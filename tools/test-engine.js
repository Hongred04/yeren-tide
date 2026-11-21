/**
 * 引擎单测（Node 直接跑，不需要浏览器）
 * 目的：验证情绪评分、涨停池评分、月线波段判定的行为是否符合文档口径。
 */
const path = require('path');

/* ---- 最小浏览器环境垫片 ---- */
global.window = {};
global.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  documentElement: { setAttribute: () => {}, getAttribute: () => 'dark' },
  dispatchEvent: () => {},
  createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }),
  head: { appendChild: () => {} },
  body: { appendChild: () => {} }
};
global.CustomEvent = class { constructor(n, o) { this.type = n; this.detail = o && o.detail; } };
global.navigator = { userAgent: 'node' };

const web = path.resolve(__dirname, '..', 'www', 'js');
require(path.join(web, 'util.js'));
require(path.join(web, 'engine.js'));

const YB = global.window.YB;
const E = YB.engine;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function group(t) { console.log('\n' + t); }

/* =========================================================
 * 1. 情绪评分
 * =======================================================*/
group('1. 情绪周期');
{
  const ice = E.emotion({ zt: 12, dt: 22, zb: 6, maxBoard: 2, up: 800, down: 4300, volRatio: 0.82 });
  ok('双杀+跌停潮 → 冰点期', ice.phaseKey === 'freeze', ice.phase + ' ' + ice.mes);
  ok('冰点期仓位上限 0', ice.maxPosition === 0, ice.maxPosition);

  const mid = E.emotion({ zt: 35, dt: 5, zb: 12, maxBoard: 4, up: 2400, down: 2600, volRatio: 1.0, premium: 1.2 });
  ok('中性环境 → 试错期', mid.phaseKey === 'trial', mid.phase + ' ' + mid.mes);

  const hot = E.emotion({ zt: 78, dt: 2, zb: 9, maxBoard: 7, up: 4200, down: 900, volRatio: 1.35, premium: 5.5 });
  ok('高涨停+高溢价 → 主升/高潮', hot.phaseKey === 'main' || hot.phaseKey === 'peak', hot.phase + ' ' + hot.mes);
  ok('主升期仓位上限放大', hot.maxPosition >= 30, hot.maxPosition);

  // 边界：跌停成堆（情绪与指数双杀），分数刚好卡在 32 附近也不能判成试错期
  const edge = E.emotion({ zt: 16, dt: 17, zb: 10, maxBoard: 3, up: 1400, down: 3900, volRatio: 0.95 });
  ok('跌停成堆即使分数≥32 仍判冰点', edge.phaseKey === 'freeze', edge.phase + ' ' + edge.mes);
  ok('冰点边界仓位为 0', edge.maxPosition === 0, edge.maxPosition);

  // 退潮特征：涨停多但封不住 + 跌停抬头
  const retreat = E.emotion({ zt: 48, dt: 10, zb: 26, maxBoard: 3, up: 2600, down: 2400, volRatio: 1.1, premium: -1.8 });
  ok('封不住+跌停抬头 → 触发退潮预警', retreat.retreatRisk >= 2, retreat.retreatVotes);

  // 高度天花板（11-19 复盘：高度压在 2-3 板时短线没有参与价值）
  const h3 = E.emotion({ zt: 40, dt: 5, zb: 10, maxBoard: 3, up: 3000, down: 2000, volRatio: 1.0, premium: 1 });
  ok('最高 3 板判定为高度压制', h3.heightSuppressed === true && h3.heightLabel === '高度压制',
    h3.heightLabel + ' cap=' + h3.heightCap);
  ok('高度压制时仓位上限压到 ≤20%', h3.maxPosition <= 20, h3.maxPosition);
  ok('普涨但无高度被识别', h3.wideButFlat === true, { up: h3.upRatio.toFixed(2), sup: h3.heightSuppressed });

  const h2 = E.emotion({ zt: 40, dt: 5, zb: 10, maxBoard: 2, up: 3000, down: 2000, volRatio: 1.0, premium: 1 });
  ok('最高 2 板判定为极度压制', h2.heightLabel === '极度压制', h2.heightLabel);
  ok('极度压制不给试错仓', h2.firstPosition === 0, h2.firstPosition);

  const h7 = E.emotion({ zt: 60, dt: 3, zb: 8, maxBoard: 7, up: 3500, down: 1200, volRatio: 1.15, premium: 3 });
  ok('最高 7 板判定为空间打开', h7.heightLabel === '空间打开', h7.heightLabel);
  ok('空间打开不做仓位压制', h7.maxPosition >= 30, h7.maxPosition);

  const hPeak = E.emotion({ zt: 30, dt: 6, zb: 10, maxBoard: 2, height5: 6, up: 2600, down: 2400, volRatio: 1, premium: 0 });
  ok('近 5 日峰值参与天花板计算', hPeak.heightCap === 6, hPeak.heightCap);

  const sumW = E.EMOTION_ITEMS.reduce((s, i) => s + i.w, 0);
  ok('分项权重合计 = 1', Math.abs(sumW - 1) < 1e-9, sumW);
}

