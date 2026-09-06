/* eslint-disable */
// ⚠️ 本文件由 scripts/sync-shared.js 自动生成，请勿直接修改。
// 源文件：shared/common.js

/**
 * 云函数共享模块（唯一源文件）
 * ⚠️ 不要直接改各云函数目录下生成的 common.js —— 改这里，然后执行：
 *      node scripts/sync-shared.js
 *    脚本会把本文件分发到 6 个云函数目录。
 */

// ---------------------------------------------------------------
// 配置区
// ---------------------------------------------------------------

// 审批人白名单见下方 getApproverList()，仅从环境变量 APPROVER_OPENIDS 读取，不在代码里写死。

/** 集合名 */
const COLLECTION = {
  APPROVALS: 'approvals',
  SUBSCRIBE_QUOTA: 'subscribeQuota',
};

/** 自动审批阈值（元）：price < 5 直接通过 */
const AUTO_APPROVE_THRESHOLD = 5;

/** 申请状态枚举 */
const STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

/**
 * 订阅消息模板 ID（与前端 config/index.js 保持一致）。
 * 仅从云函数环境变量读取，不在代码里写死：
 *   TMPL_PENDING = 待审批提醒模板 ID（场景 A，发给审批人）
 *   TMPL_RESULT  = 审批结果通知模板 ID（场景 B，发给申请人）
 */
const SUBSCRIBE_TEMPLATES = {
  PENDING: process.env.TMPL_PENDING || '',
  RESULT: process.env.TMPL_RESULT || '',
};

/**
 * 云函数之间互调的内部令牌。
 * 防止前端伪造 action='send' 直接给任意用户发订阅消息。
 * 仅从云函数环境变量 INTERNAL_TOKEN 读取，不在代码里写死。
 * 若未配置，sendSubscribeMsg 会直接报错（避免空令牌被绕过）。
 */
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || '';

// ---------------------------------------------------------------
// 错误码
// ---------------------------------------------------------------

const ERR = {
  INVALID_PARAM: 'INVALID_PARAM',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_HANDLED: 'ALREADY_HANDLED',
  INTERNAL: 'INTERNAL',
};

// ---------------------------------------------------------------
// 统一响应
// ---------------------------------------------------------------

function ok(data, extra) {
  return Object.assign({ success: true, data }, extra || {});
}

function fail(errCode, message) {
  return { success: false, errCode, message: message || '' };
}

// ---------------------------------------------------------------
// 身份与权限
// ---------------------------------------------------------------

/**
 * 审批人白名单：仅从云函数环境变量 APPROVER_OPENIDS 读取（逗号分隔）。
 * 未配置时返回空数组 → 所有人都会被判定为非审批人（fail-closed，安全）。
 * 配置入口：云开发控制台 → 云函数 → 配置 → 环境变量。
 */
function getApproverList() {
  const fromEnv = process.env.APPROVER_OPENIDS;
  if (!fromEnv || !fromEnv.trim()) return [];
  return fromEnv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 当前 openid 是否审批人 */
function isApprover(openid) {
  if (!openid) return false;
  return getApproverList().indexOf(openid) > -1;
}

// ---------------------------------------------------------------
// 参数校验
// ---------------------------------------------------------------

/** 去首尾空白并限长，非字符串返回空串 */
function sanitizeString(val, maxLen) {
  if (typeof val !== 'string') return '';
  const s = val.trim();
  return maxLen ? s.slice(0, maxLen) : s;
}

/**
 * 校验并归一化价格
 * @returns {{ok: boolean, value?: number, message?: string}}
 */
function normalizePrice(raw) {
  const n = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return { ok: false, message: '价格必须为数字' };
  }
  if (n < 0) {
    return { ok: false, message: '价格不能为负数' };
  }
  if (n > 1000000) {
    return { ok: false, message: '价格超出允许范围' };
  }
  // 保留两位小数，规避浮点误差
  return { ok: true, value: Math.round(n * 100) / 100 };
}

/** 仅允许 http/https 链接，其他一律视为空 */
function normalizeUrl(raw) {
  const s = sanitizeString(raw, 1000);
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : '';
}

/** 云存储 fileID 校验（cloud:// 开头） */
function normalizeFileId(raw) {
  const s = sanitizeString(raw, 500);
  if (!s) return '';
  return /^cloud:\/\//i.test(s) ? s : '';
}

/** 分页参数归一化 */
function normalizePaging(input) {
  const raw = input || {};
  let page = Number(raw.page);
  let pageSize = Number(raw.pageSize);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = 20;
  page = Math.floor(page);
  pageSize = Math.min(Math.floor(pageSize), 100);
  return { page, pageSize, skip: (page - 1) * pageSize };
}

// ---------------------------------------------------------------
// 时间格式化（订阅消息用，东八区）
// ---------------------------------------------------------------

function formatTime(ts) {
  const d = new Date(Number(ts) + 8 * 3600 * 1000); // 云函数默认 UTC，转东八区
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours()
  )}:${pad(d.getUTCMinutes())}`;
}

/** openid 脱敏 */
function maskOpenid(openid) {
  if (!openid) return '未知用户';
  if (openid.length <= 8) return openid;
  return `${openid.slice(0, 5)}***${openid.slice(-3)}`;
}

module.exports = {
  COLLECTION,
  AUTO_APPROVE_THRESHOLD,
  STATUS,
  SUBSCRIBE_TEMPLATES,
  INTERNAL_TOKEN,
  ERR,
  ok,
  fail,
  getApproverList,
  isApprover,
  sanitizeString,
  normalizePrice,
  normalizeUrl,
  normalizeFileId,
  normalizePaging,
  formatTime,
  maskOpenid,
};
