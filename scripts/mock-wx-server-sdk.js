/**
 * wx-server-sdk 的内存版模拟实现，仅用于本地跑云函数逻辑测试。
 * 不参与部署，也不会被上传到云端。
 */

const store = { approvals: [], subscribeQuota: [] };
let currentOpenid = '';
const registry = {}; // 云函数名 → main
const sentMessages = [];
let autoId = 0;

// ---------------- 指令对象 ----------------
const cmd = {
  gte: (value) => ({ __cmd: 'gte', value }),
  gt: (value) => ({ __cmd: 'gt', value }),
  lt: (value) => ({ __cmd: 'lt', value }),
  inc: (value) => ({ __cmd: 'inc', value }),
  aggregate: {
    sum: (expr) => ({ __agg: 'sum', field: String(expr).replace(/^\$/, '') }),
  },
};

function matchOne(docValue, cond) {
  if (cond && typeof cond === 'object' && cond.__cmd) {
    switch (cond.__cmd) {
      case 'gte':
        return docValue >= cond.value;
      case 'gt':
        return docValue > cond.value;
      case 'lt':
        return docValue < cond.value;
      default:
        throw new Error(`mock 未实现的查询指令：${cond.__cmd}`);
    }
  }
  return docValue === cond;
}

function matchWhere(doc, where) {
  if (!where) return true;
  return Object.keys(where).every((k) => matchOne(doc[k], where[k]));
}

function applyUpdate(doc, data) {
  Object.keys(data).forEach((k) => {
    const v = data[k];
    if (v && typeof v === 'object' && v.__cmd === 'inc') {
      doc[k] = (Number(doc[k]) || 0) + v.value;
    } else {
      doc[k] = v;
    }
  });
}

function project(doc, field) {
  if (!field) return Object.assign({}, doc);
  const out = {};
  Object.keys(field).forEach((k) => {
    if (field[k] && k in doc) out[k] = doc[k];
  });
  return out;
}

// ---------------- 查询链 ----------------
class Query {
  constructor(name) {
    this.name = name;
    this._where = null;
    this._orderBy = [];
    this._skip = 0;
    this._limit = 100;
    this._field = null;
    this._docId = null;
  }

  get _rows() {
    if (!store[this.name]) store[this.name] = [];
    return store[this.name];
  }

  where(w) {
    this._where = w;
    return this;
  }
  orderBy(field, dir) {
    this._orderBy.push([field, dir]);
    return this;
  }
  skip(n) {
    this._skip = n;
    return this;
  }
  limit(n) {
    this._limit = n;
    return this;
  }
  field(f) {
    this._field = f;
    return this;
  }
  doc(id) {
    this._docId = id;
    return this;
  }

  _filtered() {
    let rows = this._rows.filter((d) => matchWhere(d, this._where));
    if (this._docId != null) rows = rows.filter((d) => d._id === this._docId);
    this._orderBy.forEach(([f, dir]) => {
      rows.sort((a, b) => (dir === 'desc' ? (b[f] > a[f] ? 1 : -1) : a[f] > b[f] ? 1 : -1));
    });
    return rows;
  }

  async get() {
    if (this._docId != null) {
      const row = this._rows.find((d) => d._id === this._docId);
      if (!row) {
        const err = new Error('document.get:fail document does not exist');
        err.errCode = -1;
        throw err;
      }
      return { data: project(row, this._field) };
    }
    const rows = this._filtered().slice(this._skip, this._skip + this._limit);
    return { data: rows.map((r) => project(r, this._field)) };
  }

  async count() {
    return { total: this._filtered().length };
  }

  async add({ data }) {
    const _id = data._id != null ? data._id : `mock_${++autoId}`;
    if (this._rows.some((d) => d._id === _id)) {
      const err = new Error('duplicate _id');
      err.errCode = -502001;
      throw err;
    }
    this._rows.push(Object.assign({}, data, { _id }));
    return { _id };
  }

  async update({ data }) {
    const rows = this._filtered();
    if (this._docId != null && rows.length === 0) {
      // 真实环境 doc().update() 命中不到会报错
      const err = new Error('document.update:fail document does not exist');
      err.errCode = -1;
      throw err;
    }
    rows.forEach((r) => applyUpdate(r, data));
    return { stats: { updated: rows.length } };
  }

  aggregate() {
    const self = this;
    const pipeline = { where: null, group: null };
    const agg = {
      match(w) {
        pipeline.where = w;
        return agg;
      },
      group(g) {
        pipeline.group = g;
        return agg;
      },
      async end() {
        const rows = self._rows.filter((d) => matchWhere(d, pipeline.where));
        if (!pipeline.group) return { list: rows };
        const out = { _id: pipeline.group._id };
        Object.keys(pipeline.group).forEach((k) => {
          if (k === '_id') return;
          const spec = pipeline.group[k];
          if (spec && spec.__agg === 'sum') {
            out[k] = rows.reduce((s, r) => s + (Number(r[spec.field]) || 0), 0);
          }
        });
        return { list: rows.length ? [out] : [] };
      },
    };
    return agg;
  }
}

// ---------------- 对外接口 ----------------
const database = () => {
  const db = (name) => new Query(name);
  return {
    collection: (name) => new Query(name),
    command: cmd,
  };
};
database.command = cmd;

const sdk = {
  DYNAMIC_CURRENT_ENV: 'mock-env',
  init() {},
  getWXContext: () => ({ OPENID: currentOpenid, APPID: 'mock-appid' }),
  database: () => {
    const d = { collection: (name) => new Query(name) };
    Object.defineProperty(d, 'command', { get: () => cmd });
    return d;
  },
  callFunction: async ({ name, data }) => {
    if (!registry[name]) throw new Error(`mock: 云函数 ${name} 未注册`);
    // 云函数互调时 OPENID 上下文延续
    const result = await registry[name](data || {});
    return { result };
  },
  openapi: {
    subscribeMessage: {
      send: async (payload) => {
        sentMessages.push(payload);
        return { errCode: 0 };
      },
    },
  },
};

// 测试辅助
sdk.__mock = {
  store,
  sentMessages,
  register(name, main) {
    registry[name] = main;
  },
  setOpenid(openid) {
    currentOpenid = openid;
  },
  reset() {
    store.approvals.length = 0;
    store.subscribeQuota.length = 0;
    sentMessages.length = 0;
    autoId = 0;
  },
};

module.exports = sdk;