/* ---- 两市量能水位 ---- */
group('1b. 两市量能水位');
{
  const dry = E.volumeRegime(0.8e12, 0.85);
  ok('0.8 万亿判为地量', dry.levelKey === 'dry', dry.level);
  ok('地量不支撑指数', dry.canSupportIndex === false, dry.support);
  ok('地量缩量给抱团打法', /抱团/.test(dry.play), dry.play);

  const mild = E.volumeRegime(1.31e12, 0.98);
  ok('1.31 万亿判为温和', mild.levelKey === 'mild', mild.level);
  ok('温和不支撑趋势', mild.canSupportIndex === false, mild.support);
  ok('算出距 1.5 万亿的差额', Math.round(mild.gapToSupport) === 1900,
    Math.round(mild.gapToSupport) + ' 亿');

  const add = E.volumeRegime(1.7e12, 1.15);
  ok('1.7 万亿判为增量', add.levelKey === 'add', add.level);
  ok('增量支撑指数', add.canSupportIndex === true, add.support);
  ok('放量增量转机构票打法', /机构/.test(add.play), add.play);

  const strong = E.volumeRegime(2.6e12, 1.3);
  ok('2.6 万亿判为强势增量', strong.levelKey === 'strong', strong.level);
  ok('1.5 万亿是支撑分水岭',
    E.volumeRegime(1.49e12, 1).canSupportIndex === false &&
    E.volumeRegime(1.51e12, 1).canSupportIndex === true);
  ok('换手率按流通市值折算', Math.abs(mild.turnoverRate - 1.49) < 0.05,
    mild.turnoverRate.toFixed(2) + '%');

  // 2026-11-19 实盘：连续 2 天递减、距峰值 -19.9%，不能叫「温和」
  const rt = E.volumeRegime(1.31e12, {
    volRatio: 0.894, downDays: 2, peakDrawdown: -0.199, trend5: 0.956
  });
  ok('连续递减 + 距峰值 -20% 判为撤退', rt.trendKey === 'retreat', rt.trendKey);
  ok('缩量时主标签不用「温和」', rt.mainLabel === '短线缩量', rt.mainLabel);
  ok('撤退时不支撑指数', rt.canSupportIndex === false, rt.support);

  // 连续 3 天递减也应判撤退（即使回撤还没到 15%）
  const rt2 = E.volumeRegime(1.4e12, {
    volRatio: 0.97, downDays: 3, peakDrawdown: -0.05, trend5: 0.97
  });
  ok('连续 3 天递减即判撤退', rt2.trendKey === 'retreat', rt2.trendKey);

  // 量在撤时，即使绝对量超过 1.5 万亿也不能说支撑指数
  const rt3 = E.volumeRegime(1.6e12, {
    volRatio: 0.9, downDays: 3, peakDrawdown: -0.2, trend5: 0.9
  });
  ok('量在撤时过 1.5 万亿也不算支撑', rt3.canSupportIndex === false, rt3.support);

  /* ---- 半年尺度：中枢 / 位置 / 量价性质 ---- */
  // 复刻 2026-11 实盘：中枢持续下移 + 缩量下跌
  const shrinkDown = E.volumeRegime(1.07e12, {
    volRatio: 1.10, downDays: 1, peakDrawdown: -0.05, trend5: 1.02,
    ma: { d5: 9.74e11, d20: 1.038e12, d60: 1.049e12, d120: 1.189e12 },
    pct: { p20: 0.70, p60: 0.65, p120: 0.33 },
    centerSlope: -0.049,
    priceChg20: -4.25, priceChg60: -8.6
  });
  ok('中枢下移被识别', shrinkDown.center.key === 'down', shrinkDown.center.label);
  ok('中枢下移时主标签用中枢而非短线', shrinkDown.mainLabel === '中枢下移', shrinkDown.mainLabel);
  ok('120 日分位 33% 判为偏低', shrinkDown.position.label === '偏低',
    shrinkDown.position.label + ' p120=' + shrinkDown.position.p120);
  ok('量价性质判为缩量下跌', shrinkDown.nature.key === 'shrinkDown', shrinkDown.nature.label);
  ok('缩量下跌时指数不支撑', shrinkDown.canSupportIndex === false, shrinkDown.support);
  ok('结论串包含中枢与分位两个维度',
    /中枢|台阶/.test(shrinkDown.summary) && /分位/.test(shrinkDown.summary),
    shrinkDown.summary.slice(0, 60));
  ok('缩量下跌给出抱团打法', /抱团/.test(shrinkDown.play), shrinkDown.play);

  // 中枢上移 + 量价齐升
  const expandUp = E.volumeRegime(1.8e12, {
    volRatio: 1.2, downDays: 0, peakDrawdown: 0, trend5: 1.1,
    ma: { d5: 1.8e12, d20: 1.75e12, d60: 1.6e12, d120: 1.5e12 },
    pct: { p20: 0.9, p60: 0.92, p120: 0.88 },
    centerSlope: 0.09, priceChg20: 4.2
  });
  ok('中枢上移被识别', expandUp.center.key === 'up', expandUp.center.label);
  ok('中枢上移 + 量价齐升 → 支撑指数', expandUp.canSupportIndex === true, expandUp.support);
  ok('放量上涨给出做机构票的打法', /机构/.test(expandUp.play), expandUp.play);

  // 缩量上涨（无量反弹）
  const shrinkUp = E.volumeRegime(1.2e12, {
    volRatio: 0.85, ma: { d20: 1.0e12, d60: 1.1e12 },
    pct: { p120: 0.3 }, centerSlope: -0.02, priceChg20: 3.5
  });
  ok('缩量上涨被识别为无量反弹', shrinkUp.nature.key === 'shrinkUp', shrinkUp.nature.label);
  ok('无量反弹时不给支撑结论', shrinkUp.canSupportIndex === false, shrinkUp.support);

  // 放量上行
  const ex = E.volumeRegime(1.6e12, {
    volRatio: 1.18, downDays: 0, peakDrawdown: 0, trend5: 1.12
  });
  ok('放量判为扩张', ex.trendKey === 'expand', ex.trendKey);
  ok('放量且水位够 → 支撑指数', ex.canSupportIndex === true, ex.support);
}

