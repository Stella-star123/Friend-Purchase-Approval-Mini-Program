/**
 * 展示层格式化工具
 */

const STATUS_MAP = {
  pending: { text: '待审批', color: '#F59E0B', bg: '#FFF4E5' },
  approved: { text: '已通过', color: '#16A34A', bg: '#E7F6EC' },
  rejected: { text: '已拒绝', color: '#DC2626', bg: '#FDECEC' },
};

function pad(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

/** 时间戳 → 2026-08-26 21:50 */
function formatTime(ts) {
  if (!ts) return '--';
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return '--';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 时间戳 → 08-26 21:50（列表用短格式） */
function formatShortTime(ts) {
  if (!ts) return '--';
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return '--';
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 价格 → 两位小数字符串（不带 ¥，符号在模板里加，方便控制字号） */
function formatPrice(price) {
  const n = Number(price);
  if (Number.isNaN(n)) return '0.00';
  return n.toFixed(2);
}

/** openid 脱敏：oX8k2abcdefg → oX8k2***efg */
function maskOpenid(openid) {
  if (!openid) return '未知用户';
  if (openid.length <= 8) return openid;
  return `${openid.slice(0, 5)}***${openid.slice(-3)}`;
}

/** 取 openid 首个可见字符做头像占位 */
function avatarChar(openid) {
  if (!openid) return '?';
  const m = openid.replace(/^o/i, '');
  return (m[0] || '?').toUpperCase();
}

/** 给列表记录补上展示字段，避免在 WXML 里写逻辑 */
function decorateRecord(item) {
  const status = STATUS_MAP[item.status] || STATUS_MAP.pending;
  return Object.assign({}, item, {
    priceText: formatPrice(item.price),
    createdAtText: formatTime(item.createdAt),
    createdAtShort: formatShortTime(item.createdAt),
    updatedAtText: formatTime(item.updatedAt),
    statusText: status.text,
    applicantMask: maskOpenid(item.applicantOpenid || item._openid),
    applicantChar: avatarChar(item.applicantOpenid || item._openid),
  });
}

module.exports = {
  STATUS_MAP,
  formatTime,
  formatShortTime,
  formatPrice,
  maskOpenid,
  avatarChar,
  decorateRecord,
};
