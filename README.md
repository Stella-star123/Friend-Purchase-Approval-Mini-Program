# 好友采购审批 · 小程序实现

微信小程序原生（WXML + WXSS + JS）+ 腾讯云开发 CloudBase。
按《好友采购审批-后端对接规格书.md》与《好友采购审批-设计交付文档.md》实现，6 个云函数 + 5 个页面 + 4 个共享组件。

---

## 一、目录结构

```
friend-approval/
├── project.config.json          小程序项目配置（需填 AppID）
├── package.json                 本地脚本入口
├── miniprogram/                 小程序前端
│   ├── app.js / app.json / app.wxss
│   ├── config/index.js          ★ 云环境 ID、订阅模板 ID
│   ├── utils/
│   │   ├── cloud.js             云函数调用封装（统一错误码 → 友好文案）
│   │   └── format.js            时间/价格/状态/openid 脱敏
│   ├── components/
│   │   ├── status-tag/          状态标签（三色胶囊）
│   │   ├── empty-state/         空状态 + 引导按钮
│   │   ├── skeleton/            骨架屏（200/260/160 错落）
│   │   └── error-tip/           错误提示 + 重试
│   └── pages/
│       ├── my-list/             我的申请（tabBar，三态）
│       ├── apply/               新建申请
│       ├── detail/              申请详情
│       ├── pending/             待我审批（tabBar，三态 + 403）
│       └── approve/             审批操作
├── shared/common.js             ★ 云函数共享配置与工具（唯一源文件）
├── cloudfunctions/              6 个云函数，common.js 由脚本同步生成
└── scripts/
    ├── sync-shared.js           同步 shared/common.js 到各云函数
    ├── verify.js                结构自检
    ├── test-cloudfunctions.js   云函数逻辑测试（75 项断言，无需部署）
    └── mock-wx-server-sdk.js    内存版 SDK（仅测试用）
```

---

## 二、部署步骤

### 1. 打开项目

微信开发者工具 → 导入项目 → 选择 `friend-approval` 目录 → 填入你的小程序 AppID
（或先把 `project.config.json` 里的 `REPLACE_WITH_YOUR_APPID` 改掉）。

### 2. 开通云开发并建集合

云开发控制台 → 新建环境 → 复制**环境 ID**。

在「数据库」新建两个集合：

| 集合 | 用途 | 权限设置 |
|------|------|----------|
| `approvals` | 申请单主表 | **仅创建者可读写**（前端不直连，全部走云函数） |
| `subscribeQuota` | 一次性订阅配额 | **仅创建者可读写** |

给 `approvals` 建索引（数据库 → 索引管理）：

| 索引字段 | 类型 |
|---------|------|
| `_openid` | 升序（申请人查询） |
| `status` | 升序（审批列表） |
| `createdAt` | 降序（列表排序） |

### 3. 填配置（4 处）

**① `miniprogram/config/index.js`**
```js
const CLOUD_ENV = '你的云环境ID';
const SUBSCRIBE_TEMPLATES = {
  PENDING: '待审批提醒模板ID',
  RESULT:  '审批结果通知模板ID',
};
```

**② `shared/common.js`**
```js
const FALLBACK_APPROVER_OPENIDS = ['你自己的openid'];   // 审批人白名单
const INTERNAL_TOKEN = '换成一串随机字符';               // 云函数互调令牌
```

> 拿自己 openid 的最快方式：先随便提交一条申请，在云开发数据库 `approvals` 里看 `_openid`。

**③ 改完 `shared/common.js` 必须执行同步**
```bash
node scripts/sync-shared.js
```
> 云函数不能跨目录 require，`common.js` 是分发到 6 个函数目录的副本。
> **只改 `shared/common.js`，改完必须同步**，否则改动不生效。

**④ 订阅消息模板**

微信公众平台 → 功能 → 订阅消息 → 添加两个模板，然后把模板里的字段 key
（形如 `thing1` / `amount2` / `phrase2` / `time4`）对齐到
`cloudfunctions/sendSubscribeMsg/index.js` 顶部的 `FIELD_MAP`：

| 场景 | 收件人 | 字段映射 |
|------|--------|----------|
| A 待审批提醒 | 审批人 | 物品名称 `thing1` / 金额 `amount2` / 申请人 `thing3` / 提交时间 `time4` |
| B 审批结果通知 | 申请人 | 物品名称 `thing1` / 审批结果 `phrase2` / 审批备注 `thing3` / 处理时间 `time4` |

> 字段 key 不一致会报 **47003**；模板 ID 没填时代码会自动跳过下发，不会报错。

### 4. 上传云函数

`cloudfunctions/` 下逐个右键 → **上传并部署：云端安装依赖**。
先传 `sendSubscribeMsg`（其他两个函数会调它），再传剩下 5 个。

`sendSubscribeMsg` 已通过 `config.json` 声明 `subscribeMessage.send` 权限，无需手动开。

