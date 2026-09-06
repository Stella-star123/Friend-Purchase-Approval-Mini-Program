/**
 * getMyApplications —— 我的申请列表
 * 规格书 §2.2
 *
 * 权限：强制 where _openid == 本人 OPENID
 * 排序：createdAt 倒序
 * 附加：返回 isApprover，供前端决定是否展示审批入口
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

  const { pageSize, skip } = C.normalizePaging(event);
  // 权限核心：只查本人记录，忽略客户端可能传入的任何 openid
  const where = { _openid: OPENID };

  try {
    const collection = db.collection(C.COLLECTION.APPROVALS);

    const [listRes, countRes] = await Promise.all([
      collection
        .where(where)
        .orderBy('createdAt', 'desc')
        .skip(skip)
        .limit(pageSize)
        .field({
          _id: true,
          itemName: true,
          price: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        })
        .get(),
      collection.where(where).count(),
    ]);

    return C.ok(listRes.data, {
      total: countRes.total,
      isApprover: C.isApprover(OPENID),
    });
  } catch (err) {
    console.error('[getMyApplications] 查询失败', err);
    return C.fail(C.ERR.INTERNAL, '加载失败，请稍后重试');
  }
};
