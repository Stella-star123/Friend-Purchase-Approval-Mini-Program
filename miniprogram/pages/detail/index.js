const { callFunction } = require('../../utils/cloud');
const { decorateRecord } = require('../../utils/format');

const app = getApp();

// 状态横幅配置
const BANNER = {
  pending: { icon: '⏳', title: '等待审批', cls: 'status-banner--pending' },
  approved: { icon: '✓', title: '审批已通过', cls: 'status-banner--approved' },
  rejected: { icon: '✕', title: '审批未通过', cls: 'status-banner--rejected' },
};

Page({
  data: {
    state: 'loading',
    errorText: '',
    id: '',
    record: null,
    banner: BANNER.pending,
    showResubmit: false,
    hasNote: false,
    imageUrl: '',
  },

  onLoad(options) {
    const id = options && options.id;
    if (!id) {
      this.setData({ state: 'error', errorText: '缺少申请单 id' });
      return;
    }
    this.setData({ id });
    this.fetchDetail();
  },

  fetchDetail() {
    this.setData({ state: 'loading', errorText: '' });
    return callFunction('getApplicationDetail', { id: this.data.id })
      .then((res) => {
        const record = decorateRecord(res.data || {});
        this.setData({
          record,
          state: 'ready',
          banner: BANNER[record.status] || BANNER.pending,
          // 被拒后允许「修改并重新提交」（原记录保留）
          showResubmit: record.status === 'rejected' && record.viewerRole === 'applicant',
          hasNote: !!record.approveNote,
          imageUrl: record.imageUrl || '',
        });
      })
      .catch((err) => {
        this.setData({
          state: 'error',
          errorText: err.friendlyMessage || '加载失败，请检查网络',
        });
      });
  },

  onRetry() {
    this.fetchDetail();
  },

  onBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/my-list/index' }),
    });
  },

  copyUrl() {
    const url = this.data.record && this.data.record.productUrl;
    if (!url) return;
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '链接已复制', icon: 'none' }),
    });
  },

  previewImage() {
    const url = this.data.imageUrl;
    if (url) wx.previewImage({ urls: [url] });
  },

  /** 修改并重新提交：把原内容存为草稿，新建一条申请，原记录状态不变 */
  onResubmit() {
    const r = this.data.record;
    if (!r) return;
    app.globalData.resubmitDraft = {
      itemName: r.itemName,
      price: r.price,
      productUrl: r.productUrl,
      imageUrl: r.imageUrl,
      reason: r.reason,
    };
    wx.navigateTo({ url: '/pages/apply/index' });
  },
});
