/**
 * getApplicationDetail —— 申请详情
 * 规格书 §2.3 / §4
 *
 * 可读取的两类身份：
 *  1. 申请人本人（_openid === OPENID）
 *  2. 审批人：pending 单放开；已由本人审批过的单（approverOpenid === OPENID）也放开，
 *     否则审批完成后审批页无法刷新详情。
 * 防越权：以 id 读取时服务端二次校验身份，不信任前端带入的 openid。
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

  const id = C.sanitizeString(event.id, 64);
  if (!id) return C.fail(C.ERR.INVALID_PARAM, '缺少申请单 id');

  let doc;
  try {
    const res = await db.collection(C.COLLECTION.APPROVALS).doc(id).get();
    doc = res.data;
  } catch (err) {
    console.error('[getApplicationDetail] 读取失败', err);
    return C.fail(C.ERR.NOT_FOUND, '记录不存在或已被删除');
  }
  if (!doc) return C.fail(C.ERR.NOT_FOUND, '记录不存在或已被删除');

  const isOwner = doc._openid === OPENID;
  const approver = C.isApprover(OPENID);
  const approverCanRead =
    approver && (doc.status === C.STATUS.PENDING || doc.approverOpenid === OPENID);

  if (!isOwner && !approverCanRead) {
    return C.fail(C.ERR.FORBIDDEN, '你没有查看该申请的权限');
  }

  // 申请人侧不需要看到审批人原始 openid，做脱敏
  const payload = Object.assign({}, doc, {
    applicantOpenid: doc._openid,
    applicantMask: C.maskOpenid(doc._openid),
    approverMask: doc.approverOpenid ? C.maskOpenid(doc.approverOpenid) : '',
    viewerRole: isOwner ? 'applicant' : 'approver',
    canApprove: approver && doc.status === C.STATUS.PENDING,
  });
  if (!approver) {
    delete payload.approverOpenid;
    delete payload.applicantOpenid;
  }
  delete payload._openid;

  return C.ok(payload);
};
