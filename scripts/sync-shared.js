#!/usr/bin/env node
/**
 * 把 shared/common.js 分发到每个云函数目录，并按需生成 package.json。
 * 修改配置（审批人 openid / 模板 ID / 内部令牌）后务必重新执行：
 *     node scripts/sync-shared.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHARED_FILE = path.join(ROOT, 'shared', 'common.js');
const CLOUD_DIR = path.join(ROOT, 'cloudfunctions');

const FUNCTIONS = [
  'submitApply',
  'getMyApplications',
  'getApplicationDetail',
  'getPendingList',
  'approveApplication',
  'sendSubscribeMsg',
];

const WX_SERVER_SDK_VERSION = '~2.6.3';

function buildPackageJson(name) {
  return `${JSON.stringify(
    {
      name,
      version: '1.0.0',
      description: `好友采购审批 - ${name} 云函数`,
      main: 'index.js',
      dependencies: {
        'wx-server-sdk': WX_SERVER_SDK_VERSION,
      },
    },
    null,
    2
  )}\n`;
}

function main() {
  if (!fs.existsSync(SHARED_FILE)) {
    console.error(`✗ 找不到共享文件：${SHARED_FILE}`);
    process.exit(1);
  }
  const shared = fs.readFileSync(SHARED_FILE, 'utf8');
  const banner =
    '/* eslint-disable */\n' +
    '// ⚠️ 本文件由 scripts/sync-shared.js 自动生成，请勿直接修改。\n' +
    '// 源文件：shared/common.js\n\n';

  let count = 0;
  FUNCTIONS.forEach((name) => {
    const dir = path.join(CLOUD_DIR, name);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`+ 新建目录 ${name}/`);
    }
    fs.writeFileSync(path.join(dir, 'common.js'), banner + shared, 'utf8');

    const pkgPath = path.join(dir, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      fs.writeFileSync(pkgPath, buildPackageJson(name), 'utf8');
      console.log(`+ 生成 ${name}/package.json`);
    }
    count += 1;
    console.log(`✓ 已同步 ${name}/common.js`);
  });

  console.log(`\n完成：共同步 ${count} 个云函数。`);

  // 这些值不再写进代码，部署后须在云函数环境变量里配置
  console.log('\n部署后请在「云开发控制台 → 云函数 → 配置 → 环境变量」中配置：');
  console.log('  · APPROVER_OPENIDS = 审批人 openid，多个用英文逗号分隔');
  console.log('  · TMPL_PENDING     = 待审批提醒模板 ID');
  console.log('  · TMPL_RESULT      = 审批结果通知模板 ID');
  console.log('  · INTERNAL_TOKEN   = 一段随机字符串（建议 32 位以上）');
  console.log('保存即生效，无需重传代码。');
}

main();
