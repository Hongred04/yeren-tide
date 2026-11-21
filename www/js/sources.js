/* ============================================================
 * 野人量化 · 数据源适配层
 *
 * 分层策略（针对东财限流的应对）：
 *   行情/K线  → 腾讯 qt.gtimg.cn（主力，无限流）→ 新浪 hq.sinajs.cn（备用）
 *   涨停池类  → 东财 push2ex（无替代品，但接口轻、带缓存）
 *   全市场榜单→ 东财 clist（仅波段初筛用，可用腾讯行情补齐）
 *
 * 每个函数都会记录实际命中的源，UI 里能看到当前数据来自哪。
 * ============================================================ */
(function (YB) {
  'use strict';

  const U = YB.util, N = YB.net;
  const EM_UT = '7eea3edcaed734bea9cbfc24409ed989';

  /** 沪深京全市场 fs 过滤串 */
  const FS_ALL = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';

  /* ---------------- 代码工具 ---------------- */
  /** 6位代码 → 带市场前缀（腾讯格式 sh/sz/bj）；已带前缀则原样返回 */
  function txCode(code) {
    const s = String(code).toLowerCase().trim();
    if (/^(sh|sz|bj)\d{6}$/.test(s)) return s;
    const c = String(code).replace(/\D/g, '').slice(-6);
    if (/^(6|5|9|11|13)/.test(c) && !/^920/.test(c)) {
      if (/^(60|68|51|58|56|50|11|13|9)/.test(c)) return 'sh' + c;
    }
    if (/^(920|8|4)/.test(c)) return 'bj' + c;
    if (/^(60|68|51|58|56|50)/.test(c)) return 'sh' + c;
    if (/^(00|30|12|15|16|18)/.test(c)) return 'sz' + c;
    if (/^9/.test(c)) return 'sh' + c;
    return 'sz' + c;
  }

  /** 6位代码（可带 sh/sz/bj 前缀） → 东财 secid (市场.代码) */
  function emSecid(code) {
    const s = String(code).toLowerCase().trim();
    if (/^(sh|sz|bj)\d{6}$/.test(s)) {
      return (s.slice(0, 2) === 'sh' ? '1.' : '0.') + s.slice(2);
    }
    const c = String(code).replace(/\D/g, '').slice(-6);
    if (/^(60|68|51|58|56|50|11|9)/.test(c) && !/^920/.test(c)) return '1.' + c;
    return '0.' + c;
  }

  function plainCode(c) { return String(c).replace(/\D/g, '').slice(-6); }

  /* ---------------- 行情解析 ---------------- */
  /**
   * 腾讯行情字段（按 ~ 分割，已用 sh600000 / sh000001 双向实测核对）：
   * 3现价 4昨收 5今开 6成交量(手) 30时间
   * 31涨跌 32涨跌幅 33最高 34最低 36成交量(手) 37成交额(万)
   * 38换手率 39市盈率(动) 43振幅 44流通市值(亿) 45总市值(亿)
   * 46市净率 47涨停价 48跌停价 49量比 51均价
   * 注意：曾经误把 31 当涨跌幅，个股只差 0.x 但指数会拿到「跌的点数」，
   *      3565 点显示成 -22.28%，必须用 32。
   */
  function parseTencent(txt, code) {
    if (!txt) return null;
    const f = String(txt).split('~');
    if (f.length < 50) return null;
    const price = U.num(f[3]);
    const prev = U.num(f[4]);
    if (price <= 0 && prev <= 0) return null;
    const pct = f[32] !== '' && f[32] !== undefined
      ? U.num(f[32])
      : (prev > 0 ? (price - prev) / prev * 100 : 0);
    return {
      code: plainCode(code || f[2]),
      name: f[1] || '',
      price: price,
      prev: prev,
      open: U.num(f[5]),
      high: U.num(f[33]),
      low: U.num(f[34]),
      pct: pct,
      vol: U.num(f[6]),                 // 手
      amount: U.num(f[37]) * 1e4,       // 元
      turnover: U.num(f[38]),           // 换手率 %
      pe: U.num(f[39]),
      amplitude: U.num(f[43]),
      floatCap: U.num(f[44]) * 1e8,     // 元
      totalCap: U.num(f[45]) * 1e8,     // 元
      pb: U.num(f[46]),
      limitUp: U.num(f[47]),
      limitDown: U.num(f[48]),
      volRatio: U.num(f[49]),
      avgPrice: U.num(f[51]),
      source: 'tencent'
    };
  }

  /** 新浪字段：0名称 1今开 2昨收 3现价 4最高 5最低 8成交量(股) 9成交额(元) 30日期 31时间 */
  function parseSina(txt, code, fallback) {
    if (!txt) return null;
    const f = String(txt).split(',');
    if (f.length < 10) return null;
    const price = U.num(f[3]);
    const prev = U.num(f[2]);
    if (price <= 0) return null;
    const base = fallback || {};
    return {
      code: plainCode(code),
      name: f[0] || base.name || '',
      price: price,
      prev: prev,
      open: U.num(f[1]),
      high: U.num(f[4]),
      low: U.num(f[5]),
      pct: prev > 0 ? (price - prev) / prev * 100 : 0,
      vol: U.num(f[8]) / 100,
      amount: U.num(f[9]),
      turnover: base.turnover || 0,
      floatCap: base.floatCap || 0,
      totalCap: base.totalCap || 0,
      volRatio: base.volRatio || 0,
      limitUp: base.limitUp || 0,
      limitDown: base.limitDown || 0,
      source: 'sina',
      time: (f[30] || '') + ' ' + (f[31] || '')
    };
  }

  /* ---------------- 行情入口（多源容灾） ---------------- */
  function batch(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  async function quotesTencent(codes) {
    const groups = batch(codes, 50);
    const result = {};
    await N.pool(groups.map((g) => async () => {
      const tx = g.map(txCode);
      const names = tx.map((c) => 'v_' + c);
      const url = 'https://qt.gtimg.cn/q=' + tx.join(',') + '&_=' + Date.now();
      const got = await N.retry(() => N.vars(url, names, { charset: 'gbk', source: 'tencent' }), 1);
      tx.forEach((c, i) => {
        const q = parseTencent(got['v_' + c], c.slice(2));
        if (q) result[q.code] = q;
      });
    }), 4);
    return result;
  }

  async function quotesSina(codes, fallbackMap) {
    const groups = batch(codes, 60);
    const result = {};
    await N.pool(groups.map((g) => async () => {
      const tx = g.map(txCode);
      const names = tx.map((c) => 'hq_str_' + c);
      const url = 'https://hq.sinajs.cn/list=' + tx.join(',') + '&_=' + Date.now();
      // 新浪需要 Referer 才返回数据；script 标签无法自定义头，因此在纯前端下成功率有限
      const got = await N.retry(() => N.vars(url, names, { charset: 'gbk', source: 'sina' }), 1);
      tx.forEach((c, i) => {
        const q = parseSina(got['hq_str_' + c], c.slice(2), (fallbackMap || {})[c.slice(2)]);
        if (q) result[q.code] = q;
      });
    }), 3);
    return result;
  }

  /**
   * 批量行情：腾讯优先，失败则新浪兜底（新浪缺换手/市值，用东财榜单缓存补齐）
   */
  async function quotes(codes) {
    const list = (codes || []).map(plainCode).filter(Boolean);
    if (!list.length) return {};
    const pref = U.store.get('sourcePref', 'auto');
    let out = {};
    if (pref !== 'sina') {
      try { out = await quotesTencent(list); } catch (e) { out = {}; }
    }
    const missing = list.filter((c) => !out[c]);
    if (missing.length && pref !== 'tencent') {
      try {
        const alt = await quotesSina(missing);
        Object.assign(out, alt);
      } catch (e) {}
    }
    return out;
  }

  /* ---------------- 指数 ---------------- */
  const INDEXES = [
    { code: '000001', tx: 'sh000001', name: '上证指数' },
    { code: '399001', tx: 'sz399001', name: '深证成指' },
    { code: '399006', tx: 'sz399006', name: '创业板指' }
  ];

  async function indexQuotes() {
    return N.cached('idx', 8000, async () => {
      const names = INDEXES.map((i) => 'v_' + i.tx);
      const url = 'https://qt.gtimg.cn/q=' + INDEXES.map((i) => i.tx).join(',') + '&_=' + Date.now();
      const got = await N.retry(() => N.vars(url, names, { charset: 'gbk', source: 'tencent' }), 1);
      return INDEXES.map((i) => {
        const q = parseTencent(got['v_' + i.tx], i.code);
        return {
          code: i.code,
          name: i.name,
          price: q ? q.price : 0,
          pct: q ? q.pct : 0,
          amount: q ? q.amount : 0,   // 上证/深证为对应市场成交额
          vol: q ? q.vol : 0
        };
      });
    });
  }

  /* ---------------- K 线（三级容灾） ----------------
   * 实测 web.ifzq.gtimg.cn 频繁请求后会返回反爬 HTML（script.onerror），
   * 而 proxy.finance.qq.com 走的是同一套 fqkline 接口但没被拦，所以放第一顺位；
   * 东财 push2his 支持 cb 回调，作为最后兜底。
   */
  const KLINE_QQ_HOSTS = [
    'https://proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get',
    'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get'
  ];

  /** 腾讯 K 线：unit = day / week / month */
  async function klineQQ(c, count, host, unit) {
    const varName = '_ybk' + Math.random().toString(36).slice(2, 9);
    const url = host + '?_var=' + varName + '&param=' + c + ',' + (unit || 'day') +
      ',,,' + count + ',qfq&_=' + Date.now();
    const raw = await N.pick(url, varName, { source: 'tencent', timeout: 9000 });
    return extractKline(raw, c, unit || 'day');
  }

  /** 东财 K 线 klt：101 日 / 102 周 / 103 月；klines 每行 "日期,开,收,高,低,量(手),额" */
  const EM_KLT = { day: 101, week: 102, month: 103 };

  async function klineEM(c, count, unit) {
    const url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + emSecid(c) +
      '&fields1=f1,f2,f3,f4,f5&fields2=f51,f52,f53,f54,f55,f56,f57' +
      '&klt=' + (EM_KLT[unit] || 101) + '&fqt=1&end=20500101&lmt=' + count + '&_=' + Date.now();
    const raw = await N.emGate(() => N.retry(() => N.jsonp(url, { source: 'eastmoney' }), 1));
    const kl = raw && raw.data && raw.data.klines;
    if (!Array.isArray(kl)) return [];
    return kl.map((line) => {
      const p = String(line).split(',');
      return {
        date: p[0],
        open: U.num(p[1]),
        close: U.num(p[2]),
        high: U.num(p[3]),
        low: U.num(p[4]),
        vol: U.num(p[5])
      };
    }).filter((b) => b.close > 0);
  }

  const KLINE_COUNT = { day: 320, week: 160, month: 84 };

  /**
   * K 线（前复权）。unit = day / week / month
   * 依次尝试：腾讯 proxy → 腾讯 ifzq → 东财 push2his
   *
   * 磁盘缓存（stale-while-revalidate）：
   * 日线绝大部分是历史数据、不会变，每次开 App 重拉一次要 1.5 秒，
   * 而这 1.5 秒正好卡在首屏量能计算上。所以日/周/月线都落本地，
   * 有缓存就立即返回、同时后台静默刷新，下次打开即是新的。
   */
  async function kline(code, unit, count) {
    const c = txCode(code);
    const u = unit === 'week' || unit === 'month' ? unit : 'day';
    const n = count || KLINE_COUNT[u];

    const fresh = () => N.cached('k' + u + '_' + c + '_' + n, 60000, async () => {
      for (let i = 0; i < KLINE_QQ_HOSTS.length; i++) {
        try {
          const bars = await klineQQ(c, n, KLINE_QQ_HOSTS[i], u);
          if (bars && bars.length) return bars;
        } catch (e) { /* 换下一个源 */ }
      }
      const bars = await klineEM(c, n, u);
      if (bars && bars.length) return bars;
      throw new Error('K线获取失败: ' + c);
    });

    const persisted = readKlineDisk(c, u);
    if (persisted) {
      fresh().then((bars) => { if (bars && bars.length) writeKlineDisk(c, u, bars); })
        .catch(() => {});
      return persisted;
    }

    const bars = await fresh();
    if (bars && bars.length) writeKlineDisk(c, u, bars);
    return bars;
  }

  /* 磁盘缓存：只用最后 90 根（趋势与均线足够），控制体积 */
  const KLINE_DISK_KEEP = 90;

  function readKlineDisk(c, u) {
    try {
      const rec = U.store.get('kline.' + u + '.' + c, null);
      if (!rec || !Array.isArray(rec.bars) || rec.bars.length < 6) return null;
      // 超过 3 天的缓存不再作为「立即返回」使用，避免长期停用后拿到过时数据
      if (Date.now() - (rec.at || 0) > 3 * 86400000) return null;
      return rec.bars;
    } catch (e) {
      return null;
    }
  }

  function writeKlineDisk(c, u, bars) {
    try {
      const tail = bars.length > KLINE_DISK_KEEP ? bars.slice(-KLINE_DISK_KEEP) : bars;
      U.store.set('kline.' + u + '.' + c, { at: Date.now(), bars: tail });
    } catch (e) { /* 配额满了就算了，不影响功能 */ }
  }

  /** 日K 快捷方式（波段扫描在用） */
  function dayKline(code, count) {
    return kline(code, 'day', count);
  }

  function extractKline(raw, c, unit) {
    const u = unit || 'day';
    try {
      const node = raw && raw.data && raw.data[c];
      if (!node) return [];
      // 优先取 qfq 前缀的同周期字段，其次取裸字段，最后按后缀兜底
      let arr = node['qfq' + u] || node[u] || null;
      if (!Array.isArray(arr)) {
        const k = Object.keys(node).filter((x) => x.slice(-u.length) === u)[0];
        if (k) arr = node[k];
      }
      if (!Array.isArray(arr)) return [];
      return arr.map((r) => ({
        date: r[0],
        open: U.num(r[1]),
        close: U.num(r[2]),
        high: U.num(r[3]),
        low: U.num(r[4]),
        vol: U.num(r[5])   // 手
      })).filter((b) => b.close > 0);
    } catch (e) {
      return [];
    }
  }

  /* ---------------- 分时 ---------------- */

  /**
   * 当日分时。腾讯返回：
   *   data[code].data.data = ["0930 28.65 69051 197831115.00", ...]
   * 即「时间 价格 累计成交量(手) 累计成交额(元)」，最后一条通常是收盘快照。
   * 这里转成逐分钟增量，均价用 累计额 ÷ 累计量 计算（与软件口径一致）。
   */
  async function minuteData(code) {
    const c = txCode(code);
    return N.cached('min_' + c, 20000, async () => {
      const varName = '_ybm' + Math.random().toString(36).slice(2, 9);
      const url = 'https://proxy.finance.qq.com/ifzqgtimg/appstock/app/minute/query?_var=' +
        varName + '&code=' + c + '&_=' + Date.now();
      const raw = await N.pick(url, varName, { source: 'tencent', timeout: 9000 });

      const node = raw && raw.data && raw.data[c];
      const arr = (node && node.data && node.data.data) || [];
      if (!Array.isArray(arr) || arr.length < 2) return null;

      const out = [];
      let lastVol = 0;
      let lastAmt = 0;

      for (let i = 0; i < arr.length; i++) {
        const p = String(arr[i]).split(/\s+/);
        if (p.length < 3) continue;
        const tm = p[0];
        if (!/^\d{4}$/.test(tm)) continue;
        const hh = +tm.slice(0, 2), mm = +tm.slice(2, 4);
        const price = +p[1];
        const cumVol = +p[2];
        const cumAmt = p[3] ? +p[3] : 0;
        if (!(price > 0)) continue;

        const vol = Math.max(0, cumVol - lastVol);
        const amt = Math.max(0, cumAmt - lastAmt);
        lastVol = cumVol;
        lastAmt = cumAmt;

        out.push({
          t: hh * 60 + mm,          // 分钟序号，9:30 = 570
          time: tm,
          price: price,
          vol: vol,                 // 当分钟成交量（手）
          cumVol: cumVol,
          amt: amt,
          cumAmt: cumAmt,
          // 均价：累计成交额 / 累计成交股数（手 × 100）
          avg: cumVol > 0 && cumAmt > 0 ? cumAmt / (cumVol * 100) : price
        });
      }

      return out.length ? out : null;
    });
  }

  /* ---------------- 东财涨停池系列 ---------------- */
  function emDate(d) { return d || U.todayStr(); }

  /**
   * 涨停池通用取数。ttl 分级：
   *  - 今日池随时在变（陆续封板）→ 60s
   *  - 昨日池是静态名单 → 10min（只用来取代码，涨跌幅另外实时拉）
   */
  async function poolApi(name, sort, date, ttl) {
    const d = emDate(date);
    const isHistory = d !== U.todayStr();

    // 历史池子是静态名单，收盘后永不再变：落本地，隔天打开直接秒读，
    // 省掉一次东财请求（昨日池是首屏必经的一环）。
    if (isHistory) {
      const saved = U.store.get('pool.' + name + '.' + d, null);
      if (saved && Array.isArray(saved) && saved.length) return saved;
      const pool = await poolApiRemote(name, sort, d, ttl);
      if (pool.length) {
        U.store.set('pool.' + name + '.' + d, pool);
        prunePoolDisk();
      }
      return pool;
    }
    return poolApiRemote(name, sort, d, ttl);
  }

  /** 只保留最近 6 个交易日的本地池子，避免占满配额 */
  function prunePoolDisk() {
    try {
      const today = U.todayStr();
      const keep = [];
      for (let i = 1; i <= 6; i++) keep.push(U.prevTradingDay(i));
      const keys = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.indexOf('yb.pool.') === 0) keys.push(k);
      }
      keys.forEach((k) => {
        const m = k.match(/\.(\d{8})$/);
        if (m && m[1] !== today && keep.indexOf(m[1]) < 0) {
          try { window.localStorage.removeItem(k); } catch (e) {}
        }
      });
    } catch (e) { /* 忽略 */ }
  }

  function poolApiRemote(name, sort, d, ttl) {
    return N.cached(name + '_' + d, ttl || 60000, async () => {
      const raw = await N.emGate(() => N.retry(() => N.jsonp(
        'https://push2ex.eastmoney.com/' + name +
        '?ut=' + EM_UT + '&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=' + sort +
        '&date=' + d + '&_=' + Date.now(),
        { source: 'eastmoney' }
      ), 2));
      return (raw && raw.data && raw.data.pool) || [];
    });
  }

  /** 涨停池：c代码 m市场 n名称 p价格*1000 zdp涨幅 amount成交额 ltsz流通市值
   *  hs换手 lbc连板 fbt首次封板 lbt最后封板 fund封单额 zbc炸板次数 hybk行业 */
  /** 昨日涨停池：名单是静态的，缓存 10 分钟（涨跌幅另走腾讯实时行情） */
  async function limitUpPool(date) {
    const d = emDate(date);
    const isHistory = d !== U.todayStr();
    const pool = await poolApi('getTopicZTPool', 'fbt:asc', date, isHistory ? 600000 : 60000);
    return pool.map((x) => ({
      code: plainCode(x.c),
      name: x.n,
      price: U.num(x.p) / 1000,
      pct: U.num(x.zdp),
      amount: U.num(x.amount),
      floatCap: U.num(x.ltsz),
      turnover: U.num(x.hs),
      boards: U.num(x.lbc),        // 连板数
      firstSeal: U.num(x.fbt),     // HHMMSS
      lastSeal: U.num(x.lbt),
      sealAmount: U.num(x.fund),   // 封单额（元）
      breakTimes: U.num(x.zbc),    // 炸板次数
      industry: x.hybk || '其他',
      stat: x.zttj || null,        // {days, ct}
      market: U.num(x.m)
    }));
  }

  /** 跌停池 */
  async function limitDownPool(date) {
    const pool = await poolApi('getTopicDTPool', 'fund:asc', date);
    return pool.map((x) => ({
      code: plainCode(x.c),
      name: x.n,
      price: U.num(x.p) / 1000,
      pct: U.num(x.zdp),
      amount: U.num(x.amount),
      floatCap: U.num(x.ltsz),
      turnover: U.num(x.hs),
      boards: U.num(x.lbc),
      industry: x.hybk || '其他'
    }));
  }

  /** 炸板池 */
  async function brokenPool(date) {
    const pool = await poolApi('getTopicZBPool', 'fbt:asc', date);
    return pool.map((x) => ({
      code: plainCode(x.c),
      name: x.n,
      price: U.num(x.p) / 1000,
      pct: U.num(x.zdp),
      amount: U.num(x.amount),
      floatCap: U.num(x.ltsz),
      turnover: U.num(x.hs),
      boards: U.num(x.lbc),
      industry: x.hybk || '其他'
    }));
  }

  /** 涨跌分布：fenbu 的 key 是涨跌幅整数档，'-11'/'-10' 为跌停区，'11'/'10' 为涨停区 */
  async function zdfenbu() {
    return N.cached('zdfb', 60000, async () => {
      const raw = await N.emGate(() => N.retry(() => N.jsonp(
        'https://push2ex.eastmoney.com/getTopicZDFenBu?ut=' + EM_UT +
        '&dpt=wz.ztzt&_=' + Date.now(),
        { source: 'eastmoney' }
      ), 2));
      const arr = (raw && raw.data && raw.data.fenbu) || [];
      let up = 0, down = 0, flat = 0, limitUp = 0, limitDown = 0;
      arr.forEach((o) => {
        Object.keys(o).forEach((k) => {
          const bucket = parseInt(k, 10);
          const cnt = U.num(o[k]);
          if (!isFinite(bucket)) return;
          if (bucket === 0) flat += cnt;
          else if (bucket > 0) { up += cnt; if (bucket >= 10) limitUp += cnt; }
          else { down += cnt; if (bucket <= -10) limitDown += cnt; }
        });
      });
      return { up, down, flat, limitUp, limitDown, total: up + down + flat };
    });
  }

  /* ---------------- 东财全市场榜单（波段初筛 / 备用行情） ---------------- */
  /**
   * fid 排序字段：f3涨幅 f6成交额 f8换手 f10量比
   * 返回字段：f2价 f3涨幅 f6成交额 f8换手 f10量比 f12代码 f14名称 f20总市值 f21流通市值 f24 60日涨幅
   */
  async function emRank(opts) {
    const o = Object.assign({ fid: 'f6', pn: 1, pz: 100, po: 1 }, opts || {});
    const fields = o.fields || 'f2,f3,f6,f8,f10,f12,f14,f20,f21,f24';
    const url = 'https://push2.eastmoney.com/api/qt/clist/get?pn=' + o.pn + '&pz=' + o.pz +
      '&po=' + o.po + '&np=1&fltt=2&invt=2&fid=' + o.fid +
      '&fs=' + (o.fs || FS_ALL) +
      '&fields=' + fields + '&_=' + Date.now();
    // noGate：次要接口（如涨幅榜）不能占用主池的串行队列，
    // 否则被限流时会把涨停池、涨跌分布一起拖死。
    const run = () => N.retry(() => N.jsonp(url, { source: 'eastmoney' }), o.noGate ? 0 : 2);
    const raw = o.noGate ? await run() : await N.emGate(run);
    const diff = (raw && raw.data && raw.data.diff) || [];
    const list = (Array.isArray(diff) ? diff : Object.keys(diff).map((k) => diff[k]));
    return list.map((x) => ({
      code: plainCode(x.f12),
      name: x.f14,
      price: U.safeNum(x.f2),
      pct: U.safeNum(x.f3),
      amount: U.safeNum(x.f6),
      turnover: U.safeNum(x.f8),
      volRatio: U.safeNum(x.f10),
      totalCap: U.safeNum(x.f20),
      floatCap: U.safeNum(x.f21),
      pct60: U.safeNum(x.f24, NaN),
      industry: (x.f100 && x.f100 !== '-') ? x.f100 : ''
    }));
  }

  /**
   * 当日强势股榜（按涨幅降序）。
   * 用途：龙头不一定涨停——九阳股份这类行业龙头可能只涨 6%，
   * 但它成交额、换手远高于连板杂毛，仍是资金焦点。
   */
  let hotFailAt = 0;
  const HOT_COOLDOWN = 30 * 60 * 1000;   // 失败后 30 分钟内不再试
  const HOT_DISK_TTL = 15 * 60 * 1000;   // 本地强势股榜有效 15 分钟

  /** 同步读本地缓存的强势股榜：首屏龙头识别靠它，不等网络 */
  function hotPoolStale() {
    try {
      const rec = U.store.get('hot.disk', null);
      if (!rec || !Array.isArray(rec.list) || !rec.list.length) return null;
      if (Date.now() - (rec.at || 0) > HOT_DISK_TTL) return null;
      return rec.list;
    } catch (e) {
      return null;
    }
  }

  async function hotPool(limit) {
    const n = limit || 100;
    if (Date.now() - hotFailAt < HOT_COOLDOWN) return hotPoolStale() || [];

    return N.cached('hot_' + n, 60000, async () => {
      try {
        const list = await emRank({
          fid: 'f3', pn: 1, pz: n, po: 1, noGate: true,
          fields: 'f2,f3,f6,f8,f10,f12,f14,f20,f21,f100'
        });
        if (list && list.length) {
          try { U.store.set('hot.disk', { at: Date.now(), list: list }); } catch (e) {}
          return list;
        }
        hotFailAt = Date.now();
        return hotPoolStale() || [];
      } catch (e) {
        hotFailAt = Date.now();
        return hotPoolStale() || [];
      }
    });
  }

  YB.src = {
    INDEXES, FS_ALL, EM_UT,
    txCode, emSecid, plainCode,
    parseTencent, parseSina,
    quotes, quotesTencent, quotesSina,
    indexQuotes, kline, dayKline,
    limitUpPool, limitDownPool, brokenPool, zdfenbu, hotPool, hotPoolStale, minuteData,
    emRank
  };
})(window.YB);
