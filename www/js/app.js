/* ============================================================
 * 野人量化 · 应用主控
 * 负责：视图切换、数据编排、事件分发、自动刷新
 * ============================================================ */
(function (YB) {
  'use strict';

  const U = YB.util, S = YB.src, E = YB.engine, UI = YB.ui;
  const { $, $$ } = U;

  const TABS = [
    { k: 'market', n: '市场', icon: UI.ICON.market },
    { k: 'picks', n: '选股', icon: UI.ICON.picks },
    { k: 'portfolio', n: '持仓', icon: UI.ICON.portfolio },
    { k: 'risk', n: '风控', icon: UI.ICON.risk },
    { k: 'settings', n: '设置', icon: UI.ICON.settings }
  ];

  /** 设置二级页标题 */
  const NAV_TITLES = {
    datasource: '行情与数据源',
    advanced: '高级',
    update: '软件更新',
    about: '关于'
  };

  const st = {
    tab: 'market',
    pickTab: 'short',
    market: null,
    short: null,
    ztPool: null,          // 原始涨停池（重算评分时用）
    hotList: null,         // 当日强势股（板块页补全未涨停成员）
    swing: null,
    swingScanning: false,
    swingProgress: 0,
    loading: false,
    lastMarketLoad: 0,
    // 设置二级页面栈：[{ name }]
    stack: [],
    // 涨停梯队展开的档位（null = 未展开）
    ladderPick: null,
    // K 线页状态
    kline: null,
    klineDetach: null,
    // 持仓快照
    pf: null,
    pfQuotes: null,
    pfLoading: false
  };

  /* ---------------------------------------------------------
   * 盘中成交量进度曲线
   * A 股日内成交量分布呈 U 型，用锚点插值估算「此刻应完成
   * 全天成交量的百分之几」，用于把盘中成交量还原成全天口径，
   * 否则早上 9:50 的「量能环比」会严重偏低。
   * ------------------------------------------------------- */
  const VOL_CURVE = [
    [9 * 60 + 30, 0], [10 * 60, 18], [10 * 60 + 30, 30], [11 * 60, 40],
    [11 * 60 + 30, 48], [13 * 60, 48], [13 * 60 + 30, 57],
    [14 * 60, 67], [14 * 60 + 30, 80], [15 * 60, 100]
  ];

  /* 首屏耗时埋点（供诊断页读取，正常使用无副作用） */
  const PERF = { t0: Date.now(), marks: {} };
  window.__ybPerf = PERF;
  function perfMark(k) {
    try { PERF.marks[k] = Date.now() - PERF.t0; } catch (e) {}
  }

  function intradayFraction(now) {
    const d = now || new Date();
    const m = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    if (m <= VOL_CURVE[0][0]) return 0.02;
    if (m >= 15 * 60) return 1;
    // 午休归到 11:30
    const mm = (m > 11 * 60 + 30 && m < 13 * 60) ? 11 * 60 + 30 : m;
    for (let i = 0; i < VOL_CURVE.length - 1; i++) {
      const a = VOL_CURVE[i], b = VOL_CURVE[i + 1];
      if (mm >= a[0] && mm <= b[0]) {
        const t = (mm - a[0]) / (b[0] - a[0]);
        return Math.max(0.02, (a[1] + (b[1] - a[1]) * t) / 100);
      }
    }
    return 1;
  }

  /* ---------------------------------------------------------
   * 市场数据编排
   * ------------------------------------------------------- */
  /* ---------------------------------------------------------
   * 首屏加载
   *
   * 早期是所有请求串成一条链（池子 → 昨日报价 → 量能K线 → 强势股榜），
   * 冷启动要 4 秒以上。实测各环节耗时：
   *   腾讯指数 0.5s / 东财四池 0.6s / 昨日报价 0.5s / 量能K线 1.5s / 强势股榜 2.5s
   * 全部串行相加就是 4.5s。现在拆成三层：
   *   ① 核心盘面：全部并行发，彼此不依赖 → ~0.7s 出首屏
   *   ② 量能趋势：日线走本地磁盘缓存，通常毫秒级，已并入①
   *   ③ 强势股榜：只影响龙头，用上次缓存兜底，后台刷新后补一次渲染
   * ------------------------------------------------------- */
  async function loadMarket(force) {
    if (st.loading) return;
    if (!force && st.market && Date.now() - st.lastMarketLoad < 15000) return;
    st.loading = true;
    setRefreshSpin(true);

    try {
      const prevDay = U.prevTradingDay(1);

      // 昨日涨停池（历史名单，本地命中）→ 再拉今日报价。
      // 这条链与今日四池完全并行，不再串在它们后面。
      const prevInfoP = S.limitUpPool(prevDay)
        .then(function (prev) {
          if (!prev || !prev.length) return { prev: [], quotes: {} };
          return S.quotes(prev.map(function (x) { return x.code; }))
            .then(function (q) { return { prev: prev, quotes: q }; })
            .catch(function () { return { prev: prev, quotes: {} }; });
        })
        .catch(function () { return { prev: [], quotes: {} }; });

      // 量能趋势（日线有磁盘缓存，通常毫秒级）
      const volP = computeMarketVolume().catch(function () { return null; });

      const [indexes, ztPool, dtPool, zbPool, breadth, prevInfo, volStat] =
        await Promise.all([
          S.indexQuotes().catch(function () { return []; }),
          S.limitUpPool().catch(function () { return []; }),
          S.limitDownPool().catch(function () { return []; }),
          S.brokenPool().catch(function () { return []; }),
          S.zdfenbu().catch(function () { return { up: 0, down: 0, flat: 0 }; }),
          prevInfoP,
          volP
        ]);

      perfMark('core');
      // 昨日涨停今日表现（溢价 / 晋级率）
      let premium = null;
      if (prevInfo.prev.length) {
        const rows = prevInfo.prev
          .map(function (x) { return prevInfo.quotes[x.code]; })
          .filter(Boolean);
        if (rows.length >= 5) {
          const avgPct = rows.reduce(function (s, r) { return s + r.pct; }, 0) / rows.length;
          const promoted = rows.filter(function (r) {
            return r.limitUp > 0 && r.price >= r.limitUp - 0.005;
          }).length;
          premium = {
            avgPct: avgPct,
            advanceRate: promoted / rows.length,
            count: rows.length
          };
        }
      }

      // 东财限流时涨停池可能为空：保留上一份数据，避免界面闪成空表
      if (!ztPool.length && st.market) {
        st.lastMarketLoad = Date.now();
        UI.toast('东财限流，暂用上一份涨停池数据');
        render();
        return;
      }

      const maxBoard = ztPool.reduce(function (m, x) { return Math.max(m, x.boards); }, 0);
      const volRatio = volStat ? volStat.volRatio : 1;

      const snapshot = {
        zt: ztPool.length || breadth.limitUp || 0,
        dt: dtPool.length || breadth.limitDown || 0,
        zb: zbPool.length,
        maxBoard: maxBoard,
        up: breadth.up,
        down: breadth.down,
        volRatio: volRatio,
        premium: premium ? premium.avgPct : null,
        advanceRate: premium ? premium.advanceRate : null,
        height5: recentHeightPeak()
      };

      const emotion = E.emotion(snapshot);

      // 龙头：先用本地缓存的强势股榜（通常 15 分钟内），保证首屏就有结论；
      // 后台刷新到新数据后，再由 refreshLeader() 补一次。
      const hotList = S.hotPoolStale() || [];
      st.hotList = hotList;
      let leader = E.pickLeader(buildLeaderCandidates(ztPool, hotList), {
        heightCap: emotion.heightCap
      });

      const pool = E.shortPool(ztPool, {
        heightCap: emotion.heightCap,
        leader: leader
      });

      const turnover = (indexes[0] && indexes[1])
        ? indexes[0].amount + indexes[1].amount : 0;

      st.market = {
        indexes: indexes,
        emotion: emotion,
        volume: E.volumeRegime(turnover, volStat || volRatio),
        premium: premium,
        sectors: pool.sectors,
        leader: leader || pool.leader,
        focusOnly: pool.focusOnly,
        ladder: buildLadder(ztPool),
        turnover: turnover,
        updatedAt: Date.now(),
        stale: false,
        counts: { zt: ztPool.length, dt: dtPool.length, zb: zbPool.length }
      };
      st.short = pool;
      st.ztPool = ztPool;
      st.lastMarketLoad = Date.now();

      recomputePf();
      saveSnapshot();

      if (U.marketState() === 'closed') {
        const rec = U.store.get('closeRefresh', {}) || {};
        rec.done = U.dateStr();
        rec.date = U.dateStr();
        U.store.set('closeRefresh', rec);
      }

      saveHistory(emotion, snapshot);
    } finally {
      st.loading = false;
      setRefreshSpin(false);
      render();
      perfMark('loaded');
    }

    // 后台补龙头：强势股榜回来后再算一次，可能把未涨停的人气票顶上来
    refreshLeader();
  }

  /**
   * 异步补龙头。强势股榜是最容易被东财限流的接口，
   * 所以它不参与首屏，回来后只在「龙头真的变了」时才重绘，避免无谓跳变。
   */
  async function refreshLeader() {
    if (!st.market || !st.short || !st.short.list.length) return;
    let hot = [];
    try {
      hot = await S.hotPool(100);
    } catch (e) {
      return;
    }
    if (!hot || !hot.length) return;

    // 用原始池子重算，不能用已评分对象——二次评分会让 tags/flags 重复累积
    const ztPool = st.ztPool || [];
    if (!ztPool.length) return;
    const leader = E.pickLeader(buildLeaderCandidates(ztPool, hot), {
      heightCap: st.market.emotion.heightCap
    });
    if (!leader) return;
    if (st.market.leader && st.market.leader.code === leader.code) return;

    st.market.leader = leader;
    st.short = E.shortPool(ztPool, {
      heightCap: st.market.emotion.heightCap,
      leader: leader
    });
    saveSnapshot();
    perfMark('leader');
    if (st.tab === 'market' || st.tab === 'picks') render();
  }

  /* ---------------------------------------------------------
   * 界面快照
   *
   * 收盘后数据是定稿的，下次打开没必要再等 1 秒。
   * 启动时先把上次的快照铺上去（标注数据时间），再静默刷新。
   * ------------------------------------------------------- */
  const SNAP_TTL = 12 * 3600 * 1000;   // 超过 12 小时的快照不铺，避免展示过期盘面

  function saveSnapshot() {
    if (!st.market) return;
    try {
      const m = st.market;
      const payload = {
        v: 3,
        at: Date.now(),
        market: {
          indexes: m.indexes,
          emotion: m.emotion,
          volume: m.volume,
          premium: m.premium,
          sectors: m.sectors,
          leader: m.leader,
          focusOnly: m.focusOnly,
          // 梯队只保留渲染需要的字段，控制体积
          ladder: (m.ladder || []).map(function (l) {
            return {
              boards: l.boards, count: l.count,
              list: (l.list || []).map(function (x) {
                return {
                  code: x.code, name: x.name, price: x.price, pct: x.pct,
                  sealAmount: x.sealAmount, industry: x.industry
                };
              })
            };
          }),
          turnover: m.turnover,
          updatedAt: m.updatedAt,
          counts: m.counts
        }
      };
      // 体积保护：快照只服务首屏，没必要为它冒配额风险
      if (JSON.stringify(payload).length > 900000) return;
      U.store.set('snap.market', payload);
    } catch (e) { /* 配额满就放弃快照，不影响功能 */ }
  }

  function restoreSnapshot() {
    try {
      const rec = U.store.get('snap.market', null);
      if (!rec || !rec.market || !rec.market.emotion) return false;
      if (rec.v !== 3) return false;   // 结构变了就作废旧快照
      if (Date.now() - (rec.at || 0) > SNAP_TTL) return false;
      st.market = rec.market;
      st.market.stale = true;
      st.market.cachedAt = rec.at;
      return true;
    } catch (e) {
      return false;
    }
  }

  async function computeMarketVolume(indexes) {
    const idx = indexes || [];
    const [sh, sz] = await Promise.all([
      S.dayKline('sh000001', 160),
      S.dayKline('sz399001', 160)
    ]);
    if (!sh.length || !sz.length) return null;

    const today = U.dateStr();
    const map = {};
    sh.forEach(function (b) {
      map[b.date] = { vol: b.vol || 0, close: b.close || 0 };
    });
    sz.forEach(function (b) {
      if (!map[b.date]) map[b.date] = { vol: 0, close: 0 };
      map[b.date].vol += (b.vol || 0);
    });

    // K 线最后一根就是最新交易日；若与本地日期不一致（跨节假日、盘前未生成当日 K 线），
    // 以最后一根为准，避免整块量能算不出来。
    let todayKey = today;
    if (!map[today]) {
      const lastDate = Object.keys(map).sort().pop();
      if (lastDate) todayKey = lastDate;
    }
    if (!map[todayKey]) return null;

    const days = Object.keys(map).filter(function (d) { return d !== todayKey; }).sort();
    if (days.length < 20) return null;

    // 盘中把当日成交量还原成全天口径再参与比较
    const frac = U.isTrading() ? intradayFraction() : 1;
    const todayVol = map[todayKey].vol / frac;

    const prev = days.map(function (d) { return map[d].vol; });   // 不含今日，升序
    const seq = prev.concat([todayVol]);                          // 含今日
    const n = seq.length;
    const todayVal = seq[n - 1];

    const mean = function (arr) {
      if (!arr.length) return 0;
      return arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
    };
    const avgOf = function (k) { return mean(seq.slice(-k)); };

    const ma = { d5: avgOf(5), d10: avgOf(10), d20: avgOf(20), d60: avgOf(60), d120: avgOf(120) };

    /* 分位：今日量在近 N 日中的位置。比「量比」更能说明现在是不是地量 */
    const pctOf = function (k) {
      const arr = seq.slice(-k);
      if (arr.length < 3) return null;
      const below = arr.filter(function (x) { return x <= todayVal; }).length;
      return below / arr.length;
    };
    const pct = { p20: pctOf(20), p60: pctOf(60), p120: pctOf(120) };

    /* 中枢斜率：60 日均量相对「20 日前的 60 日均量」的变化。
       这是「量能台阶在上移还是下移」的量化——日频噪声看不出来，必须拉长。 */
    let centerSlope = null;
    if (n >= 80) {
      const cur60 = mean(seq.slice(-60));
      const old60 = mean(seq.slice(-80, -20));
      if (old60 > 0) centerSlope = cur60 / old60 - 1;
    }

    // 连续递减天数（从今日往前数）
    let downDays = 0;
    for (let i = n - 1; i > 0; i--) {
      if (seq[i] < seq[i - 1]) downDays++;
      else break;
    }

    // 近 10 日峰值回撤
    const win = seq.slice(-10);
    const peak = win.reduce(function (a, b) { return Math.max(a, b); }, 0);
    const peakDrawdown = peak > 0 ? todayVal / peak - 1 : 0;

    // 近5日均 ÷ 前5日均（环比方向）
    const avgLast5 = mean(seq.slice(-5));
    const prev5 = seq.slice(-10, -5);
    const avgPrev5b = prev5.length ? mean(prev5) : avgLast5;

    /* 量价配合：指数涨跌 × 量能增减，四个象限对应四种市场性质 */
    const closeSeq = days.map(function (d) { return map[d].close; });
    const closeNow = map[todayKey].close || closeSeq[closeSeq.length - 1];
    const chgOf = function (k) {
      if (closeSeq.length < k + 1) return null;
      const c0 = closeSeq[closeSeq.length - k];
      return c0 > 0 ? (closeNow / c0 - 1) * 100 : null;
    };

    /* 月度均量序列：复盘用，能一眼看出台阶。
       当日必须并入「当月」而不是单独成柱——否则当月会出现两根柱子，
       还会把最早的那个月挤出去。 */
    const byMonth = {};
    days.forEach(function (d, i2) {
      const m = d.slice(0, 7);
      (byMonth[m] = byMonth[m] || []).push(prev[i2]);
    });
    const curMonth = todayKey.slice(0, 7);
    (byMonth[curMonth] = byMonth[curMonth] || []).push(todayVal);

    const monthly = Object.keys(byMonth).sort().map(function (m) {
      return { month: m, avg: mean(byMonth[m]), partial: m === curMonth };
    });

    return {
      volRatio: ma.d5 > 0 ? todayVal / ma.d5 : 1,
      downDays: downDays,
      peakDrawdown: peakDrawdown,
      trend5: avgPrev5b > 0 ? avgLast5 / avgPrev5b : 1,
      todayVol: todayVal,
      peakVol: peak,
      seq: seq.slice(-20).map(function (v) { return Math.round(v); }),
      ma: ma,
      pct: pct,
      centerSlope: centerSlope,
      priceChg20: chgOf(20),
      priceChg60: chgOf(60),
      monthly: monthly
    };
  }

  /**
   * 龙头候选池 = 涨停股 + 当日强势股
   * 龙头不一定涨停：行业龙头可能只涨 6%，但成交额、换手远高于连板杂毛。
   */
  function buildLeaderCandidates(ztPool, hotList) {
    const seen = {};
    const out = [];

    ztPool.forEach(function (x) {
      seen[x.code] = 1;
      out.push({
        code: x.code, name: x.name, price: x.price, pct: x.pct,
        amount: x.amount, floatCap: x.floatCap, turnover: x.turnover,
        boards: x.boards, industry: x.industry || '其他', inPool: true
      });
    });

    (hotList || []).forEach(function (x) {
      if (seen[x.code]) return;
      if (!(x.pct >= 5)) return;                    // 当日要有热度
      if (!(x.amount >= 2e8)) return;               // 成交额门槛，过滤噪音
      if (!(x.floatCap >= 20e8 && x.floatCap <= 800e8)) return;  // 排除杂毛与超级权重
      if (!(x.turnover >= 2)) return;
      seen[x.code] = 1;
      out.push({
        code: x.code, name: x.name, price: x.price, pct: x.pct,
        amount: x.amount, floatCap: x.floatCap, turnover: x.turnover,
        boards: 0, industry: x.industry || '其他', inPool: false
      });
    });
    return out;
  }

  /** 近 5 日最高板的峰值（读本地历史，不含今天） */
  function recentHeightPeak() {
    try {
      const all = U.store.get('hist', {}) || {};
      const today = U.dateStr();
      const keys = Object.keys(all).filter(function (k) { return k !== today; })
        .sort().slice(-5);
      let peak = 0;
      keys.forEach(function (k) {
        const v = all[k] && all[k].maxBoard;
        if (isFinite(v) && v > peak) peak = v;
      });
      return peak;
    } catch (e) {
      return 0;
    }
  }

  function buildLadder(pool) {
    const map = {};
    pool.forEach((x) => {
      (map[x.boards] = map[x.boards] || []).push(x);
    });
    return Object.keys(map).map(Number).sort((a, b) => b - a).map((k) => {
      // 同档内按封单额降序、封板时间升序，最强的排前面
      const list = map[k].slice().sort((a, b) =>
        (b.sealAmount || 0) - (a.sealAmount || 0) ||
        (a.firstSeal || 999999) - (b.firstSeal || 999999));
      return { boards: k, count: list.length, list: list };
    });
  }

  /** 每日情绪快照，用于长期回看（只存 60 天） */
  function saveHistory(emotion, snap) {
    try {
      const all = U.store.get('hist', {});
      all[U.dateStr()] = {
        mes: emotion.mes,
        phase: emotion.phase,
        zt: snap.zt, dt: snap.dt,
        volRatio: +snap.volRatio.toFixed(2),
        maxBoard: snap.maxBoard,
        premium: snap.premium == null ? null : +snap.premium.toFixed(2)
      };
      const keys = Object.keys(all).sort();
      while (keys.length > 60) delete all[keys.shift()];
      U.store.set('hist', all);
    } catch (e) {}
  }

  /* ---------------------------------------------------------
   * 波段扫描
   * ------------------------------------------------------- */
  async function scanSwing() {
    if (st.swingScanning) return;
    st.swingScanning = true;
    st.swingProgress = 0;
    st.swing = null;
    render();

    try {
      // 1) 候选池：优先东财成交额榜（1 页 100 只，尽量少打扰东财）；
      //    若被限流，退回「涨停池 + 炸板池」——这两个接口在 push2ex 上，
      //    压力小得多，而且「资金已进场」本身也符合月线法的资金前置逻辑。
      let pool = [];
      try {
        pool = await S.emRank({ fid: 'f6', pn: 1, pz: 100, po: 1 });
      } catch (e) {
        pool = [];
      }

      if (!pool.length) {
        const [zt, zb] = await Promise.all([
          S.limitUpPool().catch(() => []),
          S.brokenPool().catch(() => [])
        ]);
        const seen = {};
        pool = zt.concat(zb).filter((x) => {
          if (seen[x.code]) return false;
          seen[x.code] = 1;
          return true;   // 遍历
        });
        st.swingFallback = true;
      } else {
        st.swingFallback = false;
      }
      if (!pool.length) throw new Error('候选池为空');

      // 2) 粗筛：涨幅不高、市值合适、成交活跃
      const cand = pool.filter((x) => {
        if (!x.price || x.price <= 0) return false;
        const cap = x.floatCap;
        if (!(cap >= 20e8 && cap <= 800e8)) return false;
        if (isFinite(x.pct60) && x.pct60 > 60) return false;
        return true;
      }).slice(0, 70);

      if (!cand.length) throw new Error('没有符合条件的候选');

      // 3) 逐只拉日线（380 根 ≈ 18 个月，可聚合出周线、月线）
      const tasks = cand.map((c) => async () => {
        const bars = await S.dayKline(c.code, 380);
        if (!bars || bars.length < 120) return null;
        const a = E.analyzeSwing(bars);
        if (!a) return null;
        return Object.assign({}, c, a);
      });

      const results = await YB.net.pool(tasks, 6, (done, total) => {
        st.swingProgress = Math.round(done / total * 100);
        const bar = document.getElementById('swingProg');
        if (bar) bar.style.width = st.swingProgress + '%';
      });

      // 保留全部成功解析的候选（最多 70 只），由界面分成「可买点 / 全部」两档
      const items = results
        .filter((r) => r && !r.__error)
        .sort((a, b) => (b.buyReady - a.buyReady) || (b.score - a.score));

      st.swing = { items, filter: 'ready', scannedAt: Date.now(), scanned: cand.length };
    } catch (e) {
      UI.toast('扫描失败：' + (e && e.message || '网络异常'));
      st.swing = null;
    } finally {
      st.swingScanning = false;
      render();
    }
  }

  /* ---------------------------------------------------------
   * 持仓数据编排
   * ------------------------------------------------------- */
  /** 用当前行情和情绪阶段重算持仓快照 */
  async function loadPortfolio(force) {
    const arr = YB.pf.list();
    const capital = U.store.get('capital', 100000);
    const stopPct = U.store.get('stopPct', 6);
    const phase = (st.market && st.market.emotion) || null;

    // 先用成本价铺一版，避免切页时闪空
    if (!st.pf || force || !arr.length) {
      st.pf = YB.pf.snapshot({}, capital, stopPct, phase);
    }

    if (!arr.length) {
      st.pfLoading = false;
      render();
      return;
    }

    st.pfLoading = true;
    try {
      const quotes = await S.quotes(arr.map((x) => x.code));
      st.pfQuotes = quotes;
      st.pf = YB.pf.snapshot(quotes, capital, stopPct, phase);
    } catch (e) {
      // 拉不到行情就按成本价，不打断界面
      st.pf = YB.pf.snapshot({}, capital, stopPct, phase);
    } finally {
      st.pfLoading = false;
      if (st.tab === 'portfolio') render();
    }
  }

  /** 行情/参数变化后按已缓存的行情重算，不额外发请求 */
  function recomputePf() {
    if (!st.pf) return;
    st.pf = YB.pf.snapshot(
      st.pfQuotes || {},
      U.store.get('capital', 100000),
      U.store.get('stopPct', 6),
      (st.market && st.market.emotion) || null
    );
  }

  /* ---------------------------------------------------------
   * 收盘补拉
   *
   * 盘中按间隔刷新；15:00 之后只补一次最终数据（此时涨停池才是定稿的），
   * 拉成功就标记当天已完成，之后不再自动请求。
   * 加节流与重试上限，避免拉失败时每秒重试把接口打爆。
   * ------------------------------------------------------- */
  let lastCloseCheck = 0;

  function maybeCloseRefresh() {
    // tick 每秒触发，这里每 30 秒才真正判断一次，避免频繁读 localStorage
    if (Date.now() - lastCloseCheck < 30000) return false;
    lastCloseCheck = Date.now();

    const now = new Date();
    const day = now.getDay();
    if (day === 0 || day === 6) return false;
    if (now.getHours() < 15) return false;

    const today = U.dateStr();
    const rec = U.store.get('closeRefresh', {}) || {};
    if (rec.done === today) return false;                       // 今天已经成功拉过
    if (rec.date === today && (rec.tries || 0) >= 3) return false;  // 连续失败，今天不再试
    if (rec.at && Date.now() - rec.at < 60000) return false;     // 失败后 1 分钟内不重试

    U.store.set('closeRefresh', {
      date: today,
      at: Date.now(),
      tries: (rec.date === today ? (rec.tries || 0) : 0) + 1
    });

    YB.net.clearCache();
    loadMarket(true);
    if (st.pf) loadPortfolio(true);
    return true;
  }

  /* ---------------------------------------------------------
   * 板块二级页
   * ------------------------------------------------------- */
  function openSector(name) {
    if (!name) return;
    st.stack.push({ name: 'sector', key: name });
    render();
  }

  /* ---------------------------------------------------------
   * K 线页
   * ------------------------------------------------------- */
  /** 在涨停池里找这只票的评分结果（不在池里返回 null） */
  function findPoolItem(code) {
    const list = (st.short && st.short.list) || [];
    for (let i = 0; i < list.length; i++) {
      if (list[i].code === code) return list[i];
    }
    return null;
  }

  /** 这只票在所属板块内的审美排名 */
  function sectorRankOf(code, industry) {
    if (!industry || !st.short) return null;
    const d = YB.engine.sectorDetail(industry, st.short.list, st.hotList || []);
    if (!d) return null;
    let rank = 0;
    for (let i = 0; i < d.list.length; i++) {
      if (d.list[i].code === code) { rank = i + 1; break; }
    }
    if (!rank) return null;
    return { name: d.name, rank: rank, total: d.count, limitUp: d.limitUpCount };
  }

  async function openKline(code, name) {
    const c = S.plainCode(code);
    if (!c) return;
    st.stack.push({ name: 'kline', code: c });
    const ref = {
      code: c, name: name || c, period: 'day',
      loading: true, bars: {}, view: null, quote: null, analysis: null
    };
    st.kline = ref;
    render();

    try {
      // 指数 K 线（算相对强弱）与分时并行拉，分时失败不影响主流程
      const res = await Promise.all([
        S.kline(c, 'day', 320),
        S.quotes([c]).catch(function () { return {}; }),
        S.kline('sh000001', 'day', 320).catch(function () { return null; }),
        S.minuteData(c).catch(function () { return null; })
      ]);
      if (st.kline !== ref) return;   // 用户已经切走

      const bars = res[0];
      const quote = res[1][c] || null;
      const idxBars = res[2];
      ref.minute = res[3];

      ref.bars.day = bars;
      ref.view = bars;
      ref.quote = quote;
      if (quote && quote.name) ref.name = quote.name;

      // 深度分析：把这只票放进当前市场语境里判断，而不是孤立看图形
      const poolItem = findPoolItem(c);
      const em = (st.market && st.market.emotion) || null;
      const A = YB.engine.analyzeStock(bars, quote || {}, {
        code: c,
        name: ref.name,
        indexBars: idxBars,
        emotion: em,
        poolItem: poolItem,
        capital: U.store.get('capital', 100000),
        stopPct: U.store.get('stopPct', 6),
        phaseKey: em ? em.phaseKey : null
      });
      if (A && poolItem && poolItem.industry) {
        A.sector = sectorRankOf(c, poolItem.industry);
      }
      if (A) A.period = 'day';   // 指标一律基于日线，切周期不改变判定

      /* 筹码分布：流通股本 = 流通市值 ÷ 现价。
         用真实股本才能算出真实换手率，否则筹码衰减会严重失真。 */
      try {
        const fcap = quote && quote.floatCap > 0 ? quote.floatCap : 0;
        const px = quote && quote.price > 0 ? quote.price : bars[bars.length - 1].close;
        ref.chips = YB.engine.computeChips(bars, {
          price: px,
          bins: 96,
          floatShares: fcap > 0 && px > 0 ? fcap / px : 0
        });
      } catch (e2) {
        ref.chips = null;
      }
      ref.analysis = A;

      ref.loading = false;
    } catch (e) {
      if (st.kline !== ref) return;
      ref.loading = false;
      ref.error = '获取K线失败：' + ((e && e.message) || '网络异常');
    }
    render();
  }

  async function switchPeriod(period) {
    const k = st.kline;
    if (!k || k.period === period) return;
    k.period = period;
    k.error = null;
    if (k.bars[period]) { k.view = k.bars[period]; render(); return; }

    k.loading = true;
    render();
    const count = period === 'day' ? 320 : period === 'week' ? 160 : 84;
    try {
      const bars = await S.kline(k.code, period, count);
      k.bars[period] = bars;
      k.view = bars;
      k.loading = false;
    } catch (e) {
      k.loading = false;
      k.error = '获取K线失败：' + ((e && e.message) || '网络异常');
    }
    if (st.kline === k) render();
  }

  function mountKline() {
    const canvas = document.getElementById('klineChart');
    const k = st.kline;
    if (!canvas || !k || !k.view || k.view.length < 2) return;

    if (st.klineDetach) { st.klineDetach(); st.klineDetach = null; }
    st.klineDetach = null;

    const bars = k.view;
    // 叠加筹码带后 K 线区变窄约 22%，可见根数相应下调，否则蜡烛会挤成细线
    const withChips = !!(k.chips && k.chips.dist);
    const base = k.period === 'month'
      ? (withChips ? 18 : 24)
      : (withChips ? 22 : 30);
    const zoom = k.zoom || 1;
    const visible = Math.max(12, Math.min(240, Math.round(base / zoom)));

    // innerHTML 刚写入时布局尚未完成，clientWidth 可能是 0 或旧值，
    // 直接绘制会把右侧价格轴与日期轴画到画布外。等一帧再画。
    const paint = function () {
      const target = document.getElementById('mainChart');
      if (!target || st.kline !== k) return;

      const mode = k.chart || 'day';

      if (mode === 'minute') {
        YB.kline.drawMinute(target, k.minute, {
          prevClose: k.quote && k.quote.prev > 0 ? k.quote.prev : 0
        });
        return;
      }
      if (mode === 'chips') {
        YB.kline.drawChips(target, k.chips, {
          price: k.quote && k.quote.price > 0 ? k.quote.price : 0
        });
        return;
      }

      // 日K（叠加筹码分布）。十字光标的数据直接画在画布内，不再回写 DOM
      YB.kline.draw(target, bars, {
        cross: null, axisFormat: k.period, visible: visible, chips: k.chips
      });
      st.klineDetach = YB.kline.attach(target, bars, null, {
        visible: visible, axisFormat: k.period, chips: k.chips
      });
    };

    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(paint);
    else setTimeout(paint, 0);
  }

  /* ---------------------------------------------------------
   * 渲染
   * ------------------------------------------------------- */
  function render() {
    const view = $('#view');
    if (!view) return;
    const sub = st.stack[st.stack.length - 1];
    let html = '';
    if (sub && sub.name === 'kline') {
      html = UI.renderKline(st);
    } else if (sub && sub.name === 'sector') {
      html = UI.renderSector(st);
    } else if (sub) {
      html = UI.renderSettingsSub(st);
    } else if (st.tab === 'market') {
      html = UI.renderMarket(st);
    } else if (st.tab === 'picks') {
      html = UI.renderPicks(st);
    } else if (st.tab === 'portfolio') {
      html = UI.renderPortfolio(st);
    } else if (st.tab === 'risk') {
      html = UI.renderRisk(st);
    } else {
      html = UI.renderSettings(st);
    }
    // 记住离开时各页面的滚动位置：切到别的 tab 再回来，不该又回到顶部
    const rk = routeKey();
    if (lastRouteKey && rk !== lastRouteKey) {
      scrollMemo[lastRouteKey] = window.scrollY || 0;
    }

    view.innerHTML = html;
    view.scrollTop = 0;

    if (rk !== lastRouteKey) {
      lastRouteKey = rk;
      const y = scrollMemo[rk];
      // 等布局完成再滚，否则新内容还没撑开高度，滚动位置会被夹到 0
      const apply = function () {
        try { window.scrollTo(0, y == null ? 0 : y); } catch (e) {}
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
      else setTimeout(apply, 0);
    }
    syncTabs();
    // K 线是 canvas，必须在 DOM 就位后挂载
    if (sub && sub.name === 'kline') mountKline();
    else if (st.klineDetach) { st.klineDetach(); st.klineDetach = null; }
  }

  /** 路由指纹：tab + 二级页 + 栈深度，用来判断是不是换了页面 */
  let lastRouteKey = '';
  /** 各路由的滚动位置记忆 */
  const scrollMemo = {};
  function routeKey() {
    const sub = st.stack[st.stack.length - 1];
    return st.tab + '|' + st.stack.length + '|' +
      (sub ? sub.name + ':' + (sub.code || '') : '');
  }

  function syncTabs() {
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === st.tab));
  }

  function setRefreshSpin(on) {
    const b = $('#btnRefresh');
    if (b) b.classList.toggle('spinning', !!on);
  }

  /* ---------------------------------------------------------
   * 简易弹窗（WebView 下 prompt 不可靠，自己实现）
   * ------------------------------------------------------- */
  function askNumber(title, def, onOk) {
    const mask = document.createElement('div');
    mask.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.5);' +
      'display:flex;align-items:center;justify-content:center;padding:24px';
    mask.innerHTML = '<div style="background:var(--surface);border:1px solid var(--border);' +
      'border-radius:16px;padding:18px;width:100%;max-width:300px;box-shadow:0 20px 60px rgba(0,0,0,.5)">' +
      '<div style="font-size:14px;font-weight:650;margin-bottom:12px">' + U.escapeHtml(title) + '</div>' +
      '<input class="input" type="number" inputmode="decimal" value="' + def + '" ' +
      'style="margin-bottom:14px" />' +
      '<div style="display:flex;gap:8px">' +
      '<button class="btn" style="flex:1" data-x="c">取消</button>' +
      '<button class="btn btn-primary" style="flex:1" data-x="o">确定</button>' +
      '</div></div>';
    document.body.appendChild(mask);
    const input = mask.querySelector('input');
    setTimeout(() => input.focus(), 60);
    mask.addEventListener('click', (ev) => {
      const act = ev.target.dataset && ev.target.dataset.x;
      if (act === 'c') document.body.removeChild(mask);
      if (act === 'o') {
        const v = parseFloat(input.value);
        if (isFinite(v) && v > 0) { onOk(v); document.body.removeChild(mask); }
        else UI.toast('请输入有效数字');
      }
    });
  }

  /* ---------------------------------------------------------
   * 通用弹窗 / 持仓表单
   * ------------------------------------------------------- */
  function modal(opt) {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML =
      '<div class="modal">' +
        '<div class="modal-title">' + U.escapeHtml(opt.title || '') + '</div>' +
        (opt.desc ? '<div class="modal-desc">' + U.escapeHtml(opt.desc) + '</div>' : '') +
        '<div class="modal-body">' + (opt.body || '') + '</div>' +
        '<div class="modal-actions">' +
          '<button class="btn" data-x="c">' + (opt.cancelText || '取消') + '</button>' +
          '<button class="btn ' + (opt.danger ? 'danger-outline' : 'btn-primary') + '" data-x="o">' +
            (opt.okText || '确定') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(mask);

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      if (mask.parentNode) mask.parentNode.removeChild(mask);
    }

    if (opt.onMount) opt.onMount(mask.querySelector('.modal'), close);

    mask.addEventListener('click', (ev) => {
      if (ev.target === mask) { close(); return; }
      const act = ev.target.dataset && ev.target.dataset.x;
      if (act === 'c') { close(); return; }
      if (act === 'o') {
        const keep = opt.onOk ? opt.onOk(mask.querySelector('.modal'), close) : true;
        if (keep !== false) close();
      }
    });
    return { el: mask, close };
  }

  function confirmModal(title, desc, onOk) {
    modal({ title: title, desc: desc, okText: '确定', danger: true, onOk: function () { onOk(); return true; } });
  }

  /** 添加 / 编辑持仓表单 */
  function openPosForm(existing) {
    const isEdit = !!existing;
    const v = (x) => U.escapeHtml(x == null ? '' : String(x));
    const body =
      '<div class="field"><div class="field-label">股票代码</div>' +
        '<input class="input num" id="fCode" inputmode="numeric" maxlength="6" ' +
          'placeholder="6 位数字" value="' + v(existing && existing.code) + '"' +
          (isEdit ? ' disabled' : '') + '></div>' +
      '<div class="field"><div class="field-label">名称</div>' +
        '<input class="input" id="fName" placeholder="输入代码后自动带出" value="' +
          v(existing && existing.name) + '"></div>' +
      '<div class="field-row">' +
        '<div class="field"><div class="field-label">持仓数量（股）</div>' +
          '<input class="input num" id="fShares" inputmode="numeric" value="' +
            v(existing && existing.shares) + '"></div>' +
        '<div class="field"><div class="field-label">成本价</div>' +
          '<input class="input num" id="fCost" inputmode="decimal" value="' +
            v(existing && existing.cost ? Number(existing.cost).toFixed(3) : '') + '"></div>' +
      '</div>' +
      '<div class="field"><div class="field-label">备注（可选）</div>' +
        '<input class="input" id="fNote" placeholder="如：分歧转一致买入" value="' +
          v(existing && existing.note) + '"></div>';

    modal({
      title: isEdit ? '编辑持仓' : '添加持仓',
      okText: isEdit ? '保存' : '添加',
      body: body,
      onMount: function (root) {
        const codeEl = root.querySelector('#fCode');
        const nameEl = root.querySelector('#fName');
        const costEl = root.querySelector('#fCost');

        if (!isEdit && codeEl) {
          // 输满 6 位自动查一次名称与现价，省得手填
          const probe = U.debounce(async function () {
            const code = codeEl.value.replace(/\D/g, '');
            if (code.length !== 6) return;
            try {
              const q = await S.quotes([code]);
              const item = q[code];
              if (!item) return;
              if (!nameEl.value) nameEl.value = item.name;
              if (!costEl.value && item.price > 0) costEl.value = item.price.toFixed(2);
            } catch (e) {}
          }, 350);
          codeEl.addEventListener('input', probe);
        }
        setTimeout(function () {
          (isEdit ? root.querySelector('#fShares') : codeEl).focus();
        }, 80);
      },
      onOk: function (root) {
        const code = (root.querySelector('#fCode').value || '').replace(/\D/g, '');
        const name = root.querySelector('#fName').value.trim();
        const shares = parseInt(root.querySelector('#fShares').value, 10);
        const cost = parseFloat(root.querySelector('#fCost').value);
        const note = root.querySelector('#fNote').value.trim();

        if (!isEdit && code.length !== 6) { UI.toast('请输入 6 位股票代码'); return false; }
        if (!isFinite(shares) || shares <= 0) { UI.toast('请输入持仓数量'); return false; }
        if (!isFinite(cost) || cost <= 0) { UI.toast('请输入成本价'); return false; }

        if (isEdit) {
          YB.pf.update(existing.id, { shares: shares, cost: cost, name: name || existing.name, note: note });
          UI.toast('已保存');
        } else {
          const saved = YB.pf.add({ code: code, name: name, shares: shares, cost: cost, note: note });
          if (!saved) { UI.toast('添加失败'); return false; }
          UI.toast('已添加 ' + (saved.name || saved.code));
        }
        loadPortfolio(true);
        return true;
      }
    });
  }

  /** 清仓：输入卖出价，转入交割单 */
  function closePos(id) {
    const p = YB.pf.list().filter((x) => x.id === id)[0];
    if (!p) return;
    const row = st.pf && st.pf.rows.filter((r) => r.id === id)[0];
    const def = row && row.hasQuote ? row.price.toFixed(2) : Number(p.cost).toFixed(2);

    modal({
      title: '清仓 ' + p.name,
      desc: '卖出后转入交割单，计入已实现盈亏',
      body: '<div class="field"><div class="field-label">卖出价</div>' +
        '<input class="input num" id="fExit" inputmode="decimal" value="' + def + '"></div>' +
        '<div class="pv-hint num">成本 ' + Number(p.cost).toFixed(2) +
        ' × ' + p.shares + ' 股 = ' + UI.money(p.cost * p.shares) + '</div>',
      okText: '确认清仓',
      onMount: function (root) {
        setTimeout(function () {
          const el = root.querySelector('#fExit');
          el.focus(); el.select();
        }, 80);
      },
      onOk: function (root) {
        const ep = parseFloat(root.querySelector('#fExit').value);
        if (!isFinite(ep) || ep <= 0) { UI.toast('请输入卖出价'); return false; }
        const rec = YB.pf.close(id, ep);
        if (rec) UI.toast('已清仓 · ' + U.fmtPct(rec.pnlPct));
        loadPortfolio(true);
        return true;
      }
    });
  }

  /* ---------------------------------------------------------
   * 事件
   * ------------------------------------------------------- */
  function bind() {
    document.addEventListener('click', (ev) => {
      const t = ev.target;

      // 底部 tab
      const tabEl = t.closest('.tab');
      if (tabEl) { switchTab(tabEl.dataset.tab); return; }

      // 设置二级页导航
      const navEl = t.closest('[data-nav]');
      if (navEl) {
        const name = navEl.dataset.nav;
        if (name === 'back') st.stack.pop();
        else if (NAV_TITLES[name]) st.stack.push({ name: name });
        render();
        return;
      }

      /* 软件更新：检查 / 下载 / 打开发布页 */
      const upEl = t.closest('[data-up]');
      if (upEl && YB.update) {
        const act = upEl.dataset.up;

        if (act === 'check') {
          YB.update.check(true).then(function () {
            render();
            const sm = YB.update.summary();
            UI.toast(sm.hasUpdate
              ? '发现新版本 v' + sm.latest.versionName
              : '已是最新');
          }, function () {
            render();
            UI.toast(YB.update.state.error || '检查失败');
          });
          render();   // check 已同步置 checking=true，先把「检查中」显示出来
          return;
        }

        if (act === 'install') {
          const r = YB.update.install();
          if (r.ok && r.mode === 'web') UI.toast('已用浏览器打开下载页');
          else if (r.ok) UI.toast('开始下载');
          else UI.toast('无法开始下载，请到发布页手动安装');
          render();
          return;
        }

        if (act === 'page') {
          try { window.open(YB.update.pageUrl(), '_blank'); } catch (e2) {}
          return;
        }
      }

      // 持仓：编辑 / 清仓 / 删除
      const posAct = t.closest('[data-pos-act]');
      if (posAct) {
        const row = posAct.closest('[data-pos]');
        const id = row && row.dataset.pos;
        const p = YB.pf.list().filter((x) => x.id === id)[0];
        if (!p) return;
        const act = posAct.dataset.posAct;
        if (act === 'edit') openPosForm(p);
        else if (act === 'close') closePos(id);
        else if (act === 'del') {
          confirmModal('删除 ' + p.name + '？', '不会计入交割单，也不会产生已实现盈亏。', function () {
            YB.pf.remove(id);
            loadPortfolio(true);
            UI.toast('已删除');
          });
        }
        return;
      }

      // 添加持仓
      if (t.closest('#btnAddPos')) { openPosForm(null); return; }

      // 刷新间隔
      const rs = t.closest('[data-refresh-sec]');
      if (rs) {
        U.store.set('refreshSec', parseInt(rs.dataset.refreshSec, 10) || 30);
        render();
        return;
      }

      // 刷新
      if (t.closest('#btnRefresh')) {
        YB.net.clearCache();
        loadMarket(true);
        if (st.tab === 'picks') UI.toast('已刷新');
        return;
      }

      // 选股子 tab
      const pickTab = t.closest('[data-picktab]');
      if (pickTab) { st.pickTab = pickTab.dataset.picktab; render(); return; }

      // 波段筛选
      const swf = t.closest('[data-swfilter]');
      if (swf && st.swing) { st.swing.filter = swf.dataset.swfilter; render(); return; }

      // 扫描
      if (t.closest('#btnSwingScan')) { scanSwing(); return; }

      // 板块 → 二级页（板块内个股审美排名）
      const secEl = t.closest('[data-sector]');
      if (secEl) {
        openSector(secEl.dataset.sector);
        return;
      }

      // 涨停梯队：展开某一档
      const ladderEl = t.closest('[data-ladder]');
      if (ladderEl) {
        const b = parseInt(ladderEl.dataset.ladder, 10);
        st.ladderPick = st.ladderPick === b ? null : b;
        render();
        return;
      }

      // 打开 K 线
      const klineEl = t.closest('[data-kline]');
      if (klineEl) {
        openKline(klineEl.dataset.kline, klineEl.dataset.name);
        return;
      }

      // 主图模式切换（分时 / 日K / 筹码）
      const cbtn = t.closest('[data-chart]');
      if (cbtn && st.kline) {
        const next = cbtn.dataset.chart;
        if (st.kline.chart !== next) {
          st.kline.chart = next;
          render();
        }
        return;
      }

      // K 线周期切换
      const pd = t.closest('[data-period]');
      if (pd) { switchPeriod(pd.dataset.period); return; }

      // 决策卡展开更多理由
      const dcm = t.closest('[data-dcard="toggle"]');
      if (dcm && st.kline) {
        st.kline.reasonOpen = !st.kline.reasonOpen;
        render();
        return;
      }

      // K 线缩放
      const zm = t.closest('[data-zoom]');
      if (zm && st.kline) {
        const cur = st.kline.zoom || 1;
        const next = zm.dataset.zoom === 'in' ? cur * 1.5 : cur / 1.5;
        st.kline.zoom = Math.max(0.4, Math.min(3, next));
        render();
        return;
      }

      // 展开个股详情
      const stock = t.closest('.stock');
      if (stock) {
        stock.classList.toggle('open');
        return;
      }

      // 主题
      const tp = t.closest('[data-theme-pref]');
      if (tp) { U.Theme.set(tp.dataset.themePref); render(); return; }

      // 数据源偏好
      const sp = t.closest('[data-srcpref]');
      if (sp) {
        U.store.set('sourcePref', sp.dataset.srcpref);
        YB.net.clearCache();
        render();
        loadMarket(true);
        return;
      }

      // 开关
      const tg = t.closest('[data-toggle]');
      if (tg) {
        const k = tg.dataset.toggle;
        if (k === 'autoRefresh') U.store.set('autoRefresh', !U.store.get('autoRefresh', true));
        render();
        return;
      }

      // 本地数据操作（缓存 / 复盘 / 持仓 / 资金 / 重置）
      const actEl = t.closest('[data-act]');
      if (actEl) {
        const act = actEl.dataset.act;

        if (act === 'clearcache') {
          YB.net.clearCache();
          UI.toast('行情缓存已清空');
          return;
        }
        if (act === 'clearhist') {
          confirmModal('清空复盘记录？', '会删除全部每日情绪快照，不影响持仓。', function () {
            U.store.del('hist');
            render();
            UI.toast('复盘记录已清空');
          });
          return;
        }
        if (act === 'clearpos') {
          confirmModal('清空持仓与交割单？', '所有持仓记录和已实现盈亏都会被删除，无法恢复。', function () {
            YB.pf.reset();
            st.pf = null;
            st.pfQuotes = null;
            loadPortfolio(true);
            UI.toast('已清空');
          });
          return;
        }
        if (act === 'resetall') {
          confirmModal('重置全部设置与数据？', '主题、参数、持仓、复盘记录全部恢复初始状态，无法撤销。', function () {
            try { window.localStorage.clear(); } catch (e) {}
            ['theme', 'capital', 'stopPct', 'riskBudget', 'refreshSec',
              'autoRefresh', 'sourcePref', 'checks', 'hist'].forEach(function (k) { U.store.del(k); });
            YB.pf.reset();
            st.stack = [];
            st.pf = null;
            st.pfQuotes = null;
            U.Theme.set('auto');
            render();
            loadPortfolio(true);
            UI.toast('已重置');
          });
          return;
        }
        if (act === 'capital') {
          askNumber('总资金（元）', U.store.get('capital', 100000), function (v) {
            U.store.set('capital', v);
            recomputePf();
            render();
          });
          return;
        }
      }

      // 清单勾选
      const chk = t.closest('[data-check]');
      if (chk) {
        const checks = U.store.get('checks', {});
        const id = chk.dataset.check;
        checks[id] = !checks[id];
        U.store.set('checks', checks);
        chk.classList.toggle('done', !!checks[id]);
        return;
      }

      // 改资金 / 改止损
      if (t.closest('#btnCapital')) {
        askNumber('总资金（元）', U.store.get('capital', 100000), (v) => {
          U.store.set('capital', v); recomputePf(); render();
        });
        return;
      }
      if (t.closest('#btnStop')) {
        askNumber('单笔止损幅度（%）', U.store.get('stopPct', 6), (v) => {
          U.store.set('stopPct', U.clamp(v, 1, 20)); recomputePf(); render();
        });
        return;
      }
    });

    // 下拉刷新（仅市场页）
    let touchStart = 0;
    const view = $('#view');
    view.addEventListener('touchstart', (e) => {
      if (view.scrollTop <= 0) touchStart = e.touches[0].clientY;
    }, { passive: true });
    view.addEventListener('touchend', (e) => {
      if (touchStart && e.changedTouches[0].clientY - touchStart > 70) {
        if (st.tab === 'market') { YB.net.clearCache(); loadMarket(true); }
        touchStart = 0;
      }
    }, { passive: true });
  }

  function switchTab(k) {
    if (st.tab === k) return;
    st.tab = k;
    st.stack = [];          // 切 tab 时清掉二级页面栈
    render();
    if (k === 'market' && (!st.market || Date.now() - st.lastMarketLoad > 60000)) loadMarket();
    if (k === 'portfolio') loadPortfolio();
  }

  /* ---------------------------------------------------------
  /* ---------------------------------------------------------
   * 更新
   * ------------------------------------------------------- */

  /** 原生下载进度的回调入口：只在用户正看着更新页时才重绘 */
  function refreshUpdateView() {
    const sub = st.stack[st.stack.length - 1];
    if (sub && sub.name === 'update') render();
  }

  /**
   * 静默检查更新。
   *
   * 一天最多提示一次；检查失败一声不吭——用户是来看行情的，
   * 不该被「更新源连不上」这种与他无关的事打断。
   */
  function silentUpdateCheck() {
    if (!YB.update || !YB.update.check) return;
    const last = U.store.get('updateNoticeAt', 0);
    if (Date.now() - last < 24 * 3600 * 1000) return;

    YB.update.check(false).then(function () {
      const sm = YB.update.summary();
      if (!sm.hasUpdate) return;
      U.store.set('updateNoticeAt', Date.now());
      UI.toast('有新版本 v' + sm.latest.versionName + '，设置 → 软件更新');
    }, function () { /* 静默 */ });
  }

  /* ---------------------------------------------------------
   * 启动
   * ------------------------------------------------------- */
  function boot() {
    U.Theme.init();

    const nav = document.createElement('nav');
    nav.className = 'tabbar';
    nav.innerHTML = TABS.map((t) =>
      '<button class="tab" data-tab="' + t.k + '">' + t.icon +
      '<span>' + t.n + '</span><span class="tab-dot"></span></button>').join('');
    document.body.appendChild(nav);

    bind();

    // 先把上次的快照铺上去：收盘后数据是定稿的，没必要让用户对着骨架屏等
    if (restoreSnapshot()) { render(); perfMark('snapshotPaint'); }
    perfMark('boot');

    render();
    loadMarket();
    loadPortfolio();

    // 启动后静默查一次更新。放在 8 秒后，不与首屏请求抢带宽；
    // 一天最多提示一次，没有更新就什么也不说。
    setTimeout(silentUpdateCheck, 8000);

    // 自动刷新：间隔可在「设置 → 高级」里改，用 1 秒 tick 判断更灵活
    let lastAuto = 0;
    setInterval(function () {
      // 收盘后补拉一次最终数据（涨停池定稿、收盘价），之后不再刷新
      if (maybeCloseRefresh()) return;

      if (!U.store.get('autoRefresh', true)) return;
      if (!U.isTrading()) return;
      const sec = (U.store.get('refreshSec', 30) || 30) * 1000;
      if (Date.now() - lastAuto < sec) return;
      if (st.tab === 'market') { lastAuto = Date.now(); loadMarket(); }
      else if (st.tab === 'portfolio') { lastAuto = Date.now(); loadPortfolio(); }
    }, 1000);

    // 主题切换后重绘图标颜色
    document.addEventListener('yb:theme', () => { /* CSS 变量自动生效 */ });

    // 供 Android 返回键调用：先退二级页，再回市场页，最后才退出
    window.__ybBack = function () {
      if (st.stack.length) {
        const top = st.stack[st.stack.length - 1];
        if (top.name === 'kline' && st.klineDetach) { st.klineDetach(); st.klineDetach = null; }
        st.stack.pop();
        render();
        return 'handled';
      }
      if (st.tab !== 'market') { switchTab('market'); return 'handled'; }
      return 'exit';
    };

    // 预热：后台静默拉一次，切到选股时不用等
    setTimeout(() => { if (!st.short) loadMarket(); }, 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  YB.app = { st, loadMarket, scanSwing, switchTab, saveSnapshot, restoreSnapshot, refreshLeader, openSector, openKline, refreshUpdateView };
})(window.YB);
