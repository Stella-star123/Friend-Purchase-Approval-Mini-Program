/**
 * 前端配置
 * ⚠️ 上线前必须替换下面 3 处 REPLACE_ 占位值
 */

// 云开发环境 ID，微信开发者工具「云开发」控制台首页可见
const CLOUD_ENV = 'cloud1-d6gmkinaad3c12a2f';

// 订阅消息模板 ID，微信公众平台「功能 - 订阅消息」创建后回填
const SUBSCRIBE_TEMPLATES = {
  // 场景 A：待审批提醒（发给审批人）
  PENDING: 'yQ7oHis_84WVvh_EjzA8WeYRDI16nfVOLy3TydEetyA',
  // 场景 B：审批结果通知（发给申请人）
  RESULT: '2flVqiJc7J354NX1TpWMT8mIGdY-vN4En-qtFodJx60',
};

// 自动审批阈值（元）：低于该值系统直接通过
const AUTO_APPROVE_THRESHOLD = 5;

module.exports = {
  CLOUD_ENV,
  SUBSCRIBE_TEMPLATES,
  AUTO_APPROVE_THRESHOLD,
};
