Component({
  properties: {
    // 骨架卡片数量
    count: { type: Number, value: 3 },
    // 是否显示底部「加载中…」
    showTip: { type: Boolean, value: true },
  },
  data: {
    blocks: [1, 2, 3],
  },
  lifetimes: {
    attached() {
      const n = Math.max(1, this.data.count);
      this.setData({ blocks: Array.from({ length: n }, (_, i) => i) });
    },
  },
});
