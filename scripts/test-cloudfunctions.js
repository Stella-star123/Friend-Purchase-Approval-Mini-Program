#!/usr/bin/env node
/**
 * 云函数逻辑测试（不需要部署，纯本地内存库）
 *   node scripts/test-cloudfunctions.js
 *
 * 覆盖规格书 §7.5 的必测项：
 *   自动审批阈值 / 权限越权 / 重复审批 / 参数校验 / 订阅消息下发
 */

// ⚠️ 必须在 require 云函数之前设置环境变量：common.js 在加载时读取
const APPROVER = 'oAPPROVER_0001';
const FRIEND_A = 'oFRIEND_A_0001';
const FRIEND_B = 'oFRIEND_B_0002';

process.env.APPROVER_OPENIDS = APPROVER;
process.env.TMPL_PENDING = 'TMPL_PENDING_TEST';
process.env.TMPL_RESULT = 'TMPL_RESULT_TEST';
process.env.INTERNAL_TOKEN = 'test-internal-token';

const path = require('path');
const Module = require('module');

// 用 mock 替换 wx-server-sdk
const mockSdk = require('./mock-wx-server-sdk');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return mockSdk;
  return originalLoad.apply(this, arguments);
};

const CF = path.resolve(__dirname, '..', 'cloudfunctions');
const FN_NAMES = [
  'submitApply',
  'getMyApplications',
  'getApplicationDetail',
  'getPendingList',
  'approveApplication',
  'sendSubscribeMsg',
];

const fns = {};
FN_NAMES.forEach((name) => {
  fns[name] = require(path.join(CF, name, 'index.js')).main;
  mockSdk.__mock.register(name, fns[name]);
});

// ---------------- 迷你断言框架 ----------------
let passed = 0;
const failures = [];
let currentGroup = '';

function group(name) {
  currentGroup = name;
  console.log(`\n${name}`);
}