/* =========================================================
 * 2. 涨停池评分
 * =======================================================*/
group('2. 短线涨停池评分');
{
  const pool = [
    { code: '600001', name: '板块A龙一', price: 20, pct: 10, amount: 8e8, floatCap: 120e8, turnover: 8, boards: 4, firstSeal: 93000, sealAmount: 3e8, breakTimes: 0, industry: '算力' },
    { code: '600002', name: '板块A跟风', price: 10, pct: 10, amount: 2e8, floatCap: 60e8, turnover: 12, boards: 2, firstSeal: 110000, sealAmount: 3e7, breakTimes: 1, industry: '算力' },
    { code: '600003', name: '孤零零首板', price: 8, pct: 10, amount: 1e8, floatCap: 30e8, turnover: 5, boards: 1, firstSeal: 145000, sealAmount: 5e6, breakTimes: 2, industry: '纺织' },
    { code: '600004', name: 'ST垃圾', price: 3, pct: 5, amount: 5e7, floatCap: 15e8, turnover: 4, boards: 1, firstSeal: 100000, sealAmount: 1e6, breakTimes: 0, industry: '其他' }
  ];
  const { list, sectors } = E.shortPool(pool);
  const byCode = {};
  list.forEach((x) => { byCode[x.code] = x; });

  ok('龙一评分 > 跟风', byCode['600001'].score > byCode['600002'].score,
    byCode['600001'].score + ' vs ' + byCode['600002'].score);
  ok('龙一打上「龙一」标签', byCode['600001'].tags.indexOf('龙一') >= 0, byCode['600001'].tags);
  ok('跟风打上「跟风」标签', byCode['600002'].tags.indexOf('跟风') >= 0, byCode['600002'].tags);
  ok('ST 被否决', byCode['600004'].veto === true, byCode['600004'].flags);
  ok('否决项评分被封顶 35', byCode['600004'].score <= 35, byCode['600004'].score);
  ok('排序：合规标的排在否决标的前面', list[0].veto === false, list.map((x) => x.code + ':' + x.veto));
  ok('首板非爆发日被标黑名单④', byCode['600003'].flags.some((f) => /首板/.test(f)), byCode['600003'].flags);
  ok('板块榜识别出算力', sectors[0].name === '算力' && sectors[0].count === 2, sectors[0]);
}

