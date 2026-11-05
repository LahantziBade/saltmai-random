const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const input = path.join(root, 'data', 'lxns.json');
const aliasInput = path.join(root, 'data', 'dxrating-aliases.json');
const lxnsAliasInput = path.join(root, 'data', 'lxns-aliases.json');
const output = path.join(root, 'card', 'assets', 'catalog.js');

if (!fs.existsSync(input)) {
  console.error('找不到 data/lxns.json，请先下载落雪曲目列表。');
  process.exit(1);
}

const response = JSON.parse(fs.readFileSync(input, 'utf8'));
const raw = Array.isArray(response.songs) ? response : response.data;

if (!raw || !Array.isArray(raw.songs) || raw.songs.length < 100) {
  throw new Error('曲库 JSON 结构或数量异常，已停止生成。');
}

const releases = Array.isArray(raw.versions)
  ? raw.versions.slice()
  : [];

releases.sort((a, b) => Number(a.id) - Number(b.id));

const versionNames = [];
const versionNameToIndex = new Map();
const versionKeyToIndex = new Map();

function ensureVersionName(name) {
  const key = String(name);

  if (versionNameToIndex.has(key)) {
    return versionNameToIndex.get(key);
  }

  const index = versionNames.length;
  versionNames.push(key);
  versionNameToIndex.set(key, index);
  return index;
}

// 同时把 Version.id 和 Version.version 映射到同一个标题
for (const v of releases) {
  const title = String(v.title || v.version || v.id);
  const index = ensureVersionName(title);

  if (v.id != null) {
    versionKeyToIndex.set(String(v.id), index);
  }

  if (v.version != null) {
    versionKeyToIndex.set(String(v.version), index);
  }
}

function versionIndex(rawVersion) {
  const key = String(rawVersion ?? 'unknown');

  // 优先精确匹配
  if (versionKeyToIndex.has(key)) {
    return versionKeyToIndex.get(key);
  }

  const number = Number(rawVersion);

  // 尝试把 23007 这种值归到 23000 主版本
  if (Number.isFinite(number)) {
    const normalized = String(Math.floor(number / 100) * 100);

    if (versionKeyToIndex.has(normalized)) {
      return versionKeyToIndex.get(normalized);
    }
  }

  // 实在没有就保留编号
  return ensureVersionName('版本 ' + key);
}


 // DXRating 别名：legacy 的 song_id 是歌曲名称，不是数字 ID

function normalizeSongTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

let aliasRows = [];

if (fs.existsSync(aliasInput)) {
  const aliasRaw = JSON.parse(
    fs.readFileSync(aliasInput, 'utf8')
  );

  aliasRows = Array.isArray(aliasRaw)
    ? aliasRaw
    : [];
}

// 歌曲名称 -> 别名数组
const aliasMap = new Map();

for (const row of aliasRows) {
  const key = normalizeSongTitle(row.song_id);
  const name = String(row.name || '').trim();

  if (!key || !name) continue;

  // 排除与歌曲原名完全相同的别名
  if (normalizeSongTitle(name) === key) continue;

  const list = aliasMap.get(key) || [];

  // 去重，最多保存三个
  const exists = list.some(
    item => normalizeSongTitle(item) ===
      normalizeSongTitle(name)
  );

  if (!exists) {
    list.push(name);
  }

  aliasMap.set(key, list);
}

if (!fs.existsSync(lxnsAliasInput)) {
  throw new Error('找不到 data/lxns-aliases.json');
}

const lxnsAliasRaw = JSON.parse(
  fs.readFileSync(lxnsAliasInput, 'utf8')
);

const lxnsAliasRows = lxnsAliasRaw.aliases;

if (!Array.isArray(lxnsAliasRows)) {
  throw new Error('落雪别名数据格式异常');
}

const lxnsAliasMap = new Map();

