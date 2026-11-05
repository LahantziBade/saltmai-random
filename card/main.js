
(function () {
  'use strict';

  var canvas = document.getElementById('rear');
  var ctx = canvas.getContext('2d');

  var W = window.CANVAS_W || 912;
  var H = window.CANVAS_H || 596;

  var catalog = window.SALTMAI_CATALOG || {
    versions: [],
    songs: []
  };

  var VERSION_NAME_FIXES = {
    '版本 20100': '舞萌DX',
    '版本 20105': '舞萌DX',
    '版本 20106': '舞萌DX'
  };

  catalog.versions = catalog.versions.map(function (name) {
    return VERSION_NAME_FIXES[name] || name;
  });

  // 背景图
  var backgroundImage = null;
  var backgroundLoader = new Image();

  backgroundLoader.onload = function () {
    backgroundImage = backgroundLoader;
    requestDraw();
  };

  backgroundLoader.onerror = function () {
    backgroundImage = null;
    requestDraw();
  };

  backgroundLoader.src = 'assets/rear-bg_background_with_logo.webp';

  // 圆环前景图
  var ringsImage = null;
  var ringsLoader = new Image();

  ringsLoader.onload = function () {
    ringsImage = ringsLoader;
    requestDraw();
  };

  ringsLoader.onerror = function () {
    ringsImage = null;
    requestDraw();
  };

  ringsLoader.src = 'assets/rear-bg_rings.webp';

  var guideRingsImage = null;
  var guideRingsLoader = new Image();

  guideRingsLoader.onload = function () {
    guideRingsImage = guideRingsLoader;
    requestDraw();
  };

  guideRingsLoader.onerror = function () {
    guideRingsImage = null;
    requestDraw();
  };

  guideRingsLoader.src = 'assets/rear-bg_rings_go_setting.webp';

  var coverImage = null;
  var coverState = 'loading';
  var coverLoadStartedAt = 0;
  var UI_OFFSET_Y = -12;
  var current = null;
  var requestId = 0;
  var queued = false;
  var retryPress = null;

  var COVER_DISPLAY_TIMEOUT_MS = 18000;
  var RETRY_HOLD_THRESHOLD_MS = 350;
  var NETWORK_RETRY_DELAY_MS = 650;

  // 当前长按动画，null 表示没有动画
  var holdAnimation = null;

  // 动画总时长 2500ms
  var CHARGE_MS = 1500;
  var BURST_MS = 350;
  var REVEAL_MS = 650;
  var TOTAL_MS = CHARGE_MS + BURST_MS + REVEAL_MS;


  var bridgeReady =
    typeof bridge !== 'undefined' &&
    bridge.net &&
    bridge.files;

  var GUIDE_STATE_PATH = 'settings/onboarding.json';

  var guideState = {
    ready: false,
    visitedSettings: false,
    randomCompleted: false
  };

  var guideSaveQueue = Promise.resolve();

  function restoreGuideState() {
    if (!bridgeReady) {
      guideState.ready = true;
      requestDraw();
      return;
    }

    guideSaveQueue = Promise.resolve()
      .then(function () {
        return bridge.files.readText(GUIDE_STATE_PATH);
      })
      .then(function (raw) {
        var saved = JSON.parse(raw);

        if (!saved || typeof saved !== 'object') return;

        guideState.visitedSettings =
          guideState.visitedSettings ||
          saved.visitedSettings === true;

        guideState.randomCompleted =
          guideState.randomCompleted ||
          saved.randomCompleted === true;
      })
      .catch(function () {
        // 首次使用时可能还没有状态文件
      })
      .then(function () {
        guideState.ready = true;
        requestDraw();
      });
  }

  function saveGuideState() {
    if (!bridgeReady) return;

    guideSaveQueue = guideSaveQueue
      .then(function () {
        return bridge.files.writeText(
          GUIDE_STATE_PATH,
          JSON.stringify({
            visitedSettings: guideState.visitedSettings,
            randomCompleted: guideState.randomCompleted
          })
        );
      })
      .catch(function () {});
  }

  function finishSettingsGuide() {
    if (guideState.visitedSettings) return;

    guideState.visitedSettings = true;
    saveGuideState();
    requestDraw();
  }

  function finishRandomGuide() {
    if (guideState.randomCompleted) return;

    guideState.randomCompleted = true;
    saveGuideState();
    requestDraw();
  }

  // 把 10、10+、11、11+ 转成可比较的数字
  function levelNum(value) {
    var s = String(value || '');
    var n = parseInt(s, 10);

    return isFinite(n)
      ? n * 2 + (s.indexOf('+') >= 0 ? 1 : 0)
      : -1;
  }

  // 第一阶段默认范围：
  // 10～15级，红/紫/白，标准/DX 均可
  var filterPage = window.createSaltMaiFilterUI(
    catalog,
    bridgeReady ? bridge : null,
    function () {
      pool = filterPage.buildPool(levelNum);
      requestDraw();
    },
    canvas,
    finishSettingsGuide
  );

  var pool = filterPage.buildPool(levelNum);

  filterPage.restore().then(function () {
    pool = filterPage.buildPool(levelNum);
    requestDraw();
  });

  var guideArrowFramesLeft = 45;

  function shouldContinueDrawing() {
    var now = Date.now();

    if (holdAnimation) return true;
    if (retryPress) return true;
    if (filterPage.isAnimating()) return true;

    if (
      !coverImage &&
      coverState === 'loading' &&
      coverLoadStartedAt > 0 &&
      now - coverLoadStartedAt < COVER_DISPLAY_TIMEOUT_MS
    ) {
      return true;
    }

    if (
      guideState.ready &&
      !guideState.randomCompleted &&
      guideArrowFramesLeft > 0
    ) {
      guideArrowFramesLeft--;
      return true;
    }

    return false;
  }

  function requestDraw() {
    if (queued) return;

    queued = true;

    window.requestAnimationFrame(function () {
      queued = false;

      draw();

      if (shouldContinueDrawing()) {
        requestDraw();
      }
    });
  }

  // 根据可用宽度自动缩小文字
  function fitText(text, x, y, maxWidth, size, color, weight) {
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    do {
      ctx.font =
        (weight || 'normal') +
        ' ' + size + 'px sans-serif';

      if (ctx.measureText(text).width <= maxWidth) break;

      size -= 2;
    } while (size >= 14);

    ctx.fillText(text, x, y);
  }

  function fitCenterText(text, centerX, y, maxWidth, size, color, weight) {
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    do {
      ctx.font =
        (weight || 'normal') +
        ' ' + size + 'px sans-serif';

      if (ctx.measureText(text).width <= maxWidth) break;

      size -= 2;
    } while (size >= 14);

    ctx.fillText(text, centerX, y);
  }

  function truncateTextEnd(text, maxWidth, size, weight) {
    text = String(text || '');
    ctx.font = (weight || 'normal') + ' ' + size + 'px sans-serif';

    if (ctx.measureText(text).width <= maxWidth) {
      return text;
    }

    var result = text;

    while (result.length > 1) {
      result = result.slice(0, -1);

      if (ctx.measureText(result + '...').width <= maxWidth) {
        return result + '...';
      }
    }

    return '...';
  }

  function buildAliasText(aliases) {
    if (!Array.isArray(aliases) || !aliases.length) {
      return '';
    }

    return aliases
      .filter(Boolean)
      .slice(0, 3)
      .map(function (name) {
        return '<' + name + '>';
      })
      .join('');
  }

  // 绘制圆角矩形
  function roundRect(x, y, w, h, r, color) {
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

  // 获取同一首歌、同一谱面类型下的五档等级
  // 0 绿、1 黄、2 红、3 紫、4 白
  function getLevels(song, type) {
    var result = ['', '', '', '', ''];
    var charts = song[3] || [];

    for (var i = 0; i + 2 < charts.length; i += 3) {
      var chartType = charts[i];
      var difficulty = charts[i + 1];
      var level = charts[i + 2];

      if (
        chartType === type &&
        difficulty >= 0 &&
        difficulty <= 4
      ) {
        result[difficulty] = String(level);
      }
    }

    return result;
  }


  function paintRetryIcon(cx, cy) {
    var radius = 32;
    var startAngle = -Math.PI * 0.65;
    var endAngle = Math.PI * 0.72;

    ctx.save();
    ctx.strokeStyle = '#E7EDF5';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.stroke();

    var endX = cx + radius * Math.cos(endAngle);
    var endY = cy + radius * Math.sin(endAngle);
    var direction = endAngle + Math.PI / 2;
    var dx = Math.cos(direction);
    var dy = Math.sin(direction);
    var px = -dy;
    var py = dx;

    ctx.beginPath();
    ctx.moveTo(endX - dx * 14 + px * 10, endY - dy * 14 + py * 10);
    ctx.lineTo(endX, endY);
    ctx.lineTo(endX - dx * 14 - px * 10, endY - dy * 14 - py * 10);
    ctx.stroke();
    ctx.restore();
  }

  function paintCover(x, y, size) {
    ctx.save();
    roundRect(x, y, size, size, 8, '#4B586B');

    if (coverImage) {
      ctx.beginPath();
      ctx.moveTo(x + 8, y);
      ctx.arcTo(x + size, y, x + size, y + size, 8);
      ctx.arcTo(x + size, y + size, x, y + size, 8);
      ctx.arcTo(x, y + size, x, y, 8);
      ctx.arcTo(x, y, x + size, y, 8);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(coverImage, x, y, size, size);
    } else if (coverState === 'failed') {
      paintRetryIcon(x + size / 2, y + size / 2);
    } else {
      ctx.fillStyle = '#AAB7CA';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 60px sans-serif';
      ctx.fillText('♪', x + size / 2, y + size / 2);
    }

    ctx.restore();
  }

  // 绘制封面动画
  function paintAnimatedCover(x, y, size, now) {
    var job = holdAnimation;

    if (!job) {
      paintCover(x, y, size);
      return;
    }

    var elapsed = Math.max(0, now - job.startTime);
    var cx = x + size / 2;
    var cy = y + size / 2;

    // ===== 第一阶段：蓄力 =====
    if (elapsed < CHARGE_MS) {
      var p = elapsed / CHARGE_MS;

      // 平滑放大
      var eased = p * p * (3 - 2 * p);

      var scale =
        1 +
        0.09 * eased +
        Math.sin(now * 0.017) * 0.004 * p;

      // 震动从很轻微逐渐增强
      var shake = 0.4 + 2.3 * p * p;

      var offsetX =
        Math.sin(now * 0.038) * shake;

      var offsetY =
        Math.cos(now * 0.047) * shake * 0.6;

      ctx.save();

      ctx.translate(cx + offsetX, cy + offsetY);
      ctx.scale(scale, scale);

      paintCover(
        -size / 2,
        -size / 2,
        size
      );

      ctx.restore();
      return;
    }

    // ===== 第二阶段：爆炸 =====
    if (elapsed < CHARGE_MS + BURST_MS) {
      var burstP =
        (elapsed - CHARGE_MS) / BURST_MS;

      var burstEase =
        1 - Math.pow(1 - burstP, 3);

      // 原封面迅速膨胀、淡出
      ctx.save();

      ctx.translate(cx, cy);

      var burstScale = 1.09 + 0.34 * burstP;
      ctx.scale(burstScale, burstScale);

      ctx.globalAlpha = 1 - burstP;

      paintCover(
        -size / 2,
        -size / 2,
        size
      );

      ctx.restore();

      // 向外扩散的光环
      ctx.save();
      ctx.globalAlpha = 1 - burstP;

      ctx.strokeStyle = '#B7D6FF';
      ctx.lineWidth = Math.max(1, 8 * (1 - burstP));

      ctx.beginPath();
      ctx.arc(
        cx,
        cy,
        25 + 105 * burstEase,
        0,
        Math.PI * 2
      );
      ctx.stroke();

      // 少量碎片，避免背屏绘制负担过重
      var particleColors = [
        '#DCEBFF',
        '#86B7F5',
        '#5A88D8'
      ];

      for (var i = 0; i < 12; i++) {
        var angle = i * Math.PI * 2 / 12;
        var distance = 25 + 115 * burstEase;

        var px = cx + Math.cos(angle) * distance;
        var py = cy + Math.sin(angle) * distance;

        var particleSize =
          (5 + (i % 3) * 3) * (1 - burstP);

        ctx.fillStyle =
          particleColors[i % particleColors.length];

        ctx.fillRect(
          px - particleSize / 2,
          py - particleSize / 2,
          particleSize,
          particleSize
        );
      }

      ctx.restore();
      return;
    }

    // ===== 第三阶段：新歌揭晓 =====
    var revealP = Math.min(
      1,
      (elapsed - CHARGE_MS - BURST_MS) / REVEAL_MS
    );

    var revealEase =
      1 - Math.pow(1 - revealP, 3);

    // 新封面从 86% 大小弹入正常尺寸
    var revealScale =
      0.86 + 0.14 * revealEase;

    ctx.save();

    ctx.translate(cx, cy);
    ctx.scale(revealScale, revealScale);

    ctx.globalAlpha = Math.min(1, revealP * 2);

    paintCover(
      -size / 2,
      -size / 2,
      size
    );

    ctx.restore();
  }


  // 根据设计图绘制完整首页
  function draw() {
    if (ctx.setTransform) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    ctx.globalAlpha = 1;
  
    var now = Date.now();

    // 长按失败封面仍可随机选歌
    maybeStartRetryHold(now);
    advanceHold(now);

    if (
      !coverImage &&
      coverState === 'loading' &&
      coverLoadStartedAt > 0 &&
      now - coverLoadStartedAt >= COVER_DISPLAY_TIMEOUT_MS
    ) {
      coverState = 'failed';
    }


    // 第一层：基础背景色
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, W, H);

    // 第二层：半透明背景
    if (backgroundImage) {
      ctx.save();

      ctx.globalAlpha = 0.55;
      ctx.drawImage(backgroundImage, 0, 0, W, H);

      ctx.restore();

      // 仅对背景添加深色蒙层
      ctx.fillStyle = 'rgba(17, 24, 39, 0.30)';
      ctx.fillRect(0, 0, W, H);
    }

    // 第三层：清晰圆环
    var activeRingsImage =
      guideState.ready &&
      !guideState.visitedSettings &&
      guideRingsImage
        ? guideRingsImage
        : ringsImage;

    if (activeRingsImage) {
      ctx.save();

      ctx.globalAlpha = 1.0;
      ctx.drawImage(activeRingsImage, 0, 0, W, H);

      ctx.restore();
    }

    // 首页左上角的筛选状态图标
    if (filterPage.isNonDefault()) {
      ctx.save();

      ctx.beginPath();
      ctx.rect(320, 0, W - 320, H);
      ctx.clip();

      ctx.translate(filterPage.homeShift(now), 0);

      ctx.fillStyle = '#D7897E';

      ctx.beginPath();
      ctx.moveTo(332, 26);
      ctx.lineTo(352, 26);
      ctx.lineTo(344, 37);
      ctx.lineTo(344, 47);
      ctx.lineTo(339, 51);
      ctx.lineTo(339, 37);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }

    if (!current || !pool.length) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(320, 0, W - 320, H);
      ctx.clip();

      ctx.translate(filterPage.homeShift(now), 0);

      fitCenterText(
        pool.length
          ? '正在准备随机歌曲…'
          : '没有符合条件的谱面',
        600, 298, 460, 25,
        '#CDD8E9', 'normal'
      );

      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.rect(320, 0, W - 320, H);
      ctx.clip();

      ctx.translate(filterPage.settingsShift(now), 0);
      filterPage.draw(ctx, pool.length);

      ctx.restore();
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(320, 0, W - 320, H);
    ctx.clip();

    ctx.translate(filterPage.homeShift(now), 0);

    // 整体上移，背景不移动
    ctx.translate(0, UI_OFFSET_Y);

    // ===== 总体布局 =====
    // 底部版本、难度区左右延伸，并靠近屏幕底部
    var regionX = 352;
    var regionW = 500;
    var regionCenterX = regionX + regionW / 2;

    // 标题和底部区域统一居中
    var titleCenterX = regionCenterX;

    // 左侧长按提醒
    var promptCenterX = 395;

    // 曲绘：从 194 放大到 284
    var coverSize = 284;
    var coverX = Math.round(regionCenterX - coverSize / 2);
    var coverY = 150;

    // 版本条：横向铺开，下沉
    var versionW = 500;
    var versionH = 54;
    var versionX = Math.round(regionCenterX - versionW / 2);
    var versionY = 464;

    // 五档等级：放大并沉底
    var boxW = 88;
    var boxH = 50;
    var gap = 12;

    var totalLevelWidth = boxW * 5 + gap * 4;
    var levelStartX = Math.round(
      regionCenterX - totalLevelWidth / 2
    );
    var levelY = 528;



    // ===== 标题区域 =====
    var aliasText = buildAliasText(current.aliases || []);

    if (aliasText) {
      // 有别名：双行
      fitCenterText(
        current.title,
        titleCenterX, 57,
        regionW - 20, 35,
        '#F7F9FD', 'bold'
      );

      aliasText = truncateTextEnd(
        aliasText,
        regionW - 20,
        19,
        'normal'
      );

      fitCenterText(
        aliasText,
        titleCenterX, 105,
        regionW - 20, 19,
        '#97A5BA', 'normal'
      );

    } else {
      // 无别名：单行大标题
      fitCenterText(
        current.title,
        titleCenterX, 87,
        regionW - 20, 44,
        '#F7F9FD', 'bold'
      );
    }

    // ===== 提示区域 =====
    if (guideState.ready && !guideState.randomCompleted) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#B7C2D1';

      ctx.font = '24px sans-serif';
      ctx.fillText('长按', promptCenterX, 232);
      ctx.fillText('随机', promptCenterX, 266);

      var arrowShift =
        Math.max(0, Math.sin(now * 0.006)) * 12;

      ctx.font = '31px sans-serif';
      ctx.fillText(
        '→',
        promptCenterX + arrowShift,
        306
      );
    }

    // ===== 曲绘区域 =====
    paintAnimatedCover(
      coverX,
      coverY,
      coverSize,
      now
    );

    // ===== 版本条 =====
    roundRect(
      versionX, versionY,
      versionW, versionH,
      7, '#4B71C5'
    );

    fitCenterText(
      current.version || '未知版本',
      regionCenterX,
      versionY + versionH / 2,
      versionW - 24,
      27,
      '#FFFFFF',
      'bold'
    );

    // ===== 五档难度 =====
    var levels = current.levels || ['', '', '', '', ''];

    var levelColors = [
      '#69B36F', // 绿
      '#D9B150', // 黄
      '#CD6872', // 红
      '#9E87DA', // 紫
      '#F1EDF8'  // 白
    ];

    for (var i = 0; i < 5; i++) {
      var x = levelStartX + i * (boxW + gap);
      var text = levels[i] || '—';

      roundRect(
        x, levelY,
        boxW, boxH,
        7, levelColors[i]
      );

      ctx.fillStyle = i === 4 ? '#7052AA' : '#FFFFFF';
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.fillText(
        text,
        x + boxW / 2,
        levelY + boxH / 2 + 1
      );
    }

    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(320, 0, W - 320, H);
    ctx.clip();

    ctx.translate(filterPage.settingsShift(now), 0);
    filterPage.draw(ctx, pool.length);

    ctx.restore();
  }


  function decodeCover(source) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        reject(new Error('图片解码失败'));
      };
      img.src = source;
    });
  }

  function metaPath(songId) {
    return 'cache/covers/' + songId + '.json';
  }

  function partPath(songId, i) {
    return 'cache/covers/' + songId + '-' + i + '.txt';
  }

  async function readCache(songId) {
    var meta = JSON.parse(
      await bridge.files.readText(metaPath(songId))
    );

    if (
      !meta ||
      !Number.isInteger(meta.n) ||
      meta.n < 1 ||
      meta.n > 8
    ) {
      throw new Error('无有效缓存');
    }

    var base64 = '';
    for (var i = 0; i < meta.n; i++) {
      base64 += await bridge.files.readText(partPath(songId, i));
    }

    if (!base64) throw new Error('缓存为空');
    var format = meta.format === 'webp' ? 'webp' : 'png';
    return 'data:image/' + format + ';base64,' + base64;
  }

  async function writeCache(songId, base64) {
    var chunkSize = 120000;
    var n = Math.ceil(base64.length / chunkSize);

    for (var i = 0; i < n; i++) {
      await bridge.files.writeText(
        partPath(songId, i),
        base64.slice(i * chunkSize, (i + 1) * chunkSize)
      );
    }

    await bridge.files.writeText(
      metaPath(songId),
      JSON.stringify({
        n: n,
        format: 'webp'
      })
    );
  }

  function waitFrames(ms) {
    return new Promise(function (resolve) {
      var start = Date.now();
      function tick() {
        if (Date.now() - start >= ms) {
          resolve();
        } else {
          window.requestAnimationFrame(tick);
        }
      }
      window.requestAnimationFrame(tick);
    });
  }

  function isTemporaryNetworkError(error) {
    var status = error && error.httpStatus;
    if (status === 429 || (status >= 500 && status <= 504)) {
      return true;
    }

    var code = String(error && error.code || '').toUpperCase();
    return code === 'ERROR' ||
      code === 'TIMEOUT' ||
      code === 'NETWORK_ERROR' ||
      code === 'IO_ERROR' ||
      code === 'ECONNRESET' ||
      code === 'CONNECTION_RESET';
  }

  async function getCoverSource(songId, forceNetwork) {
    if (!bridgeReady) {
      throw new Error('桥接 API 不可用');
    }

    if (!forceNetwork) {
      try {
        return {
          src: await readCache(songId),
          cached: true,
          base64: null
        };
      } catch (_) {
        // 没有可用缓存，尝试下载
      }
    }

    var lastError = null;
    for (var attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        await waitFrames(NETWORK_RETRY_DELAY_MS);
      }

      try {
        var response = await bridge.net.request({
          url: 'https://assets.lahantzi.top/maimai/jackets/' + songId + '.webp',
          responseType: 'base64',
          timeoutMs: 12000
        });

        if (!response) {
          throw new Error('无网络响应');
        }

        if (response.status !== 200) {
          var httpError = new Error('HTTP ' + response.status);
          httpError.httpStatus = response.status;
          throw httpError;
        }

        if (!response.bodyBase64) {
          throw new Error('图片内容为空');
        }

        var base64 = response.bodyBase64;
        if (base64.length > 680000) {
          throw new Error('曲绘文件过大');
        }

        return {
          src: 'data:image/webp;base64,' + base64,
          cached: false,
          base64: base64
        };
      } catch (error) {
        lastError = error;
        if (!isTemporaryNetworkError(error) || attempt === 1) {
          break;
        }
      }
    }

    throw lastError || new Error('曲绘下载失败');
  }

  function saveDownloadedCover(songId, result) {
    if (!result || !result.base64) return;
    writeCache(songId, result.base64).catch(function () {});
  }

  async function loadDecodedCover(songId, forceNetwork) {
    var result = await getCoverSource(songId, forceNetwork);
    var image;

    try {
      image = await decodeCover(result.src);
    } catch (error) {
      if (!result.cached) throw error;
      result = await getCoverSource(songId, true);
      image = await decodeCover(result.src);
    }

    saveDownloadedCover(songId, result);
    return {
      image: image,
      cached: result.cached
    };
  }

  async function loadCover(songId, id, forceNetwork) {
    if (id === requestId) {
      coverState = 'loading';
      coverLoadStartedAt = Date.now();
      requestDraw();
    }

    try {
      var result = await loadDecodedCover(songId, !!forceNetwork);
      if (id !== requestId) return;

      coverImage = result.image;
      coverState = 'ready';
      requestDraw();
    } catch (_) {
      if (id !== requestId) return;

      coverImage = null;
      coverState = 'failed';
      requestDraw();
    }
  }

  function retryCurrentCover() {
    if (!current || coverImage || coverState !== 'failed') return;
    if (holdAnimation) return;

    var id = ++requestId;
    coverState = 'loading';
    coverLoadStartedAt = Date.now();
    loadCover(current.id, id, true);
  }

  function maybeStartRetryHold(now) {
    if (!retryPress || holdAnimation) return;
    if (now - retryPress.startTime < RETRY_HOLD_THRESHOLD_MS) return;

    var press = retryPress;
    retryPress = null;
    beginHold({
      pointerId: press.pointerId,
      clientX: press.x,
      clientY: press.y
    });
    if (holdAnimation) {
      holdAnimation.startTime = press.startTime;
    }
  }

  // 保存当前抽中的歌曲
  function saveCurrent() {
    if (
      !bridgeReady ||
      !current ||
      !bridge.card
    ) return;

    var result = bridge.card.saveSnapshot({
      song: current
    });

    if (result && result.catch) {
      result.catch(function () {});
    }
  }

  var RANDOM_STATS_PATH = 'stats/random-stats.json';
  var statsSaveQueue = Promise.resolve();
  var pendingRandomResults = [];

  function randomLocalDay(timestamp) {
    var date = new Date(timestamp);

    return date.getFullYear() + '-' +
      String(date.getMonth() + 1).padStart(2, '0') + '-' +
      String(date.getDate()).padStart(2, '0');
  }

  function emptyRandomStats() {
    return {
      schema: 1,
      total: 0,
      day: '',
      today: 0,
      lastSeq: 0,
      recent: [],
      songs: {}
    };
  }

  async function readRandomStatsForWrite() {
    try {
      var raw = await bridge.files.readText(
        RANDOM_STATS_PATH
      );
      var data = JSON.parse(raw);

      if (
        !data ||
        typeof data !== 'object' ||
        !Array.isArray(data.recent) ||
        !data.songs ||
        typeof data.songs !== 'object' ||
        Array.isArray(data.songs) ||
        !Number.isFinite(Number(data.total))
      ) {
        throw new Error('统计文件格式错误');
      }

      return data;

    } catch (error) {
      var entries;

      try {
        entries = await bridge.files.list('stats');
      } catch (_) {
        var root = await bridge.files.list('');

        if (
          Array.isArray(root) &&
          !root.some(function (item) {
            return item.name === 'stats';
          })
        ) {
          return emptyRandomStats();
        }

        throw error;
      }

      if (!Array.isArray(entries)) throw error;

      var exists = entries.some(function (item) {
        return item.name === 'random-stats.json';
      });

      if (exists) throw error;

      return emptyRandomStats();
    }
  }

  function recordRandomResult(song) {
    if (!bridgeReady || !song) return;

    pendingRandomResults.push({
      id: song.id,
      title: song.title,
      version: song.version,
      type: song.type,
      difficulty: song.difficulty,
      level: song.level,
      at: Date.now()
    });

    statsSaveQueue = statsSaveQueue
      .catch(function () {})
      .then(async function () {
        if (!pendingRandomResults.length) return;

        var batch = pendingRandomResults.slice();
        var data = await readRandomStatsForWrite();

        if (!Number.isFinite(Number(data.lastSeq))) {
          data.lastSeq = 0;
        }

        data.lastSeq = Math.max(
          0,
          Number(data.lastSeq) || 0,
          Number(data.total) || 0
        );

        batch.forEach(function (entry) {
          data.lastSeq += 1;
          entry.seq = data.lastSeq;

          var day = randomLocalDay(entry.at);

          if (data.day !== day) {
            data.day = day;
            data.today = 0;
          }

          data.total =
            Math.max(0, Number(data.total) || 0) + 1;

          data.today =
            Math.max(0, Number(data.today) || 0) + 1;

          data.recent.unshift(entry);

          var key = String(entry.id);
          var previous = data.songs[key];
          var count = Array.isArray(previous)
            ? Math.max(0, Number(previous[0]) || 0)
            : 0;

          data.songs[key] = [
            count + 1,
            entry.at,
            entry.title
          ];
        });

        data.recent = data.recent.slice(0, 15);

        await bridge.files.writeText(
          RANDOM_STATS_PATH,
          JSON.stringify(data)
        );

        pendingRandomResults.splice(0, batch.length);
      })
      .catch(function (error) {
        if (bridge.log && bridge.log.warn) {
          bridge.log.warn(
            '随机统计保存失败：' + String(error)
          );
        }
      });
  }

  // 只随机确定歌曲，不改变屏幕
  function pickNextSong() {
    if (!pool.length) return null;

    var choices = pool;

    // 有多个候选时避免连续出现同一首歌
    if (current && pool.length > 1) {
      choices = pool.filter(function (item) {
        return item.song[0] !== current.id;
      });
    }

    if (!choices.length) choices = pool;

    var picked = choices[
      Math.floor(Math.random() * choices.length)
    ];

    var song = picked.song;

    var chart = picked.charts[
      Math.floor(Math.random() * picked.charts.length)
    ];

    return {
      id: song[0],
      title: song[1],
      version: catalog.versions[song[2]] || '未知版本',
      type: chart[0],
      difficulty: chart[1],
      level: chart[2],
      levels: getLevels(song, chart[0]),
      aliases: Array.isArray(song[4])
        ? song[4].slice(0, 3)
        : []
    };
  }

  // 只用于首次启动时直接显示一首歌
  function chooseNext() {
    var next = pickNextSong();
    if (!next) return;

    current = next;
    coverImage = null;
    coverState = 'loading';
    coverLoadStartedAt = Date.now();

    var id = ++requestId;

    saveCurrent();
    requestDraw();
    loadCover(current.id, id);
  }


  // 只允许点击封面区域抽歌
  function inCover(event) {
    var rect = canvas.getBoundingClientRect
      ? canvas.getBoundingClientRect()
      : {
          left: 0,
          top: 0,
          width: W,
          height: H
        };

    var x =
      (event.clientX - (rect.left || 0)) *
      W / (rect.width || W);

    var y =
      (event.clientY - (rect.top || 0)) *
      H / (rect.height || H);

    return (
      x >= 460 &&
      x <= 744 &&
      y >= 150 + UI_OFFSET_Y &&
      y <= 434 + UI_OFFSET_Y
    );
  }


  function preloadNextCover(job) {
    loadDecodedCover(job.next.id, false).then(function (result) {
      if (job.cancelled) return;

      job.fromCache = result.cached;
      job.image = result.image;

      if (job.revealed && job.displayId === requestId) {
        coverImage = result.image;
        coverState = 'ready';
        requestDraw();
      }
    }).catch(function () {
      if (job.cancelled) return;

      job.failed = true;
      if (job.revealed && job.displayId === requestId) {
        coverImage = null;
        coverState = 'failed';
        requestDraw();
      }
    });
  }

  // 手指按下：开始蓄力并预先抽歌
  function beginHold(event) {
    if (holdAnimation || !pool.length) return;

    var next = pickNextSong();
    if (!next) return;

    var job = {
      pointerId: event.pointerId,
      startTime: Date.now(),

      startX: event.clientX,
      startY: event.clientY,

      next: next,
      image: null,

      fromCache: false,
      failed: false,
      cancelled: false,
      revealed: false,
      displayId: 0
    };

    holdAnimation = job;

    // 尝试捕获手指，避免轻微移动中断
    try {
      if (
        canvas.setPointerCapture &&
        event.pointerId !== undefined
      ) {
        canvas.setPointerCapture(event.pointerId);
      }
    } catch (_) {}

    // 立刻开始缓存读取或下载
    // 不等待它完成，也不提前显示新歌
    preloadNextCover(job);

    requestDraw();
  }

  // 提前松手或明显移开手指：取消蓄力
  function cancelHold() {
    var job = holdAnimation;
    if (!job || job.revealed) return;

    job.cancelled = true;
    holdAnimation = null;

    // 当前歌曲和曲绘均不发生变化
    requestDraw();
  }

  // 每一帧检查动画进度
  function advanceHold(now) {
    var job = holdAnimation;
    if (!job) return;

    var elapsed = now - job.startTime;
    var revealStart = CHARGE_MS + BURST_MS;

    // 爆炸完成后才正式切换下一首歌
    if (!job.revealed && elapsed >= revealStart) {
      job.revealed = true;

      current = job.next;

      // 使先前歌曲的异步加载结果失效
      job.displayId = ++requestId;

      // 图片准备好了就直接显示
      // 否则先使用灰色占位
      coverImage = job.image || null;

      coverState = job.image
        ? 'ready'
        : (job.failed ? 'failed' : 'loading');
      coverLoadStartedAt = now;

      saveCurrent();
      recordRandomResult(current);
    }

    // 2.5 秒后结束动画
    if (elapsed >= TOTAL_MS) {
      if (job.revealed) {
        finishRandomGuide();
      }

      holdAnimation = null;
    }
  }



  canvas.addEventListener('pointerdown', function (event) {
    if (filterPage.onDown(event)) {
      requestDraw();
      return;
    }
    if (event.isPrimary === false) return;
    if (event.button !== undefined && event.button !== 0) return;
    if (!inCover(event)) return;

    if (!coverImage && coverState === 'failed' && !holdAnimation) {
      retryPress = {
        pointerId: event.pointerId,
        startTime: Date.now(),
        x: event.clientX,
        y: event.clientY
      };
      requestDraw();
      return;
    }

    beginHold(event);
  });

  canvas.addEventListener('pointermove', function (event) {
    if (filterPage.onMove(event)) {
      requestDraw();
      retryPress = null;
      cancelHold();
      return;
    }
    if (retryPress && event.pointerId === retryPress.pointerId) {
      var rx = event.clientX - retryPress.x;
      var ry = event.clientY - retryPress.y;
      if (rx * rx + ry * ry > 28 * 28) retryPress = null;
      return;
    }

    var job = holdAnimation;
    if (!job || event.pointerId !== job.pointerId) return;
    if (Date.now() - job.startTime >= CHARGE_MS) return;

    var dx = event.clientX - job.startX;
    var dy = event.clientY - job.startY;
    if (dx * dx + dy * dy > 28 * 28) cancelHold();
  });

  canvas.addEventListener('pointerup', function (event) {
    if (filterPage.onUp(event)) {
      requestDraw();
      retryPress = null;
      cancelHold();
      return;
    }
    if (retryPress && event.pointerId === retryPress.pointerId) {
      retryPress = null;
      retryCurrentCover();
      return;
    }

    var job = holdAnimation;
    if (!job || event.pointerId !== job.pointerId) return;

    var now = Date.now();
    if (now - job.startTime < CHARGE_MS) {
      cancelHold();
    } else {
      advanceHold(now);
    }
  });

  canvas.addEventListener('pointercancel', function (event) {
    if (filterPage.onCancel(event)) {
      requestDraw();
      retryPress = null;
      cancelHold();
      return;
    }
    if (retryPress && event.pointerId === retryPress.pointerId) {
      retryPress = null;
      return;
    }

    var job = holdAnimation;
    if (!job || event.pointerId !== job.pointerId) return;
    if (Date.now() - job.startTime < CHARGE_MS) cancelHold();
  });

  // 恢复上次抽中的歌曲
  var snapshot =
    bridgeReady &&
    bridge.card &&
    bridge.card.readSnapshot();

  if (
    snapshot &&
    snapshot.song &&
    Number.isInteger(snapshot.song.id)
  ) {
    current = snapshot.song;

    for (var s = 0; s < catalog.songs.length; s++) {
      if (catalog.songs[s][0] === current.id) {
        current.version =
          catalog.versions[catalog.songs[s][2]] ||
          current.version ||
          '未知版本';

        current.levels = getLevels(
          catalog.songs[s],
          current.type
        );

        current.aliases = Array.isArray(catalog.songs[s][4])
          ? catalog.songs[s][4].slice(0, 3)
          : [];

        break;
      }
    }

    requestDraw();
    loadCover(current.id, ++requestId);
  } else {
    chooseNext();
  }
  restoreGuideState();
  requestDraw();
})();
