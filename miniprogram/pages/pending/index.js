const { callFunction } = require('../../utils/cloud');
const { decorateRecord, formatPrice } = require('../../utils/format');
const { SUBSCRIBE_TEMPLATES } = require('../../config/index');

const app = getApp();

Page({
  data: {
    // loading / error / forbidden / empty / ready
    state: 'loading',
    errorText: '',
    list: [],
    total: 0,
    sumPriceText: '0.00',
    subscribeReady: false,
  },

  onLoad() {
    this.fetchList();
  },

  onShow() {
    if (this.data.state !== 'loading') {
      this.fetchList({ silent: true });
    }
  },

  onPullDownRefresh() {
    this.fetchList({ silent: true }).then(() => wx.stopPullDownRefresh());
  },

  fetchList(options = {}) {
    if (this._loading) return Promise.resolve();
    this._loading = true;
    if (!options.silent) {
      this.setData({ state: 'loading', errorText: '' });
    }

    return callFunction('getPendingList', { page: 1, pageSize: 50 })
      .then((res) => {
        const list = (res.data || []).map(decorateRecord);
        app.globalData.isApprover = true;
        this.setData({
          list,
          total: res.total || list.length,
          sumPriceText: formatPrice(res.sumPrice || 0),
          state: list.length ? 'ready' : 'empty',
        });
      })
      .catch((err) => {
        if (err.errCode === 'FORBIDDEN') {
          app.globalData.isApprover = false;
          this.setData({
            state: 'forbidden',
            errorText: '你不是审批人，这里只有审批人可见',
          });
          return;
        }
        this.setData({
          state: 'error',
          errorText: err.friendlyMessage || '加载失败，请检查网络',
        });
      })
      .then(() => {
        this._loading = false;
      });
  },

  onRetry() {
    this.fetchList();
  },

  onRefreshTap() {
    if (this.data.state === 'loading') return;
    this.fetchList();
  },

  goApprove(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    wx.navigateTo({ url: `/pages/approve/index?id=${id}` });
  },

  /** 审批人开启「待审批提醒」：一次性订阅，需自己授权累积配额 */
  onEnableReminder() {
    const tmplIds = [SUBSCRIBE_TEMPLATES.PENDING].filter(
      (id) => id && id.indexOf('REPLACE_') !== 0
    );
    if (!tmplIds.length) {
      wx.showToast({ title: '尚未配置提醒模板', icon: 'none' });
      return;
    }
    wx.requestSubscribeMessage({
      tmplIds,
      success: (res) => {
        const accepted = tmplIds.filter((id) => res[id] === 'accept');
        if (!accepted.length) {
          wx.showToast({ title: '未开启提醒', icon: 'none' });
          return;
        }
        callFunction('sendSubscribeMsg', { action: 'grant', templateIds: accepted })
          .then(() => {
            this.setData({ subscribeReady: true });
            wx.showToast({ title: '已开启一次提醒', icon: 'success' });
          })
          .catch(() => wx.showToast({ title: '开启失败，请重试', icon: 'none' }));
      },
      fail: () => wx.showToast({ title: '开启失败，请重试', icon: 'none' }),
    });
  },
});
