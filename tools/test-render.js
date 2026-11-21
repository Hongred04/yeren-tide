/**
 * 渲染冒烟测试：用真实结构的 state 跑一遍四个页面，
 * 检查是否抛错、是否出现 undefined / NaN 之类的脏输出。
 */
const path = require('path');

global.window = {};
const classes = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
global.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  dispatchEvent: () => {},
  getElementById: () => null,
  documentElement: { setAttribute: () => {}, getAttribute: () => 'dark' },
  createElement: () => ({ style: {}, classList: classes, appendChild() {}, setAttribute() {} }),
  head: { appendChild: () => {} },
  body: { appendChild: () => {}, removeChild: () => {} }
};
global.CustomEvent = class { constructor(n, o) { this.type = n; this.detail = o && o.detail; } };
global.navigator = { userAgent: 'node' };
global.getComputedStyle = () => ({ getPropertyValue: () => '' });
global.localStorage = undefined;

const web = path.resolve(__dirname, '..', 'www', 'js');
['util.js', 'net.js', 'sources.js', 'engine.js', 'portfolio.js', 'kline.js', 'ui.js', 'update.js'].forEach((f) => require(path.join(web, f)));

const YB = global.window.YB;
const E = YB.engine;
const UI = YB.ui;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

function checkHtml(name, html) {
  ok(name + ' 产出 HTML', typeof html === 'string' && html.length > 400, typeof html + ' len=' + (html || '').length);
  ok(name + ' 无 undefined', html.indexOf('undefined') < 0,
    (html.match(/.{0,40}undefined.{0,40}/) || [''])[0]);
  ok(name + ' 无 NaN', html.indexOf('NaN') < 0,
    (html.match(/.{0,40}NaN.{0,40}/) || [''])[0]);
  ok(name + ' 标签闭合平衡', (html.match(/<div/g) || []).length === (html.match(/<\/div>/g) || []).length,
    'open=' + (html.match(/<div/g) || []).length + ' close=' + (html.match(/<\/div>/g) || []).length);
}

/* ---- 构造一份贴近真实的数据 ---- */
const ztPool = [
  { code: '002685', name: '华东重机', price: 7.37, pct: 10, amount: 1.63e8, floatCap: 74.26e8, turnover: 2.2, boards: 4, firstSeal: 92500, sealAmount: 5.32e8, breakTimes: 0, industry: '工程机械' },
  { code: '603324', name: '盛剑科技', price: 22.9, pct: 9.99, amount: 3.1e8, floatCap: 45e8, turnover: 9.1, boards: 2, firstSeal: 101500, sealAmount: 8e7, breakTimes: 1, industry: '环保设备' },
  { code: '002420', name: '毅昌科技', price: 6.42, pct: 9.93, amount: 3.7e7, floatCap: 25.9e8, turnover: 1.4, boards: 1, firstSeal: 92500, sealAmount: 2.5e7, breakTimes: 0, industry: '家电零部件' },
  { code: '300123', name: '某ST股', price: 3.2, pct: 5, amount: 2e7, floatCap: 12e8, turnover: 3.2, boards: 1, firstSeal: 130000, sealAmount: 1e6, breakTimes: 0, industry: '其他' }
];

const emotion = E.emotion({
  zt: 16, dt: 15, zb: 11, maxBoard: 3,
  up: 1500, down: 3700, volRatio: 0.94, premium: 0.8, advanceRate: 0.25
});

const short = E.shortPool(ztPool);

const swingItems = [
  {
    code: '688820', name: '盛合晶微', price: 99.45, pct: 0.05, floatCap: 320e8,
    score: 60, grade: 'B', buyReady: true, heapMonths: 4, gather: 18.3, volShrink: 0.42,
    isYin: true, limitUpDays: 1, pos250: 0.72, pos60: 0.66, weekUp: true, ma20Up: true,
    ma20: 95.2, todayPct: 0.05,
    conditions: { heap: true, weekUp: true, ma20Up: true, bull: true, hasLimitUp: true, shrink: true, yin: true, notHigh: true, steady: true, aboveMa20: true }
  },
  {
    code: '688372', name: '伟测科技', price: 88.96, pct: -3.39, floatCap: 180e8,
    score: 52, grade: 'C', buyReady: false, heapMonths: 3, gather: 22.1, volShrink: 0.61,
    isYin: true, limitUpDays: 1, pos250: 0.81, pos60: 0.7, weekUp: true, ma20Up: true,
    ma20: 87.1, todayPct: -3.39,
    conditions: { heap: false, weekUp: true, ma20Up: true, bull: false, hasLimitUp: true, shrink: true, yin: true, notHigh: true, steady: true, aboveMa20: true }
  }
];

