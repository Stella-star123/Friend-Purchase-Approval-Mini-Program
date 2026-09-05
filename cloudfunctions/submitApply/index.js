/**
 * submitApply —— 提交申请 + 自动审批
 * 规格书 §2.1
 *
 * 关键约束：
 *  - _openid 由 cloud.getWXContext() 获取，绝不信任客户端传入
 *  - createdAt / updatedAt 由服务端 Date.now() 生成
 *  - price < 5 → approved；price >= 5 → pending
 */
const cloud = require('wx-server-sdk');
const C = require('./common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return C.fail(C.ERR.FORBIDDEN, '无法识别用户身份');
  }

  // ---- 1. 参数校验与归一化（客户端传入的 openid / 时间一律丢弃）----
  const itemName = C.sanitizeString(event.itemName, 50);
  if (!itemName) return C.fail(C.ERR.INVALID_PARAM, '请填写物品名称');

  const priceResult = C.normalizePrice(event.price);
  if (!priceResult.ok) return C.fail(C.ERR.INVALID_PARAM, priceResult.message);
  const price = priceResult.value;

  const reason = C.sanitizeString(event.reason, 500);
  if (!reason) return C.fail(C.ERR.INVALID_PARAM, '请填写申请理由');

  const productUrl = C.normalizeUrl(event.productUrl);
  const imageUrl = C.normalizeFileId(event.imageUrl);

  // ---- 2. 自动审批判定 ----
  const status = price < C.AUTO_APPROVE_THRESHOLD ? C.STATUS.APPROVED : C.STATUS.PENDING;

  // ---- 3. 服务端时间 ----
  const now = Date.now();

  const record = {
    _openid: OPENID,
    itemName,
    price,
    productUrl,
    imageUrl,
    reason,
    status,
    // 人工审批后才写入审批人；自动通过留空表示「非人工」
    approverOpenid: '',
    approveNote:
      status === C.STATUS.APPROVED ? `系统自动通过（金额低于 ${C.AUTO_APPROVE_THRESHOLD} 元）` : '',
    createdAt: now,
    updatedAt: now,
  };

  // ---- 4. 写库 ----
  let addResult;
  try {
    addResult = await db.collection(C.COLLECTION.APPROVALS).add({ data: record });
  } catch (err) {
    console.error('[submitApply] 写库失败', err);
    return C.fail(C.ERR.INTERNAL, '提交失败，请稍后重试');
  }

  const _id = addResult._id;

  // ---- 5. pending 才通知审批人；通知失败不影响提交结果 ----
  if (status === C.STATUS.PENDING) {
    try {
      await cloud.callFunction({
        name: 'sendSubscribeMsg',
        data: {
          action: 'send',
          internalToken: C.INTERNAL_TOKEN,
          scene: 'PENDING',
          record: Object.assign({ _id }, record),
        },
      });
    } catch (err) {
      console.error('[submitApply] 订阅消息下发失败（已忽略）', err);
    }
  }

  return C.ok({ _id, status });
};
