# 好友采购审批 · 入口与上线速查单

> 这个小程序目前是 **代码项目**，没有线上访问链接。必须先在「微信开发者工具」里导入并编译才能运行。
> 本文件解决两件事：**① 从哪里进入** + **② 怎么做成能在微信里用的真小程序**。

---

## 一、入口在哪里（怎么打开它）

**项目目录（导入时选这个）：**

```
C:\Users\10944\WorkBuddy\2026-08-26-21-50-11\friend-approval
```

**打开步骤：**

1. 下载安装 **微信开发者工具（稳定版）**
   官网：https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html
2. 打开开发者工具 → 扫码登录 → 点「**导入项目**」
3. 目录选上面的 `friend-approval` 文件夹
4. AppID 填你的**小程序 AppID**（见下文章节二）
5. 后端服务选「**微信云开发**」
6. 点「导入」→ 工具自动编译 → 左侧模拟器即出现页面

> ⚠️ 不填真实 AppID 也能用「测试号」看 UI 骨架，但**云函数、云数据库、订阅消息全部跑不起来**，必须走完章节二拿到真实 AppID + 云环境。

---

## 二、做成真小程序的 10 步（按顺序）

| # | 动作 | 在哪里做 | 产出 |
|---|------|----------|------|
| 1 | 注册小程序账号 | https://mp.weixin.qq.com | 拿到 **AppID**（设置-开发设置） |
| 2 | 安装开发者工具 | 见上一节 | 能导入项目 |
| 3 | 开通**云开发** | 工具顶部「云开发」按钮 → 开通 | 拿到 **环境 ID**（如 `friend-approval-1g2x3y4z`） |
| 4 | 填 AppID | `project.config.json` 第 5 行 | 替换 `REPLACE_WITH_YOUR_APPID` |
| 5 | 填云环境 ID | `miniprogram/config/index.js` 第 7 行 `CLOUD_ENV` | 替换 `REPLACE_WITH_YOUR_CLOUD_ENV_ID` |
| 6 | 建数据库集合 | 云开发控制台 → 数据库 → 新建 | `approvals`、`subscribeQuota` |
| 7 | 加索引 | 集合 `approvals` 索引：`_openid`(升序)、`approverOpenid`(升序)、`status`(升序) | 查询不为空 |
| 8 | 部署云函数 | 右键 `cloudfunctions/` 下 6 个文件夹逐个「上传并部署：云端安装依赖」 | 6 个函数上线 |
| 9 | 配订阅消息模板 | 公众平台「功能-订阅消息-我的模板」选 2 个模板 | 拿到 2 个 **模板 ID** 回填 |
| 10 | 填审批人+令牌 | `shared/common.js` 第 17-19 行（审批人 openid）、第 51 行（`INTERNAL_TOKEN`） | 改完跑 `node scripts/sync-shared.js` |

---

## 三、必须填的 6 处配置（精确位置）

| 配置项 | 文件 : 行 | 改什么 |
|--------|-----------|--------|
| AppID | `project.config.json` : 5 | `"REPLACE_WITH_YOUR_APPID"` |
| 云环境 ID | `miniprogram/config/index.js` : 7 | `CLOUD_ENV` |
| 待审批模板 ID | `miniprogram/config/index.js` : 12 | `SUBSCRIBE_TEMPLATES.PENDING` |
| 结果通知模板 ID | `miniprogram/config/index.js` : 14 | `SUBSCRIBE_TEMPLATES.RESULT` |
| 审批人 openid | `shared/common.js` : 17-19 | `FALLBACK_APPROVER_OPENIDS` |
| 内部令牌 | `shared/common.js` : 51 | `INTERNAL_TOKEN`（改成随机串） |

> 模板 ID 在 `shared/common.js` 第 42-44 行也读一份（优先读环境变量），两边保持一致即可。
> ⚠️ 改完 `shared/common.js` **必须**执行 `node scripts/sync-shared.js`，把副本分发到 6 个云函数目录，否则改动不生效。

---

## 四、两个订阅消息模板怎么选字段

在公众平台「订阅消息-公共模板库」搜索相近模板，或选「一次性订阅」自定：

**模板 A — 待审批提醒（发给审批人）**
- 事项名称：`{{thing1.DATA}}`
- 提交人：`{{thing2.DATA}}`
- 金额：`{{amount3.DATA}}`
- 提交时间：`{{time4.DATA}}`

**模板 B — 审批结果通知（发给申请人）**
- 事项名称：`{{thing1.DATA}}`
- 审批结果：`{{phrase2.DATA}}`（通过 / 未通过）
- 备注：`{{thing3.DATA}}`
- 处理时间：`{{time4.DATA}}`

> 字段关键词（thing/amount/time/phrase）顺序不重要，关键是 **dataKey 映射**要和 `cloudfunctions/sendSubscribeMsg/index.js` 里一致。

---

## 五、联调与上线

1. **模拟器自测**：开发者工具里走一遍——提交申请 → 我的申请看到记录 →（金额≥5 进入待审批）→ 切换审批人账号点通过/拒绝 → 收到订阅消息。
2. **真机预览**：工具右上「预览」扫码，用手机实跑（订阅消息必须在真机才能授权成功）。
3. **上传体验版**：工具右上「上传」→ 版本号填 `1.0.0` → 在 mp 后台「管理-版本管理」设为体验版，发给同事试。
4. **提交审核发布**：体验无误后「提交审核」→ 等 1-3 天 → 审核通过即全量上线。

---

## 六、常见坑

- **云函数报 `missing appid` / 403**：AppID、云环境 ID 没填或填错。
- **列表一直空白/转圈**：集合没建、索引没加、或 `CLOUD_ENV` 还是占位值。
- **订阅消息收不到**：必须在**真机**授权；`sendSubscribeMsg` 里 `miniprogramState` 联调时改 `'trial'`，上线前改回 `'formal'`。
- **改了 common.js 不生效**：忘了跑 `sync-shared.js`。
- **审批人看不到待审单**：`FALLBACK_APPROVER_OPENIDS` 里没填对 openid（openid 可在云函数日志里 `console.log` 出来查）。
