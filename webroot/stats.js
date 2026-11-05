
(function () {
  'use strict';

  var api = window.bridge;
  var path = 'stats/random-stats.json';
  var viewPath = 'stats/random-view.json';

  var totalEl = document.getElementById('random-total');
  var todayEl = document.getElementById('random-today');
  var historyEl = document.getElementById('random-history');
  var rankEl = document.getElementById('random-ranking');
  var rankDialog = document.getElementById('ranking-dialog');
  var messageEl = document.getElementById('random-message');

  var actions = [
    document.getElementById('clear-history'),
    document.getElementById('reset-counts'),
    document.getElementById('open-ranking')
  ];

  function emptyData() {
    return {
      schema: 1,
      total: 0,
      day: '',
      today: 0,
      recent: [],
      songs: {}
    };
  }

  function localDay(timestamp) {
    var date = new Date(timestamp);

    return date.getFullYear() + '-' +
      String(date.getMonth() + 1).padStart(2, '0') + '-' +
      String(date.getDate()).padStart(2, '0');
  }

  function emptyView() {
    return {
      resetTotal: 0,
      resetDay: '',
      resetToday: 0,
      resetSongs: {},
      clearAfterSeq: null
    };
  }

  async function readJsonSafely(file, createDefault) {
    try {
      var raw = await api.files.readText(file);
      var data = JSON.parse(raw);

      if (
        !data ||
        typeof data !== 'object' ||
        Array.isArray(data)
      ) {
        throw new Error('数据文件格式错误');
      }

      if (
        file === path &&
        (
          !Array.isArray(data.recent) ||
          !data.songs ||
          typeof data.songs !== 'object' ||
          Array.isArray(data.songs) ||
          !Number.isFinite(Number(data.total))
        )
      ) {
        throw new Error('统计文件格式错误');
      }

      return data;

    } catch (error) {
      var parts = file.split('/');
      var folder = parts[0];
      var filename = parts[1];
      var entries;

      try {
        entries = await api.files.list(folder);
      } catch (_) {
        var root = await api.files.list('');

        if (
          Array.isArray(root) &&
          !root.some(function (item) {
            return item.name === folder;
          })
        ) {
          return createDefault();
        }

        throw error;
      }

      if (!Array.isArray(entries)) throw error;

      var exists = entries.some(function (item) {
        return item.name === filename;
      });

      if (exists) throw error;

      return createDefault();
    }
  }

  function readStats() {
    return readJsonSafely(path, emptyData);
  }

  function readView() {
    return readJsonSafely(viewPath, emptyView);
  }

  function element(tag, className, value) {
    var item = document.createElement(tag);

    if (className) item.className = className;

    if (value !== undefined) {
      item.textContent = String(value);
    }

    return item;
  }

  function timestampText(timestamp) {
    var date = new Date(Number(timestamp));

    if (!isFinite(date.getTime())) return '--:--';

    var clock =
      String(date.getHours()).padStart(2, '0') + ':' +
      String(date.getMinutes()).padStart(2, '0');

    if (localDay(timestamp) === localDay(Date.now())) {
      return clock;
    }

    return String(date.getMonth() + 1).padStart(2, '0') +
      '/' + String(date.getDate()).padStart(2, '0') +
      ' ' + clock;
  }

  function chartText(item) {
    var type = Number(item.type) === 1 ? 'DX' : '标准';

    var names = [
      'BASIC',
      'ADVANCED',
      'EXPERT',
      'MASTER',
      'Re:MASTER'
    ];

    var difficulty =
      names[Number(item.difficulty)] || '未知难度';

    return type + ' · ' +
      difficulty + ' · ' +
      String(item.level || '?');
  }

  function renderHistory(data, view) {
    historyEl.replaceChildren();

    var list = Array.isArray(data.recent)
      ? data.recent.slice(0, 15)
      : [];

    if (view.clearAfterSeq !== null) {
      var cutoff = Number(view.clearAfterSeq) || 0;

      list = list.filter(function (item) {
        return Number(item.seq) > cutoff;
      });
    }

    if (!list.length) {
      historyEl.appendChild(
        element('p', 'stats-empty', '还没有随机记录')
      );
      return;
    }

    list.forEach(function (item) {
      var row = element('div', 'stats-history-row');
      var icon = element('span', 'stats-music-icon', '♪');
      var detail = element('div', 'stats-song-detail');

      detail.appendChild(
        element(
          'div',
          'stats-song-title',
          item.title || '未知歌曲'
        )
      );

      detail.appendChild(
        element(
          'div',
          'stats-song-meta',
          chartText(item)
        )
      );

      row.appendChild(icon);
      row.appendChild(detail);

      row.appendChild(
        element(
          'time',
          'stats-history-time',
          timestampText(item.at)
        )
      );

      historyEl.appendChild(row);
    });
  }

  function renderRanking(data, view) {
    rankEl.replaceChildren();

    var songs = data.songs &&
      typeof data.songs === 'object'
        ? data.songs
        : {};

    var ranking = Object.keys(songs)
      .map(function (id) {
        var value = songs[id];

        if (!Array.isArray(value)) return null;

        var baseline = view.resetSongs &&
          Number(view.resetSongs[id]) || 0;

        return {
          id: id,
          count: Math.max(
            0,
            (Number(value[0]) || 0) - baseline
          ),
          at: Number(value[1]) || 0,
          title: String(value[2] || '未知歌曲')
        };
      })
      .filter(function (song) {
        return song && song.count > 0;
      })
      .sort(function (a, b) {
        return (b.count - a.count) ||
          (b.at - a.at) ||
          a.title.localeCompare(b.title);
      })
      .slice(0, 10);

    if (!ranking.length) {
      rankEl.appendChild(
        element('p', 'stats-empty', '暂无排行榜数据')
      );
      return;
    }

    ranking.forEach(function (song, index) {
      var row = element('li', 'stats-rank-row');

      row.appendChild(
        element('span', 'stats-rank-number', index + 1)
      );

      row.appendChild(
        element('span', 'stats-rank-title', song.title)
      );

      row.appendChild(
        element(
          'span',
          'stats-rank-count',
          song.count + ' 次'
        )
      );

      rankEl.appendChild(row);
    });
  }

  function render(data, view) {
    var total = Math.max(
      0,
      (Number(data.total) || 0) -
      (Number(view.resetTotal) || 0)
    );

    var today = 0;
    var currentDay = localDay(Date.now());

    if (data.day === currentDay) {
      today = Number(data.today) || 0;

      if (view.resetDay === currentDay) {
        today -= Number(view.resetToday) || 0;
      }
    }

    totalEl.textContent = total;
    todayEl.textContent = Math.max(0, today);

    renderHistory(data, view);
    renderRanking(data, view);
  }

  async function refreshStats() {
    if (!api || !api.files) {
      messageEl.textContent = '未连接背屏卡片桥';

      actions.forEach(function (button) {
        button.disabled = true;
      });

      return;
    }

    try {
      var data = await readStats();
      var view = await readView();

      render(data, view);
      messageEl.textContent = '';

      actions.forEach(function (button) {
        button.disabled = false;
      });

    } catch (error) {
      messageEl.textContent = '统计读取失败';

      actions.forEach(function (button) {
        button.disabled = true;
      });
    }
  }

  var statsModifying = false;

  async function mutateView(confirmText, updater) {
    if (statsModifying) return;
    if (!window.confirm(confirmText)) return;

    statsModifying = true;

    actions.forEach(function (button) {
      button.disabled = true;
    });

    try {
      var data = await readStats();
      var view = await readView();

      updater(data, view);

      await api.files.writeText(
        viewPath,
        JSON.stringify(view)
      );

      render(data, view);
      messageEl.textContent = '';

    } catch (error) {
      messageEl.textContent =
        '操作失败：' +
        (error.message || String(error));

    } finally {
      statsModifying = false;

      actions.forEach(function (button) {
        button.disabled = false;
      });
    }
  }

  document.getElementById('clear-history')
    .addEventListener('click', function () {
      mutateView(
        '确定清空最近随机记录吗？不会影响统计次数和排行榜。',
        function (data, view) {
          view.clearAfterSeq = Math.max(
            Number(data.lastSeq) || 0,
            Number(data.total) || 0
          );
        }
      );
    });

  document.getElementById('reset-counts')
    .addEventListener('click', function () {
      mutateView(
        '确定重置累计次数、今日次数和排行榜吗？最近记录会保留。',
        function (data, view) {
          view.resetTotal = Number(data.total) || 0;
          view.resetDay = data.day || '';
          view.resetToday = Number(data.today) || 0;
          view.resetSongs = {};

          var songs = data.songs || {};

          Object.keys(songs).forEach(function (id) {
            var item = songs[id];

            if (Array.isArray(item)) {
              view.resetSongs[id] =
                Math.max(0, Number(item[0]) || 0);
            }
          });
        }
      );
    });

  document.getElementById('open-ranking')
    .addEventListener('click', function () {
      rankDialog.hidden = false;
    });

  document.getElementById('close-ranking')
    .addEventListener('click', function () {
      rankDialog.hidden = true;
    });

  rankDialog.addEventListener('click', function (event) {
    if (event.target === rankDialog) {
      rankDialog.hidden = true;
    }
  });

  window.addEventListener('focus', refreshStats);

  document.addEventListener(
    'visibilitychange',
    function () {
      if (!document.hidden) refreshStats();
    }
  );

  refreshStats();
})();
