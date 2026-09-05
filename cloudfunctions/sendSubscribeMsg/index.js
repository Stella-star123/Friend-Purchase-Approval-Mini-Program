/**
 * sendSubscribeMsg —— 订阅消息下发 + 授权配额记录
 * 规格书 §2.6 / §5
 *
 * 两个 action：
 *  - 'grant'：前端 wx.requestSubscribeMessage 授权成功后调用，累加当前用户的一次性订阅配额
 *  - 'send' ：仅供 submitApply / approveApplication 内部调用，需携带 internalToken
 *
 * 为什么要自己记配额：一次性订阅消息每次授权只能发 1 条。
 * 审批人的「待审批提醒」配额来自审批人自己在待审批页的授权，
 * 与申请人的「结果通知」配额是两套，必须分别记录，否则会出现 43101 下发失败。
 */
const cloud = require('wx-server-sdk');
const C = require('./common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

/**
 * 模板字段映射
 * ⚠️ 下面的 thing1 / amount2 / time4 等 key 必须与你在微信公众平台
 *    「功能 - 订阅消息」里选定的模板字段完全一致，否则会报 47003。
 */
const FIELD_MAP = {
  PENDING: {
    thing1: (r) => cut(r.itemName, 20), // 物品名称
    amount2: (r) => `${Number(r.price).toFixed(2)}元`, // 金额
    thing3: (r) => cut(C.maskOpenid(r._openid || r.applicantOpenid), 20), // 申请人
    time4: (r) => C.formatTime(r.createdAt), // 提交时间
  },
  RESULT: {
    thing1: (r) => cut(r.itemName, 20), // 物品名称
    phrase2: (r) => (r.status === C.STATUS.APPROVED ? '已通过' : '未通过'), // 审批结果
    thing3: (r) => cut(r.approveNote || '无', 20), // 审批备注
    time4: (r) => C.formatTime(r.updatedAt), // 处理时间
  },
};

const PAGE_MAP = {
  PENDING: () => 'pages/pending/index',
  RESULT: (r) => `pages/detail/index?id=${r._id}`,
};

function cut(str, len) {
  const s = String(str == null ? '' : str);
  return s.length > len ? `${s.slice(0, len - 1)}…` : s;
}

function quotaId(openid, templateId) {
  return `${openid}_${templateId}`;
}

/** 授权成功后累加配额 */
async function grantQuota(openid, templateIds) {
  const collection = db.collection(C.COLLECTION.SUBSCRIBE_QUOTA);
  const results = [];
  for (const templateId of templateIds) {
    const _id = quotaId(openid, templateId);
    try {
      const res = await collection.doc(_id).update({
        data: { count: _.inc(1), updatedAt: Date.now() },
      });
      if (!res.stats || res.stats.updated === 0) throw new Error('NOT_EXIST');
      results.push({ templateId, created: false });
    } catch (err) {
      // 文档不存在 → 新建
      try {
        await collection.add({
          data: { _id, _openid: openid, templateId, count: 1, updatedAt: Date.now() },
        });
        results.push({ templateId, created: true });
      } catch (addErr) {
        console.error('[sendSubscribeMsg] 配额写入失败', templateId, addErr);
        results.push({ templateId, error: true });
      }
    }
  }
  return results;
}

/** 消耗一次配额，成功返回 true */
async function consumeQuota(openid, templateId) {
  const collection = db.collection(C.COLLECTION.SUBSCRIBE_QUOTA);
  const res = await collection
    .where({ _id: quotaId(openid, templateId), count: _.gte(1) })
    .update({ data: { count: _.inc(-1), updatedAt: Date.now() } });
  return !!(res.stats && res.stats.updated > 0);
}

/** 向单个用户下发 */
async function sendToUser(openid, templateId, scene, record) {
  const hasQuota = await consumeQuota(openid, templateId);
  if (!hasQuota) {
    console.warn(`[sendSubscribeMsg] ${openid} 无 ${scene} 订阅配额，跳过下发`);
    return { openid, skipped: 'NO_QUOTA' };
  }

  const map = FIELD_MAP[scene];
  const data = {};
  Object.keys(map).forEach((key) => {
    data[key] = { value: map[key](record) };
  });

  try {
    await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId,
      page: PAGE_MAP[scene](record),
      miniprogramState: 'formal', // 体验版/开发版联调时改成 'trial' / 'developer'
      lang: 'zh_CN',
      data,
    });
    return { openid, sent: true };
  } catch (err) {
    console.error('[sendSubscribeMsg] 下发失败', openid, err);
    // 下发失败把配额退回，避免白扣
    try {
      await db
        .collection(C.COLLECTION.SUBSCRIBE_QUOTA)
        .doc(quotaId(openid, templateId))
        .update({ data: { count: _.inc(1) } });
    } catch (e) {
      /* 退回失败可忽略 */
    }
    return { openid, error: (err && err.errCode) || 'SEND_FAIL' };
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = C.sanitizeString(event.action, 20) || 'send';

  // ---------- 授权配额记录（前端可直接调用，只能记自己的）----------
  if (action === 'grant') {
    if (!OPENID) return C.fail(C.ERR.FORBIDDEN, '无法识别用户身份');
    const ids = Array.isArray(event.templateIds) ? event.templateIds : [];
    const valid = ids
      .map((s) => C.sanitizeString(s, 100))
      .filter((s) => s && s.indexOf('REPLACE_') !== 0);
    if (!valid.length) return C.fail(C.ERR.INVALID_PARAM, '缺少有效的模板 ID');
    const results = await grantQuota(OPENID, valid);
    return C.ok(results);
  }

  // ---------- 下发（仅内部调用）----------
  if (action !== 'send') {
    return C.fail(C.ERR.INVALID_PARAM, '不支持的 action');
  }
  if (C.sanitizeString(event.internalToken, 200) !== C.INTERNAL_TOKEN) {
    return C.fail(C.ERR.FORBIDDEN, '仅允许内部调用');
  }

  const scene = C.sanitizeString(event.scene, 20);
  if (!FIELD_MAP[scene]) return C.fail(C.ERR.INVALID_PARAM, '未知的下发场景');

  const record = event.record || {};
  if (!record._id) return C.fail(C.ERR.INVALID_PARAM, '缺少申请单数据');

  const templateId = C.SUBSCRIBE_TEMPLATES[scene];
  if (!templateId || templateId.indexOf('REPLACE_') === 0) {
    console.warn(`[sendSubscribeMsg] 模板 ID 未配置，跳过 ${scene} 下发`);
    return C.ok({ skipped: 'TEMPLATE_NOT_CONFIGURED' });
  }

  // 场景 A → 发给所有审批人；场景 B → 发给申请人
  const targets =
    scene === 'PENDING'
      ? C.getApproverList()
      : [record._openid || record.applicantOpenid].filter(Boolean);

  if (!targets.length) {
    console.warn('[sendSubscribeMsg] 没有可下发的目标用户');
    return C.ok({ skipped: 'NO_TARGET' });
  }

  const results = [];
  for (const target of targets) {
    results.push(await sendToUser(target, templateId, scene, record));
  }
  return C.ok(results);
};
