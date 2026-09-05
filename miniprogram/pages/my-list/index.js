const { callFunction } = require('../../utils/cloud');
const { decorateRecord } = require('../../utils/format');

const app = getApp();

Page({
  data: {
    // 页面状态：loading / error / empty / ready
    state: 'loading',
    errorText: '',
    list: [],
    total: 0,
  },

  onLoad() {
    this.fetchList();
  },

  onShow() {
    // 从新建/详情页返回时刷新，保证状态最新
    if (this.data.state !== 'loading') {
      this.fetchList({ silent: true });
    }
  },

  onPullDownRefresh() {
    this.fetchList({ silent: true }).then(() => wx.stopPullDownRefresh());
  },

  /**
   * @param {object} options silent=true 时不切到骨架屏（用于下拉/返回刷新）
   */
  fetchList(options = {}) {
    if (this._loading) return Promise.resolve();
    this._loading = true;
    if (!options.silent) {
      this.setData({ state: 'loading', errorText: '' });
    }

    return callFunction('getMyApplications', { page: 1, pageSize: 50 })
      .then((res) => {
        const list = (res.data || []).map(decorateRecord);
        app.globalData.isApprover = !!res.isApprover;
        this.setData({
          list,
          total: res.total || list.length,
          state: list.length ? 'ready' : 'empty',
        });
      })
      .catch((err) => {
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
    if (this.data.state === 'loading') return; // 加载中禁用刷新
    this.fetchList();
  },

  goApply() {
    wx.navigateTo({ url: '/pages/apply/index' });
  },

  goDetail(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    wx.navigateTo({ url: `/pages/detail/index?id=${id}` });
  },
});
