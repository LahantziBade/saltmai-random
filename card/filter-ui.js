
(function () {
  'use strict';

  window.createSaltMaiFilterUI = function (
    catalog,
    bridgeApi,
    onChange,
    canvas,
    onSettingsEntered
  ) {
    var W = 912;
    var LEVELS = ['10', '10+', '11', '11+', '12', '12+',
                  '13', '13+', '14', '14+', '15'];

    var versions = [];
    catalog.versions.forEach(function (name) {
      if (versions.indexOf(name) < 0) versions.push(name);
    });

    var settings = {
      levelEnabled: true,
      low: 0,
      high: 10,
      versionEnabled: false,
      versions: versions.slice(),
      types: [0, 1],
      difficulties: [2, 3, 4]
    };

    var changed = false;
    var saveQueue = Promise.resolve();
    var pagePosition = 0;
    var animation = null;
    var pointer = null;
    var versionsOpen = false;
    var versionPage = 0;
    function sameSelection(current, expected) {
      return current.length === expected.length &&
        expected.every(function (value) {
          return current.indexOf(value) >= 0;
        });
    }

    function isNonDefault() {
      return (
        !settings.levelEnabled ||
        settings.low !== 0 ||
        settings.high !== 10 ||
        settings.versionEnabled ||
        !sameSelection(settings.types, [0, 1]) ||
        !sameSelection(settings.difficulties, [2, 3, 4])
      );
    }

    function resetFilters() {
      settings.levelEnabled = true;
      settings.low = 0;
      settings.high = 10;
      settings.versionEnabled = false;
      settings.versions = versions.slice();
      settings.types = [0, 1];
      settings.difficulties = [2, 3, 4];

      commit();
    }

    function clamp(value, low, high) {
      return Math.max(low, Math.min(high, value));
    }

    function restore() {
      if (!bridgeApi || !bridgeApi.files) return Promise.resolve();

      return bridgeApi.files.readText('settings/random-filters.json')
        .then(function (raw) {
          if (changed) return;

          var data = JSON.parse(raw);
          if (!data || typeof data !== 'object') return;

          settings.levelEnabled = data.levelEnabled !== false;
          settings.low = clamp(Number(data.low) || 0, 0, 10);
          settings.high = clamp(Number(data.high), settings.low, 10);
          if (!isFinite(settings.high)) settings.high = 10;

          settings.versionEnabled = data.versionEnabled === true;

          if (Array.isArray(data.versions)) {
            settings.versions = versions.filter(function (name) {
              return data.versions.indexOf(name) >= 0;
            });
          }

          if (Array.isArray(data.types)) {
            settings.types = [0, 1].filter(function (type) {
              return data.types.indexOf(type) >= 0;
            });
          }

          if (Array.isArray(data.difficulties)) {
            settings.difficulties = [2, 3, 4].filter(function (diff) {
              return data.difficulties.indexOf(diff) >= 0;
            });
          }

          onChange();
        })
        .catch(function () {});
    }

    function commit() {
      changed = true;
      onChange();

      if (!bridgeApi || !bridgeApi.files) return;

      var serialized = JSON.stringify(settings);
      saveQueue = saveQueue.then(function () {
        return bridgeApi.files.writeText(
          'settings/random-filters.json',
          serialized
        );
      }).catch(function () {});
    }

    function buildPool(levelNum) {
      var result = [];

      catalog.songs.forEach(function (song) {
        var name = catalog.versions[song[2]];

        if (
          settings.versionEnabled &&
          settings.versions.indexOf(name) < 0
        ) return;

        var source = song[3] || [];
        var available = [];

        for (var i = 0; i + 2 < source.length; i += 3) {
          var type = source[i];
          var diff = source[i + 1];
          var level = source[i + 2];
          var rank = levelNum(level);

          if (
            settings.types.indexOf(type) < 0 ||
            settings.difficulties.indexOf(diff) < 0
          ) continue;

          if (
            settings.levelEnabled &&
            (rank < 20 + settings.low ||
             rank > 20 + settings.high)
          ) continue;

          available.push([type, diff, level]);
        }

        if (available.length) {
          result.push({
            song: song,
            charts: available
          });
        }
      });

      return result;
    }

    function page(now) {
      if (animation) {
        var t = clamp((now - animation.start) / 240, 0, 1);
        var eased = t * t * (3 - 2 * t);

        pagePosition = animation.from +
          (animation.to - animation.from) * eased;

        if (t === 1) {
          var enteredSettings = animation.to === 1;

          animation = null;

          if (
            enteredSettings &&
            typeof onSettingsEntered === 'function'
          ) {
            onSettingsEntered();
          }
        }
      }

      return pagePosition;
    }

    function settle(target) {
      animation = {
        from: page(Date.now()),
        to: target,
        start: Date.now()
      };
    }

    function point(event) {
      var rect = canvas.getBoundingClientRect();

      return {
        x: (event.clientX - rect.left) * W / rect.width,
        y: (event.clientY - rect.top) * 596 / rect.height
      };
    }

    function setLevelFromX(x, which) {
      var value = clamp(
        Math.round((x - 398) / 450 * 10),
        0,
        10
      );

      if (which === 'low') {
        settings.low = Math.min(value, settings.high);
      } else {
        settings.high = Math.max(value, settings.low);
      }
    }

    function onDown(event) {
      if (
        event.isPrimary === false ||
        (event.button !== undefined && event.button !== 0)
      ) return false;

      var pos = point(event);
      var nowPage = page(Date.now());
      var inSettings = nowPage > 0.85;

      pointer = {
        id: event.pointerId,
        x: pos.x,
        y: pos.y,
        oldPosition: nowPage,
        fromSettings: inSettings,
        swiping: false,
        slider: null,
        sliderChanged: false
      };

      if (
        inSettings &&
        !versionsOpen &&
        settings.levelEnabled &&
        pos.y >= 174 &&
        pos.y <= 228 &&
        pos.x >= 365 &&
        pos.x <= 875
      ) {
        var a = 398 + settings.low * 45;
        var b = 398 + settings.high * 45;

        pointer.slider = Math.abs(pos.x - a) < Math.abs(pos.x - b)
          ? 'low' : 'high';

        if (a === b) {
          pointer.slider = pos.x < a ? 'low' : 'high';
        }

        var previous = settings.low + ':' + settings.high;
        setLevelFromX(pos.x, pointer.slider);

        pointer.sliderChanged =
          previous !== settings.low + ':' + settings.high;
      }

      return inSettings;
    }

    function onMove(event) {
      if (!pointer || pointer.id !== event.pointerId) return false;

      var pos = point(event);
      var dx = pos.x - pointer.x;
      var dy = pos.y - pointer.y;

      if (pointer.slider) {
        var previous = settings.low + ':' + settings.high;
        setLevelFromX(pos.x, pointer.slider);

        if (previous !== settings.low + ':' + settings.high) {
          pointer.sliderChanged = true;
        }
        return true;
      }

      if (
        !versionsOpen &&
        !pointer.swiping &&
        Math.abs(dx) > 18 &&
        Math.abs(dx) > Math.abs(dy) * 1.2
      ) {
        if (
          (!pointer.fromSettings && dx > 0) ||
          (pointer.fromSettings && dx < 0)
        ) {
          pointer.swiping = true;
        }
      }

      if (pointer.swiping) {
        animation = null;
        pagePosition = clamp(
          pointer.oldPosition + dx / W,
          0,
          1
        );
        return true;
      }

      return pointer.fromSettings;
    }

    function contains(x, y, left, top, width, height) {
      return (
        x >= left &&
        x <= left + width &&
        y >= top &&
        y <= top + height
      );
    }

    function toggle(array, value) {
      var index = array.indexOf(value);

      if (index >= 0) array.splice(index, 1);
      else array.push(value);
    }

    function tap(x, y) {
      if (versionsOpen) {
        if (contains(x, y, 770, 26, 112, 62)) {
          versionsOpen = false;
          return;
        }

        if (contains(x, y, 355, 521, 90, 53)) {
          settings.versions = versions.slice();
          commit();
          return;
        }

        if (contains(x, y, 450, 521, 90, 53)) {
          settings.versions = [];
          commit();
          return;
        }

        var pages = Math.max(
          1,
          Math.ceil(versions.length / 14)
        );

        if (contains(x, y, 725, 521, 70, 53)) {
          versionPage = Math.max(0, versionPage - 1);
          return;
        }

        if (contains(x, y, 795, 521, 80, 53)) {
          versionPage = Math.min(
            pages - 1,
            versionPage + 1
          );
          return;
        }

        for (var i = 0; i < 14; i++) {
          var index = versionPage * 14 + i;
          if (index >= versions.length) break;

          var col = i % 2;
          var row = Math.floor(i / 2);

          if (
            contains(
              x,
              y,
              col ? 618 : 354,
              103 + row * 55,
              258,
              50
            )
          ) {
            toggle(settings.versions, versions[index]);
            commit();
            return;
          }
        }
        return;
      }

      if (contains(x, y, 755, 32, 120, 62)) {
        resetFilters();
        return;
      }

      if (contains(x, y, 340, 101, 250, 58)) {
        settings.levelEnabled = !settings.levelEnabled;
        commit();

      } else if (contains(x, y, 340, 261, 208, 64)) {
        settings.versionEnabled = !settings.versionEnabled;
        commit();

      } else if (contains(x, y, 552, 261, 320, 64)) {
        versionsOpen = true;
        versionPage = 0;

      } else if (contains(x, y, 414, 384, 175, 53)) {
        toggle(settings.types, 0);
        commit();

      } else if (contains(x, y, 610, 384, 175, 53)) {
        toggle(settings.types, 1);
        commit();

      } else if (contains(x, y, 414, 479, 150, 51)) {
        toggle(settings.difficulties, 2);
        commit();

      } else if (contains(x, y, 574, 479, 150, 51)) {
        toggle(settings.difficulties, 3);
        commit();

      } else if (contains(x, y, 734, 479, 150, 51)) {
        toggle(settings.difficulties, 4);
        commit();
      }
    }

    function onUp(event) {
      if (!pointer || pointer.id !== event.pointerId) return false;

      var pos = point(event);
      var dx = pos.x - pointer.x;
      var dy = pos.y - pointer.y;

      var used =
        pointer.fromSettings ||
        pointer.swiping ||
        !!pointer.slider;

      if (pointer.slider) {
        if (pointer.sliderChanged) commit();

      } else if (pointer.swiping) {
        settle(
          pointer.fromSettings
            ? (dx < -80 ? 0 : 1)
            : (dx > 80 ? 1 : 0)
        );

      } else if (
        pointer.fromSettings &&
        Math.abs(dx) < 20 &&
        Math.abs(dy) < 20
      ) {
        tap(pos.x, pos.y);
      }

      pointer = null;
      return used;
    }

    function onCancel(event) {
      if (!pointer || pointer.id !== event.pointerId) return false;

      var used =
        pointer.fromSettings ||
        pointer.swiping ||
        !!pointer.slider;

      if (pointer.slider && pointer.sliderChanged) commit();

      if (pointer.swiping) {
        settle(pointer.fromSettings ? 1 : 0);
      }

      pointer = null;
      return used;
    }

    function box(ctx, x, y, w, h, r, color) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      ctx.fill();
    }

    function label(ctx, value, x, y, size, color, weight, align) {
      ctx.font =
        (weight || 'normal') + ' ' + size + 'px sans-serif';
      ctx.fillStyle = color || '#F3F5FC';
      ctx.textAlign = align || 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(value, x, y);
    }

    function check(ctx, x, y, selected, color) {
      box(
        ctx,
        x - 15,
        y - 15,
        30,
        30,
        6,
        selected
          ? (color || '#5B82C8')
          : 'rgba(230,237,247,0.18)'
      );

      if (!selected) return;

      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';

      ctx.beginPath();
      ctx.moveTo(x - 7, y);
      ctx.lineTo(x - 1, y + 6);
      ctx.lineTo(x + 9, y - 8);
      ctx.stroke();
    }

    function drawVersions(ctx) {
      box(
        ctx, 342, 21, 544, 555, 14,
        'rgba(19,27,43,0.97)'
      );

      label(
        ctx, '选择版本', 368, 60, 30,
        '#FFFFFF', 'bold'
      );

      label(
        ctx, '完成', 829, 60, 24,
        '#9CC3FF', 'bold', 'center'
      );

      var start = versionPage * 14;

      for (var i = 0; i < 14; i++) {
        var idx = start + i;
        if (idx >= versions.length) break;

        var col = i % 2;
        var row = Math.floor(i / 2);
        var x = col ? 640 : 373;
        var y = 128 + row * 55;

        check(
          ctx,
          x,
          y,
          settings.versions.indexOf(versions[idx]) >= 0
        );

        label(ctx, versions[idx], x + 24, y, 20);
      }

      label(ctx, '全选', 394, 548, 22, '#C8D9F2');
      label(ctx, '清空', 490, 548, 22, '#C8D9F2');

      label(
        ctx,
        (versionPage + 1) + ' / ' +
          Math.max(1, Math.ceil(versions.length / 14)),
        660, 548, 21,
        '#A8B4CA', 'normal', 'center'
      );

      label(
        ctx, '‹', 760, 545, 40,
        '#BFD8FF', 'normal', 'center'
      );

      label(
        ctx, '›', 827, 545, 40,
        '#BFD8FF', 'normal', 'center'
      );
    }

    function draw(ctx, count) {
      label(
        ctx, '筛选设置', 535, 65, 32,
        '#FFFFFF', 'bold', 'center'
      );

      label(
        ctx, '重置', 815, 65, 23,
        '#B9D6FF', 'bold', 'center'
      );

      // 等级限制
      check(ctx, 369, 130, settings.levelEnabled);
      label(ctx, '等级范围', 400, 130, 25);

      label(
        ctx,
        LEVELS[settings.low] + ' ～ ' + LEVELS[settings.high],
        844, 130, 23,
        '#B9D6FF', 'bold', 'right'
      );

      box(ctx, 398, 198, 450, 6, 3, '#556276');

      box(
        ctx,
        398 + settings.low * 45,
        198,
        Math.max(2, (settings.high - settings.low) * 45),
        6,
        3,
        '#83ADE9'
      );

      [settings.low, settings.high].forEach(function (value) {
        ctx.beginPath();
        ctx.arc(
          398 + value * 45,
          201,
          14,
          0,
          Math.PI * 2
        );

        ctx.fillStyle = settings.levelEnabled
          ? '#F2F6FF'
          : '#8795A7';

        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#5B82C8';
        ctx.stroke();
      });

      label(
        ctx, '10', 398, 237, 20,
        '#AFC2DE', 'normal', 'center'
      );

      label(
        ctx, '15', 848, 237, 20,
        '#AFC2DE', 'normal', 'center'
      );

      // 版本限制
      check(ctx, 369, 291, settings.versionEnabled);
      label(ctx, '版本限制', 400, 291, 25);

      box(ctx, 552, 267, 315, 49, 8, '#314C75');

      var summary = settings.versions.length === versions.length
        ? '全部版本'
        : ('已选 ' + settings.versions.length + ' 个版本');

      label(
        ctx, summary + ' ›', 708, 291, 23,
        '#FFFFFF', 'normal', 'center'
      );

      // 谱面类型
      label(ctx, '谱面类型', 365, 370, 25);

      check(
        ctx, 437, 410,
        settings.types.indexOf(0) >= 0
      );
      label(ctx, '标准谱', 462, 410, 23);

      check(
        ctx, 630, 410,
        settings.types.indexOf(1) >= 0
      );
      label(ctx, 'DX 谱', 654, 410, 23);

      // 谱面难度
      label(ctx, '谱面难度', 365, 463, 25);

      var names = ['红谱', '紫谱', '白谱'];
      var colors = ['#CD6872', '#9E87DA', '#D6C7F7'];

      [2, 3, 4].forEach(function (diff, i) {
        var x = 433 + i * 160;

        check(
          ctx,
          x,
          505,
          settings.difficulties.indexOf(diff) >= 0,
          colors[i]
        );

        label(ctx, names[i], x + 25, 505, 23);
      });

      // 当前筛选结果
      label(
        ctx,
        count
          ? '符合条件：' + count + ' 首歌曲'
          : '没有符合条件的谱面',
        610,
        559,
        20,
        count ? '#C1D2EC' : '#FFB7B7',
        'normal',
        'center'
      );

      if (versionsOpen) drawVersions(ctx);
    }

    return {
      restore: restore,
      buildPool: buildPool,
      draw: draw,
      isNonDefault: isNonDefault,
      isAnimating: function () {
        return !!animation;
      },

      homeShift: function (now) {
        return page(now) * W;
      },

      settingsShift: function (now) {
        return (page(now) - 1) * W;
      },

      onDown: onDown,
      onMove: onMove,
      onUp: onUp,
      onCancel: onCancel
    };
  };
})();