for (const row of lxnsAliasRows) {
  const id = Number(row.song_id);

  if (!Number.isInteger(id) || !Array.isArray(row.aliases)) {
    continue;
  }

  const list = lxnsAliasMap.get(id) || [];

  for (const item of row.aliases) {
    const name = String(item || '').trim();
    const key = normalizeSongTitle(name);

    if (!key) continue;

    const exists = list.some(
      value => normalizeSongTitle(value) === key
    );

    if (!exists) {
      list.push(name);
    }
  }

  lxnsAliasMap.set(id, list);
}

// 检查同名歌曲，避免把别名错误地分配给另一首歌
const titleCounts = new Map();

for (const song of raw.songs) {
  const key = normalizeSongTitle(song.title);

  if (!key) continue;

  titleCounts.set(
    key,
    (titleCounts.get(key) || 0) + 1
  );
}

function mergedAliases(id, title) {
  const key = normalizeSongTitle(title);
  const merged = [];
  const seen = new Set([key]);

  const primary = lxnsAliasMap.get(id) || [];

  const extra = titleCounts.get(key) === 1
    ? (aliasMap.get(key) || [])
    : [];

  for (const item of primary.concat(extra)) {
    const name = String(item || '').trim();
    const normalized = normalizeSongTitle(name);

    if (!normalized || seen.has(normalized)) continue;

    seen.add(normalized);
    merged.push(name);

    if (merged.length === 3) break;
  }

  return merged;
}

// 使用北京时间判断已配信歌曲
const today = new Date(
  Date.now() + 8 * 60 * 60 * 1000
).toISOString().slice(0, 10);

function isReleased(date) {
  return !date || String(date).slice(0, 10) <= today;
}

const songs = [];
const songIds = new Set();

for (const song of raw.songs) {
  const id = Number(song.id);

  if (
    !Number.isInteger(id) ||
    id <= 0 ||
    id >= 100000 ||
    song.disabled === true ||
    !isReleased(song.release_date)
  ) {
    continue;
  }

  if (songIds.has(id)) {
    throw new Error('重复歌曲 ID: ' + id);
  }

  const title = String(song.title || '未知曲名');
  const charts = [];
  const groups = song.difficulties || {};

  // type：0 = 标准谱，1 = DX 谱
  for (const [type, entries] of [
    [0, groups.standard],
    [1, groups.dx]
  ]) {
    if (!Array.isArray(entries)) continue;

    for (const chart of entries) {
      const difficulty = Number(chart.difficulty);
      const level = String(chart.level || '').trim();

      if (
        !Number.isInteger(difficulty) ||
        difficulty < 0 ||
        difficulty > 4 ||
        !/^\d{1,2}\+?$/.test(level)
      ) {
        continue;
      }

      if (!isReleased(chart.release_date)) continue;

      charts.push(type, difficulty, level);
    }
  }

  if (charts.length === 0) continue;


  const aliases = mergedAliases(id, title);


  songIds.add(id);

  songs.push([
    id,                           // 0
    title,                        // 1
    versionIndex(song.version),   // 2
    charts,                       // 3
    aliases                       // 4
  ]);
}

if (songs.length < 100) {
  throw new Error('可用曲目少于 100，疑似接口字段发生变化。');
}

const code = 'window.SALTMAI_CATALOG=' +
  JSON.stringify({
    versions: versionNames,
    songs: songs
  }) + ';\n';

const size = Buffer.byteLength(code);

if (size > 800 * 1024) {
  throw new Error('曲库脚本过大，请先压缩字段。');
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, code, 'utf8');

const chartCount = songs.reduce(
  (n, song) => n + song[3].length / 3,
  0
);

const aliasCount = songs.reduce(
  (n, song) => n + (Array.isArray(song[4]) ? song[4].length : 0),
  0
);

console.log('生成成功：' + songs.length + ' 首歌曲');
console.log('谱面数量：' + chartCount);
console.log('别名数量：' + aliasCount);
console.log('曲库大小：' + (size / 1024).toFixed(1) + ' KiB');
console.log('输出：' + output);