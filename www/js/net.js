/* ============================================================
 * 野人量化 · 网络层
 * 核心问题：行情接口全部不返回 CORS 头，浏览器 fetch 会被拦截。
 * 解决：全部走 <script> 注入（JSONP / 变量轮询），天然不受 CORS 限制。
 * 同时负责：超时、重试、内存缓存、数据源健康度统计。
 * ============================================================ */
(function (YB) {
  'use strict';

  let seq = 0;

  /** 数据源健康度：{ name: {ok, fail, lastError, lastAt} } */
  const health = {};
  function mark(name, ok, err) {
    const h = health[name] || (health[name] = { ok: 0, fail: 0, lastError: '', lastAt: 0 });
    if (ok) h.ok++; else { h.fail++; h.lastError = String(err && err.message || err || ''); }
    h.lastAt = Date.now();
    return h;
  }

  function inject(url, opts, onReady) {
    const o = opts || {};
    const timer = { t: null };
    const script = document.createElement('script');
    let settled = false;

    function finish(ok, err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer.t);
      try { script.parentNode && script.parentNode.removeChild(script); } catch (e) {}
      if (onReady) onReady(ok, err);
    }

    if (o.charset) script.charset = o.charset;   // 腾讯/新浪返回 GBK，必须声明
    script.async = true;
    script.src = url;
    script.onload = () => finish(true);
    script.onerror = () => finish(false, new Error('script load failed'));
    timer.t = setTimeout(() => finish(false, new Error('timeout')), o.timeout || 9000);
    document.head.appendChild(script);
    return { script, finish };
  }

  /**
   * JSONP：接口支持 cb=xxx 回调包裹时使用（东财 push2 / push2ex）
   */
  function jsonp(url, opts) {
    const o = Object.assign({ cbParam: 'cb', timeout: 9000, source: 'eastmoney' }, opts || {});
    return new Promise((resolve, reject) => {
      const name = '__ybjp' + (++seq) + '_' + Math.random().toString(36).slice(2, 8);
      let called = false;
      window[name] = function (data) {
        called = true;
        delete window[name];
        mark(o.source, true);
        resolve(data);
      };
      const full = url + (url.indexOf('?') >= 0 ? '&' : '?') + o.cbParam + '=' + name;
      inject(full, o, (ok, err) => {
        if (called) return;
        try { delete window[name]; } catch (e) { window[name] = undefined; }
        if (ok) {
          // 脚本加载成功但没触发回调，视为解析失败
          mark(o.source, false, 'no callback');
          reject(new Error('no callback: ' + url));
        } else {
          mark(o.source, false, err);
          reject(err);
        }
      });
    });
  }

  /**
   * 变量轮询：接口直接赋值全局变量时使用（腾讯 qt.gtimg.cn / 新浪 hq.sinajs.cn）
   * varNames 为期望读到的全局变量名数组
   */
  function vars(url, varNames, opts) {
    const o = Object.assign({ charset: 'gbk', timeout: 9000, source: 'tencent' }, opts || {});
    return new Promise((resolve, reject) => {
      inject(url, o, (ok, err) => {
        if (!ok) { mark(o.source, false, err); reject(err); return; }
        const out = {};
        try {
          for (let i = 0; i < varNames.length; i++) {
            const v = window[varNames[i]];
            if (v !== undefined) out[varNames[i]] = v;
          }
        } catch (e) {}
        if (!Object.keys(out).length) {
          mark(o.source, false, 'no vars');
          reject(new Error('no vars: ' + url));
          return;
        }
        mark(o.source, true);
        resolve(out);
      });
    });
  }

  /** 赋值型接口（_var=xxx 参数的腾讯 K 线） */
  function pick(url, varName, opts) {
    const o = Object.assign({ timeout: 10000, source: 'tencent' }, opts || {});
    return new Promise((resolve, reject) => {
      inject(url, o, (ok, err) => {
        if (!ok) { mark(o.source, false, err); reject(err); return; }
        const v = window[varName];
        try { delete window[varName]; } catch (e) { window[varName] = undefined; }
        if (v === undefined) { mark(o.source, false, 'no var'); reject(new Error('no var ' + varName)); return; }
        mark(o.source, true);
        resolve(v);
      });
    });
  }

  /* ---------- 缓存 ---------- */
  const cache = new Map();
  function cached(key, ttl, producer) {
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && now - hit.at < ttl) return hit.p;
    const p = producer().then(
      (v) => { cache.set(key, { at: Date.now(), p: Promise.resolve(v) }); return v; },
      (e) => { cache.delete(key); throw e; }
    );
    cache.set(key, { at: now, p: p });
    return p;
  }
  function clearCache(prefix) {
    if (!prefix) { cache.clear(); return; }
    Array.from(cache.keys()).forEach((k) => { if (k.indexOf(prefix) === 0) cache.delete(k); });
  }

  /** 简单重试包装 */
  async function retry(fn, times) {
    const max = times == null ? 2 : times;
    const BACKOFF = [350, 900, 1800];
    let last;
    for (let i = 0; i <= max; i++) {
      try { return await fn(i); } catch (e) { last = e; if (i < max) await sleep(BACKOFF[Math.min(i, 2)]); }
    }
    throw last;
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  /**
   * 东财请求闸门：错峰并发。
   *
   * 早期是完全串行（GAP 380ms），5 个池子就要 1.9 秒，光排队就吃掉首屏。
   * 实测东财能承受 3 个并发（各 500ms 正常返回），真正触发限流的是
   * 「密集连发」而不是并发本身。所以改成：
   *   同时最多 3 个在飞 + 每次发起至少间隔 150ms
   * 5 个请求从 ~1.9s 降到 ~0.8s，稳定性不受影响。
   */
  const GAP = 150;
  const EM_MAX = 3;
  let lastAt = 0;
  let emRunning = 0;
  const emQueue = [];

  /* 自适应降速：连续失败说明已经在限流，这时继续并发只会更糟。
     失败 2 次后退回「单并发 + 400ms 间隔」，成功一次即恢复。 */
  let emFailStreak = 0;

  function pumpEm() {
    const maxC = emFailStreak >= 2 ? 1 : EM_MAX;
    const gap = emFailStreak >= 2 ? 400 : GAP;

    while (emRunning < maxC && emQueue.length) {
      const task = emQueue.shift();
      // 按「发起时刻」排队错峰，而不是等上一个返回
      const now = Date.now();
      const wait = Math.max(0, lastAt - now);
      lastAt = Math.max(now, lastAt) + gap;
      emRunning++;
      const fire = () => task.fn().then(
        (v) => {
          emRunning--; emFailStreak = 0;
          task.resolve(v); pumpEm();
        },
        (e) => {
          emRunning--; emFailStreak++;
          task.reject(e); pumpEm();
        }
      );
      if (wait > 0) sleep(wait).then(fire);
      else fire();
    }
  }

  function emGate(fn) {
    return new Promise((resolve, reject) => {
      emQueue.push({ fn: fn, resolve: resolve, reject: reject });
      pumpEm();
    });
  }

  /** 并发池 */
  async function pool(tasks, limit, onProgress) {
    const results = new Array(tasks.length);
    let idx = 0, done = 0;
    const n = Math.max(1, Math.min(limit || 8, tasks.length));
    async function worker() {
      while (true) {
        const i = idx++;
        if (i >= tasks.length) return;
        try { results[i] = await tasks[i](); }
        catch (e) { results[i] = { __error: e }; }
        done++;
        if (onProgress) onProgress(done, tasks.length);
      }
    }
    await Promise.all(Array.from({ length: n }, worker));
    return results;
  }

  YB.net = { jsonp, vars, pick, cached, clearCache, retry, sleep, pool, emGate, health, mark };
})(window.YB);
