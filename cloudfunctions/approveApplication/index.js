/**
 * approveApplication —— 通过 / 拒绝 + 备注
 * 规格书 §2.5
 *
 * 1. 校验审批人身份（白名单）
 * 2. 校验目标单 status === 'pending'，避免重复审批
 *    —— 用「带 status 条件的 update」做原子更新，双端同时点击也只有一次生效
 * 3. 更新 status / approverOpenid / approveNote / updatedAt
 * 4. 通知申请人最终结果
 */
const cloud = require('wx-server-sdk');
const C = require('./common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const DECISION_ENUM = [C.STATUS.APPROVED, C.STATUS.REJECTED];

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return C.fail(C.ERR.FORBIDDEN, '无法识别用户身份');
  }
  if (!C.isApprover(OPENID)) {
    return C.fail(C.ERR.FORBIDDEN, '你不是审批人，无权执行审批');
  }

  const id = C.sanitizeString(event.id, 64);
  if (!id) return C.fail(C.ERR.INVALID_PARAM, '缺少申请单 id');

  const decision = C.sanitizeString(event.decision, 20);
  if (DECISION_ENUM.indexOf(decision) === -1) {
    return C.fail(C.ERR.INVALID_PARAM, '审批结果取值不合法');
  }

  const approveNote = C.sanitizeString(event.approveNote, 200);
  const now = Date.now();
  const collection = db.collection(C.COLLECTION.APPROVALS);

  // 原子更新：仅当当前状态仍为 pending 时才写入
  let updateRes;
  try {
    updateRes = await collection
      .where({ _id: id, status: C.STATUS.PENDING })
      .update({
        data: {
          status: decision,
          approverOpenid: OPENID,
          approveNote,
          updatedAt: now,
        },
      });
  } catch (err) {
    console.error('[approveApplication] 更新失败', err);
    return C.fail(C.ERR.INTERNAL, '审批失败，请稍后重试');
  }

  if (!updateRes.stats || updateRes.stats.updated === 0) {
    // 要么 id 不存在，要么已被处理过
    let exists = null;
    try {
      const res = await collection.doc(id).get();
      exists = res.data;
    } catch (e) {
      exists = null;
    }
    if (!exists) return C.fail(C.ERR.NOT_FOUND, '记录不存在或已被删除');
    return C.fail(C.ERR.ALREADY_HANDLED, '该申请已被处理，无需重复审批');
  }

  // 通知申请人；下发失败不回滚审批结果
  try {
    const res = await collection.doc(id).get();
    const doc = res.data || {};
    await cloud.callFunction({
      name: 'sendSubscribeMsg',
      data: {
        action: 'send',
        internalToken: C.INTERNAL_TOKEN,
        scene: 'RESULT',
        record: Object.assign({}, doc, { _id: id }),
      },
    });
  } catch (err) {
    console.error('[approveApplication] 订阅消息下发失败（已忽略）', err);
  }

  return C.ok({ status: decision });
};
