#!/usr/bin/env node
/**
 * 项目自检脚本
 *   node scripts/verify.js
 *
 * 检查项：
 *  1. 所有 JSON 可解析
 *  2. app.json 中登记的页面都存在 wxml/js
 *  3. 页面 json 里引用的自定义组件路径都存在
 *  4. 页面 js 调用的云函数名都有对应目录
 *  5. 每个云函数都有 index.js / package.json / common.js
 *  6. 前后端配置一致性（模板 ID、阈值）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const CF = path.join(ROOT, 'cloudfunctions');

const errors = [];
const warns = [];
const info = [];

function walk(dir, ext, out = []) {
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules') return;
      walk(p, ext, out);
    } else if (e.name.endsWith(ext)) {
      out.push(p);
    }
  });
  return out;
}

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

// ---- 1. JSON 解析 ----
const jsonFiles = walk(ROOT, '.json');
const parsed = {};
jsonFiles.forEach((f) => {
  try {
    parsed[f] = JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    errors.push(`JSON 解析失败 ${rel(f)}: ${e.message}`);
  }
});
info.push(`JSON 文件 ${jsonFiles.length} 个，解析通过 ${Object.keys(parsed).length} 个`);

// ---- 2. app.json 页面存在性 ----
const appJsonPath = path.join(MP, 'app.json');
const appJson = parsed[appJsonPath];
if (!appJson) {
  errors.push('app.json 缺失或无法解析');
} else {
  (appJson.pages || []).forEach((page) => {
    ['.wxml', '.js', '.json'].forEach((ext) => {
      const f = path.join(MP, page + ext);
      if (!fs.existsSync(f)) errors.push(`app.json 登记的页面缺少文件：${page}${ext}`);
    });
  });
  info.push(`app.json 登记页面 ${(appJson.pages || []).length} 个`);

  // tabBar 页面必须在 pages 中
  const tabs = (appJson.tabBar && appJson.tabBar.list) || [];
  tabs.forEach((t) => {
    if ((appJson.pages || []).indexOf(t.pagePath) === -1) {
      errors.push(`tabBar 页面未登记在 pages 中：${t.pagePath}`);
    }
  });
  info.push(`tabBar 项 ${tabs.length} 个`);
}

// ---- 3. 自定义组件引用 ----
let compRefs = 0;
Object.keys(parsed).forEach((f) => {
  if (!f.startsWith(MP)) return;
  const uc = parsed[f].usingComponents;
  if (!uc) return;
  Object.keys(uc).forEach((name) => {
    compRefs += 1;
    const raw = uc[name];
    const base = raw.startsWith('/') ? path.join(MP, raw.slice(1)) : path.resolve(path.dirname(f), raw);
    ['.wxml', '.js', '.json'].forEach((ext) => {
      if (!fs.existsSync(base + ext)) {
        errors.push(`${rel(f)} 引用组件 ${name} 缺少文件 ${rel(base + ext)}`);
      }
    });
  });
});
info.push(`自定义组件引用 ${compRefs} 处`);

// ---- 4. 云函数调用名 ----
const cloudFnDirs = fs.existsSync(CF)
  ? fs.readdirSync(CF, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  : [];
const calledNames = new Set();
walk(MP, '.js').forEach((f) => {
  const src = fs.readFileSync(f, 'utf8');
  const re = /callFunction\(\s*['"]([A-Za-z0-9_]+)['"]/g;
  let m;
  while ((m = re.exec(src))) calledNames.add(m[1]);
});
calledNames.forEach((name) => {
  if (cloudFnDirs.indexOf(name) === -1) {
    errors.push(`前端调用了不存在的云函数：${name}`);
  }
});
info.push(`前端调用云函数 ${calledNames.size} 个：${[...calledNames].sort().join(', ')}`);

// 云函数之间的互调
walk(CF, '.js').forEach((f) => {
  if (path.basename(f) !== 'index.js') return;
  const src = fs.readFileSync(f, 'utf8');
  const re = /callFunction\(\s*\{[\s\S]{0,80}?name:\s*['"]([A-Za-z0-9_]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    if (cloudFnDirs.indexOf(m[1]) === -1) {
      errors.push(`${rel(f)} 互调了不存在的云函数：${m[1]}`);
    }
  }
});

// ---- 5. 云函数完整性 ----
const EXPECTED_FN = [
  'submitApply',
  'getMyApplications',
  'getApplicationDetail',
  'getPendingList',
  'approveApplication',
  'sendSubscribeMsg',
];
EXPECTED_FN.forEach((name) => {
  if (cloudFnDirs.indexOf(name) === -1) {
    errors.push(`缺少云函数目录：${name}`);
    return;
  }
  ['index.js', 'package.json', 'common.js'].forEach((file) => {
    if (!fs.existsSync(path.join(CF, name, file))) {
      errors.push(`云函数 ${name} 缺少 ${file}`);
    }
  });
});
info.push(`云函数 ${cloudFnDirs.length} 个：${cloudFnDirs.sort().join(', ')}`);

// sendSubscribeMsg 必须声明 openapi 权限
const subCfg = parsed[path.join(CF, 'sendSubscribeMsg', 'config.json')];
if (!subCfg) {
  errors.push('sendSubscribeMsg/config.json 缺失');
} else {
  const openapi = (subCfg.permissions && subCfg.permissions.openapi) || [];
  if (openapi.indexOf('subscribeMessage.send') === -1) {
    errors.push('sendSubscribeMsg/config.json 未声明 subscribeMessage.send 权限');
  } else {
    info.push('sendSubscribeMsg 已声明 subscribeMessage.send 权限');
  }
}

// ---- 6. 前后端配置一致性 ----
const feConfig = require(path.join(MP, 'config', 'index.js'));
const beConfig = require(path.join(ROOT, 'shared', 'common.js'));

if (feConfig.AUTO_APPROVE_THRESHOLD !== beConfig.AUTO_APPROVE_THRESHOLD) {
  errors.push(
    `自动审批阈值前后端不一致：前端 ${feConfig.AUTO_APPROVE_THRESHOLD} vs 后端 ${beConfig.AUTO_APPROVE_THRESHOLD}`
  );
} else {
  info.push(`自动审批阈值一致：¥${beConfig.AUTO_APPROVE_THRESHOLD}`);
}

['PENDING', 'RESULT'].forEach((k) => {
  const fe = feConfig.SUBSCRIBE_TEMPLATES[k];
  const be = beConfig.SUBSCRIBE_TEMPLATES[k];
  if (fe !== be) {
    errors.push(`订阅模板 ${k} 前后端不一致：前端 ${fe} vs 后端 ${be}`);
  }
});

// ---- 待配置项（提醒，非错误）----
const placeholders = [
  [path.join(MP, 'config', 'index.js'), 'REPLACE_WITH_YOUR_CLOUD_ENV_ID', '云环境 ID'],
  [path.join(MP, 'config', 'index.js'), 'REPLACE_WITH_PENDING_TEMPLATE_ID', '待审批提醒模板 ID（前端）'],
  [path.join(MP, 'config', 'index.js'), 'REPLACE_WITH_RESULT_TEMPLATE_ID', '审批结果模板 ID（前端）'],
  [path.join(ROOT, 'shared', 'common.js'), 'REPLACE_WITH_APPROVER_OPENID', '审批人 openid'],
  [path.join(ROOT, 'shared', 'common.js'), 'CHANGE_ME_TO_A_RANDOM_SECRET', '内部调用令牌'],
  [path.join(ROOT, 'project.config.json'), 'REPLACE_WITH_YOUR_APPID', '小程序 AppID'],
];
placeholders.forEach(([file, token, label]) => {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(token)) {
    warns.push(`${label} 仍为占位值（${rel(file)}）`);
  }
});

// ---- 输出 ----
console.log('\n=== 结构自检 ===');
info.forEach((i) => console.log(`  · ${i}`));

if (warns.length) {
  console.log('\n=== 待配置（部署前必须填）===');
  warns.forEach((w) => console.log(`  ! ${w}`));
}

if (errors.length) {
  console.log('\n=== 错误 ===');
  errors.forEach((e) => console.log(`  ✗ ${e}`));
  console.log(`\n自检失败：${errors.length} 个错误\n`);
  process.exit(1);
}

console.log('\n✓ 结构自检全部通过\n');
