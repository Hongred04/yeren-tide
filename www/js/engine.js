/* ============================================================
 * 野人量化 · 核心模型
 *
 * 全部规则来自《全能野人交易方法完整总结》，注释中标注章节出处。
 * 模型分四层（对应文档「体系总纲」的三步 + 预期管理）：
 *   L1 情绪周期   → 择时，决定能不能做、该用多少仓位
 *   L2 量能资金   → 量在价先，判断资金真假
 *   L3 选股/买点  → 短线情绪流 + 波段月线流，两套池子
 *   L4 风控       → 试错仓、止损、黑名单，硬约束
 *
 * 免责：本模型为规则化归纳，非投资建议。
 * ============================================================ */
(function (YB) {
  'use strict';

  const U = YB.util;
  const { norm, clamp, num } = U;

  /* ==========================================================
   * L1 · 情绪周期引擎（文档第三章）
   * ========================================================== */

  /**
   * 七个分项，权重合计 1.00。每项先归一化到 [0,1]。
   * 归一化区间取自 A 股近年的常识分布，写在参数里便于调参。
   */
  const EMOTION_ITEMS = [
    { key: 'zt',      name: '涨停强度', w: 0.16, hint: '涨停家数' },
    { key: 'dt',      name: '跌停反向', w: 0.16, hint: '跌停家数' },
    { key: 'seal',    name: '封板率',   w: 0.12, hint: '封住/曾涨停' },
    { key: 'height',  name: '连板高度', w: 0.10, hint: '最高连板' },
    { key: 'volume',  name: '量能环比', w: 0.14, hint: '今日量/5日均量' },
    { key: 'breadth', name: '涨跌比',   w: 0.14, hint: '上涨家数占比' },
    { key: 'premium', name: '昨停溢价', w: 0.18, hint: '昨日涨停今日均涨' }
  ];

  /**
   * @param {Object} s 市场快照
   *  zt 涨停数 | dt 跌停数 | zb 炸板数 | maxBoard 最高连板
   *  up 上涨家数 | down 下跌家数 | volRatio 量能环比
   *  premium 昨日涨停今日平均涨幅(%) | advanceRate 晋级率
   */
  function emotion(s) {
    const zt = num(s.zt), dt = num(s.dt), zb = num(s.zb);
    const up = num(s.up), down = num(s.down);
    const sealTotal = zt + zb;
    const sealRate = sealTotal > 0 ? zt / sealTotal : 0.5;
    const upRatio = (up + down) > 0 ? up / (up + down) : 0.5;
    const volRatio = num(s.volRatio, 1);
    const premium = (s.premium == null || !isFinite(s.premium)) ? null : s.premium;

    const raw = {
      zt:      norm(zt, 12, 80),                 // 12家以下极冷，80家以上极热
      dt:      1 - norm(dt, 0, 22),              // 跌停越多越差
      seal:    norm(sealRate, 0.55, 0.88),       // 封板率 55%~88%
      height:  norm(num(s.maxBoard), 1, 8),      // 1板~8板
      volume:  norm(volRatio, 0.80, 1.25),       // 缩量~放量
      breadth: norm(upRatio, 0.30, 0.70),        // 上涨占比 30%~70%
      // 溢价：-3% 视为极差，+5% 视为极好；无数据时取中性 0.5
      premium: premium == null ? 0.5 : norm(premium, -3, 5)
    };

    const items = EMOTION_ITEMS.map((it) => ({
      key: it.key, name: it.name, hint: it.hint, weight: it.w,
      ratio: raw[it.key], score: raw[it.key] * it.w * 100
    }));

    const mes = clamp(Math.round(items.reduce((a, b) => a + b.score, 0)), 0, 100);

    /* --- 阶段判定（文档 3.3）---
     * 主升期不能只看分数：文档对主升的定义是「龙头回封、小弟批量助攻、中军启动」，
     * 对应到数据就是「涨多跌少的普涨」+「昨停还能溢价」。
     * 分数够但结构不支撑时，仍然按试错期对待（控制回撤优先）。
     */
    const broadStrong = upRatio >= 0.50 && (premium == null || premium > 0);
    // 冰点按「结构」判，不只看分数：文档说冰点是「情绪与指数双杀，核心股、情绪标都跌停」。
    // 跌停成堆 + 涨停稀少就是这个结构，分数偶尔卡在 32 附近不该被误判成试错期。
    const bloodbath = dt >= 12 && zt <= 25;
    let phase, phaseKey;
    if ((bloodbath && mes < 40) || (dt >= 12 && mes < 32)) { phase = '冰点期'; phaseKey = 'freeze'; }
    else if (mes < 30) { phase = '冰点修复'; phaseKey = 'thaw'; }
    else if (mes < 46) { phase = '试错期'; phaseKey = 'trial'; }
    else if (mes >= 74) { phase = '高潮期'; phaseKey = 'peak'; }
    else if (broadStrong) { phase = '主升期'; phaseKey = 'main'; }
    else { phase = '试错期(结构不足)'; phaseKey = 'trial'; }

    /* --- 退潮预警（文档 3.3 / 3.4）---
     * 「中军负反馈 → 龙头高位滞涨 → 中位股先杀 → 龙头补跌」
     * 用四个结构特征投票，命中 2 项即预警。
     */
    const retreatVotes = [];
    if (zt >= 25 && sealRate < 0.62) retreatVotes.push('涨停多但封不住');
    if (dt >= 8) retreatVotes.push('跌停抬头');
    if (zt >= 45 && num(s.maxBoard) <= 3) retreatVotes.push('高度被压制');
    if (premium != null && premium < 0) retreatVotes.push('昨停今日亏钱');
    const retreatRisk = retreatVotes.length;

    /* --- 高度天花板 ---
     * 取「今日最高板」与「近 5 日最高板峰值」的较大者：
     * 单日断板会把天花板看低，但资金记忆还在，所以要看近期峰值。
     */
    const maxBoardNow = num(s.maxBoard);
    const height5 = num(s.height5, maxBoardNow);
    const heightCap = Math.max(maxBoardNow, height5);
    const heightLabel = heightCap <= 2 ? '极度压制'
      : heightCap <= 3 ? '高度压制'
      : heightCap <= 5 ? '空间尚可' : '空间打开';
    const heightSuppressed = heightCap <= 3;

    /* 普涨但无高度：资金分散在低位轮动，短线反而最难做（11-19 复盘的盘面） */
    const wideButFlat = upRatio >= 0.60 && heightSuppressed;

    const base = POSITION_TABLE[phaseKey];
    let maxPos = base.max, firstPos = base.first;

    // 退潮预警直接压制仓位
    if (retreatRisk >= 2) {
      maxPos = Math.min(maxPos, 20);
      firstPos = Math.min(firstPos, 10);
    }
    if (retreatRisk >= 3) {
      maxPos = Math.min(maxPos, 10);
      firstPos = 0;
    }

    // 高度压制：短线没有参与价值，仓位再压一层
    if (heightCap <= 2) {
      maxPos = Math.min(maxPos, 10);
      firstPos = 0;
    } else if (heightCap <= 3) {
      maxPos = Math.min(maxPos, 20);
      firstPos = Math.min(firstPos, 10);
    }

    return {
      mes, items, phase, phaseKey,
      sealRate, upRatio, volRatio, premium,
      advanceRate: s.advanceRate,
      retreatRisk, retreatVotes,
      advice: PHASE_ADVICE[phaseKey],
      maxPosition: maxPos,
      firstPosition: firstPos,
      // 高度天花板
      heightCap, heightLabel, heightSuppressed, wideButFlat,
      todayBoard: maxBoardNow, heightPeak5: height5 > 0 ? height5 : null,
      heightAdvice: HEIGHT_ADVICE[heightLabel],
      inputs: { zt, dt, zb, up, down, maxBoard: maxBoardNow }
    };
  }

  /**
   * 高度天花板的分档与操作口径。
   * 来自文档 3.3/3.4 与 2026-11-19 复盘：
   * 「若老龙头无法打开上涨高度，下方接力资金会直接退潮，短线高度最多到 3 板，
   *   3 板以上就没有性价比，资金会停止参与。」
   * 「市场高度被压制在 2-3 板时，短线基本没有参与价值，此时只能聚焦龙头。」
   */
  const HEIGHT_ADVICE = {
    '极度压制': {
      title: '最高只有 2 板',
      text: '接力资金已退潮，短线没有参与价值。空仓观察，等有人把高度打出来。'
    },
    '高度压制': {
      title: '天花板在 3 板',
      text: '3 板以上没有性价比，资金会停止接力。要么只做绝对龙头，要么不做。'
    },
    '空间尚可': {
      title: '高度 4-5 板',
      text: '空间还在，但已接近天花板，只做龙一与中军，不做补涨。'
    },
    '空间打开': {
      title: '高度 6 板以上',
      text: '空间打开，可按主升逻辑参与，重点是龙头能否继续打开高度。'
    }
  };

  /** 各阶段仓位上限（%），文档 3.3 + 第八章 */
  const POSITION_TABLE = {
    freeze: { max: 0,  first: 0  },   // 冰点：空仓
    thaw:   { max: 10, first: 10 },   // 冰点后第3天：可10%试错
    trial:  { max: 20, first: 10 },   // 试错期：小仓反复试错
    main:   { max: 50, first: 20 },   // 主升确认：加重仓
    peak:   { max: 30, first: 10 }    // 高潮：不追高，边打边撤
  };

  const PHASE_ADVICE = {
    freeze: { title: '空仓等待', text: '情绪与指数双杀，核心股跌停才叫冰点。此时空仓，等新题材。' },
    thaw:   { title: '10% 试错', text: '冰点后第3天，等新题材，可用10%仓位试错。' },
    trial:  { title: '小仓试错', text: '只做新题材，反复试错，符合预期才加仓。' },
    main:   { title: '可加重仓', text: '龙头回封、小弟批量助攻、中军启动，确定性最高的一段。' },
    peak:   { title: '边打边撤', text: '高位只认一条：滞涨即风险。不加仓，只减仓。' }
  };

  /* ==========================================================
   * L1-B · 两市量能水位（文档 4.4 增量行情 vs 存量行情）
   *
   * 环比（量能比）只告诉你「今天比前几天多还是少」，
   * 不告诉你「这个量级本身够不够支撑指数」。这是两件事，都要看。
   *
   * 刻度基准：上证 3500-3600 点、两市流通市值约 88 万亿（2026-11）。
   * 换手率 = 成交额 / 流通市值，是比绝对金额更稳的口径；
   * 市值大幅变化后需要按换手率重新换算这张表。
   * ========================================================== */
  const VOLUME_BASE_CAP = 88e12;   // 两市流通市值基准（元），用于折算换手率

  const VOLUME_LEVELS = [
    {
      key: 'dry', label: '地量', max: 0.9e12,
      support: '不支撑',
      play: '存量极致，只有抱团核心能做，且只能短线，不做趋势'
    },
    {
      key: 'stock', label: '存量', max: 1.2e12,
      support: '不支撑',
      play: '零和博弈，资金被迫抱团。缩量震荡反而好做短线核心'
    },
    {
      key: 'mild', label: '温和', max: 1.5e12,
      support: '勉强支撑',
      play: '结构性行情，主线与题材并存，指数只能震荡不能走趋势'
    },
    {
      key: 'add', label: '增量', max: 2.0e12,
      support: '支撑趋势',
      play: '场外资金进场，普涨。情绪题材被瓦解，转做机构方向与大票'
    },
    {
      key: 'strong', label: '强势增量', max: Infinity,
      support: '支撑强势',
      play: '牛市级别的量。做中军与大票，短线性价比反而下降'
    }
  ];

  /**
   * @param {Number} turnover 两市成交额（元）
   * @param {Number} volRatio 今日成交量 / 近5日均量
   */
  function volumeRegime(turnover, volInfo) {
    const t = num(turnover);
    if (t <= 0) return null;

    // 第二参数兼容旧写法（传数字）与新写法（传统计对象）
    const info = (typeof volInfo === 'number') ? { volRatio: volInfo } : (volInfo || {});
    const vr = num(info.volRatio, 1);
    const downDays = num(info.downDays, 0);
    const peakDrawdown = num(info.peakDrawdown, 0);   // 负数：距近 10 日峰值的回撤
    const trend5 = num(info.trend5, 1);
    const ma = info.ma || {};
    const pct = info.pct || {};
    const slope = info.centerSlope;                    // 60 日均量相对 20 日前的变化
    const chg20 = info.priceChg20;                     // 指数近 20 日涨幅

    let lv = VOLUME_LEVELS[VOLUME_LEVELS.length - 1];
    for (let i = 0; i < VOLUME_LEVELS.length; i++) {
      if (t < VOLUME_LEVELS[i].max) { lv = VOLUME_LEVELS[i]; break; }
    }

    /* ---------- 1) 中枢：量能台阶在上移还是下移 ----------
     * 这是最容易被忽略、却最决定性质的维度。
     * 「今日比上周多 10%」在一个持续下移的中枢里毫无意义。
     */
    let centerKey, centerLabel, centerText;
    if (slope == null) {
      centerKey = 'unknown'; centerLabel = '中枢未知';
      centerText = '历史样本不足，无法判断量能中枢方向';
    } else if (slope <= -0.03) {
      centerKey = 'down'; centerLabel = '中枢下移';
      centerText = '60 日均量较 20 日前下降 ' + Math.abs(slope * 100).toFixed(0) +
        '%，量能台阶在下移——场外资金持续离场，这不是一两天的缩量';
    } else if (slope >= 0.03) {
      centerKey = 'up'; centerLabel = '中枢上移';
      centerText = '60 日均量较 20 日前上升 ' + (slope * 100).toFixed(0) +
        '%，增量资金在进场，属于可持续的量';
    } else {
      centerKey = 'flat'; centerLabel = '中枢走平';
      centerText = '60 日均量基本走平，存量资金博弈';
    }

    /* ---------- 2) 位置：今日量在长周期里的分位 ----------
     * 「量比 1.1」和「半年地量」可以是同一天，必须看分位。
     */
    const p120 = pct.p120;
    let posLabel = '';
    let posKey = 'mid';
    if (p120 != null) {
      if (p120 <= 0.25) { posKey = 'low'; posLabel = '地量区'; }
      else if (p120 <= 0.45) { posKey = 'lowmid'; posLabel = '偏低'; }
      else if (p120 >= 0.8) { posKey = 'high'; posLabel = '高位量'; }
      else if (p120 >= 0.6) { posKey = 'highmid'; posLabel = '偏高'; }
      else posLabel = '中位';
    }

    /* ---------- 3) 性质：量价配合 ----------
     * 用「20 日均量 ÷ 60 日均量」代表中期量能方向，「20 日涨幅」代表价格方向。
     * 只用当日量比会被单日脉冲骗，用 20 日才稳定。
     */
    /* 量能方向用「20 日均量 ÷ 120 日均量」——
       用 d20/d60 看不出半年缩量：两个窗口都包含下跌段，比值会互相抵消。
       d20/d120 直接回答「现在的量比半年前少多少」。 */
    const r2060 = (ma.d20 > 0 && ma.d120 > 0) ? ma.d20 / ma.d120
      : (ma.d20 > 0 && ma.d60 > 0) ? ma.d20 / ma.d60 : null;
    let natureKey, natureLabel, natureText;
    if (r2060 == null || chg20 == null) {
      natureKey = 'unknown'; natureLabel = '量价未知';
      natureText = '样本不足，暂不判断量价配合';
    } else {
      const volUp = r2060 >= 1.08;
      const volDown = r2060 <= 0.92;
      const priceUp = chg20 >= 1.5;
      const priceDown = chg20 <= -1.5;

      if (volDown && priceDown) {
        natureKey = 'shrinkDown'; natureLabel = '缩量下跌';
        natureText = '量能萎缩而指数下行，属阴跌：没有恐慌抛售，也没有资金接盘。' +
          '这种盘面只能等，等到放量下跌(赶底)或缩到地量后重新放量，才谈得上反转';
      } else if (volDown && priceUp) {
        natureKey = 'shrinkUp'; natureLabel = '缩量上涨';
        natureText = '指数在涨但量在缩，是无量反弹。没有增量资金，' +
          '持续性差，涨到压力位容易夭折';
      } else if (volUp && priceDown) {
        natureKey = 'expandDown'; natureLabel = '放量下跌';
        natureText = '放量下跌，说明有资金在出。可能是恐慌赶底，也可能是趋势破坏，' +
          '要看后续能否止跌——放量跌之后的第一根缩量阳线才是信号';
      } else if (volUp && priceUp) {
        natureKey = 'expandUp'; natureLabel = '放量上涨';
        natureText = '量价齐升，增量资金进场，这是唯一可以做趋势的组合';
      } else {
        natureKey = 'balance'; natureLabel = '量价平衡';
        natureText = '量能与指数变化都不显著，处于选择方向的僵持阶段';
      }
    }

    /* ---------- 4) 趋势标签：短周期方向 ---------- */
    let trendKey, trendLabel;
    if (peakDrawdown <= -0.15 || downDays >= 3 || trend5 <= 0.90) {
      trendKey = 'retreat'; trendLabel = '短线缩量';
    } else if (peakDrawdown <= -0.08 || downDays >= 2 || trend5 <= 0.95) {
      trendKey = 'weak'; trendLabel = '短线走弱';
    } else if (vr >= 1.12 || trend5 >= 1.08) {
      trendKey = 'expand'; trendLabel = '短线放量';
    } else {
      trendKey = 'flat'; trendLabel = '短线平稳';
    }

    /* 主标签：中枢方向比短线波动更重要，优先显示 */
    const mainLabel = centerKey === 'down' ? centerLabel
      : centerKey === 'up' ? centerLabel
      : (trendKey === 'retreat' || trendKey === 'weak') ? trendLabel : lv.label;

    /* 指数支撑：绝对量够 + 中枢不在下移 + 中期不是缩量下跌。
       中枢数据缺失时（样本不足）不能乐观——用短线趋势兜底，
       宁可判「不支撑」，也不要给一个没有依据的看多结论。 */
    const centerDown = centerKey === 'down' ||
      (centerKey === 'unknown' && (trendKey === 'retreat' || trendKey === 'weak'));
    const canSupportIndex = t >= 1.5e12 && !centerDown && natureKey !== 'shrinkDown';

    /* 打法指引：量价性质决定该做哪一类票，这是野人体系的核心结论 */
    let play;
    if (natureKey === 'shrinkDown') {
      play = '缩量阴跌：只能抱团做核心，越弱越要抱团，并缩短持股周期';
    } else if (natureKey === 'shrinkUp') {
      play = '无量反弹：不追高，反弹到压力位要减，等放量再谈趋势';
    } else if (natureKey === 'expandDown') {
      play = '放量下跌：等止跌信号（放量后的第一根缩量阳线），不抄底';
    } else if (natureKey === 'expandUp') {
      play = '量价齐升：做机构方向与大票，情绪短线性价比反而下降';
    } else if (lv.key === 'dry' || lv.key === 'stock') {
      play = vr <= 0.95
        ? '缩量存量：抱团取暖，只做短线核心，越弱越要抱团'
        : '存量放量：分歧加剧，拉高要防退潮，不追高';
    } else {
      play = lv.play;
    }

    /* ---------- 5) 一句话结论（复盘口径） ---------- */
    const parts = [];
    parts.push(centerText);
    if (p120 != null) {
      parts.push('今日量能处于近 120 日的 ' + Math.round(p120 * 100) + '% 分位（' + posLabel + '）');
    }
    parts.push(natureText);
    if (t < 1.5e12) {
      parts.push('距 1.5 万亿的支撑线还差 ' + Math.round((1.5e12 - t) / 1e8) + ' 亿');
    }
    const summary = parts.join('。');

    return {
      /* 水位 */
      turnover: t,
      yi: t / 1e8,
      level: lv.label,
      levelKey: lv.key,
      turnoverRate: t / VOLUME_BASE_CAP * 100,
      gapToSupport: t >= 1.5e12 ? 0 : (1.5e12 - t) / 1e8,
      canSupportIndex: canSupportIndex,
      support: canSupportIndex ? lv.support : '不支撑',

      /* 中枢 */
      center: { slope: slope, label: centerLabel, key: centerKey, text: centerText },

      /* 位置 */
      position: {
        p20: pct.p20, p60: pct.p60, p120: pct.p120,
        label: posLabel, key: posKey
      },

      /* 量价性质 */
      nature: { key: natureKey, label: natureLabel, text: natureText },

      /* 短周期 */
      trend: trendLabel,
      trendKey: trendKey,
      downDays: downDays,
      peakDrawdown: peakDrawdown,
      trend5: trend5,
      volRatio: vr,
      mainLabel: mainLabel,
      play: play,
      summary: summary,

      /* 明细（界面用） */
      ma: ma,
      monthly: info.monthly || [],
      priceChg20: chg20,
      priceChg60: info.priceChg60
    };
  }

  /* ==========================================================
   * L2 · 量能工具（文档第四章）
   * ========================================================== */

  function volMA(bars, n, offset) {
    const end = bars.length - (offset || 0);
    if (end < n) return 0;
    let sum = 0;
    for (let i = end - n; i < end; i++) sum += bars[i].vol;
    return sum / n;
  }

  function ma(bars, n) {
    if (bars.length < n) return 0;
    let s = 0;
    for (let i = bars.length - n; i < bars.length; i++) s += bars[i].close;
    return s / n;
  }

  /** 位置：当前价处于近 n 日高低区间的分位（0=最低 1=最高） */
  function position(bars, n) {
    const seg = bars.slice(-n);
    if (!seg.length) return 0.5;
    let hi = -Infinity, lo = Infinity;
    seg.forEach((b) => { if (b.high > hi) hi = b.high; if (b.low < lo) lo = b.low; });
    if (hi <= lo) return 0.5;
    return clamp((seg[seg.length - 1].close - lo) / (hi - lo), 0, 1);
  }

  /** 日线聚合成周线 / 月线；days 记录该周期内包含的交易日数 */
  function aggregate(bars, unit) {
    const out = [];
    let cur = null;
    const keyOf = (d) => {
      const dt = new Date(d.replace(/-/g, '/'));
      if (unit === 'month') return dt.getFullYear() + '-' + (dt.getMonth() + 1);
      if (unit === 'week') {
        const onejan = new Date(dt.getFullYear(), 0, 1);
        const week = Math.ceil(((dt - onejan) / 86400000 + onejan.getDay() + 1) / 7);
        return dt.getFullYear() + '-w' + week;
      }
      return d;
    };
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const k = keyOf(b.date);
      if (!cur || cur.k !== k) {
        cur = { k, date: b.date, open: b.open, close: b.close, high: b.high, low: b.low, vol: b.vol, days: 1 };
        out.push(cur);
      } else {
        cur.close = b.close;
        cur.high = Math.max(cur.high, b.high);
        cur.low = Math.min(cur.low, b.low);
        cur.vol += b.vol;
        cur.days += 1;
        cur.date = b.date;
      }
    }
    return out;
  }

  /* ==========================================================
   * L3-A · 短线情绪池（文档第五章 5.1）
   * ========================================================== */

  /** 板块分组 → 每个行业的涨停家数与内部排序 */
  function buildSectors(pool) {
    const map = {};
    pool.forEach((x) => {
      const k = x.industry || '其他';
      (map[k] = map[k] || []).push(x);
    });
    Object.keys(map).forEach((k) => {
      map[k].sort((a, b) => (b.boards - a.boards) || (b.sealAmount - a.sealAmount));
    });
    return map;
  }

  /** 主线榜：按涨停家数排序（文档 4.7「板块连续3天成交额居前」的当日代理） */
  function sectorRank(pool, topN) {
    const map = buildSectors(pool);
    return Object.keys(map).map((k) => {
      const arr = map[k];
      return {
        name: k,
        count: arr.length,
        maxBoards: arr.reduce((m, x) => Math.max(m, x.boards), 0),
        leader: arr[0],
        amount: arr.reduce((s, x) => s + (x.amount || 0), 0)
      };
    }).sort((a, b) => (b.count - a.count) || (b.maxBoards - a.maxBoards)).slice(0, topN || 10);
  }

  /**
   * 单只涨停股评分（满分 100）
   * 30 板块地位 + 22 连板高度 + 16 封单强度 + 14 市值适配 + 10 换手健康 + 8 封板时间
   */
  function scoreLimitUpStock(x, ctx, heightCap) {
    const cap = heightCap || 8;
    const sectorArr = ctx.sectors[x.industry] || [x];
    const sectorSize = sectorArr.length;
    const rank = sectorArr.indexOf(x);
    const maxBoards = ctx.sectorMax[x.industry] || x.boards;
    const maxFloat = ctx.sectorMaxFloat[x.industry] || x.floatCap;

    const parts = {};
    const tags = [];
    const flags = [];
    let veto = false;

    /* --- 板块地位 30（文档 5.1 第4步：只做龙一或中军） --- */
    let pos = 10;
    if (rank === 0 && sectorSize >= 2) { pos = 30; tags.push('龙一'); }
    else if (rank === 0) { pos = 14; tags.push('孤军'); }
    else if (sectorSize > 1 && x.boards === maxBoards) { pos = 24; tags.push('并列龙一'); }
    else if (x.floatCap >= 200e8 && sectorSize >= 3 && x.floatCap >= maxFloat) {
      pos = 22; tags.push('中军');           // 中军硬指标：辨识度 + 容量
    } else { pos = 9; tags.push('跟风'); }

    /* --- 连板高度 22 --- */
    const b = x.boards;
    const boardScore = b >= 5 ? 22 : b === 4 ? 20 : b === 3 ? 17 : b === 2 ? 12 : 5;

    /* --- 封单强度 16（封单额 / 流通市值） --- */
    const sealRatio = x.floatCap > 0 ? (x.sealAmount || 0) / x.floatCap : 0;
    const sealScore = sealRatio >= 0.06 ? 16 : sealRatio >= 0.025 ? 13 : sealRatio >= 0.01 ? 9 : sealRatio >= 0.003 ? 5 : 2;

    /* --- 市值适配 14（文档 5.3 大票优先 / 5.1 杂毛排除） --- */
    const capYi = x.floatCap / 1e8;
    const capScore = capYi >= 50 && capYi <= 300 ? 14
      : capYi > 300 && capYi <= 800 ? 11
      : capYi >= 20 && capYi < 50 ? 9
      : capYi > 800 ? 7 : 3;

    /* --- 换手健康 10 --- */
    const t = x.turnover || 0;
    const turnScore = t >= 3 && t <= 20 ? 10 : t > 20 && t <= 30 ? 7 : t >= 1 && t < 3 ? 6 : t > 30 ? 3 : 5;

    /* --- 封板时间 8（越早封板越强） --- */
    const fs = x.firstSeal || 0;
    const timeScore = fs > 0 && fs <= 93100 ? 8 : fs <= 103500 ? 6 : fs <= 113500 ? 4 : 2;

    /* --- 扣分 ---
     * 炸板惩罚不能线性累加：13 次 ×4 会把分数直接砸成 0，
     * 而且高换手下的反复开板属于分歧释放，不该按大盘股同等力度罚。
     */
    const zbcCount = x.breakTimes || 0;
    let penalty = Math.min(zbcCount * 4, 20);
    if (t >= 15) penalty = penalty * 0.5;
    if (zbcCount > 0) tags.push('炸板' + zbcCount + '次');

    if (b === 1) {
      // 首板仅限题材爆发日（文档 6.1-1 / 黑名单④）
      const sectorFirsts = sectorArr.filter((y) => y.boards === 1).length;
      if (sectorFirsts >= 3) tags.push('题材首板潮');
      else { tags.push('孤板'); flags.push('首板非爆发日（黑名单④）'); }
    }
    if (b === 2) flags.push('一进二（黑名单⑤，需回封确认）');
    if (b === 3) flags.push('二进三（黑名单⑤，需回封确认）');
    if (b >= 5) tags.push('高位区');

    /* --- 接力性价比（高度天花板）---
     * 天花板是多高，决定这一板还能不能接：
     *   剩余空间 0 → 已在天花板，必须破局才有意义
     *   超出天花板 → 无性价比，资金不会接力
     */
    const headroom = cap - b;
    let relay = 'ok', relayText = '';
    if (cap <= 3 && b >= 4) {
      relay = 'none'; relayText = '超出天花板，3 板以上无性价比';
    } else if (headroom < 0) {
      relay = 'none'; relayText = '已在天花板之外，接力风险极高';
    } else if (headroom === 0) {
      relay = 'ceiling'; relayText = '已到天花板，需破局才可参与';
    } else if (headroom === 1) {
      relay = 'thin'; relayText = '距天花板仅 1 板，性价比下降';
    }
    if (relay === 'none') { veto = true; flags.push(relayText); }
    else if (relay === 'ceiling') { flags.push(relayText); }
    else if (relay === 'thin') { flags.push(relayText); }

    /* --- 硬否决 --- */
    if (/ST/i.test(x.name)) { veto = true; flags.push('ST'); }
    if (/^(8|4|920)/.test(x.code)) { veto = true; flags.push('北交所'); }
    if (capYi < 20) { veto = true; flags.push('流通<20亿（杂毛）'); }
    if (b >= 6 && t > 35) { veto = true; flags.push('高位巨换手'); }
    // 反复炸板要分情况：小盘、低换手还炸多次是真弱；
    // 大盘巨量换手反复开板属于分歧释放，文档 6.1-3「炸板后再度回封」本身就是买点。
    const zbc = x.breakTimes || 0;
    if (zbc >= 6 && t < 20) { veto = true; flags.push('反复炸板且换手不足'); }
    else if (zbc >= 5) { tags.push('烂板回封'); }

    parts.sector = pos;
    parts.board = boardScore;
    parts.seal = sealScore;
    parts.cap = capScore;
    parts.turnover = turnScore;
    parts.time = timeScore;

    const rawScore = clamp(Math.round(
      pos + boardScore + sealScore + capScore + turnScore + timeScore - penalty), 0, 100);
    let score = veto ? Math.min(rawScore, 35) : rawScore;

    return {
      ...x,
      score, rawScore, parts, tags, flags, veto,
      rank: rank + 1,
      sectorSize,
      sealRatio,
      headroom, relay, relayText,
      sector: x.industry,
      grade: score >= 78 ? 'A' : score >= 62 ? 'B' : score >= 45 ? 'C' : 'D'
    };
  }

  /**
   * 绝对龙头识别（文档 5.1 第 3 步「审美」）
   *
   * 关键认知：龙头不等于连板最高的那只。
   * 2026-11-19 的实例——九阳股份只有 1 板，但成交额 51 亿、换手 23.7%，
   * 而当天 3 板的真视通成交额只有 0.6 亿。市场注意力在哪，龙头就在哪。
   *
   * 因此候选池要包含「未涨停的强势股」，权重也必须以人气为主导：
   *   人气 35（成交额，sqrt 压缩避免一只巨量票把其余归零）
   *   强度 25（当日涨幅，涨停封顶）
   *   活跃 15（换手率，20% 封顶）
   *   身位 15（连板数 / 天花板，降权——1 板也能拿分）
   *   板块 10（板块内成交额第一）
   *
   * 早期版本把身位给到 40 分、封单/流通市值给到 25 分，结果是
   * 小盘连板股永远压过真正的人气票，而且「封单/流通市值」本质衡量的是
   * 「盘子小容易封」，不是抢筹强度，对大盘股系统性不公。
   */
  function leaderParts(c, ctx) {
    const pop = Math.sqrt(Math.max(c.amount || 0, 0) / (ctx.maxAmount || 1)) * 35;
    const str = Math.min(Math.max(c.pct || 0, 0) / 10, 1) * 25;
    const act = Math.min(Math.max(c.turnover || 0, 0) / 20, 1) * 15;
    const pos = ctx.heightCap > 0
      ? Math.min((c.boards || 0) / ctx.heightCap, 1) * 15 : 0;
    const arr = ctx.bySector[c.industry || '其他'] || [];
    const sec = (arr.length && arr[0] === c) ? 10 : 4;
    return { pop: pop, str: str, act: act, pos: pos, sec: sec };
  }

  function pickLeader(candidates, opts) {
    if (!candidates || !candidates.length) return null;
    const o = opts || {};
    const heightCap = o.heightCap || 0;

    let maxAmount = 0;
    candidates.forEach(function (c) { if ((c.amount || 0) > maxAmount) maxAmount = c.amount; });
    if (maxAmount <= 0) maxAmount = 1;

    // 板块内按成交额排序，用于判断「板块第一」
    const bySector = {};
    candidates.forEach(function (c) {
      const k = c.industry || '其他';
      (bySector[k] = bySector[k] || []).push(c);
    });
    Object.keys(bySector).forEach(function (k) {
      bySector[k].sort(function (a, b) { return (b.amount || 0) - (a.amount || 0); });
    });

    const ctx = { maxAmount: maxAmount, heightCap: heightCap, bySector: bySector };

    let best = null;
    candidates.forEach(function (c) {
      const p = leaderParts(c, ctx);
      c.leaderScore = Math.round(p.pop + p.str + p.act + p.pos + p.sec);
      c.leaderParts = p;
      if (!best || c.leaderScore > best.leaderScore) best = c;
    });

    if (!best) return null;
    best.isLeader = true;
    return best;
  }

  /** 池内龙头度（全局龙头缺失时的回退方案） */
  function leaderScore(x, maxAmount, heightCap) {
    const p = leaderParts(x, { maxAmount: maxAmount, heightCap: heightCap, bySector: {} });
    return Math.round(p.pop + p.str + p.act + p.pos + 4);
  }

  /**
   * 板块内审美排序（文档 5.1 第 3 步「审美」）
   *
   * 板块内比的不只是分数，而是「辨识度」——同一板块里资金最先想到谁。
   * 五个维度都在板块内做相对比较，避免跨板块失真：
   *   身位 30  连板数 / 板块内最高板（板块内高标天然是焦点）
   *   人气 25  成交额，sqrt 压缩（板块内钱最多的地方）
   *   封单 20  封单额 / 流通市值（抢筹强度）
   *   时间 15  首封时间越早越强（9:30 前 15 分，收盘前只 3 分）
   *   换手 10  换手率 20% 封顶
   */
  function aesthetic(x, ctx) {
    const pos = ctx.maxBoards > 0
      ? Math.min((x.boards || 0) / ctx.maxBoards, 1) * 30 : 0;
    const pop = ctx.maxAmount > 0
      ? Math.sqrt(Math.max(x.amount || 0, 0) / ctx.maxAmount) * 25 : 0;
    const seal = Math.min(Math.max(x.sealRatio || 0, 0) / 0.06, 1) * 20;
    const turn = Math.min(Math.max(x.turnover || 0, 0) / 20, 1) * 10;

    const t = x.firstSeal || 0;
    const mins = Math.floor(t / 10000) * 60 + Math.floor((t % 10000) / 100);
    const time = (mins && mins <= 570) ? 15
      : (mins && mins <= 600) ? 11
      : (mins && mins <= 690) ? 7 : 3;

    return {
      total: Math.round(pos + pop + seal + turn + time),
      parts: { pos: pos, pop: pop, seal: seal, time: time, turn: turn }
    };
  }

  /** 审美等级 */
  function aestheticGrade(v) {
    if (v >= 80) return 'S';
    if (v >= 65) return 'A';
    if (v >= 50) return 'B';
    return 'C';
  }

  /**
   * 某个板块的成员明细，按审美分降序。
   * @param {String} name 板块名
   * @param {Array}  pool 已评分的短线池（含 sealRatio / boards / amount）
   */
  function sectorDetail(name, pool, extra) {
    const seen = {};
    const arr = [];
    (pool || []).forEach(function (x) {
      if ((x.industry || '其他') !== name) return;
      seen[x.code] = 1;
      arr.push(x);
    });

    // 补充当日强势但未涨停的同板块个股。
    // 板块的强势不该只由涨停的那几只代表，没封板但放量大涨的同样是资金焦点，
    // 只是审美分里身位、封单两项为 0，自然排在涨停股后面。
    (extra || []).forEach(function (x) {
      if (!x || !x.code || seen[x.code]) return;
      if ((x.industry || '其他') !== name) return;
      if (!(x.pct > 0)) return;
      seen[x.code] = 1;
      arr.push(Object.assign({}, x, {
        boards: 0, breakTimes: 0, sealAmount: 0, sealRatio: 0,
        firstSeal: 0, inPool: false
      }));
    });

    if (!arr.length) return null;

    let maxBoards = 0, maxAmount = 0;
    arr.forEach(function (x) {
      if ((x.boards || 0) > maxBoards) maxBoards = x.boards;
      if ((x.amount || 0) > maxAmount) maxAmount = x.amount;
    });
    const ctx = { maxBoards: maxBoards, maxAmount: maxAmount || 1 };

    const list = arr.map(function (x) {
      const a = aesthetic(x, ctx);
      return Object.assign({}, x, {
        aes: a.total, aesParts: a.parts, aesGrade: aestheticGrade(a.total)
      });
    }).sort(function (p, q) { return q.aes - p.aes; });

    return {
      name: name,
      count: arr.length,
      limitUpCount: arr.filter(function (x) { return (x.boards || 0) > 0; }).length,
      maxBoards: maxBoards,
      amount: arr.reduce(function (s, x) { return s + (x.amount || 0); }, 0),
      sealTotal: arr.reduce(function (s, x) { return s + (x.sealAmount || 0); }, 0),
      list: list
    };
  }

  /** 整个短线池 */
  function shortPool(pool, opts) {
    if (!pool || !pool.length) {
      return { list: [], sectors: [], heightCap: 0, leader: null, focusOnly: false };
    }
    const o = opts || {};
    const heightCap = o.heightCap != null ? o.heightCap
      : pool.reduce(function (m, x) { return Math.max(m, x.boards); }, 0);

    const sectors = buildSectors(pool);
    const sectorMax = {}, sectorMaxFloat = {};
    Object.keys(sectors).forEach(function (k) {
      sectorMax[k] = sectors[k].reduce(function (m, x) { return Math.max(m, x.boards); }, 0);
      sectorMaxFloat[k] = sectors[k].reduce(function (m, x) { return Math.max(m, x.floatCap); }, 0);
    });
    const ctx = { sectors: sectors, sectorMax: sectorMax, sectorMaxFloat: sectorMaxFloat };

    const list = pool.map(function (x) { return scoreLimitUpStock(x, ctx, heightCap); });
    list.sort(function (a, b) {
      return (Number(a.veto) - Number(b.veto)) || (b.score - a.score);
    });

    /* 龙头：优先用全局识别结果（它可能根本不在涨停池里），
       没有就退回池内选一只。 */
    let leader = null;
    if (o.leader) {
      list.forEach(function (x) {
        if (x.code === o.leader.code) {
          x.isLeader = true;
          x.leaderScore = o.leader.leaderScore;
          x.tags.unshift('绝对龙头');
          leader = x;
        }
      });
    }
    if (!leader) {
      let maxAmount = 0;
      list.forEach(function (x) { if ((x.amount || 0) > maxAmount) maxAmount = x.amount; });
      list.forEach(function (x) { x.leaderScore = leaderScore(x, maxAmount, heightCap); });
      list.forEach(function (x) {
        if (!x.veto && (!leader || x.leaderScore > leader.leaderScore)) leader = x;
      });
      if (leader) {
        leader.isLeader = true;
        leader.tags.unshift('绝对龙头');
      }
    }

    /* 龙头豁免：龙头是全局识别的，不该被池内的封板质量规则否决。
       文档 6.1-3 把「烂板 → 次日弱转强 → 再度回封」列为买点，
       所以烂板龙头保留在视野里，只是把风险标出来。 */
    if (leader && leader.veto) {
      leader.veto = false;
      leader.score = leader.rawScore;
      leader.flags.push('封板质量差，但为当前龙头，按回封/弱转强逻辑跟踪');
    }

    // 龙头排最前，其次按评分
    list.sort(function (a, b) {
      return (Number(a.veto) - Number(b.veto)) ||
        (Number(!!b.isLeader) - Number(!!a.isLeader)) ||
        (b.score - a.score);
    });

    // 高度压制时，除龙头外一律降级为「只观察」
    const focusOnly = heightCap <= 3;
    if (focusOnly) {
      list.forEach(function (x) {
        if (x !== leader && !x.veto) {
          x.focusOnly = true;
          x.flags.push('非龙头，当前高度下无参与价值');
        }
      });
    }

    return {
      list: list, sectors: sectorRank(pool, 10),
      heightCap: heightCap, leader: leader, focusOnly: focusOnly
    };
  }

  /* ==========================================================
   * L3-B · 波段资金池（文档 5.2 / 4.10 月线选股法）
   * ========================================================== */

  /**
   * 月线：连续 4-5 个月放量（红量柱），累计涨幅 ≤ 50%
   * 周线：上升趋势
   * 日线：前有涨停 → 缩量到极致 → 买阴线
   */
  function analyzeSwing(bars) {
    if (!bars || bars.length < 120) return null;

    const months = aggregate(bars, 'month');
    const weeks = aggregate(bars, 'week');

    /* --- 月线堆量 ---
     * 关键：用「月均日成交量」而不是「月总成交量」做比较。
     * 当月是不完整月份，总成交量天然只有零头，直接比总量会永远判为缩量。
     */
    const avgDaily = (m) => (m.days > 0 ? m.vol / m.days : 0);
    const mMeta = months.map((m, i) => {
      const hist = months.slice(Math.max(0, i - 12), i);
      const avgHist = hist.length
        ? hist.reduce((s, x) => s + avgDaily(x), 0) / hist.length
        : avgDaily(m);
      return {
        volRatio: avgHist > 0 ? avgDaily(m) / avgHist : 1,
        red: m.close >= m.open,
        close: m.close
      };
    });
    // 从最近月份往前数，连续满足「放量 + 红柱」的月数
    // 当月常常只有几个交易日（甚至只有今天一根），若今天是阴线会把整个当月判成绿柱，
    // 导致堆量永远数不出来。样本不足 12 个交易日时，从上一个完整月开始数。
    let endIdx = mMeta.length - 1;
    if (months[endIdx] && months[endIdx].days < 12 && endIdx > 0) endIdx--;
    let heapMonths = 0;
    for (let i = endIdx; i >= Math.max(0, endIdx - 5); i--) {
      if (mMeta[i].volRatio >= 1.15 && mMeta[i].red) heapMonths++;
      else break;
    }
    const monthSpan = months.slice(-6);
    const gather = monthSpan.length >= 2
      ? (monthSpan[monthSpan.length - 1].close / monthSpan[0].close - 1) * 100 : 0;

    // 「翻倍的不看」：光看 6 个月会漏掉 18 个月涨了 3 倍的老票，补一条 250 日涨幅上限
    const gain250 = bars.length > 250
      ? (bars[bars.length - 1].close / bars[bars.length - 251].close - 1) * 100
      : (bars.length > 2 ? (bars[bars.length - 1].close / bars[0].close - 1) * 100 : 0);

    /* --- 周线趋势 --- */
    const wc = weeks.map((w) => w.close);
    const wMA = (n) => {
      if (wc.length < n) return 0;
      return wc.slice(-n).reduce((a, b) => a + b, 0) / n;
    };
    const w5 = wMA(5), w10 = wMA(10), w20 = wMA(20);
    const w5prev = wc.length >= 6 ? wc.slice(-6, -1).reduce((a, b) => a + b, 0) / 5 : w5;
    const weekUp = w5 > w10 && w5 > w5prev * 0.995 && (w20 === 0 || wc[wc.length - 1] > w20 * 0.97);

    /* --- 日线 --- */
    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2] || last;
    const todayPct = prev.close > 0 ? (last.close / prev.close - 1) * 100 : 0;
    const ma5 = ma(bars, 5), ma10 = ma(bars, 10), ma20 = ma(bars, 20), ma60 = ma(bars, 60);
    const ma20prev = bars.length >= 23
      ? bars.slice(0, -3).slice(-20).reduce((s, b) => s + b.close, 0) / 20 : ma20;
    const ma20Up = ma20 > ma20prev;                       // 20日线拐头向上（文档 6.2 条件③）
    const v5 = volMA(bars, 5), v10 = volMA(bars, 10);
    const volShrink = v5 > 0 ? last.vol / v5 : 1;         // 今日量 / 5日均量
    const isYin = last.close < last.open;

    // 近 20 日内是否有涨停（文档 5.2「日线：前面有涨停」）
    let limitUpDays = 0, lastLimitIdx = -1;
    for (let i = Math.max(1, bars.length - 20); i < bars.length; i++) {
      const chg = (bars[i].close / bars[i - 1].close - 1) * 100;
      if (chg >= 9.5) { limitUpDays++; lastLimitIdx = i; }
    }

    // 近 60 日是否放量突破过
    const pos60 = position(bars, 60);
    const pos250 = position(bars, 250);

    /* --- 综合判定 --- */
    const conditions = {
      heap: heapMonths >= 4 && gather <= 50 && gain250 <= 100,  // 连续放量 + 涨幅未翻倍
      weekUp: weekUp,                                // 周线上升
      ma20Up: ma20Up,                                // 20日线拐头
      bull: ma5 > ma10 && ma10 > ma20,               // 多头排列
      hasLimitUp: limitUpDays > 0,                   // 前有涨停
      shrink: volShrink <= 0.75,                     // 缩量到极致
      yin: isYin,                                    // 买阴不买阳
      // 文档要求「必须在底部，不能是高位」。但价格若已连涨 4-5 个月，
      // 250 日分位天然接近 1，用分位会跟「周线上升」自相矛盾。
      // 改成：6 个月涨幅≤50% 且离 60 日线不超过 35%（涨太多就不是买点了）。
      notHigh: gather <= 50 && (ma60 > 0 ? last.close / ma60 - 1 : 0) < 0.35,
      // 文档 4.5：缩量下跌是「没人接、集体装死」，不是买点。
      // 回踩当天跌幅过大说明是破位而非洗盘，必须排除。
      steady: todayPct > -5,                         // 回踩当日不能是大阴破位
      aboveMa20: last.close > ma20 * 0.985           // 踩到20日线附近但不破
    };

    let score = 0;
    if (conditions.heap) score += 26;
    else if (heapMonths >= 3) score += 14;
    if (conditions.weekUp) score += 18;
    if (conditions.ma20Up) score += 14;
    if (conditions.bull) score += 10;
    if (conditions.hasLimitUp) score += 12;
    if (conditions.shrink) score += 10;
    if (conditions.yin) score += 6;
    if (conditions.notHigh) score += 8;
    else score -= 12;
    if (gather > 50) score -= 14;                     // 翻倍的不看
    if (!conditions.steady) score -= 18;              // 破位大阴，直接压分

    const buyReady = conditions.shrink && conditions.yin && conditions.hasLimitUp &&
      conditions.ma20Up && conditions.steady && conditions.aboveMa20 && conditions.notHigh;

    return {
      months, weeks, bars,
      heapMonths, gather, gain250, ma5, ma10, ma20, ma60, ma20Up,
      volShrink, isYin, limitUpDays, pos60, pos250, weekUp, todayPct,
      conditions, buyReady,
      score: clamp(Math.round(score), 0, 100),
      grade: score >= 70 && buyReady ? 'A' : score >= 60 ? 'B' : score >= 45 ? 'C' : 'D'
    };
  }

  /* ==========================================================
   * L3-C · 买点识别（文档第六章）
   * ========================================================== */

  function detectSignals(bars, ctx) {
    const out = [];
    if (!bars || bars.length < 30) return out;
    const n = bars.length;
    const last = bars[n - 1], prev = bars[n - 2], prev2 = bars[n - 3];
    const pct = (a, b) => (b > 0 ? (a / b - 1) * 100 : 0);
    const v5 = volMA(bars, 5), v5prev = volMA(bars, 5, 1);
    const ma20 = ma(bars, 20);
    const pos60 = position(bars, 60);

    /* 1) 分歧转一致（文档 6.1-2，首选买点）
     * 分歧日放巨量 → 次日缩量到一半以下转一致 */
    if (prev2 && prev2.vol > 0 && prev.vol > v5prev * 1.6 && last.vol < prev.vol * 0.55 &&
        last.close > prev.close) {
      const ratio = last.vol / prev.vol;
      out.push({
        type: '分歧转一致', level: 'buy', stars: 3,
        desc: '前日放量释放分歧，今日缩量至 ' + (ratio * 100).toFixed(0) + '% 转一致' +
              (ratio <= 0.4 ? '，缩量极充分' : ''),
        note: '若次日量能再超分歧日，则筹码锁不住，需减仓'
      });
    }

    /* 2) 低位首个放量涨停（文档 4.3 / 4.8）
     * 「低位」用 250 日分位判断：用 60 日会把「涨停把价格顶到 60 日新高」误判成高位。 */
    const chgLast = pct(last.close, prev.close);
    const pos250 = position(bars, 250);
    if (chgLast >= 9.5 && last.vol > v5 * 2 && pos250 < 0.6) {
      out.push({
        type: '低位放量涨停', level: 'buy', stars: 3,
        desc: '低位放量涨停，量能为5日均量 ' + (last.vol / v5).toFixed(1) + ' 倍，资金异动',
        note: '只在低位有效；高位放量涨停是出货'
      });
    }

    /* 3) 缩量回踩不破（文档 4.8 / 6.2 第二买点） */
    if (last.vol < v5 * 0.7 && last.close < last.open &&
        last.close > ma20 * 0.97 && ctx && ctx.hasLimitUp20) {
      out.push({
        type: '缩量回踩阴线', level: 'buy', stars: 2,
        desc: '缩量至5日均量 ' + (last.vol / v5 * 100).toFixed(0) + '%，收阴不破20日线',
        note: '买阴不买阳，等待启动（历史平均约12天）'
      });
    }

    /* 4) 龙头首阴（文档 6.1-5） */
    const gain20 = bars.length > 21 ? pct(last.close, bars[n - 21].close) : 0;
    if (gain20 > 40 && last.close < last.open && prev.close > prev.open && last.vol > v5 * 1.2) {
      out.push({
        type: '龙头首阴', level: 'buy', stars: 2,
        desc: '20日涨幅 ' + gain20.toFixed(0) + '% 后首根放量阴线',
        note: '只做隔日套利，不论盈亏次日走'
      });
    }

    /* 5) 放量滞涨 / 破位（卖出，文档 4.3 / 七） */
    if (pos60 > 0.9 && last.vol > v5 * 1.8 && Math.abs(chgLast) < 2.5) {
      out.push({
        type: '高位放量滞涨', level: 'risk', stars: 3,
        desc: '接近60日高点且放巨量不涨，量能 ' + (last.vol / v5).toFixed(1) + ' 倍',
        note: '头顶三炷香，不死也受伤 —— 清仓'
      });
    }
    if (last.close < ma20 && ma20 < (bars.slice(0, -3).slice(-20).reduce((s, b) => s + b.close, 0) / 20)) {
      out.push({
        type: '跌破20日线', level: 'risk', stars: 2,
        desc: '价格跌破且20日线走平向下',
        note: '破位立即走，不等反抽'
      });
    }

    return out;
  }

  /* ==========================================================
   * 筹码分布
   *
   * 原理：每日成交的筹码按价格区间铺开，历史筹码按换手率逐日衰减。
   * 换手越充分，旧筹码被替换得越快，分布越集中在近期成交区。
   *
   * 局限（必须说清楚）：腾讯日 K 不提供历史换手率，这里用「当日量 ÷ 20 日均量」
   * 估计相对活跃度，再映射到 0.5%~12% 的换手区间。因此绝对数值仅供参照，
   * 形状（峰在哪、获利盘多少、集中度）是可信的。
   * ========================================================== */

  /**
   * @param {Array}  bars  日 K（升序）
   * @param {Object} opts  { bins, price, window, maxTurnover }
   */
  function computeChips(bars, opts) {
    const o = opts || {};
    if (!bars || bars.length < 20) return null;

    const win = Math.min(o.window || 150, bars.length);
    const seg = bars.slice(-win);
    const bins = o.bins || 96;

    let lo = Infinity, hi = -Infinity;
    seg.forEach(function (b) {
      if (b.low < lo) lo = b.low;
      if (b.high > hi) hi = b.high;
    });
    if (!(hi > lo)) return null;

    // 上下各留 3% 余量，避免峰贴着边缘
    const pad = (hi - lo) * 0.03;
    lo -= pad; hi += pad;

    const step = (hi - lo) / bins;
    const chips = new Float64Array(bins);
    const idxOf = function (p) {
      const i = Math.floor((p - lo) / step);
      return Math.max(0, Math.min(bins - 1, i));
    };

    // 流通股本（股），用于把成交量换算成换手率；拿不到则退回相对估算
    const floatShares = o.floatShares > 0 ? o.floatShares : 0;

    // 相对活跃度基准（仅在没有流通股本时使用）
    const vol20 = seg.slice(-20).reduce(function (s2, b) { return s2 + (b.vol || 0); }, 0) / 20 || 1;

    seg.forEach(function (b) {
      const vol = b.vol || 0;
      if (vol <= 0) return;

      /* 换手率：优先用「成交量 ÷ 流通股本」真实计算。
         这点很关键——用「相对 20 日均量 × 3%」估出来的换手率会系统性偏低：
         九阳近期日换手实际 20%，相对估算法只给 3%，导致半年低位的筹码
         衰减不掉，平均成本和集中度全错。
         拿不到流通股本时才退回相对估算。 */
      let tr;
      if (floatShares > 0) {
        tr = Math.min(45, Math.max(0.05, (vol * 100) / floatShares * 100)) / 100;
      } else {
        const rel = vol / vol20;
        tr = Math.min(12, Math.max(1.5, rel * 3)) / 100;
      }

      // 旧筹码衰减
      const decay = 1 - tr;
      for (let i = 0; i < bins; i++) chips[i] *= decay;

      /* 新增筹码：在 [low, high] 内按三角形分布，峰值在当日均价附近。
         通达信等软件的通行做法——成交密集在中间价位，两端稀少。 */
      const peak = (b.high + b.low + 2 * b.close) / 4;
      const halfSpan = Math.max((b.high - b.low) / 2, hi - lo <= 0 ? 0.01 : step * 0.5);
      const iLo = idxOf(b.low), iHi = idxOf(b.high);

      let wSum = 0;
      const w = [];
      for (let i = iLo; i <= iHi; i++) {
        const priceC = lo + (i + 0.5) * step;
        const d = Math.abs(priceC - peak) / halfSpan;
        const weight = Math.max(0, 1 - d);
        w.push(weight);
        wSum += weight;
      }
      if (wSum <= 0) {
        // 一字板等极端情况：全部堆在收盘价
        chips[idxOf(b.close)] += vol;
      } else {
        for (let k = 0; k < w.length; k++) {
          chips[iLo + k] += vol * (w[k] / wSum);
        }
      }
    });

    const total = chips.reduce(function (a, b) { return a + b; }, 0);
    if (!(total > 0)) return null;

    const price = o.price > 0 ? o.price : seg[seg.length - 1].close;

    /* 获利比例：成本低于现价的筹码占比 */
    let below = 0;
    for (let i = 0; i < bins; i++) {
      const pc = lo + (i + 0.5) * step;
      if (pc <= price) below += chips[i];
    }
    const profitRatio = below / total;

    /* 平均成本 */
    let wsum = 0;
    for (let i = 0; i < bins; i++) wsum += (lo + (i + 0.5) * step) * chips[i];
    const avgCost = wsum / total;

    /* 90% 成本区间（5% 与 95% 分位） */
    const target5 = total * 0.05, target95 = total * 0.95;
    let cum = 0, p5 = null, p95 = null;
    for (let i = 0; i < bins; i++) {
      cum += chips[i];
      if (p5 == null && cum >= target5) p5 = lo + (i + 0.5) * step;
      if (p95 == null && cum >= target95) { p95 = lo + (i + 0.5) * step; break; }
    }
    if (p5 == null) p5 = lo;
    if (p95 == null) p95 = hi;

    /* 集中度：(上-下)/(上+下)，越小越集中 */
    const concentration = (p95 + p5) > 0 ? (p95 - p5) / (p95 + p5) * 100 : null;

    /* 筹码峰：密度最高的价位 */
    let peakIdx = 0;
    for (let i = 1; i < bins; i++) if (chips[i] > chips[peakIdx]) peakIdx = i;
    const peakPrice = lo + (peakIdx + 0.5) * step;

    const dist = [];
    for (let i = 0; i < bins; i++) {
      dist.push({
        price: +(lo + (i + 0.5) * step).toFixed(2),
        qty: chips[i],
        ratio: chips[i] / total
      });
    }

    return {
      dist: dist,
      lo: lo, hi: hi, step: step,
      price: price,
      profitRatio: profitRatio,
      avgCost: avgCost,
      p5: p5, p95: p95,
      concentration: concentration,
      peakPrice: peakPrice,
      window: win,
      // 现价相对平均成本的位置，与「偏离成本」口径一致
      devFromAvg: (price / avgCost - 1) * 100
    };
  }

  /* ==========================================================
   * 个股深度分析
   *
   * 个股页的价值不在「把图放大」，而在回答四个问题：
   *   能不能买 / 买多少 / 亏在哪 / 凭什么
   * 下面每个字段都必须能直接落到某个动作上，不做纯展示性指标。
   * ========================================================== */

  /** 该代码的涨停阈值（%）：主板 10 / 创业板科创板 20 / 北交所 30 */
  function limitThreshold(code) {
    const c = String(code || '').replace(/\D/g, '');
    if (/^(30|688)/.test(c)) return 19.5;
    if (/^(8|4|920)/.test(c)) return 29.5;
    return 9.5;
  }

  /**
   * 涨停基因：这只票历史上被资金认可的程度。
   *
   * 接力交易的本质是赌次日溢价，而「次日溢价」在个股层面差异极大——
   * 有的票涨停后次日平均 +3%，有的 -2%。这个差异比任何技术形态都重要，
   * 却是通用行情软件不会直接给你的。
   *
   * 统计窗口默认 250 根日线（约一年）。
   */
  function limitUpGene(bars, code, window) {
    const n = bars.length;
    const win = Math.min(window || 250, n - 2);
    if (win < 20) return null;

    const th = limitThreshold(code);
    const start = n - win;
    let count = 0;
    let nextSum = 0, nextCnt = 0, nextUp = 0, nextLimit = 0;
    let lastIdx = -1;

    // 最后一根也要计入「涨停次数」与「最近涨停」——今天涨停是既成事实；
    // 但它没有次日，所以不参与次日溢价的统计。
    for (let i = Math.max(1, start); i < n; i++) {
      const prev = bars[i - 1].close;
      if (prev <= 0) continue;
      const p = (bars[i].close / prev - 1) * 100;
      if (p < th) continue;

      count++;
      lastIdx = i;

      if (i >= n - 1) continue;   // 今天涨停，次日数据尚未产生

      const nNext = (bars[i + 1].close / bars[i].close - 1) * 100;
      nextSum += nNext;
      nextCnt++;
      if (nNext > 0) nextUp++;
      if (nNext >= th) nextLimit++;
    }

    if (!count) {
      return {
        count: 0, window: win, threshold: th,
        avgNext: null, premiumRate: null, continueRate: null,
        lastDaysAgo: null,
        verdict: '一年内没有涨停，资金不认可，不适合接力'
      };
    }

    const avgNext = nextCnt ? nextSum / nextCnt : null;
    const premiumRate = nextCnt ? nextUp / nextCnt : null;
    const continueRate = nextCnt ? nextLimit / nextCnt : null;
    const lastDaysAgo = n - 1 - lastIdx;

    // 结论：把两个最关键的数（次日均值、溢价率）折成一句可执行的话
    let verdict;
    if (avgNext >= 2 && premiumRate >= 0.6) {
      verdict = '接力成功率高的品种，次日溢价稳定';
    } else if (avgNext >= 0 && premiumRate >= 0.45) {
      verdict = '中性，接力看当天盘口，不能盲打';
    } else {
      verdict = '涨停后次日普遍不给溢价，接力性价比差';
    }

    return {
      count: count, window: win, threshold: th,
      avgNext: avgNext, premiumRate: premiumRate, continueRate: continueRate,
      lastDaysAgo: lastDaysAgo, verdict: verdict
    };
  }

  /** 成交额加权均价（主力成本估算），近 n 根 */
  function vwap(bars, n) {
    const seg = bars.slice(-n);
    let pv = 0, v = 0;
    seg.forEach(function (b) {
      const vol = b.vol || 0;
      pv += b.close * vol;
      v += vol;
    });
    return v > 0 ? pv / v : null;
  }

  /**
   * 技术位：压力与支撑。
   * 短线只在「离压力远、离支撑近」的位置介入，其余都是接刀子。
   */
  function techLevels(bars, price) {
    const n = bars.length;
    if (n < 20) return null;
    const p = price > 0 ? price : bars[n - 1].close;

    const seg20 = bars.slice(-20), seg60 = bars.slice(-60);
    const hi60 = Math.max.apply(null, seg60.map(function (b) { return b.high; }));
    const lo20 = Math.min.apply(null, seg20.map(function (b) { return b.low; }));
    const ma5 = ma(bars, 5), ma10 = ma(bars, 10), ma20 = ma(bars, 20), ma60 = ma(bars, 60);

    // 压力取「前高」与「上方最近的均线」中较近的
    const resCandidates = [];
    if (hi60 > p) resCandidates.push(hi60);
    [ma5, ma10, ma20, ma60].forEach(function (m) {
      if (m && m > p) resCandidates.push(m);
    });
    const resistance = resCandidates.length ? Math.min.apply(null, resCandidates) : null;

    // 支撑取「近 20 日低点」与「下方最近的均线」中较近的
    const supCandidates = [];
    if (lo20 < p) supCandidates.push(lo20);
    [ma5, ma10, ma20, ma60].forEach(function (m) {
      if (m && m < p) supCandidates.push(m);
    });
    const support = supCandidates.length ? Math.max.apply(null, supCandidates) : null;

    let align = '纠缠';
    if (ma5 && ma10 && ma20) {
      if (ma5 > ma10 && ma10 > ma20) align = '多头排列';
      else if (ma5 < ma10 && ma10 < ma20) align = '空头排列';
    }

    return {
      ma5: ma5, ma10: ma10, ma20: ma20, ma60: ma60,
      align: align,
      resistance: resistance,
      support: support,
      toResistance: resistance ? (resistance / p - 1) * 100 : null,
      toSupport: support ? (support / p - 1) * 100 : null,
      aboveMa20: ma20 ? (p / ma20 - 1) * 100 : null
    };
  }

  /** 相对强弱：个股近 N 日涨幅 vs 指数同期涨幅 */
  function relStrength(bars, indexBars, n) {
    const win = n || 20;
    if (!bars || !indexBars || bars.length <= win || indexBars.length <= win) return null;
    const s0 = bars[bars.length - 1 - win].close;
    const s1 = bars[bars.length - 1].close;
    const i0 = indexBars[indexBars.length - 1 - win].close;
    const i1 = indexBars[indexBars.length - 1].close;
    if (!(s0 > 0) || !(i0 > 0)) return null;
    const sr = (s1 / s0 - 1) * 100;
    const ir = (i1 / i0 - 1) * 100;
    const rs = (1 + sr / 100) / (1 + ir / 100);
    return {
      stockReturn: sr, indexReturn: ir, rs: rs,
      label: rs >= 1.05 ? '强于大盘' : rs <= 0.95 ? '弱于大盘' : '与大盘同步'
    };
  }

  /**
   * 个股综合评估。纯函数，不依赖网络，便于单测。
   *
   * @param {Array}  bars   日 K（升序，最后一根是当日）
   * @param {Object} quote  实时报价（可空）
   * @param {Object} ctx    { code, indexBars, emotion, poolItem, sectorInfo, isLeader,
   *                          capital, stopPct, phaseKey }
   */
  function analyzeStock(bars, quote, ctx) {
    const c = ctx || {};
    const q = quote || {};
    if (!bars || bars.length < 20) return null;

    const last = bars[bars.length - 1];
    const price = q.price > 0 ? q.price : last.close;
    const n = bars.length;

    /* ---- 位置 ---- */
    const v60 = vwap(bars, 60);
    const v20 = vwap(bars, 20);
    const pos60 = position(bars, 60);
    const pos250 = position(bars, 250);
    const vol5 = bars.slice(-5).reduce(function (s, b) { return s + (b.vol || 0); }, 0) / 5;
    const vol20 = bars.slice(-20).reduce(function (s, b) { return s + (b.vol || 0); }, 0) / 20;
    const vol60 = bars.slice(-60).reduce(function (s, b) { return s + (b.vol || 0); }, 0) / 60;
    const volTrend = vol20 > 0 ? vol5 / vol20 : 1;

    /* 个股量能要按长周期看才准：只比 5 日均量会被单日脉冲骗。
       同时给出「今日 ÷ 20 日均」「今日 ÷ 60 日均」和「在近 120 日的分位」。 */
    const todayVol = last.vol || 0;
    const v120 = bars.slice(-120).map(function (b) { return b.vol || 0; });
    const below120 = v120.length > 3
      ? v120.filter(function (v) { return v <= todayVol; }).length / v120.length : null;

    /* ---- 涨停基因 ---- */
    const gene = limitUpGene(bars, c.code || (q.code || ''), 250);

    /* ---- 技术位 ---- */
    const tech = techLevels(bars, price);

    /* ---- 相对强弱 ---- */
    const rs = c.indexBars ? relStrength(bars, c.indexBars, 20) : null;

    /* ---- 决策 ---- */
    const poolItem = c.poolItem || null;
    const em = c.emotion || null;

    const reasons = [];
    let verdict = 'watch';       // buy / watch / avoid
    let verdictText = '观察';

    if (poolItem) {
      if (poolItem.veto) {
        verdict = 'avoid';
        verdictText = '回避';
        reasons.push('已被涨停池评分否决：' + (poolItem.flags[0] || '不符合条件'));
      } else if (poolItem.relay === 'none') {
        verdict = 'avoid';
        verdictText = '回避';
        reasons.push(poolItem.relayText || '超出高度天花板，无接力价值');
      } else if (poolItem.isLeader) {
        verdict = poolItem.relay === 'ceiling' ? 'watch' : 'buy';
        verdictText = poolItem.relay === 'ceiling' ? '只做回封' : '可参与';
        reasons.push('当前绝对龙头，市场注意力集中在这里');
      } else if (em && em.heightSuppressed) {
        verdict = 'watch';
        verdictText = '只观察';
        reasons.push('高度压在 ' + em.heightCap + ' 板，非龙头没有参与价值');
      } else {
        verdict = poolItem.score >= 65 ? 'buy' : 'watch';
        verdictText = poolItem.score >= 65 ? '可参与' : '观察';
      }
      if (poolItem.relay === 'ceiling') reasons.push('已在天花板，需破局才可参与');
      else if (poolItem.relay === 'thin') reasons.push('距天花板仅 1 板，性价比下降');
      if (poolItem.breakTimes >= 5) reasons.push('炸板 ' + poolItem.breakTimes + ' 次，封板质量差');
    } else {
      /* 不在涨停池：按位置与技术状态判断。
       * 这里的顺序有讲究——先排除不可逆的，再看位置，最后才是机会。
       */
      const todayPct = q.pct != null ? q.pct
        : (n > 1 ? (last.close / bars[n - 2].close - 1) * 100 : 0);
      const a20 = tech ? tech.aboveMa20 : null;

      if (tech && tech.align === '空头排列') {
        verdict = 'avoid';
        verdictText = '回避';
        reasons.push('均线空头排列，反弹都是卖点');
        // 当日走势是更紧迫的信息，不能被均线结论吞掉
        if (todayPct <= -5 && volTrend > 1.2) {
          reasons.push('且今日放量大跌 ' + todayPct.toFixed(1) + '%，是出货不是洗盘');
        } else if (todayPct <= -5) {
          reasons.push('且今日缩量下跌 ' + todayPct.toFixed(1) + '%，没人接');
        }
      } else if (todayPct <= -5 && volTrend > 1.2) {
        verdict = 'avoid';
        verdictText = '回避';
        reasons.push('今日放量大跌 ' + todayPct.toFixed(1) + '%，是出货不是洗盘');
      } else if (todayPct <= -5) {
        verdict = 'watch';
        verdictText = '不接下跌';
        reasons.push('今日跌 ' + todayPct.toFixed(1) +
          '%，缩量下跌说明没人接，反弹不追（文档 4.5）');
      } else if (a20 != null && a20 > 15) {
        verdict = 'watch';
        verdictText = '等回踩';
        reasons.push('偏离 20 日线 ' + a20.toFixed(0) + '%，此处介入等于接最后一棒');
      } else if (a20 != null && a20 > 8) {
        verdict = 'watch';
        verdictText = '偏离偏大';
        reasons.push('高于 20 日线 ' + a20.toFixed(0) + '%，等回踩到均线附近才有位置优势');
      } else if (a20 != null && a20 >= -2 && pos60 < 0.8) {
        verdict = 'watch';
        verdictText = '可观察买点';
        reasons.push('贴着 20 日线（' + (a20 >= 0 ? '+' : '') + a20.toFixed(1) +
          '%）且不在高位，符合缩量回踩的位置条件');
      } else if (a20 != null && a20 < -2 && a20 > -6) {
        verdict = 'watch';
        verdictText = '等企稳';
        reasons.push('跌破 20 日线 ' + a20.toFixed(1) + '%，等重新站上再看');
      } else {
        reasons.push('不在涨停池，按波段逻辑跟踪');
      }
    }

    if (em && em.maxPosition <= 10) {
      reasons.push('当前情绪阶段仓位上限仅 ' + em.maxPosition + '%，不宜开新仓');
    }
    if (rs && rs.rs <= 0.95) reasons.push('近 20 日弱于大盘，不是资金主攻方向');
    if (gene && gene.count === 0) reasons.push('一年内无涨停记录');

    /* ---- 价位与仓位 ---- */
    const stopPct = c.stopPct || 6;
    // 技术止损优先：若支撑位比固定百分比更近，用支撑位下方 1%，止损更省
    let stopPrice = price * (1 - stopPct / 100);
    let stopBasis = '固定 ' + stopPct + '%';
    if (tech && tech.support && tech.support < price) {
      const techStop = tech.support * 0.99;
      if (techStop > stopPrice && (price - techStop) / price < stopPct / 100) {
        stopPrice = techStop;
        stopBasis = '跌破支撑 ' + tech.support.toFixed(2);
      }
    }
    stopPrice = +stopPrice.toFixed(2);

    const planRes = plan({
      capital: c.capital || 100000,
      phaseKey: c.phaseKey || (em ? em.phaseKey : 'trial'),
      stopPct: stopPct,
      score: poolItem ? poolItem.score : 50,
      veto: verdict === 'avoid'
    });

    return {
      code: c.code || q.code || '',
      name: q.name || c.name || '',
      price: price,
      pct: q.pct != null ? q.pct : (n > 1 ? (last.close / bars[n - 2].close - 1) * 100 : 0),

      verdict: verdict,
      verdictText: verdictText,
      reasons: reasons,

      position: {
        vwap60: v60, vwap20: v20,
        devFromCost: v60 ? (price / v60 - 1) * 100 : null,
        pos60: pos60, pos250: pos250,
        volTrend: volTrend,
        vol: {
          today: todayVol,
          ma20: vol20, ma60: vol60,
          r20: vol20 > 0 ? todayVol / vol20 : null,
          r60: vol60 > 0 ? todayVol / vol60 : null,
          pct120: below120
        },
        turnover: q.turnover != null ? q.turnover : null,
        volRatio: q.volRatio != null ? q.volRatio : null
      },
      gene: gene,
      tech: tech,
      rs: rs,

      plan: {
        stopPrice: stopPrice,
        stopBasis: stopBasis,
        stopPct: +(((price - stopPrice) / price) * 100).toFixed(1),
        target1: +(price * 1.1).toFixed(2),
        target2: +(price * 1.3).toFixed(2),
        suggested: planRes.suggested,
        firstEntry: planRes.firstEntry,
        amount: planRes.amount,
        note: planRes.note
      },

      // 已有字段（行情条用）
      floatCap: q.floatCap || null,
      totalCap: q.totalCap || null,
      pe: q.pe || null,
      pb: q.pb || null,
      amount: q.amount || null,
      open: q.open || null,
      high: q.high || null,
      low: q.low || null
    };
  }

  /* ==========================================================
   * L4 · 风控与仓位（文档第七、八章）
   * ========================================================== */

  /**
   * 仓位 = min(情绪阶段上限, 单笔风险预算 / 止损幅度)
   * 文档：单笔止损 -5%~-7%，可以不挣钱但不能亏本金。
   */
  function plan(opts) {
    const o = Object.assign({
      capital: 100000,
      phaseKey: 'trial',
      stopPct: 6,
      riskBudgetPct: 2,
      score: 60,
      veto: false
    }, opts || {});

    const table = POSITION_TABLE[o.phaseKey] || POSITION_TABLE.trial;
    const phaseCap = table.max;
    const riskCap = o.stopPct > 0 ? (o.riskBudgetPct / o.stopPct) * 100 : 100;

    // 个股评分对仓位的修正：A/B/C/D
    const scoreAdj = o.score >= 78 ? 1.0 : o.score >= 62 ? 0.8 : o.score >= 45 ? 0.5 : 0.25;

    let suggested = Math.min(phaseCap, riskCap) * scoreAdj;
    if (o.veto) suggested = 0;
    suggested = Math.round(clamp(suggested, 0, 100));

    const firstEntry = Math.min(table.first || 10, suggested) || 0;
    const amount = Math.round(o.capital * suggested / 100);
    const firstAmount = Math.round(o.capital * firstEntry / 100);

    return {
      phaseCap, riskCap: Math.round(riskCap), scoreAdj,
      suggested, firstEntry, amount, firstAmount,
      stopPct: o.stopPct,
      singleRisk: Math.round(o.capital * o.riskBudgetPct / 100),
      note: suggested === 0 ? '当前阶段与风险预算下不建议开仓'
        : '首仓 ' + firstEntry + '%（' + firstAmount.toLocaleString('zh-CN') + ' 元），'
          + '总仓不超过 ' + suggested + '%'
    };
  }

  /** 止损/止盈价位 */
  function exits(price, opts) {
    const o = Object.assign({ stopPct: 6, mode: 'short' }, opts || {});
    const p = num(price);
    if (p <= 0) return null;
    return {
      stop: +(p * (1 - o.stopPct / 100)).toFixed(2),
      breakeven: +(p * 1.002).toFixed(2),         // 冲高回落时把止损放到成本线上方
      target1: +(p * 1.1).toFixed(2),             // 第一个板
      target2: +(p * 1.3).toFixed(2)              // 波段涨30%减一次仓
    };
  }

  /** 黑名单自查（文档第十章） */
  const BLACKLIST = [
    { k: '补涨龙', v: '出现即掩护高位出货' },
    { k: '高切低', v: '最没确定性，要做就死在龙头上' },
    { k: '跟风龙/杂毛', v: '买得到的都是杂毛' },
    { k: '首板', v: '除题材爆发日打龙一，其余不做' },
    { k: '一进二/二进三', v: '龙头一字买不到，买到的全是杂毛' },
    { k: '穿越龙', v: '十死九生' },
    { k: '鱼尾/监管末期', v: '不吃鱼尾' },
    { k: '补仓/死扛/做T摊成本', v: '不是系统，是人性' },
    { k: '满仓单吊', v: '未连续稳定三年不做' }
  ];

  YB.engine = {
    // L1
    emotion, EMOTION_ITEMS, POSITION_TABLE, PHASE_ADVICE, HEIGHT_ADVICE,
    volumeRegime, VOLUME_LEVELS, VOLUME_BASE_CAP,
    // L2
    volMA, ma, position, aggregate,
    // L3
    shortPool, sectorRank, buildSectors, pickLeader, leaderScore,
    sectorDetail, aesthetic, aestheticGrade,
    analyzeSwing, detectSignals,
    analyzeStock, limitUpGene, relStrength, techLevels, vwap, limitThreshold, computeChips,
    // L4
    plan, exits, BLACKLIST
  };
})(window.YB);
