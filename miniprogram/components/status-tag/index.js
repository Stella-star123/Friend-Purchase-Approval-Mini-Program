const { STATUS_MAP } = require('../../utils/format');

Component({
  properties: {
    status: {
      type: String,
      value: 'pending',
      observer(val) {
        const conf = STATUS_MAP[val] || STATUS_MAP.pending;
        this.setData({ text: conf.text, color: conf.color, bg: conf.bg });
      },
    },
  },
  data: {
    text: '待审批',
    color: '#F59E0B',
    bg: '#FFF4E5',
  },
});
