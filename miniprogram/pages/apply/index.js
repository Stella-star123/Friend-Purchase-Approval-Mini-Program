const { callFunction } = require('../../utils/cloud');
const {
  SUBSCRIBE_TEMPLATES,
  AUTO_APPROVE_THRESHOLD,
} = require('../../config/index');

const app = getApp();

Page({
  data: {
    threshold: AUTO_APPROVE_THRESHOLD,
    form: {
      itemName: '',
      price: '',
      productUrl: '',
      imageUrl: '', // 云存储 fileID
      reason: '',
    },
    localImage: '', // 本地临时路径，仅用于预览
    uploading: false,
    submitting: false,
    errors: {},
    isResubmit: false,
  },

  onLoad() {
    // 「修改并重新提交」：读取详情页暂存的草稿
    const draft = app.globalData.resubmitDraft;
    if (draft) {
      app.globalData.resubmitDraft = null;
      this.setData({
        isResubmit: true,
        'form.itemName': draft.itemName || '',
        'form.price': draft.price != null ? String(draft.price) : '',
        'form.productUrl': draft.productUrl || '',
        'form.imageUrl': draft.imageUrl || '',
        'form.reason': draft.reason || '',
        localImage: draft.imageUrl || '',
      });
      wx.setNavigationBarTitle({ title: '修改并重新提交' });
    }
  },

  // ---------------- 表单输入 ----------------
  onInput(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    const errors = Object.assign({}, this.data.errors);
    delete errors[field];
    this.setData({ [`form.${field}`]: value, errors });
  },

  // ---------------- 商品截图上传 ----------------
  chooseImage() {
    if (this.data.uploading) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        this.uploadImage(file.tempFilePath);
      },
      fail: (err) => {
        if (err && err.errMsg && err.errMsg.indexOf('cancel') > -1) return;
        wx.showToast({ title: '选择图片失败', icon: 'none' });
      },
    });
  },

  uploadImage(tempFilePath) {
    this.setData({ uploading: true, localImage: tempFilePath });
    const ext = (tempFilePath.match(/\.(\w+)$/) || [, 'png'])[1];
    const cloudPath = `approvals/${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;

    wx.cloud
      .uploadFile({ cloudPath, filePath: tempFilePath })
      .then((res) => {
        this.setData({ 'form.imageUrl': res.fileID, uploading: false });
      })
      .catch((err) => {
        console.error('[apply] 上传失败', err);
        this.setData({ uploading: false, localImage: '', 'form.imageUrl': '' });
        wx.showToast({ title: '图片上传失败，可稍后重试', icon: 'none' });
      });
  },

  removeImage() {
    this.setData({ localImage: '', 'form.imageUrl': '' });
  },

  previewImage() {
    const url = this.data.localImage;
    if (url) wx.previewImage({ urls: [url] });
  },

  // ---------------- 校验 ----------------
  validate() {
    const { form } = this.data;
    const errors = {};

    if (!form.itemName.trim()) errors.itemName = '请填写物品名称';

    const price = Number(form.price);
    if (form.price === '' || Number.isNaN(price)) {
      errors.price = '请填写价格';
    } else if (price < 0) {
      errors.price = '价格不能为负数';
    }

    if (form.productUrl.trim() && !/^https?:\/\//i.test(form.productUrl.trim())) {
      errors.productUrl = '链接需以 http:// 或 https:// 开头';
    }

    if (!form.reason.trim()) errors.reason = '请填写申请理由';

    this.setData({ errors });
    return Object.keys(errors).length === 0;
  },

  // ---------------- 提交 ----------------
  async onSubmit() {
    // 防重复提交：点击后立刻置灰 + loading，不依赖二次点击拦截
    if (this.data.submitting || this.data.uploading) {
      if (this.data.uploading) wx.showToast({ title: '图片上传中，请稍候', icon: 'none' });
      return;
    }
    if (!this.validate()) {
      wx.showToast({ title: '请检查表单填写', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });

    // 订阅消息授权（申请人需接收「审批结果通知」）
    await this.requestSubscribe();

    const { form } = this.data;
    const payload = {
      itemName: form.itemName.trim(),
      price: Number(form.price),
      productUrl: form.productUrl.trim(),
      imageUrl: form.imageUrl,
      reason: form.reason.trim(),
    };

    try {
      const res = await callFunction('submitApply', payload);
      const autoApproved = res.data && res.data.status === 'approved';
      wx.showToast({
        title: autoApproved ? '已自动通过' : '提交成功，等待审批',
        icon: 'success',
        duration: 1500,
      });
      setTimeout(() => {
        wx.navigateBack({
          fail: () => wx.switchTab({ url: '/pages/my-list/index' }),
        });
      }, 1200);
    } catch (err) {
      this.setData({ submitting: false });
      wx.showModal({
        title: '提交失败',
        content: err.friendlyMessage || err.message || '请稍后重试',
        showCancel: false,
      });
    }
  },

  /** 请求订阅消息授权，失败不阻断提交 */
  requestSubscribe() {
    const tmplIds = [SUBSCRIBE_TEMPLATES.RESULT].filter(
      (id) => id && id.indexOf('REPLACE_') !== 0
    );
    if (!tmplIds.length) return Promise.resolve();

    return new Promise((resolve) => {
      wx.requestSubscribeMessage({
        tmplIds,
        success: (res) => {
          const accepted = tmplIds.filter((id) => res[id] === 'accept');
          if (!accepted.length) return resolve();
          // 记录一次性订阅配额，供云函数下发时消耗
          callFunction('sendSubscribeMsg', { action: 'grant', templateIds: accepted })
            .catch((e) => console.warn('[apply] 订阅配额记录失败', e))
            .then(resolve);
        },
        fail: (err) => {
          console.warn('[apply] 订阅授权失败', err);
          resolve();
        },
      });
    });
  },
});
