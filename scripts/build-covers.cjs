
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist-covers');

const sandbox = { window: {} };
const catalogJs = fs.readFileSync(
  path.join(root, 'card/assets/catalog.js'),
  'utf8'
);

vm.runInNewContext(catalogJs, sandbox, { timeout: 5000 });

const songs = sandbox.window.SALTMAI_CATALOG.songs;
const allIds = [...new Set(songs.map(song => song[0]))];

let ids = allIds;

if (process.argv.includes('--missing-only')) {
  const missingFile = path.join(
    root, 'missing-covers.json'
  );

  const missing = JSON.parse(
    fs.readFileSync(missingFile, 'utf8')
  );

  if (!Array.isArray(missing)) {
    throw new Error('缺失曲绘清单格式错误');
  }

  const validIds = new Set(allIds);

  ids = [...new Set(missing.map(Number))]
    .filter(id => validIds.has(id));
}

let cursor = 0;
let success = 0;
const failed = [];

async function downloadCover(id) {
  const dest = path.join(output, `${id}.webp`);

  if (fs.existsSync(dest)) return;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(
        `https://assets2.lxns.net/maimai/jacket/${id}.png`,
        { signal: AbortSignal.timeout(15000) }
      );

      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.permanent = response.status === 404;
        throw error;
      }

      const data = Buffer.from(await response.arrayBuffer());

      await sharp(data)
        .resize(320, 320, {
          fit: 'contain',
          background: '#00000000'
        })
        .webp({ quality: 80, effort: 4 })
        .toFile(dest);

      success++;
      return;
    } catch (error) {
      if (attempt === 2 || error.permanent) {
        failed.push(`${id}: ${error.message}`);
        return;
      }
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

async function worker() {
  while (cursor < ids.length) {
    const id = ids[cursor++];
    await downloadCover(id);
  }
}

(async () => {
  fs.mkdirSync(output, { recursive: true });

  await Promise.all(
    Array.from({ length: 4 }, () => worker())
  );

  fs.writeFileSync(
    path.join(root, 'cover-failures.txt'),
    failed.join('\n'),
    'utf8'
  );

  console.log('歌曲总数:', ids.length);
  console.log('本次成功转换:', success);
  console.log('失败:', failed.length);
})();
