# 云函数环境变量配置清单

> 部署云函数后，在「云开发控制台 → 云函数 → 配置 → 环境变量」里逐项添加下面 4 个。
> 改了值**不用重传代码**，控制台保存即生效。

## 必须配置的 4 个变量

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `APPROVER_OPENIDS` | `odlYUxp7LwXNMHNgK4OLgnS71bnU` | 审批人 openid，多个用逗号隔开 |
| `TMPL_PENDING` | `yQ7oHis_84WVvh_EjzA8WeYRDI16nfVOLy3TydEetyA` | 待审批提醒模板 ID |
| `TMPL_RESULT` | `2flVqiJc7J354NX1TpWMT8mIGdY-vN4En-qtFodJx60` | 审批结果通知模板 ID |
| `INTERNAL_TOKEN` | `REPLACE_WITH_YOUR_INTERNAL_TOKEN` | 内部调用安全令牌，**请勿提交真实值到公开仓库**，仅在云函数控制台配置 |

## 前端已填（miniprogram/config/index.js）

- `CLOUD_ENV` = `cloud1-d6gmkinaad3c12a2f`
- `SUBSCRIBE_TEMPLATES.PENDING` = `yQ7oHis_84WVvh_EjzA8WeYRDI16nfVOLy3TydEetyA`
- `SUBSCRIBE_TEMPLATES.RESULT` = `2flVqiJc7J354NX1TpWMT8mIGdY-vN4En-qtFodJx60`

## 操作顺序

1. 开发者工具里「上传并部署」所有云函数
2. 云开发控制台 → 每个云函数 → 配置 → 环境变量 → 填上面 4 行
3. 数据库 → 新建集合 `approvals`、`subscribeQuota`
4. 小程序端编译，发起一笔 < 5 元申请验证自动通过
5. 发起一笔 ≥ 5 元申请，审批人端「待我审批」处理，检查双方收到订阅消息
