/* ============================================================
 * 野人量化 · 基础工具层
 * ============================================================ */
window.YB = window.YB || {};

(function (YB) {
  'use strict';

  /* ---------- DOM ---------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  /* ---------- 数值 ---------- */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const clamp01 = (v) => clamp(v, 0, 1);
  /** 把 v 从 [a,b] 线性映射到 [0,1] 并裁剪 */
  const norm = (v, a, b) => clamp01((v - a) / (b - a));
  const num = (v, d) => {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : (d === undefined ? 0 : d);
  };
  /** 取字符串里第一个数字，东财有时返回 "-" */
  const safeNum = (v, d) => {
    if (v === '-' || v === '' || v == null) return d === undefined ? 0 : d;
    return num(v, d);
  };

  function fmtPct(v, digits) {
    const d = digits === undefined ? 2 : digits;
    if (!isFinite(v)) return '--';
    return (v > 0 ? '+' : '') + v.toFixed(d) + '%';
  }

  function fmtPrice(v) {
    if (!isFinite(v) || v <= 0) return '--';
    return v >= 100 ? v.toFixed(2) : v.toFixed(2);
  }

  /** 金额：输入单位为「元」 */
  function fmtAmount(yuan) {
    if (!isFinite(yuan) || yuan <= 0) return '--';
    const yi = yuan / 1e8;
    if (yi >= 10000) return (yi / 10000).toFixed(2) + '万亿';
    if (yi >= 1) return yi.toFixed(yi >= 100 ? 0 : 2) + '亿';
    const wan = yuan / 1e4;
    return wan.toFixed(0) + '万';
  }

  /** 成交量：输入单位为「手」 */
  function fmtVol(shou) {
    if (!isFinite(shou) || shou <= 0) return '--';
    if (shou >= 1e8) return (shou / 1e8).toFixed(2) + '亿手';
    if (shou >= 1e4) return (shou / 1e4).toFixed(shou >= 1e6 ? 0 : 1) + '万手';
    return shou.toFixed(0) + '手';
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function todayStr(d) {
    const t = d || new Date();
    const p = (n) => String(n).padStart(2, '0');
    return t.getFullYear() + p(t.getMonth() + 1) + p(t.getDate());
  }

  function dateStr(d) {
    const t = d || new Date();
    const p = (n) => String(n).padStart(2, '0');
    return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
  }

  /* ---------- 存储（localStorage 不可用时降级内存） ---------- */
  const memStore = {};
  const store = {
    get(key, def) {
      try {
        const raw = window.localStorage.getItem('yb.' + key);
        if (raw == null) return def;
        return JSON.parse(raw);
      } catch (e) {
        return key in memStore ? memStore[key] : def;
      }
    },
    set(key, val) {
      memStore[key] = val;
      try {
        window.localStorage.setItem('yb.' + key, JSON.stringify(val));
        return true;
      } catch (e) {
        return false;
      }
    },
    del(key) {
      delete memStore[key];
      try { window.localStorage.removeItem('yb.' + key); } catch (e) {}
    }
  };

  /* ---------- 主题 ---------- */
  const Theme = {
    KEY: 'theme',
    current: 'dark',
    init() {
      const saved = store.get(this.KEY, 'auto');
      this.apply(saved);
      try {
        const mq = window.matchMedia('(prefers-color-scheme: light)');
        const onChange = () => {
          if (store.get(this.KEY, 'auto') === 'auto') this.apply('auto');
        };
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else if (mq.addListener) mq.addListener(onChange);
      } catch (e) {}
    },
    resolved(pref) {
      const p = pref || store.get(this.KEY, 'auto');
      if (p === 'light' || p === 'dark') return p;
      try {
        return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      } catch (e) {
        return 'dark';
      }
    },
    apply(pref) {
      const r = this.resolved(pref);
      this.current = r;
      document.documentElement.setAttribute('data-theme', r);
      const bg = r === 'light' ? '#f4f6f8' : '#0b0d10';
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', bg);
      // 同步 Android 原生状态栏（APK 外壳注入的桥；浏览器里不存在，忽略即可）
      try {
        if (window.AndroidBridge && window.AndroidBridge.setTheme) {
          window.AndroidBridge.setTheme(bg);
        }
      } catch (e) {}
      document.dispatchEvent(new CustomEvent('yb:theme', { detail: r }));
    },
    set(pref) {
      store.set(this.KEY, pref);
      this.apply(pref);
    },
    get() { return store.get(this.KEY, 'auto'); }
  };

  /* ---------- 市场时段 ---------- */
  function marketState(now) {
    const d = now || new Date();
    const day = d.getDay();
    if (day === 0 || day === 6) return 'closed';
    const m = d.getHours() * 60 + d.getMinutes();
    if (m < 9 * 60 + 15) return 'pre';
    if (m < 9 * 60 + 30) return 'auction';
    if (m < 11 * 60 + 30) return 'open';
    if (m < 13 * 60) return 'lunch';
    if (m < 15 * 60) return 'open';
    return 'closed';
  }

  /** 是否处于盘中（决定自动刷新） */
  function isTrading() {
    const s = marketState();
    return s === 'open' || s === 'auction';
  }

  /* ---------- 其他 ---------- */
  function debounce(fn, ms) {
    let t;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(self, args), ms);
    };
  }

  /** 上一交易日（简单回退，不处理长假，仅用于东财池接口的日期参数） */
  function prevTradingDay(offset) {
    const d = new Date();
    let n = offset === undefined ? 1 : offset;
    while (n > 0) {
      d.setDate(d.getDate() - 1);
      if (d.getDay() !== 0 && d.getDay() !== 6) n--;
    }
    return todayStr(d);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  /** 涨跌配色 class */
  function pctClass(v) {
    if (!isFinite(v) || Math.abs(v) < 0.005) return 'flat';
    return v > 0 ? 'up' : 'down';
  }

  YB.util = {
    $, $$, el,
    clamp, clamp01, norm, num, safeNum,
    fmtPct, fmtPrice, fmtAmount, fmtVol, fmtTime,
    todayStr, dateStr, prevTradingDay,
    store, Theme,
    marketState, isTrading,
    debounce, escapeHtml, pctClass
  };
})(window.YB);