const st = {
  tab: 'market',
  pickTab: 'short',
  market: {
    indexes: [
      { code: '000001', name: '上证指数', price: 3559.94, pct: -0.78, amount: 1.9e11, vol: 1.3e8 },
      { code: '399001', name: '深证成指', price: 10542.86, pct: -1.09, amount: 2.4e11, vol: 1.7e8 },
      { code: '399006', name: '创业板指', price: 2281.70, pct: -1.29, amount: 1.3e11, vol: 8e7 }
    ],
    emotion,
    premium: { avgPct: 0.8, advanceRate: 0.25, count: 41 },
    sectors: short.sectors,
    ladder: [{ boards: 3, count: 2 }, { boards: 2, count: 5 }, { boards: 1, count: 9 }],
    turnover: 4.3e11,
    volume: E.volumeRegime(1.3051472e12, {
      volRatio: 0.894, downDays: 2, peakDrawdown: -0.199, trend5: 0.956
    }),
    updatedAt: Date.now(),
    counts: { zt: 16, dt: 15, zb: 11 }
  },
  short,
  swing: { items: swingItems, filter: 'ready', scanned: 68 },
  swingScanning: false
};

console.log('\n渲染冒烟测试');

console.log('\n· 市场页');
checkHtml('市场页', UI.renderMarket(st));

console.log('\n· 选股页（短线）');
checkHtml('短线池', UI.renderPicks(st));

console.log('\n· 选股页（波段）');
st.pickTab = 'swing';
checkHtml('波段池', UI.renderPicks(st));
st.pickTab = 'short';

console.log('\n· 风控页');
checkHtml('风控页', UI.renderRisk(st));

console.log('\n· 设置页');
checkHtml('设置页', UI.renderSettings(st));

console.log('\n· 空态');
checkHtml('无数据市场页', UI.renderMarket({ market: null }));
checkHtml('无涨停选股页', UI.renderPicks({ market: st.market, short: { list: [], sectors: [] }, pickTab: 'short' }));
checkHtml('未扫描波段页', UI.renderPicks({ market: st.market, pickTab: 'swing', swing: null, swingScanning: false }));

console.log('\n· 持仓页');
const PF = YB.pf;
const pfPhase = E.emotion({ zt: 35, dt: 5, zb: 12, maxBoard: 4, up: 2400, down: 2600, volRatio: 1.0, premium: 1.2 });

PF.reset();
PF.add({ code: '600000', name: '浦发银行', shares: 2000, cost: 10.0 });
PF.add({ code: '002685', name: '华东重机', shares: 5000, cost: 7.6 });

const quotes = {
  '600000': { code: '600000', name: '浦发银行', price: 10.7, prev: 10.65, pct: 0.47 },
  '002685': { code: '002685', name: '华东重机', price: 7.1, prev: 7.3, pct: -2.74 }
};
const snap = PF.snapshot(quotes, 100000, 6, pfPhase);
const pfState = { pf: snap, pfLoading: false, market: st.market };

checkHtml('持仓页', UI.renderPortfolio(pfState));

ok('持仓市值 = 2000×10.7 + 5000×7.1', Math.abs(snap.totalMV - (21400 + 35500)) < 1, snap.totalMV);
ok('总盈亏为负', snap.totalPnl < 0, snap.totalPnl);
ok('仓位按总资金算', Math.abs(snap.totalWeight - 56.9) < 0.1, snap.totalWeight);
ok('单只权重 = 市值 ÷ 总资金', Math.abs(snap.rows[0].weight - snap.rows[0].marketValue / 100000 * 100) < 1e-9, snap.rows[0].weight);
ok('跌破止损被识别', snap.rows.some((r) => r.status === 'stop'),
  snap.rows.map((r) => r.code + ':' + r.status));

