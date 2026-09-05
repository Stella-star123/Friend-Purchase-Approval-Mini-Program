const { callFunction } = require('../../utils/cloud');
const { decorateRecord } = require('../../utils/format');

Page({
  data: {
    state: 'loading',
    errorText: '',
    id: '',
    record: null,
    approveNote: '',
    submitting: false,
    decision: '', // 正在提交的决定，用于按钮 loading 定位
    canApprove: false,
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
          canApprove: !!record.canApprove,
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
      fail: () => wx.switchTab({ url: '/pages/pending/index' }),
    });
  },

  onNoteInput(e) {
    this.setData({ approveNote: e.detail.value });
  },

  onApprove() {
    this.submitDecision('approved', '确认通过这笔申请？');
  },

  onReject() {
    this.submitDecision('rejected', '确认拒绝这笔申请？建议填写备注说明原因。');
  },

  submitDecision(decision, confirmText) {
    if (this.data.submitting || !this.data.canApprove) return;

    wx.showModal({
      title: decision === 'approved' ? '通过申请' : '拒绝申请',
      content: confirmText,
      confirmText: '确认',
      cancelText: '再看看',
      success: (res) => {
        if (!res.confirm) return;
        this.doSubmit(decision);
      },
    });
  },

  doSubmit(decision) {
    // 防重复提交
    this.setData({ submitting: true, decision });

    callFunction('approveApplication', {
      id: this.data.id,
      decision,
      approveNote: this.data.approveNote.trim(),
    })
      .then(() => {
        wx.showToast({
          title: decision === 'approved' ? '已通过' : '已拒绝',
          icon: 'success',
          duration: 1200,
        });
        setTimeout(() => {
          wx.navigateBack({
            fail: () => wx.switchTab({ url: '/pages/pending/index' }),
          });
        }, 1000);
      })
      .catch((err) => {
        this.setData({ submitting: false, decision: '' });
        // 已被处理：刷新页面状态，避免继续操作
        if (err.errCode === 'ALREADY_HANDLED') {
          wx.showModal({
            title: '无需重复审批',
            content: '该申请已被处理。',
            showCancel: false,
            success: () => this.fetchDetail(),
          });
          return;
        }
        wx.showModal({
          title: '审批失败',
          content: err.friendlyMessage || err.message || '请稍后重试',
          showCancel: false,
        });
      });
  },
});
