/**
 * getPendingList —— 待我审批列表
 * 规格书 §2.4
 *
 * 权限：必须是审批人白名单成员，否则返回 FORBIDDEN(403)
 * 查询：status == 'pending' AND price >= 5
 * 出参：data / total / sumPrice（顶部汇总条用）
 */
const cloud = require('wx-server-sdk');
const C = require('./common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return C.fail(C.ERR.FORBIDDEN, '无法识别用户身份');
  }
  // 白名单校验：未命中直接 403
  if (!C.isApprover(OPENID)) {
    return C.fail(C.ERR.FORBIDDEN, '你不是审批人，无权查看待审批列表');
  }

  const { pageSize, skip } = C.normalizePaging(event);
  const where = {
    status: C.STATUS.PENDING,
    price: _.gte(C.AUTO_APPROVE_THRESHOLD),
  };

  try {
    const collection = db.collection(C.COLLECTION.APPROVALS);

    const [listRes, countRes, sumRes] = await Promise.all([
      collection
        .where(where)
        .orderBy('createdAt', 'desc')
        .skip(skip)
        .limit(pageSize)
        .field({
          _id: true,
          _openid: true,
          itemName: true,
          price: true,
          createdAt: true,
        })
        .get(),
      collection.where(where).count(),
      // 合计金额：按同样条件全量聚合，不受分页影响
      collection
        .aggregate()
        .match(where)
        .group({ _id: null, sumPrice: $.sum('$price') })
        .end(),
    ]);

    const sumPrice =
      sumRes.list && sumRes.list.length ? Math.round(sumRes.list[0].sumPrice * 100) / 100 : 0;

    // 用 applicantOpenid 对外暴露申请人标识，同时给出脱敏串
    const data = listRes.data.map((item) => ({
      _id: item._id,
      itemName: item.itemName,
      price: item.price,
      applicantOpenid: item._openid,
      applicantMask: C.maskOpenid(item._openid),
      createdAt: item.createdAt,
    }));

    return C.ok(data, { total: countRes.total, sumPrice, isApprover: true });
  } catch (err) {
    console.error('[getPendingList] 查询失败', err);
    return C.fail(C.ERR.INTERNAL, '加载失败，请稍后重试');
  }
};