const issues = PF.audit(snap);
ok('体检发现超仓问题', issues.some((i) => /总仓位/.test(i.title)), issues.map((i) => i.title));

// 加权成本合并
PF.add({ code: '600000', name: '浦发银行', shares: 1000, cost: 11.2 });
const merged = PF.list().filter((x) => x.code === '600000')[0];
ok('同代码买入按加权成本合并', merged.shares === 3000 && Math.abs(merged.cost - (2000 * 10 + 1000 * 11.2) / 3000) < 1e-9,
  merged.shares + '股 @ ' + merged.cost.toFixed(4));

PF.close(merged.id, 11.5);
ok('清仓后持仓减少', PF.list().length === 1, PF.list().length);
ok('交割单记一笔', PF.realized().count === 1, PF.realized().count);
ok('已实现盈亏 = (11.5-10.4)×3000', Math.abs(PF.realized().total - (11.5 - 10.4) * 3000) < 0.01, PF.realized().total);

PF.reset();
const emptyState = { pf: PF.snapshot({}, 100000, 6, pfPhase), pfLoading: false };
checkHtml('空持仓页', UI.renderPortfolio(emptyState));
ok('空持仓页有添加入口', UI.renderPortfolio(emptyState).indexOf('btnAddPos') >= 0);

console.log('\n· 设置二级页');
['datasource', 'advanced', 'about'].forEach(function (n) {
  checkHtml('二级页 ' + n, UI.renderSettingsSub({ stack: [{ name: n }], market: st.market }));
});
checkHtml('设置主页', UI.renderSettings(st));
const settingsHtml = UI.renderSettings(st);
ok('设置主页有 4 个二级入口（数据源/高级/更新/关于）',
  (settingsHtml.match(/data-nav="/g) || []).length === 4,
  (settingsHtml.match(/data-nav="/g) || []).length);
ok('设置页含软件更新入口', settingsHtml.indexOf('软件更新') >= 0);
ok('设置页显示真实版本号而非 v1.0',
  /野人量化 v[\d.]+/.test(settingsHtml) && settingsHtml.indexOf('野人量化 v1.0') < 0,
  (settingsHtml.match(/野人量化 v[\d.]*/) || [])[0]);

console.log('\n· 个股页（极简布局）');
{
  const bars = [];
  let px = 10;
  for (let i = 0; i < 60; i++) {
    const o = px, c2 = +(px * (1 + Math.sin(i / 5) * 0.02)).toFixed(2);
    bars.push({
      date: '2026-0' + (1 + Math.floor(i / 30)) + '-' + String((i % 28) + 1).padStart(2, '0'),
      open: o, close: c2, high: +(Math.max(o, c2) * 1.01).toFixed(2),
      low: +(Math.min(o, c2) * 0.99).toFixed(2), vol: 1e6 + i * 1e4
    });
    px = c2;
  }

  const analysis = {
    code: '600000', name: '浦发银行', price: 10.5, pct: 1.2,
    verdict: 'watch', verdictText: '只做回封',
    reasons: ['当前绝对龙头，市场注意力集中在这里', '已在天花板，需破局才可参与'],
    position: {
      vwap60: 8.21, devFromCost: 27.9, pos60: 0.79, pos250: 0.79,
      volTrend: 1.41, vol: { r20: 1.4, r60: 2.2, pct120: 0.65 }
    },
    gene: { count: 16, window: 250, threshold: 9.5, avgNext: 2.67, premiumRate: 0.56,
      continueRate: 0.44, lastDaysAgo: 1, verdict: '中性，接力看当天盘口' },
    tech: { ma5: 10.74, ma10: 10.12, ma20: 9.54, ma60: 8.48, align: '多头排列',
      resistance: 10.74, support: 10.12, toResistance: 2.7, toSupport: -2.9, aboveMa20: 10.1 },
    rs: { stockReturn: 34.5, indexReturn: -4.2, rs: 1.405, label: '强于大盘' },
    plan: { stopPrice: 10.02, stopBasis: '跌破支撑 10.12', stopPct: 4.6,
      target1: 11.55, target2: 13.65, suggested: 10, firstEntry: 10, amount: 10000 },
    sector: { name: '家电', rank: 1, total: 4, limitUp: 2 }
  };

  const chips = {
    dist: [], lo: 8, hi: 12, step: 0.04, price: 10.5,
    profitRatio: 0.52, avgCost: 9.86, p5: 8.9, p95: 11.4,
    concentration: 18.1, peakPrice: 10.3, window: 150, devFromAvg: 6.5
  };

  const minute = [];
  for (let i = 0; i < 240; i++) {
    const t = i < 120 ? 570 + i : 780 + (i - 120);
    minute.push({ t: t, price: 10 + Math.sin(i / 20) * 0.15, avg: 10.02,
      vol: 1000 + (i % 20) * 60, cumVol: (i + 1) * 1000, cumAmt: 0 });
  }

  const quote = { price: 10.5, pct: 1.2, open: 10.4, high: 10.6, low: 10.3,
    amount: 1.2e8, turnover: 19.3, volRatio: 1.04, floatCap: 200e8, pe: 12, prev: 10.37 };

  const mk = function (extra) {
    return {
      stack: [{ name: 'kline', code: '600000' }],
      kline: Object.assign({
        code: '600000', name: '浦发银行', period: 'day', loading: false,
        view: bars, bars: { day: bars }, analysis: analysis,
        minute: minute, chips: chips, quote: quote
      }, extra || {})
    };
  };

  const html = UI.renderKline(mk({}));
  checkHtml('个股页', html);

  /* 结构 */
  ok('默认显示日K（筹码叠加在K线上）', html.indexOf('data-chart="day" class="on"') >= 0);
  ok('主图切换只有两个词', (html.match(/data-chart=/g) || []).length === 2);
  ok('不再有侧边竖排菜单', html.indexOf('chart-tabs') < 0);
  ok('不再有周期切换', html.indexOf('kperiod') < 0);
  ok('不再有十字光标 DOM 行', html.indexOf('klineInfo') < 0);
  ok('决策在主图之前', html.indexOf('dv-v') < html.indexOf('mainChart'));

  /* 决策：结论 + 三格 */
  ok('显示结论', html.indexOf('只做回封') >= 0);
  ok('显示止损价', html.indexOf('10.02') >= 0);
  ok('显示目标价', html.indexOf('11.55') >= 0);
  ok('显示仓位', html.indexOf('仓位') >= 0 && html.indexOf('10%') >= 0);

  /* 指标网格：信息不能因极简而丢失 */
  const must = ['成本', '偏离', '获利', '压力', '支撑', '均线',
    'RS', '量能', '涨停', '次日', '连板'];
  must.forEach(function (label) {
    ok('网格含「' + label + '」', html.indexOf('>' + label + '<') >= 0 ||
      html.indexOf('>' + label + '</em>') >= 0, label);
  });
  ok('网格含板块排名', html.indexOf('家电') >= 0 && html.indexOf('1/4') >= 0);
  ok('网格含主力成本数值', html.indexOf('8.21') >= 0);
  ok('网格含获利比例', html.indexOf('52%') >= 0);

  /* 废话必须没有 */
  const noise = ['按住图表滑动', '来源腾讯行情', '绝对数值供参照', '决定这一笔亏在哪',
    '决定值不值得接力', '位置与技术位', '涨停基因', '两市量能', '正在刷新'];
  noise.forEach(function (t) {
    ok('已删除说明文字「' + t + '」', html.indexOf(t) < 0, t);
  });

  /* 价格行 */
  ok('价格行含换手与量比', html.indexOf('换手') >= 0 && html.indexOf('量比') >= 0);
  ok('价格行不重复开高低额（图上已有）', html.indexOf('开 ') < 0 && html.indexOf('额 ') < 0);

  /* 分时模式 */
  const minuteHtml = UI.renderKline(mk({ chart: 'minute' }));
  checkHtml('分时模式', minuteHtml);
  ok('分时模式仍显示指标网格', minuteHtml.indexOf('成本') >= 0);
  ok('分时模式隐藏缩放按钮', minuteHtml.indexOf('data-zoom') < 0);
  ok('分时模式价格行显示均价与高低',
    minuteHtml.indexOf('均价') >= 0 && minuteHtml.indexOf('高 <b>') >= 0);
  ok('分时模式不再显示换手/量比', minuteHtml.indexOf('换手') < 0);
  ok('日K 模式显示缩放按钮', html.indexOf('data-zoom') >= 0);

  /* 无筹码时降级 */
  const noChips = UI.renderKline(mk({ chart: 'day', chips: null }));
  checkHtml('无筹码', noChips);
  ok('无筹码时仍正常渲染网格', noChips.indexOf('成本') >= 0);

  /* 加载态与错误态 */
  checkHtml('加载态', UI.renderKline({
    stack: [{ name: 'kline' }],
    kline: { code: '1', name: '测试', loading: true }
  }));
  checkHtml('错误态', UI.renderKline({
    stack: [{ name: 'kline' }],
    kline: { code: '1', name: '测试', loading: false, error: '获取失败', view: [] }
  }));
}

console.log('\n· 软件更新页');
{
  const U2 = YB.update;
  const page = function () { return UI.renderSettingsSub({ stack: [{ name: 'update' }] }); };

  /* 1) 还没查过 */
  U2.state.latest = null; U2.state.error = ''; U2.state.checking = false;
  U2.state.downloading = false; U2.state.installError = '';
  const h1 = page();
  checkHtml('更新页-初始', h1);
  ok('初始态只给检查按钮', h1.indexOf('data-up="check"') >= 0 && h1.indexOf('data-up="install"') < 0);
  ok('初始态显示当前版本', /v1\.\d+\.\d+/.test(h1));

  /* 2) 发现新版本 */
  U2.state.latest = {
    versionCode: 99, versionName: '9.9.9', size: 150000,
    releasedAt: '2026-11-21T10:00:00+08:00',
    notes: ['K 线手势按方向分流', '筹码叠加到日 K 右侧']
  };
  const h2 = page();
  checkHtml('更新页-有新版本', h2);
  ok('显示新版本号', h2.indexOf('v9.9.9') >= 0);
  ok('给出下载按钮', h2.indexOf('data-up="install"') >= 0);
  ok('更新说明逐条列出',
    h2.indexOf('手势按方向分流') >= 0 && h2.indexOf('筹码叠加') >= 0);
  ok('显示包体积', /KB/.test(h2));

  /* 3) 已是最新 */
  U2.state.latest = { versionCode: 1, versionName: '0.0.1', notes: [] };
  const h3 = page();
  checkHtml('更新页-已最新', h3);
  ok('无更新时提示已最新', h3.indexOf('已是最新') >= 0);
  ok('无更新时不给下载按钮', h3.indexOf('data-up="install"') < 0);

  /* 4) 检查失败要给出下一步，而不只是报错 */
  U2.state.latest = null;
  U2.state.error = '检查超时，GitHub 相关域名可能需要代理';
  const h4 = page();
  checkHtml('更新页-失败', h4);
  ok('失败时给出可执行的提示', h4.indexOf('代理') >= 0);
  ok('失败时仍能重试', h4.indexOf('data-up="check"') >= 0);

  /* 5) 下载中 */
  U2.state.error = '';
  U2.state.latest = { versionCode: 99, versionName: '9.9.9', notes: [] };
  U2.state.downloading = true;
  U2.state.done = 73; U2.state.total = 100;
  U2.state.stage = '下载中';
  const h5 = page();
  checkHtml('更新页-下载中', h5);
  ok('下载中显示进度条', h5.indexOf('up-prog') >= 0);
  ok('下载中显示百分比', h5.indexOf('73%') >= 0);
  ok('下载中不再重复给下载按钮', h5.indexOf('data-up="install"') < 0);

  /* 复原，避免影响后续用例 */
  U2.state.downloading = false;
  U2.state.done = 0; U2.state.total = 0; U2.state.stage = '';
  U2.state.latest = null;
}

console.log('\n· 板块二级页');
{
  const pool = [
    { code: '002242', name: '九阳股份', pct: 10.01, amount: 51.29e8, floatCap: 237.8e8,
      turnover: 23.74, boards: 1, firstSeal: 92500, sealAmount: 6448e4,
      sealRatio: 6448e4 / 237.8e8, industry: '小家电', breakTimes: 13 },
    { code: '603868', name: '飞科电器', pct: 10, amount: 3e8, floatCap: 60e8,
      turnover: 5, boards: 2, firstSeal: 95500, sealAmount: 1.5e8,
      sealRatio: 1.5e8 / 60e8, industry: '小家电', breakTimes: 0 }
  ];
  const sst = {
    stack: [{ name: 'sector', key: '小家电' }],
    short: { list: pool, sectors: [] },
    market: st.market
  };
  const secHtml = UI.renderSector(sst);
  checkHtml('板块页', secHtml);
  ok('板块页含返回按钮', secHtml.indexOf('data-nav="back"') >= 0);
  ok('板块页列出全部成员', secHtml.indexOf('九阳股份') >= 0 && secHtml.indexOf('飞科电器') >= 0);
  ok('板块页含审美分', /class="aes-score num">\d+/.test(secHtml));
  ok('板块页成员可点进K线', secHtml.indexOf('data-kline="002242"') >= 0);
  ok('板块页已删排序说明（信息靠排序本身表达）', secHtml.indexOf('按<b>审美</b>排序') < 0);

  const noSec = UI.renderSector({ stack: [{ name: 'sector', key: '空板块' }], short: { list: pool }, market: st.market });
  checkHtml('板块空态', noSec);
  ok('空板块给出提示', noSec.indexOf('没有该板块') >= 0);
}

console.log('\n· 涨停梯队展开');
{
  const ladder = [
    { boards: 3, count: 2, list: [
      { code: '600001', name: '甲股票', price: 12.3, pct: 10, sealAmount: 2e8, industry: '算力' },
      { code: '600002', name: '乙股票', price: 8.8, pct: 10, sealAmount: 1e8, industry: '算力' }
    ] },
    { boards: 2, count: 1, list: [
      { code: '600003', name: '丙股票', price: 5.5, pct: 10, sealAmount: 5e7, industry: '纺织' }
    ] }
  ];
  const mst = {
    market: {
      indexes: st.market.indexes, emotion: st.market.emotion,
      premium: st.market.premium, sectors: st.market.sectors,
      ladder: ladder, turnover: 4.3e11, updatedAt: Date.now()
    },
    ladderPick: 3,
    short: st.short
  };
  const expanded = UI.renderMarket(mst);
  checkHtml('梯队展开态', expanded);
  ok('点开 3 板能看到个股', expanded.indexOf('甲股票') >= 0 && expanded.indexOf('乙股票') >= 0);
  ok('展开后另一档不显示', expanded.indexOf('丙股票') < 0);
  ok('个股行带 data-kline', expanded.indexOf('data-kline="600001"') >= 0);
  ok('选中的档有高亮 class', expanded.indexOf('ladder-cell hot on') >= 0 || expanded.indexOf('ladder-cell on') >= 0);

  mst.ladderPick = null;
  const collapsed = UI.renderMarket(mst);
  ok('未展开时提示可点击', collapsed.indexOf('点上方数字') >= 0);
  ok('未展开时不渲染个股', collapsed.indexOf('甲股票') < 0);
}

console.log('\n· 关键内容断言');
const marketHtml = UI.renderMarket(st);
ok('市场页显示阶段', marketHtml.indexOf(emotion.phase) >= 0, emotion.phase);
ok('市场页显示仓位上限', marketHtml.indexOf(String(emotion.maxPosition)) >= 0, emotion.maxPosition);
ok('市场页含涨停梯队', marketHtml.indexOf('涨停梯队') >= 0);
ok('市场页含板块榜', marketHtml.indexOf('板块涨停榜') >= 0);
ok('板块榜行可点击进入二级页', marketHtml.indexOf('data-sector=') >= 0);
ok('市场页含两市量能', marketHtml.indexOf('两市量能') >= 0);
ok('量能缩量时不用「温和」作主标签', marketHtml.indexOf('温和') < 0);

const picksHtml = UI.renderPicks(st);
ok('选股页含龙一标签', picksHtml.indexOf('龙一') >= 0);
ok('选股页含 ST 否决提示', picksHtml.indexOf('ST') >= 0);

const riskHtml = UI.renderRisk(st);
ok('风控页含黑名单', riskHtml.indexOf('黑名单') >= 0);
ok('风控页含执行清单', riskHtml.indexOf('每日执行清单') >= 0);

console.log('\n────────────────────────');
console.log('通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
