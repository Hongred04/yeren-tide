/* ============================================================
 * 野人量化 · 更新检查
 *
 * 三个约束决定了这里的做法：
 *
 * 1) 页面是 file://（WebView 加载 assets）。file:// 发 fetch 到 https
 *    属于跨域，会被拦。所以清单用 <script> 注入取，和 net.js 拉行情
 *    是同一套思路——script 标签不受 CORS 限制。
 *
 * 2) GitHub 在国内时通时不通。单一源不可靠，所以同时打多个镜像。
 *    实测过：cdn.jsdelivr.net 国内直连不通，fastly/gcore 通；
 *    ghfast.top 不通，ghproxy.net 通。不并行就一定会有人用不了。
 *
 * 3) jsDelivr 不代理 .apk（301 回 raw，国内到不了），但代理 .js。
 *    所以安装包在仓库里另存一份 `.apk.js` 副本，放在带版本号的目录里
 *    ——路径随版本变化，天然没有 CDN 缓存问题。
 * ============================================================ */
(function (YB) {
  'use strict';

  /* 改仓库名只需改这一行 */
  var REPO = 'Hongred04/yeren-tide';

  /**
   * 源按「实测国内可达性」排序。
   * cdn=true 表示这个源只代理前端资源，取安装包要走 .apk.js 副本。
   */
  var SOURCES = [
    { id: 'ghproxy', base: 'https://ghproxy.net/https://raw.githubusercontent.com/' + REPO + '/main/', cdn: false },
    { id: 'fastly', base: 'https://fastly.jsdelivr.net/gh/' + REPO + '@main/', cdn: true },
    { id: 'gcore', base: 'https://gcore.jsdelivr.net/gh/' + REPO + '@main/', cdn: true },
    { id: 'ghfast', base: 'https://ghfast.top/https://raw.githubusercontent.com/' + REPO + '/main/', cdn: false },
    { id: 'jsdelivr', base: 'https://cdn.jsdelivr.net/gh/' + REPO + '@main/', cdn: true },
    { id: 'raw', base: 'https://raw.githubusercontent.com/' + REPO + '/main/', cdn: false }
  ];

  var META_PATH = 'dist/update.js';
  var APK_PATH = 'dist/yeren-quant.apk';
  var PAGE_URL = 'https://github.com/' + REPO + '/releases/latest';

  var CACHE_KEY = 'updateMeta';
  var CACHE_TTL = 6 * 3600 * 1000;

  /* ---------------- 当前版本 ---------------- */

  /**
   * 版本以 AndroidManifest 为唯一真源，运行时从原生读。
   * 网页预览没有 Bridge，用下面这个兜底值（build 脚本会同步）。
   */
  var FALLBACK = { code: 17, name: '1.1.6' };

  function current() {
    try {
      var b = window.AndroidBridge;
      if (b && b.versionName) {
        var name = String(b.versionName() || '');
        var code = parseInt(b.versionCode(), 10);
        if (name) return { name: name, code: isNaN(code) ? 0 : code };
      }
    } catch (e) { /* 非原生环境 */ }
    return { name: FALLBACK.name, code: FALLBACK.code };
  }

  function hasNative() {
    try {
      return !!(window.AndroidBridge && window.AndroidBridge.installUpdate);
    } catch (e) { return false; }
  }

  /* ---------------- 取清单 ---------------- */

  function injectOne(url, timeout) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      var done = false;
      var t = null;

      function finish(ok, err) {
        if (done) return;
        done = true;
        if (t) clearTimeout(t);
        try { s.parentNode && s.parentNode.removeChild(s); } catch (e) {}
        if (ok) resolve(); else reject(err || new Error('load failed'));
      }

      s.async = true;
      s.src = url;
      s.onload = function () { finish(true); };
      s.onerror = function () { finish(false, new Error('network')); };
      t = setTimeout(function () { finish(false, new Error('timeout')); }, timeout || 7000);
      document.head.appendChild(s);
    });
  }

  /**
   * 多源并行，取「窗口内版本号最大」的那份。
   *
   * 为什么不取第一个返回的：jsDelivr 对分支引用有 12 小时缓存，
   * 刚发版时它可能返回上一个版本的清单。如果谁先回用谁，
   * 用户点了检查更新却被告知「已是最新」。
   *
   * 窗口 2 秒：全部源都回来就立刻收口，否则 2 秒后用手里最好的那份。
   */
  var WINDOW_MS = 2000;

  function fetchMeta() {
    return new Promise(function (resolve, reject) {
      var best = null;
      var left = SOURCES.length;
      var errs = [];
      var settled = false;
      var stamp = '?t=' + Date.now();
      var timer = setTimeout(collect, WINDOW_MS);

      function collect() {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (best) resolve(best);
        else reject(new Error(errs.join(' ') || 'all failed'));
      }

      SOURCES.forEach(function (src) {
        injectOne(src.base + META_PATH + stamp, 7000).then(function () {
          var d = window.YB_UPDATE;
          if (!d || !d.versionCode) {
            errs.push(src.id + ':empty');
          } else if (!best || d.versionCode > best.versionCode) {
            d.__from = src.id;
            best = d;
          }
          if (--left === 0) collect();
        }, function (e) {
          errs.push(src.id + ':' + (e && e.message || 'fail'));
          if (--left === 0) collect();
        });
      });
    });
  }

  function cachedMeta() {
    try {
      var rec = YB.util.store.get(CACHE_KEY, null);
      if (rec && rec.at && Date.now() - rec.at < CACHE_TTL && rec.meta) return rec;
    } catch (e) {}
    return null;
  }

  function saveMeta(meta) {
    try { YB.util.store.set(CACHE_KEY, { at: Date.now(), meta: meta }); } catch (e) {}
  }

  /* ---------------- 检查 ---------------- */

  var state = {
    checking: false,
    checkedAt: 0,
    latest: null,
    error: '',
    downloading: false,
    done: 0,
    total: 0,
    stage: '',
    installError: ''
  };

  /**
   * @param {Boolean} force 忽略本地缓存
   * @returns {Promise<Object>} { hasUpdate, current, latest }
   */
  function check(force) {
    if (state.checking) return Promise.resolve(summary());

    state.checking = true;
    state.error = '';
    state.installError = '';
    if (force) { try { YB.util.store.del(CACHE_KEY); } catch (e) {} }

    var hit = force ? null : cachedMeta();
    var p = hit ? Promise.resolve(hit.meta) : fetchMeta();

    return p.then(function (meta) {
      state.checking = false;
      state.checkedAt = Date.now();
      state.latest = meta;
      saveMeta(meta);
      return summary();
    }, function (e) {
      state.checking = false;
      state.checkedAt = Date.now();
      state.error = describeError(e);
      throw e;
    });
  }

  /** 把底层错误翻成用户能理解的一句话 */
  function describeError(e) {
    var m = String(e && e.message || '');
    if (/timeout/.test(m)) return '检查超时，GitHub 相关域名可能需要代理';
    if (/network/.test(m)) return '访问不到更新源，请检查网络';
    return '检查失败：' + m;
  }

  function summary() {
    var cur = current();
    var meta = state.latest;
    var has = !!(meta && meta.versionCode > cur.code);
    return {
      current: cur,
      latest: meta,
      hasUpdate: has,
      notes: (meta && meta.notes) || [],
      from: meta && meta.__from || '',
      checking: state.checking,
      error: state.error
    };
  }

  /* ---------------- 安装 ---------------- */

  /**
   * 安装包的所有可用地址。
   *
   * 两类源取不同路径，顺序也有讲究：
   *   CDN 源 → meta.apkCdn（仓库里的 .apk.js 副本，路径带版本号）
   *   反代源 → meta.apk（原始 .apk）
   *
   * 版本化副本排在前面：它不可能被 CDN 缓存成旧包。反代走的是 raw 文件，
   * raw 自己有一层缓存，发版后几分钟内可能还吐旧内容——虽然原生会校验
   * sha256 挡下来，但白跑一趟几十秒不值。
   */
  function apkUrls(meta) {
    var plain = (meta && meta.apk) || APK_PATH;
    var cdn = (meta && meta.apkCdn) || plain;
    var out = [];
    var seen = {};

    function push(s, p) {
      var full = s.base + p;
      if (seen[full]) return;
      seen[full] = 1;
      out.push(full);
    }

    SOURCES.forEach(function (s) { if (s.cdn) push(s, cdn); });
    SOURCES.forEach(function (s) { if (!s.cdn) push(s, plain); });

    // 最后补 Release 直链：镜像全挂时还能搏一次
    if (meta && meta.versionName) {
      out.push('https://github.com/' + REPO + '/releases/download/v' + meta.versionName +
        '/yeren-quant.apk');
    }
    return out;
  }

  /**
   * 交给原生下载并安装。
   * 原生侧逐源尝试（HttpURLConnection 没有 CORS，镜像、直链都能用），
   * 失败自动换下一个，比在 JS 里探测可靠。
   */
  function install() {
    var meta = state.latest;
    if (!meta) return { ok: false, why: 'no-meta' };

    var urls = apkUrls(meta);

    if (hasNative()) {
      state.downloading = true;
      state.done = 0;
      state.total = meta.size || 0;
      state.stage = '正在连接…';
      state.installError = '';
      try {
        window.AndroidBridge.installUpdate(
          JSON.stringify(urls), meta.versionCode, meta.sha256 || '');
        return { ok: true, mode: 'native' };
      } catch (e) {
        state.downloading = false;
        state.installError = String(e && e.message || e);
        return { ok: false, why: 'bridge' };
      }
    }

    // 网页版 / 预览：只能交给浏览器
    try { window.open(urls[0], '_blank'); } catch (e2) {}
    return { ok: true, mode: 'web', url: urls[0] };
  }

  /* 原生回调 */
  function onProgress(done, total, msg) {
    state.downloading = true;
    state.done = done || 0;
    state.total = total || state.total || 0;
    state.stage = msg || '下载中';
    if (YB.app && YB.app.refreshUpdateView) YB.app.refreshUpdateView();
  }

  function onInstalled(msg) {
    state.downloading = false;
    state.stage = msg || '已交给系统安装';
    if (YB.app && YB.app.refreshUpdateView) YB.app.refreshUpdateView();
  }

  function onInstallFail(msg) {
    state.downloading = false;
    state.installError = msg || '下载失败';
    if (YB.app && YB.app.refreshUpdateView) YB.app.refreshUpdateView();
  }

  function pageUrl() { return PAGE_URL; }

  YB.update = {
    current: current,
    check: check,
    summary: summary,
    install: install,
    apkUrls: apkUrls,
    sources: SOURCES,
    state: state,
    hasNative: hasNative,
    pageUrl: pageUrl,
    /* 原生调用的入口，下划线表示内部使用 */
    __progress: onProgress,
    __installed: onInstalled,
    __installFail: onInstallFail
  };
})(window.YB);