function check(desc, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${desc}`);
  } else {
    failures.push(`[${currentGroup}] ${desc}${detail ? ` —— ${detail}` : ''}`);
    console.log(`  ✗ ${desc}${detail ? ` —— ${detail}` : ''}`);
  }
}

function as(openid) {
  mockSdk.__mock.setOpenid(openid);
}

const baseForm = {
  itemName: 'A4 打印纸',
  reason: '打印机没纸了',
};

function form(extra) {
  return Object.assign({}, baseForm, extra);
}

// ---------------- 测试主体 ----------------
async function run() {
  // ============ 1. 自动审批阈值 ============
  group('1. 自动审批阈值（price < 5 → approved，>= 5 → pending）');
  mockSdk.__mock.reset();
  as(FRIEND_A);

  const cases = [
    { price: 0, expect: 'approved' },
    { price: 4.99, expect: 'approved' },
    { price: 5, expect: 'pending' },
    { price: 5.01, expect: 'pending' },
    { price: 128, expect: 'pending' },
  ];
  for (const c of cases) {
    const res = await fns.submitApply(form({ price: c.price }));
    check(
      `¥${c.price} → ${c.expect}`,
      res.success && res.data.status === c.expect,
      res.success ? `实际 ${res.data.status}` : res.message
    );
  }

  // 字符串价格也应被正确归一化
  const strPrice = await fns.submitApply(form({ price: '3.5' }));
  check('字符串 "3.5" 归一化后自动通过', strPrice.success && strPrice.data.status === 'approved');

  // 服务端时间与 openid
  const firstDoc = mockSdk.__mock.store.approvals[0];
  check('_openid 由服务端写入', firstDoc._openid === FRIEND_A);
  check('createdAt / updatedAt 由服务端生成', typeof firstDoc.createdAt === 'number' && firstDoc.createdAt > 0);

  // 客户端伪造 openid / 时间应被忽略
  const forged = await fns.submitApply(
    form({ price: 10, _openid: 'oHACKER', createdAt: 1, openid: 'oHACKER' })
  );
  const forgedDoc = mockSdk.__mock.store.approvals.find((d) => d._id === forged.data._id);
  check('客户端传入的 _openid 被忽略', forgedDoc._openid === FRIEND_A);
  check('客户端传入的 createdAt 被忽略', forgedDoc.createdAt > 1000);

  // ============ 2. 参数校验 ============
  group('2. 参数校验');
  const invalidCases = [
    { desc: '空物品名称', payload: form({ price: 10, itemName: '   ' }) },
    { desc: '价格为负', payload: form({ price: -1 }) },
    { desc: '价格非数字', payload: form({ price: 'abc' }) },
    { desc: '缺少价格', payload: form({}) },
    { desc: '空申请理由', payload: form({ price: 10, reason: '' }) },
  ];
  for (const c of invalidCases) {
    const res = await fns.submitApply(c.payload);
    check(
      `${c.desc} → INVALID_PARAM`,
      !res.success && res.errCode === 'INVALID_PARAM',
      JSON.stringify(res)
    );
  }

  // 非法链接被清空，而不是报错
  const badUrl = await fns.submitApply(form({ price: 10, productUrl: 'javascript:alert(1)' }));
  const badUrlDoc = mockSdk.__mock.store.approvals.find((d) => d._id === badUrl.data._id);
  check('非 http(s) 链接被清空', badUrl.success && badUrlDoc.productUrl === '');

  const badFile = await fns.submitApply(form({ price: 10, imageUrl: 'http://evil.com/a.png' }));
  const badFileDoc = mockSdk.__mock.store.approvals.find((d) => d._id === badFile.data._id);
  check('非 cloud:// 的 imageUrl 被清空', badFile.success && badFileDoc.imageUrl === '');

  // ============ 3. 我的申请列表权限 ============
  group('3. getMyApplications 只返回本人记录');
  mockSdk.__mock.reset();

  as(FRIEND_A);
  await fns.submitApply(form({ price: 39, itemName: 'A的申请1' }));
  await fns.submitApply(form({ price: 89, itemName: 'A的申请2' }));
  as(FRIEND_B);
  await fns.submitApply(form({ price: 128, itemName: 'B的申请' }));

  as(FRIEND_A);
  const listA = await fns.getMyApplications({});
  check('A 只看到自己的 2 条', listA.success && listA.data.length === 2 && listA.total === 2);
  check(
    'A 的列表不含 B 的记录',
    listA.data.every((d) => d.itemName.indexOf('B的') === -1)
  );
  check('列表按 createdAt 倒序', listA.data[0].itemName === 'A的申请2');
  check('非审批人 isApprover 为 false', listA.isApprover === false);

  as(APPROVER);
  const listApprover = await fns.getMyApplications({});
  check('审批人 isApprover 为 true', listApprover.isApprover === true);

  // ============ 4. 待我审批列表权限 ============
  group('4. getPendingList 审批人白名单校验');
  as(FRIEND_A);
  const pendingByFriend = await fns.getPendingList({});
  check(
    '非审批人访问 → FORBIDDEN',
    !pendingByFriend.success && pendingByFriend.errCode === 'FORBIDDEN',
    JSON.stringify(pendingByFriend)
  );

  as(APPROVER);
  const pending = await fns.getPendingList({});
  check('审批人可访问', pending.success === true);
  check('共 3 笔待审批', pending.total === 3, `实际 ${pending.total}`);
  check(
    '合计金额 = 39 + 89 + 128 = 256',
    pending.sumPrice === 256,
    `实际 ${pending.sumPrice}`
  );
  check(
    '返回 applicantOpenid 且已附脱敏串',
    pending.data[0].applicantOpenid && pending.data[0].applicantMask.indexOf('***') > -1
  );

  // 低于阈值的自动通过单不应出现在待审列表
  as(FRIEND_A);
  await fns.submitApply(form({ price: 3, itemName: '小额自动通过' }));
  as(APPROVER);
  const pending2 = await fns.getPendingList({});
  check('自动通过的小额单不进待审列表', pending2.total === 3, `实际 ${pending2.total}`);

  // ============ 5. 详情页权限（防越权） ============
  group('5. getApplicationDetail 防越权');
  mockSdk.__mock.reset();
  as(FRIEND_A);
  const createdA = await fns.submitApply(form({ price: 39, itemName: 'A的待审单' }));
  const idA = createdA.data._id;

  const detailOwner = await fns.getApplicationDetail({ id: idA });
  check('申请人本人可读', detailOwner.success && detailOwner.data.itemName === 'A的待审单');
  check('本人视角 viewerRole = applicant', detailOwner.data.viewerRole === 'applicant');
  check('响应中不含 _openid', !('_openid' in detailOwner.data));

  as(FRIEND_B);
  const detailOther = await fns.getApplicationDetail({ id: idA });
  check(
    '其他普通用户读取 → FORBIDDEN',
    !detailOther.success && detailOther.errCode === 'FORBIDDEN',
    JSON.stringify(detailOther)
  );

  as(APPROVER);
  const detailApprover = await fns.getApplicationDetail({ id: idA });
  check('审批人可读 pending 单', detailApprover.success === true);
  check('审批人 canApprove = true', detailApprover.data.canApprove === true);

  const notFound = await fns.getApplicationDetail({ id: 'not_exist_id' });
  check('不存在的 id → NOT_FOUND', !notFound.success && notFound.errCode === 'NOT_FOUND');

  const noId = await fns.getApplicationDetail({});
  check('缺少 id → INVALID_PARAM', !noId.success && noId.errCode === 'INVALID_PARAM');

  // 审批人不能读自己没审过的非 pending 单
  as(FRIEND_A);
  const autoApproved = await fns.submitApply(form({ price: 2, itemName: '自动通过单' }));
  as(APPROVER);
  const detailAuto = await fns.getApplicationDetail({ id: autoApproved.data._id });
  check(
    '审批人读取非本人审批的已完成单 → FORBIDDEN',
    !detailAuto.success && detailAuto.errCode === 'FORBIDDEN',
    JSON.stringify(detailAuto)
  );

  // ============ 6. 审批操作 ============
  group('6. approveApplication 审批与重复审批拦截');
  as(FRIEND_A);
  const approveNonApprover = await fns.approveApplication({ id: idA, decision: 'approved' });
  check(
    '非审批人执行审批 → FORBIDDEN',
    !approveNonApprover.success && approveNonApprover.errCode === 'FORBIDDEN'
  );

  as(APPROVER);
  const badDecision = await fns.approveApplication({ id: idA, decision: 'maybe' });
  check(
    '非法 decision → INVALID_PARAM',
    !badDecision.success && badDecision.errCode === 'INVALID_PARAM'
  );

  const rejectRes = await fns.approveApplication({
    id: idA,
    decision: 'rejected',
    approveNote: '不符合采购要求，换个更便宜的',
  });
  check('审批人拒绝成功', rejectRes.success && rejectRes.data.status === 'rejected');

  const docA = mockSdk.__mock.store.approvals.find((d) => d._id === idA);
  check('status 已更新为 rejected', docA.status === 'rejected');
  check('approverOpenid 写入审批人', docA.approverOpenid === APPROVER);
  check('approveNote 已保存', docA.approveNote === '不符合采购要求，换个更便宜的');
  check('updatedAt 已刷新', docA.updatedAt >= docA.createdAt);

  const dup = await fns.approveApplication({ id: idA, decision: 'approved' });
  check(
    '重复审批 → ALREADY_HANDLED',
    !dup.success && dup.errCode === 'ALREADY_HANDLED',
    JSON.stringify(dup)
  );
  check('重复审批未改变原状态', docA.status === 'rejected');

  const approveMissing = await fns.approveApplication({ id: 'ghost', decision: 'approved' });
  check(
    '审批不存在的单 → NOT_FOUND',
    !approveMissing.success && approveMissing.errCode === 'NOT_FOUND'
  );

  // 审批后审批人仍可读该单（用于页面刷新）
  const detailAfter = await fns.getApplicationDetail({ id: idA });
  check('审批人可读自己审过的单', detailAfter.success === true);
  check('已处理单 canApprove = false', detailAfter.data.canApprove === false);

  // 被拒记录保留
  as(FRIEND_A);
  const listAfterReject = await fns.getMyApplications({});
  check(
    '被拒记录保留在申请人列表中',
    listAfterReject.data.some((d) => d._id === idA && d.status === 'rejected')
  );

  // ============ 7. 订阅消息 ============
  group('7. sendSubscribeMsg 配额与下发');
  mockSdk.__mock.reset();

  // 无配额时不下发
  as(FRIEND_A);
  await fns.submitApply(form({ price: 99, itemName: '无配额测试' }));
  check('审批人无配额时不下发', mockSdk.__mock.sentMessages.length === 0);

  // 审批人授权后累积配额
  as(APPROVER);
  const grant = await fns.sendSubscribeMsg({
    action: 'grant',
    templateIds: ['TMPL_PENDING_TEST'],
  });
  check('授权记录配额成功', grant.success === true);
  const quota = mockSdk.__mock.store.subscribeQuota.find(
    (q) => q._id === `${APPROVER}_TMPL_PENDING_TEST`
  );
  check('配额计数为 1', quota && quota.count === 1);

  await fns.sendSubscribeMsg({ action: 'grant', templateIds: ['TMPL_PENDING_TEST'] });
  check('再次授权累加到 2', quota.count === 2);

  // 有配额时提交 pending 单 → 下发给审批人
  as(FRIEND_A);
  await fns.submitApply(form({ price: 66, itemName: '有配额测试' }));
  check('pending 单触发下发', mockSdk.__mock.sentMessages.length === 1);
  const msg = mockSdk.__mock.sentMessages[0];
  check('下发目标是审批人', msg.touser === APPROVER);
  check('使用待审批模板', msg.templateId === 'TMPL_PENDING_TEST');
  check('物品名称字段正确', msg.data.thing1.value === '有配额测试');
  check('金额字段格式为 66.00元', msg.data.amount2.value === '66.00元', msg.data.amount2.value);
  check('申请人字段已脱敏', msg.data.thing3.value.indexOf('***') > -1);
  check('跳转页面为待审批页', msg.page === 'pages/pending/index');
  check('下发后配额扣减为 1', quota.count === 1);

  // 自动通过单不下发
  const before = mockSdk.__mock.sentMessages.length;
  await fns.submitApply(form({ price: 1, itemName: '自动通过不通知' }));
  check('自动通过单不触发待审批提醒', mockSdk.__mock.sentMessages.length === before);

  // 审批结果通知
  as(FRIEND_A);
  const forResult = await fns.submitApply(form({ price: 50, itemName: '结果通知测试' }));
  await fns.sendSubscribeMsg({ action: 'grant', templateIds: ['TMPL_RESULT_TEST'] });
  const beforeResult = mockSdk.__mock.sentMessages.length;

  as(APPROVER);
  await fns.approveApplication({
    id: forResult.data._id,
    decision: 'approved',
    approveNote: '批了',
  });
  const resultMsgs = mockSdk.__mock.sentMessages.slice(beforeResult);
  const resultMsg = resultMsgs.find((m) => m.templateId === 'TMPL_RESULT_TEST');
  check('审批后向申请人下发结果通知', !!resultMsg);
  if (resultMsg) {
    check('结果通知目标是申请人', resultMsg.touser === FRIEND_A);
    check('审批结果文案为 已通过', resultMsg.data.phrase2.value === '已通过');
    check('审批备注透传', resultMsg.data.thing3.value === '批了');
    check(
      '跳转到详情页并带 id',
      resultMsg.page === `pages/detail/index?id=${forResult.data._id}`
    );
  }

  // 内部令牌校验
  as(FRIEND_B);
  const forged2 = await fns.sendSubscribeMsg({
    action: 'send',
    scene: 'PENDING',
    internalToken: 'wrong-token',
    record: { _id: 'x', itemName: 'x', price: 1, createdAt: Date.now() },
  });
  check(
    '伪造 internalToken 下发 → FORBIDDEN',
    !forged2.success && forged2.errCode === 'FORBIDDEN',
    JSON.stringify(forged2)
  );

  const badGrant = await fns.sendSubscribeMsg({ action: 'grant', templateIds: [] });
  check('grant 缺少模板 ID → INVALID_PARAM', !badGrant.success && badGrant.errCode === 'INVALID_PARAM');

  // ============ 8. 未登录保护 ============
  group('8. 无 OPENID 上下文保护');
  as('');
  for (const name of ['submitApply', 'getMyApplications', 'getPendingList', 'approveApplication']) {
    const res = await fns[name]({ id: 'x', decision: 'approved', price: 1 });
    check(`${name} 无身份 → FORBIDDEN`, !res.success && res.errCode === 'FORBIDDEN');
  }

  // ---------------- 汇总 ----------------
  console.log('\n' + '='.repeat(56));
  if (failures.length) {
    console.log(`测试失败：通过 ${passed} 项，失败 ${failures.length} 项\n`);
    failures.forEach((f) => console.log(`  ✗ ${f}`));
    console.log('');
    process.exit(1);
  }
  console.log(`✓ 全部通过：${passed} 项断言`);
  console.log('='.repeat(56) + '\n');
}

run().catch((err) => {
  console.error('\n测试执行异常：', err);
  process.exit(1);
});
