Component({
  properties: {
    text: { type: String, value: '加载失败，请检查网络' },
    retryText: { type: String, value: '重试' },
    // 无权限等场景可隐藏重试按钮
    showRetry: { type: Boolean, value: true },
  },
  methods: {
    onRetry() {
      this.triggerEvent('retry');
    },
  },
});
