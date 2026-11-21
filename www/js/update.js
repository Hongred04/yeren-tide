/* ============================================================
 * 野人量化 · 更新检查
 *
 * 三个约束决定了这里的做法：
 *
 * 1) 页面是 file://（WebView 加载 assets）。file:// 发 fetch 到 https
 *    属于跨域，会话里被拦过一次。所以清单用 <script> 注入取，
 *    和 net.js 拉行情是同一套思路——script 标签不受 CORS 限制。
 *
 * 2) GitHub 在国内时通时不通。单一源不可靠，所以同时打多个镜像，
 *    谁先返回用谁（并行的 happy-eyeballs），全部失败才算失败。
 *
 * 3) APK 不能由 WebView 落盘。下载和安装交给原生（AndroidBridge），
 *    JS 只负责挑源、展示进度。
 * ============================================================ */
(function (YB) {
  'use strict';

  /* 改仓库名只需改这一行 */
  var REPO = 'Hongred04/yeren-tide';

  /* 清单放在仓库的 dist/update.js，内容是 window.YB_UPDATE = {...}
   *
   * 源的选择顺序按「国内可达性」排：
   *   jsDelivr 走国内有节点，通常最快
   *   ghfast/ghproxy 是公益反代，偶发抽风但兜得住
   *   raw.githubusercontent 是直连，国内多数时候不通，留作最后兜底
   */
  var SOURCES = [
    { id: 'jsdelivr', base: 'https://cdn.jsdelivr.net/gh/' + REPO + '@main/' },
    { id: 'fastly', base: 'https://fastly.jsdelivr.net/gh/' + REPO + '@main/' },
    { id: 'gcore', base: 'https://gcore.jsdelivr.net/gh/' + REPO + '@main/' },
    { id: 'ghfast', base: 'https://ghfast.top/https://raw.githubusercontent.com/' + REPO + '/main/' },
    { id: 'ghproxy', base: 'https://ghproxy.net/https://raw.githubusercontent.com/' + REPO + '/main/' },
    { id: 'raw', base: 'https://raw.githubusercontent.com/' + REPO + '/main/' }
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
  var FALLBACK = { code: 15, name: '1.1.4' };

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
   * 多源并行竞速。
   *
   * 不用「逐个重试」是因为国内网络下每个源超时 7 秒，串行 6 个源最坏
   * 要 40 秒。并行的话最坏也是 7 秒，而且快的源会先赢。
   *
   * 注意：多个脚本都会写 window.YB_UPDATE，后到的会覆盖先到的。
   * 内容一样所以无害，但取值必须在 onload 当下完成。
   */
  function fetchMeta() {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var left = SOURCES.length;
      var errs = [];
      var stamp = '?t=' + Date.now();   // 破 CDN 缓存

      SOURCES.forEach(function (src) {
        injectOne(src.base + META_PATH + stamp, 7000).then(function () {
          var d = window.YB_UPDATE;
          if (!d || !d.versionCode) {
            errs.push(src.id + ':empty');
            if (--left === 0 && !settled) { settled = true; reject(new Error(errs.join(' '))); }
            return;
          }
          if (settled) return;
          settled = true;
          d.__from = src.id;
          resolve(d);
        }, function (e) {
          errs.push(src.id + ':' + (e && e.message || 'fail'));
          if (--left === 0 && !settled) { settled = true; reject(new Error(errs.join(' '))); }
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
   * @param {Boolean} force 忽略缓存
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
   * APK 的所有可用地址，按源顺序。
   * jsDelivr 把仓库里的文件当 CDN 资源发，APK 也在内（146KB 远低于 20MB 上限），
   * 这是国内能跑满速度的那一条。
   */
  function apkUrls(meta) {
    var p = (meta && meta.apk) || APK_PATH;
    var out = [];
    SOURCES.forEach(function (s) {
      out.push(s.base + p);
    });
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
   * 失败会自动换下一个，比在 JS 里探测可靠。
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
        window.AndroidBridge.installUpdate(JSON.stringify(urls));
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
    state: state,
    hasNative: hasNative,
    pageUrl: pageUrl,
    /* 原生调用入口，命名带下划线表示内部使用 */
    __progress: onProgress,
    __installed: onInstalled,
    __installFail: onInstallFail
  };
})(window.YB);