也可以在云函数控制台用环境变量覆盖配置（优先级高于代码内常量）：
`APPROVER_OPENIDS`（逗号分隔）、`TMPL_PENDING`、`TMPL_RESULT`、`INTERNAL_TOKEN`。

### 5. 本地自检

```bash
node scripts/verify.js              # 结构自检：页面/组件/云函数引用一致性
node scripts/test-cloudfunctions.js # 逻辑测试：75 项断言，不需要部署
```

---

## 三、实现要点与规格对应

### 安全约束（规格书 §1）

| 约束 | 实现位置 |
|------|----------|
| `_openid` 只取服务端 | 所有云函数 `cloud.getWXContext().OPENID`；客户端传的 `_openid` 直接丢弃 |
| 时间只取服务端 | `Date.now()`，客户端传的 `createdAt` 被忽略 |
| 写库只走云函数 | 集合权限设为「仅创建者可读写」，前端无写权限 |
| 读库走云函数 | 列表/详情均经云函数做身份校验 |
| 价格非负校验 | 前端 `validate()` + 云函数 `normalizePrice()` 双重校验 |
| 自动审批阈值 | `price < 5 → approved`，`>= 5 → pending` |

### 权限设计（规格书 §4）

- **申请人**：`getMyApplications` 强制 `where _openid == OPENID`；详情仅本人可读。
- **审批人**：`getPendingList` / `approveApplication` 白名单校验，未命中返回 `FORBIDDEN`。
- **详情放开范围**：审批人可读 `pending` 单；**另外放开了「自己审过的单」**，
  否则审批完成后页面刷新会 403。这是对 §4 的一处必要补充。
- **防越权**：所有按 id 的读/写都在服务端二次校验身份。

### 防重复审批

用**带状态条件的原子更新**，而不是「先查再写」：

```js
collection.where({ _id: id, status: 'pending' }).update({ ... })
```

`stats.updated === 0` 说明已被处理 → 返回 `ALREADY_HANDLED`。
两端同时点「通过/拒绝」也只有一次生效。

### 订阅消息配额（重要）

一次性订阅每次授权只能发 1 条，且**审批人的配额只能由审批人自己授权**。
所以做了 `subscribeQuota` 集合记账：

- 申请人在**提交申请时**授权「审批结果通知」→ `sendSubscribeMsg({action:'grant'})` 记账
- 审批人在**待我审批页**点「开启新申请微信提醒」授权「待审批提醒」→ 同样记账
- 下发前先扣配额，没配额就跳过（并打日志），下发失败则把配额退回

`action: 'send'` 只允许云函数内部调用，靠 `INTERNAL_TOKEN` 校验，防止前端伪造给任意用户发消息。

### 三态与防抖（设计文档 §4）

- 两个列表页均实现 加载中（骨架屏）/ 空状态 / 错误重试，加载中禁用刷新。
- 提交按钮点击后立即 `disabled + loading`，图片上传中不允许提交。
- 详情页被拒后「修改并重新提交」→ 走 `submitApply` 新建一条，**原记录状态不变**。

---

## 四、联调必测项（规格书 §7.5）

`scripts/test-cloudfunctions.js` 已覆盖并全部通过：

- **自动审批阈值**：0 / 4.99 → approved；5 / 5.01 / 128 → pending（边界值 5 归 pending）
- **权限越权**：非审批人查待审列表 403、他人查详情 403、非审批人执行审批 403
- **重复审批**：二次审批返回 `ALREADY_HANDLED` 且不改变原状态
- **参数校验**：空名称/负价/非数字价/空理由 → `INVALID_PARAM`；非法链接与非 `cloud://` 图片被清空
- **订阅消息**：无配额跳过、有配额下发、字段与跳转页正确、自动通过单不通知、伪造令牌被拒

仍需真机验证的部分（本地 mock 无法覆盖）：

1. `wx.requestSubscribeMessage` 弹窗与真实模板下发（模板字段 key 是否对齐）
2. `wx.cloud.uploadFile` 上传截图与 `cloud://` fileID 在 `<image>` 中的渲染
3. 联调阶段把 `sendSubscribeMsg` 里的 `miniprogramState` 改成 `'trial'` 或 `'developer'`，上线前改回 `'formal'`

---

## 五、常见问题

| 现象 | 原因 |
|------|------|
| 调用云函数报「函数不存在」 | 云函数未上传，或环境 ID 填错 |
| 待我审批页一直 403 | `shared/common.js` 的审批人 openid 没填，或改完没跑 `node scripts/sync-shared.js` |
| 订阅消息报 43101 | 用户没授权 / 配额已用完，需重新授权 |
| 订阅消息报 47003 | `FIELD_MAP` 的字段 key 与后台模板不一致 |
| 改了配置没生效 | 只改了 `shared/common.js` 却没同步，或同步后没重新上传云函数 |