/* ---- 高度压制下的接力性价比与龙头识别 ---- */
group('2b. 龙头聚焦（高度天花板）');
{
  const hPool = [
    // 3 板，封单强、成交额最大 → 应是绝对龙头
    { code: '600010', name: '三板强龙', price: 12, pct: 10, amount: 1.2e9, floatCap: 150e8,
      turnover: 12, boards: 3, firstSeal: 93000, sealAmount: 4e8, breakTimes: 0, industry: '算力' },
    // 3 板，封单弱、封板晚
    { code: '600011', name: '三板跟风', price: 9, pct: 10, amount: 2e8, floatCap: 60e8,
      turnover: 8, boards: 3, firstSeal: 140000, sealAmount: 3e7, breakTimes: 1, industry: '算力' },
    // 4 板，超过 3 板天花板
    { code: '600012', name: '四板高位', price: 20, pct: 10, amount: 5e8, floatCap: 80e8,
      turnover: 18, boards: 4, firstSeal: 93500, sealAmount: 1e8, breakTimes: 0, industry: '算力' },
    // 1 板，人气不错
    { code: '600013', name: '一板人气', price: 30, pct: 10, amount: 8e8, floatCap: 200e8,
      turnover: 15, boards: 1, firstSeal: 100000, sealAmount: 1.5e8, breakTimes: 0, industry: '小家电' }
  ];

  const r = E.shortPool(hPool, { heightCap: 3 });
  const by = {};
  r.list.forEach((x) => { by[x.code] = x; });

  ok('天花板=3 时 4 板被判无性价比并否决', by['600012'].veto === true && by['600012'].relay === 'none',
    { veto: by['600012'].veto, relay: by['600012'].relay });
  ok('3 板处于天花板位置', by['600010'].relay === 'ceiling', by['600010'].relay);
  ok('1 板仍有空间', by['600013'].relay === 'ok', by['600013'].relay);
  ok('龙头是龙头度最高的合规标的', r.leader && r.leader.code === '600010',
    r.leader && (r.leader.name + ' ' + r.leader.leaderScore));
  ok('龙头被标记且在列表首位', r.list[0].isLeader === true, r.list[0].name);
  ok('高度压制时非龙头降级为只观察',
    by['600011'].focusOnly === true && by['600013'].focusOnly === true && !by['600010'].focusOnly,
    { a: by['600011'].focusOnly, b: by['600013'].focusOnly });

  // 天花板打开时不应有「只观察」压制
  const r2 = E.shortPool(hPool, { heightCap: 8 });
  ok('天花板打开时不做聚焦限制', r2.focusOnly === false, r2.focusOnly);
  ok('天花板打开时 4 板不再因高度被否决',
    (function () { const x = r2.list.filter((y) => y.code === '600012')[0]; return x.relay !== 'none'; })(),
    r2.list.filter((y) => y.code === '600012')[0].relay);
}

group('2c. 龙头识别（热度综合，不只看涨停）');
{
  // 真实数据（2026-11-19）：九阳股份 1 板但成交额 51 亿，真视通 3 板成交额仅 0.6 亿
  const cands = [
    { code: '002242', name: '九阳股份', price: 31.21, pct: 10.01, amount: 51.29e8,
      floatCap: 237.8e8, turnover: 23.74, boards: 1, industry: '小家电', inPool: true },
    { code: '002771', name: '真视通', price: 14.38, pct: 10.02, amount: 0.61e8,
      floatCap: 26e8, turnover: 2.36, boards: 3, industry: 'IT服务', inPool: true },
    { code: '600000', name: '未涨停强势股', price: 10, pct: 6.5, amount: 20e8,
      floatCap: 300e8, turnover: 8, boards: 0, industry: '银行', inPool: false }
  ];
  const L = E.pickLeader(cands, { heightCap: 3 });
  ok('龙头取人气最高的那只，不是连板最高的', L.code === '002242',
    L.name + ' 龙头度=' + L.leaderScore);
  ok('3 板但无人气的真视通不是龙头', L.code !== '002771',
    cands.filter(c => c.code === '002771')[0].leaderScore);
  ok('未涨停的强势股也参与比较', cands[2].leaderScore > 0, cands[2].leaderScore);
  ok('人气项在龙头度里占主导', L.leaderParts.pop > 30, L.leaderParts.pop.toFixed(1));

  // 未涨停的强势股可以压过小盘连板股
  const L2 = E.pickLeader([
    { code: 'A', name: '小盘连板', price: 10, pct: 10, amount: 0.5e8,
      floatCap: 25e8, turnover: 3, boards: 3, industry: 'A' },
    { code: 'B', name: '人气未涨停', price: 20, pct: 7, amount: 40e8,
      floatCap: 200e8, turnover: 15, boards: 0, industry: 'B', inPool: false }
  ], { heightCap: 3 });
  ok('未涨停的高人气股能成为龙头', L2.code === 'B', L2.name + ' ' + L2.leaderScore);
}

