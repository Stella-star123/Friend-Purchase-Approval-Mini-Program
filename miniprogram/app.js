const { CLOUD_ENV } = require('./config/index');

App({
  globalData: {
    // 是否审批人身份，由 getMyApplications / getPendingList 返回后缓存
    isApprover: false,
    // 「修改并重新提交」时暂存的表单草稿
    resubmitDraft: null,
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('[app] 基础库版本过低，请使用 2.2.3 及以上版本以启用云能力');
      return;
    }
    if (CLOUD_ENV.indexOf('REPLACE_') === 0) {
      console.warn('[app] 尚未配置云环境 ID，请修改 miniprogram/config/index.js');
    }
    wx.cloud.init({
      env: CLOUD_ENV,
      traceUser: true,
    });
  },
});
