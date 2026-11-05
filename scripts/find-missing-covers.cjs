
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

const catalogFile = path.join(
  root, 'card', 'assets', 'catalog.js'
);

const listingFile = path.join(root, 'r2-cover-list.txt');
const outputFile = path.join(root, 'missing-covers.json');

const sandbox = { window: {} };

vm.runInNewContext(
  fs.readFileSync(catalogFile, 'utf8'),
  sandbox,
  { timeout: 5000 }
);

const songs = sandbox.window.SALTMAI_CATALOG.songs;

const ids = [...new Set(
  songs.map(song => Number(song[0]))
)];

const listing = fs.readFileSync(
  listingFile, 'utf8'
);

const existing = new Set();

for (const line of listing.split(/\r?\n/)) {
  const match = line.match(
    /\smaimai\/jackets\/(\d+)\.webp\s*$/
  );

  if (match) {
    existing.add(Number(match[1]));
  }
}

const missing = ids.filter(id => !existing.has(id));

fs.writeFileSync(
  outputFile,
  JSON.stringify(missing),
  'utf8'
);

console.log('当前曲库歌曲:', ids.length);
console.log('R2 已有曲绘:', existing.size);
console.log('需要补充:', missing.length);

if (missing.length) {
  console.log('缺失歌曲 ID:', missing.join(', '));
}