group('2d. 板块内审美排序');
{
  const pool = [
    { code: '002242', name: '九阳股份', pct: 10.01, amount: 51.29e8, floatCap: 237.8e8,
      turnover: 23.74, boards: 1, firstSeal: 92500, sealAmount: 6448e4,
      sealRatio: 6448e4 / 237.8e8, industry: '小家电' },
    { code: '002705', name: '新宝股份', pct: 9.99, amount: 8e8, floatCap: 90e8,
      turnover: 9, boards: 1, firstSeal: 134500, sealAmount: 2e7,
      sealRatio: 2e7 / 90e8, industry: '小家电' },
    { code: '603868', name: '飞科电器', pct: 10, amount: 3e8, floatCap: 60e8,
      turnover: 5, boards: 2, firstSeal: 95500, sealAmount: 1.5e8,
      sealRatio: 1.5e8 / 60e8, industry: '小家电' },
    { code: '600000', name: '别的板块', pct: 10, amount: 50e8, floatCap: 200e8,
      turnover: 10, boards: 3, firstSeal: 93000, sealAmount: 3e8,
      sealRatio: 3e8 / 200e8, industry: '银行' }
  ];

  const d = E.sectorDetail('小家电', pool);
  ok('板块明细只含本板块成员', d.count === 3, d.count);
  ok('按审美分降序排列', d.list[0].aes >= d.list[1].aes && d.list[1].aes >= d.list[2].aes,
    d.list.map(x => x.name + ':' + x.aes).join(' | '));
  ok('连板最高的不一定第一（人气更重要）', d.list[0].code === '002242',
    d.list[0].name + ' aes=' + d.list[0].aes);
  ok('审美分级存在', /^[SABC]$/.test(d.list[0].aesGrade), d.list[0].aesGrade);
  ok('汇总最高板正确', d.maxBoards === 2, d.maxBoards);

  const none = E.sectorDetail('不存在的板块', pool);
  ok('不存在的板块返回 null', none === null, none);

  // 板块内相对性：同一只票在不同板块里审美分不同（因为分母不同）
  const d2 = E.sectorDetail('银行', pool);
  ok('单成员板块能正常计算', d2.count === 1 && d2.list[0].aes > 0, d2.list[0].aes);
}

