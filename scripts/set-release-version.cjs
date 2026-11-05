
const fs = require('node:fs');

const file = 'module.json';
const version = String(
  process.env.RELEASE_VERSION || ''
).trim();

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error('版本号必须是 0.9.0 这样的格式');
}

const mod = JSON.parse(fs.readFileSync(file, 'utf8'));

if (version !== mod.version) {
  if (
    version.localeCompare(mod.version, 'en', {
      numeric: true
    }) <= 0
  ) {
    throw new Error('新版本号必须高于当前版本');
  }

  mod.version = version;
  mod.versionCode = Number(mod.versionCode) + 1;

  fs.writeFileSync(
    file,
    JSON.stringify(mod, null, 2) + '\n',
    'utf8'
  );
}

console.log('版本:', mod.version);
console.log('versionCode:', mod.versionCode);
