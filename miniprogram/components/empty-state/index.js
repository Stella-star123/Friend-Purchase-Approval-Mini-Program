Component({
  properties: {
    // 空状态文案
    text: { type: String, value: '暂无申请记录' },
    // 引导按钮文案，为空则不渲染按钮
    actionText: { type: String, value: '' },
  },
  methods: {
    onAction() {
      this.triggerEvent('action');
    },
  },
});
