
(function () {
  'use strict';

  var info = document.getElementById('cache-info');
  var status = document.getElementById('status');
  var button = document.getElementById('clear');

  var api = window.bridge;

  // 刷新缓存数量和大小
  async function refresh() {
    if (!api || !api.files) {
      info.textContent = '未连接背屏卡片桥';
      button.disabled = true;
      return;
    }

    try {
      var files = await api.files.list('cache/covers');

      // 每首歌对应一个 .json 元数据文件
      var count = files.filter(function (f) {
        return f.name.endsWith('.json') && !f.dir;
      }).length;

      var bytes = files.reduce(function (sum, f) {
        return sum + Number(f.size || 0);
      }, 0);

      info.textContent =
        count + ' 张曲绘 · ' +
        (bytes / 1024 / 1024).toFixed(2) + ' MB';

    } catch (_) {
      info.textContent = '0 张曲绘 · 0 MB';
    }
  }

  // 手动清理曲绘
  button.addEventListener('click', async function () {
    var confirmed = window.confirm(
      '确定清理所有已下载的曲绘吗？离线曲库和当前抽歌结果会保留。'
    );

    if (!confirmed) return;

    button.disabled = true;
    status.textContent = '正在清理…';

    try {
      await api.files.remove('cache/covers');

      status.textContent = '清理完成。';

    } catch (error) {
      status.textContent =
        '清理失败：' + (error.message || error);

    } finally {
      button.disabled = false;
      await refresh();
    }
  });

  refresh();
})();