group('2e. 个股深度分析');
{
  // 造一段含涨停的日线：主板阈值 9.5%
  function mk(pcts, start) {
    const out = [];
    let p = start || 10;
    const d = new Date(2025, 0, 1);
    for (let i = 0; i < pcts.length; i++) {
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
      const open = p;
      const close = +(open * (1 + pcts[i] / 100)).toFixed(2);
      out.push({
        date: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
          String(d.getDate()).padStart(2, '0'),
        open: open, close: close,
        high: +(Math.max(open, close) * 1.005).toFixed(2),
        low: +(Math.min(open, close) * 0.995).toFixed(2),
        vol: 1e6
      });
      p = close;
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  // 前半段横盘，中间两次涨停且次日都涨
  const seq = [];
  for (let i = 0; i < 30; i++) seq.push(0.2);
  seq.push(10, 3.5);      // 涨停 → 次日 +3.5%
  for (let i = 0; i < 20; i++) seq.push(0.1);
  seq.push(10, 6);        // 涨停 → 次日 +6%
  for (let i = 0; i < 20; i++) seq.push(0.1);
  seq.push(10, -2);       // 涨停 → 次日 -2%（破板）
  for (let i = 0; i < 30; i++) seq.push(0.1);

  const bars = mk(seq, 10);
  const g = E.limitUpGene(bars, '600001', 250);
  ok('识别出 3 次涨停', g.count === 3, g.count);
  ok('次日平均涨幅算对', Math.abs(g.avgNext - (3.5 + 6 - 2) / 3) < 0.05,
    g.avgNext.toFixed(2) + '%');
  ok('次日溢价率 = 2/3', Math.abs(g.premiumRate - 2 / 3) < 0.01,
    g.premiumRate.toFixed(2));
  ok('涨停基因给出可执行结论', typeof g.verdict === 'string' && g.verdict.length > 5, g.verdict);
  ok('记录最近一次涨停距今', g.lastDaysAgo != null && g.lastDaysAgo >= 0, g.lastDaysAgo);

  // 今天涨停：计入次数、最近涨停为 0 天前，但不参与次日溢价统计
  const seqToday = [];
  for (let i = 0; i < 40; i++) seqToday.push(0.1);
  seqToday.push(10);
  const gToday = E.limitUpGene(mk(seqToday, 10), '600001', 250);
  ok('今天涨停计入次数', gToday.count === 1, gToday.count);
  ok('今天涨停 → 最近 0 天前', gToday.lastDaysAgo === 0, gToday.lastDaysAgo);
  ok('今天涨停没有次日数据，均值应为空', gToday.avgNext == null, gToday.avgNext);

  // 20cm 标的要用 19.5% 阈值
  ok('创业板阈值 19.5', E.limitThreshold('300750') === 19.5, E.limitThreshold('300750'));
  ok('科创板阈值 19.5', E.limitThreshold('688981') === 19.5, E.limitThreshold('688981'));
  ok('主板阈值 9.5', E.limitThreshold('600000') === 9.5, E.limitThreshold('600000'));
  ok('北交所阈值 29.5', E.limitThreshold('920001') === 29.5, E.limitThreshold('920001'));

  // 10% 的涨停在创业板不算涨停
  const cybSeq = [];
  for (let i = 0; i < 40; i++) cybSeq.push(0.1);
  cybSeq.push(10, 2);
  for (let i = 0; i < 20; i++) cybSeq.push(0.1);
  const cybBars = mk(cybSeq, 10);
  ok('创业板 10% 不算涨停', E.limitUpGene(cybBars, '300001', 250).count === 0,
    E.limitUpGene(cybBars, '300001', 250).count);

  // ---- 技术位 ----
  const up = mk(Array(80).fill(0.5), 10);
  const t = E.techLevels(up, up[up.length - 1].close);
  ok('多头排列被识别', t.align === '多头排列', t.align);
  ok('支撑在现价之下', t.support == null || t.support < up[up.length - 1].close, t.support);
  ok('压力在现价之上', t.resistance == null || t.resistance > up[up.length - 1].close, t.resistance);

  const down = mk(Array(80).fill(-0.5), 30);
  const t2 = E.techLevels(down, down[down.length - 1].close);
  ok('空头排列被识别', t2.align === '空头排列', t2.align);

  // ---- 相对强弱 ----
  const idxFlat = mk(Array(40).fill(0), 100);
  const stockUp = mk(Array(40).fill(0.8), 10);
  const rs = E.relStrength(stockUp, idxFlat, 20);
  ok('个股明显跑赢 → RS > 1.05', rs.rs > 1.05, rs.rs.toFixed(3));
  ok('标注强于大盘', rs.label === '强于大盘', rs.label);

  // ---- 综合评估 ----
  const full = mk(seq, 10);
  const a = E.analyzeStock(full, { price: full[full.length - 1].close, pct: 0.1, code: '600001' }, {
    code: '600001', emotion: { phaseKey: 'trial', maxPosition: 30, heightSuppressed: false, heightCap: 6 },
    indexBars: idxFlat, capital: 100000, stopPct: 6
  });
  ok('综合评估返回结构完整', !!(a && a.position && a.gene && a.tech && a.plan), !!a);
  ok('给出止损价且低于现价', a.plan.stopPrice < a.price, a.plan.stopPrice + ' < ' + a.price);

  // 被否决的涨停股 → 回避
  const av = E.analyzeStock(full, { price: 10, pct: 10 }, {
    code: '600001', poolItem: { veto: true, flags: ['ST'], score: 20 },
    emotion: { phaseKey: 'trial', maxPosition: 30, heightSuppressed: false, heightCap: 6 }
  });
  ok('涨停池被否决 → 结论回避', av.verdict === 'avoid', av.verdict + '/' + av.verdictText);
  ok('回避时建议仓位为 0', av.plan.suggested === 0, av.plan.suggested);

  // 超出天花板 → 回避
  const av2 = E.analyzeStock(full, { price: 10, pct: 10 }, {
    code: '600001',
    poolItem: { veto: false, relay: 'none', relayText: '超出天花板', score: 80, flags: [] },
    emotion: { phaseKey: 'trial', maxPosition: 30, heightSuppressed: true, heightCap: 3 }
  });
  ok('超出高度天花板 → 回避', av2.verdict === 'avoid', av2.verdict);

  // 龙头 → 可参与
  const ld = E.analyzeStock(full, { price: 10, pct: 10 }, {
    code: '600001',
    poolItem: { veto: false, relay: 'ok', isLeader: true, score: 90, flags: [] },
    emotion: { phaseKey: 'main', maxPosition: 50, heightSuppressed: false, heightCap: 6 }
  });
  ok('龙头 + 有空间 → 可参与', ld.verdict === 'buy', ld.verdict + '/' + ld.verdictText);

  /* ---- 非涨停池：按位置与当日走势判断 ---- */
  // 造一段已跌破均线的下跌趋势，最后一天放量大跌
  function mkTrend(step, n, lastPct, lastVolMul) {
    const pcts = [];
    for (let i = 0; i < n; i++) pcts.push(step);
    if (lastPct != null) pcts[pcts.length - 1] = lastPct;
    const b = mk(pcts, 40);
    if (lastVolMul) b[b.length - 1].vol = b[b.length - 1].vol * lastVolMul;
    return b;
  }

  const dropVol = mkTrend(-0.4, 80, -7, 3);   // 放量大跌
  const r1 = E.analyzeStock(dropVol, { price: dropVol[dropVol.length - 1].close, pct: -7 }, {
    code: '600001', emotion: { phaseKey: 'trial', maxPosition: 30, heightSuppressed: false, heightCap: 6 }
  });
  ok('放量大跌 → 回避', r1.verdict === 'avoid', r1.verdict + '/' + r1.verdictText);
  ok('放量大跌理由说明是出货',
    r1.reasons.some((r) => /出货/.test(r)), r1.reasons.join('；'));

  const dropShrink = mkTrend(-0.4, 80, -7, 0.3);   // 缩量大跌
  const r2 = E.analyzeStock(dropShrink, { price: dropShrink[dropShrink.length - 1].close, pct: -7 }, {
    code: '600001', emotion: { phaseKey: 'trial', maxPosition: 30, heightSuppressed: false, heightCap: 6 }
  });
  // 空头排列 + 缩量大跌：结论仍是回避，但必须说清"没人接"这个事实
  ok('缩量大跌的理由保留「没人接」表述',
    r2.reasons.some((r) => /没人接/.test(r)), r2.reasons.join('；'));

  // 远离 20 日线（高位）→ 等回踩
  const high = mk(Array(60).fill(1.2), 10);
  const r3 = E.analyzeStock(high, { price: high[high.length - 1].close, pct: 1 }, {
    code: '600001', emotion: { phaseKey: 'main', maxPosition: 50, heightSuppressed: false, heightCap: 6 }
  });
  ok('远离 20 日线 → 提示等回踩/偏离偏大',
    r3.verdict === 'watch' && /回踩|偏离/.test(r3.verdictText), r3.verdict + '/' + r3.verdictText);

  // 跌破 20 日线 → 等企稳
  const broke = mkTrend(-0.3, 90, -1, 1);
  const r4 = E.analyzeStock(broke, { price: broke[broke.length - 1].close, pct: -1 }, {
    code: '600001', emotion: { phaseKey: 'trial', maxPosition: 30, heightSuppressed: false, heightCap: 6 }
  });
  ok('跌破 20 日线给出明确处置',
    /回避|企稳|均线/.test(r4.verdictText) || r4.reasons.some((r) => /20 日线|空头/.test(r)),
    r4.verdictText + ' | ' + r4.reasons.join('；'));
}

/* =========================================================
 * 3. 月线波段判定
 * =======================================================*/
group('3. 波段月线资金流');

/** 确定性伪随机：测试不能因为 Math.random() 抖动而偶发失败 */
let __seed = 20261119;
function rnd() {
  __seed = (__seed * 1103515245 + 12345) & 0x7FFFFFFF;
  return __seed / 0x7FFFFFFF;
}

function makeBars(opts) {
  const o = Object.assign({
    n: 400, start: 100, dailyDrift: 0.0006, volBase: 1e6,
    volTrend: 1.0,          // 近期放量倍数（作用于最后约 5 个月）
    lastPct: -1.5,          // 最后一根涨跌幅
    lastVolMul: 0.5,        // 最后一根缩量倍数
    pctAt: null             // 自定义每日涨跌幅函数 (i, n) => pct
  }, opts || {});

  const bars = [];
  const d = new Date(2024, 10, 1);
  let price = o.start;
  for (let i = 0; i < o.n; i++) {
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    const dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const open = price;
    let pct = o.pctAt ? o.pctAt(i, o.n) : o.dailyDrift * 100;
    if (i === o.n - 1 && o.lastPct != null) pct = o.lastPct;
    const close = +(open * (1 + pct / 100)).toFixed(2);
    const late = i > o.n - 110 ? o.volTrend : 1;
    const vol = o.volBase * late * (0.95 + rnd() * 0.1) *
      (i === o.n - 1 ? o.lastVolMul : 1);
    bars.push({
      date: dateStr,
      open: +open.toFixed(2),
      close: close,
      high: +(Math.max(open, close) * 1.005).toFixed(2),
      low: +(Math.min(open, close) * 0.995).toFixed(2),
      vol: Math.round(vol)
    });
    price = close;
    d.setDate(d.getDate() + 1);
  }
  return bars;
}

/** 横盘 → 缓涨 → 今日缩量小阴，且 15 天前有涨停（典型波段买点形态） */
function swingShape(i, n) {
  if (i === n - 15) return 10;          // 前有涨停
  if (i < n * 0.55) return 0.05;        // 前段横盘
  return 0.12;                          // 后段缓涨
}

{
  // A：月线堆量 + 缩量小阴回踩（应成立）
  const good = makeBars({ volTrend: 2.2, lastPct: -1.2, lastVolMul: 0.45, pctAt: swingShape });
  const ra = E.analyzeSwing(good);
  ok('A 月线堆量被识别（≥4 个月）', ra.heapMonths >= 4, ra.heapMonths);
  ok('A 6 个月涨幅 ≤50%', ra.gather <= 50, ra.gather.toFixed(1) + '%');
  ok('A 判定为可买点', ra.buyReady === true,
    { ready: ra.buyReady, cond: ra.conditions, pct: ra.todayPct.toFixed(2) });

  // B：同样形态但今天大跌 -8%（破位，不能算买点）
  const broke = makeBars({ volTrend: 2.2, lastPct: -8, lastVolMul: 0.45, pctAt: swingShape });
  const rb = E.analyzeSwing(broke);
  ok('B 破位大阴不算买点', rb.buyReady === false,
    { ready: rb.buyReady, pct: rb.todayPct.toFixed(2), steady: rb.conditions.steady });

  // C：翻倍股不能进波段池
  const doubled = makeBars({ dailyDrift: 0.004, volTrend: 2.2, lastPct: -1, lastVolMul: 0.45 });
  const rc = E.analyzeSwing(doubled);
  ok('C 翻倍股月线堆量判定失效', rc.conditions.heap === false,
    { gather: rc.gather.toFixed(1) + '%', heap: rc.conditions.heap });

  // D：放量阳线不触发「买阴线」
  const upDay = makeBars({ volTrend: 2.2, lastPct: 3.5, lastVolMul: 0.45, pctAt: swingShape });
  const rd = E.analyzeSwing(upDay);
  ok('D 阳线不触发买阴线', rd.buyReady === false, { yin: rd.conditions.yin });

  // E：当月不完整时，月线堆量仍应正常识别（回归测试）
  const partial = makeBars({ n: 401, volTrend: 2.2, lastPct: -1.0, lastVolMul: 0.5, pctAt: swingShape });
  const re = E.analyzeSwing(partial);
  const lastMonth = re.months[re.months.length - 1];
  ok('E 当月不完整也能判断堆量', re.heapMonths >= 3,
    { heapMonths: re.heapMonths, lastMonthDays: lastMonth.days });
}

/* =========================================================
 * 4. 买点识别
 * =======================================================*/
group('4. 买点识别');
{
  // 低位：先跌 30% 再横盘，今日放量涨停
  const lowBars = makeBars({
    n: 160, lastPct: 9.9, lastVolMul: 3.0,
    pctAt: (i, n) => (i < n * 0.7 ? -0.25 : 0.05)
  });
  const sig = E.detectSignals(lowBars, {});
  ok('低位放量涨停被识别', sig.some((s) => /低位放量涨停/.test(s.type)), sig.map((s) => s.type));

  // 高位：持续上涨后放量滞涨
  const riskBars = makeBars({ n: 160, dailyDrift: 0.003, lastPct: 0.4, lastVolMul: 2.4 });
  const sig2 = E.detectSignals(riskBars, {});
  ok('高位放量滞涨给出风险信号', sig2.some((s) => s.level === 'risk'), sig2.map((s) => s.type));
}

/* =========================================================
 * 5. 仓位与止损
 * =======================================================*/
group('5. 风控层');
{
  const ice = E.plan({ capital: 100000, phaseKey: 'freeze', score: 90 });
  ok('冰点期建议仓位 0', ice.suggested === 0, ice.suggested);

  const main = E.plan({ capital: 100000, phaseKey: 'main', score: 85, stopPct: 6, riskBudgetPct: 2 });
  ok('主升+高分 → 仓位被风险预算约束到 33%', main.suggested <= 34, main.suggested);
  ok('首仓不超过建议仓位', main.firstEntry <= main.suggested, main.firstEntry + '/' + main.suggested);
  ok('单笔风险 = 总资金 2%', main.singleRisk === 2000, main.singleRisk);

  const veto = E.plan({ capital: 100000, phaseKey: 'main', score: 80, veto: true });
  ok('否决标的仓位强制 0', veto.suggested === 0, veto.suggested);

  const ex = E.exits(10, { stopPct: 6 });
  ok('止损价 = 9.40', ex.stop === 9.4, ex.stop);
  ok('保本价在成本上方', ex.breakeven > 10, ex.breakeven);
}

console.log('\n────────────────────────');
console.log('通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
