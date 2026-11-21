/**
 * 集成冒烟测试：桩掉网络层，真跑一遍 app.js 的 loadMarket。
 *
 * 为什么需要它：`node --check` 只验语法，函数被误删、名字写错这类问题
 * 在浏览器里才暴露（例如出现 "recentHeightPeak is not defined"）。
 * 这里把数据源替换成固定桩，端到端跑一次编排流程。
 */
const path = require('path');

/* ---------- DOM 垫片 ---------- */
function fakeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    children: [],
    hidden: false,
    textContent: '',
    innerHTML: '',
    clientWidth: 360,
    clientHeight: 372,
    width: 0,
    height: 0,
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {},
    setAttribute() {},
    getAttribute() { return null; },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return fakeEl(); },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 360, height: 372 }; },
    focus() {},
    select() {},
    getContext() {
      return new Proxy({}, {
        get() { return () => ({ width: 10 }); },
        set() { return true; }
      });
    },
    measureText() { return { width: 10 }; }
  };
  return el;
}

global.window = { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
global.document = {
  readyState: 'complete',
  querySelector: () => fakeEl(),
  querySelectorAll: () => [],
  getElementById: () => fakeEl(),
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
  documentElement: { setAttribute() {}, getAttribute: () => 'dark', style: {} },
  createElement: (t) => fakeEl(t),
  head: fakeEl('head'),
  body: fakeEl('body')
};
global.CustomEvent = class { constructor(n, o) { this.type = n; this.detail = o && o.detail; } };
global.navigator = { userAgent: 'node' };
global.getComputedStyle = () => ({ getPropertyValue: () => '' });
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);

const web = path.resolve(__dirname, '..', 'www', 'js');
['util.js', 'net.js', 'sources.js', 'engine.js', 'portfolio.js', 'kline.js', 'ui.js'].forEach((f) => require(path.join(web, f)));

const YB = global.window.YB;

/* ---------- 数据桩 ---------- */
function makeBars(n) {
  const out = [];
  const d = new Date(2026, 3, 1);   // 从 4 月开始，覆盖多个月份
  let p = 10;
  for (let i = 0; i < n; i++) {
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    const ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0');

    const o = p;
    // 温和下行 + 波动：用来验证「缩量下跌」能被识别
    const c = +(p * (1 + (i % 5 - 2) * 0.004 - 0.0012)).toFixed(2);
    out.push({
      date: ds,
      open: o, close: c,
      high: +(Math.max(o, c) * 1.01).toFixed(2),
      low: +(Math.min(o, c) * 0.99).toFixed(2),
      // 量能阶梯式递减，模拟真实的量能中枢下移
      vol: 1e6 * Math.max(0.42, 1.45 - i * 0.006)
    });
    p = c;
    d.setDate(d.getDate() + 1);
  }
  return out;
}

const ZT_POOL = [
  { code: '002242', name: '九阳股份', price: 31.21, pct: 10.01, amount: 51.29e8, floatCap: 237.8e8,
    turnover: 23.74, boards: 1, firstSeal: 92500, sealAmount: 6448e4, breakTimes: 13, industry: '小家电' },
  { code: '002771', name: '真视通', price: 14.38, pct: 10.02, amount: 0.61e8, floatCap: 26e8,
    turnover: 2.36, boards: 3, firstSeal: 93100, sealAmount: 4e8, breakTimes: 0, industry: 'IT服务' },
  { code: '603931', name: '格林达', price: 29.15, pct: 10, amount: 3e8, floatCap: 60e8,
    turnover: 9, boards: 1, firstSeal: 101500, sealAmount: 8e7, breakTimes: 1, industry: '电子化学' }
];

const BARS = makeBars(160);

YB.src.indexQuotes = async () => ([
  // vol 要与 BARS 最后一天的量级对得上，否则量能趋势会被算成放量
  { code: '000001', name: '上证指数', price: 3577.62, pct: -0.28, amount: 6369e8, vol: 0.55e6 },
  { code: '399001', name: '深证成指', price: 10583.2, pct: -0.71, amount: 6682e8, vol: 0.55e6 },
  { code: '399006', name: '创业板指', price: 2293.34, pct: -0.79, amount: 0, vol: 0 }
]);
YB.src.limitUpPool = async () => ZT_POOL;
YB.src.limitDownPool = async () => [];
YB.src.brokenPool = async () => [];
YB.src.zdfenbu = async () => ({ up: 1400, down: 3900, flat: 43, limitUp: 23, limitDown: 71 });
YB.src.quotes = async () => ({});
YB.src.hotPool = async () => [];
YB.src.dayKline = async () => BARS;

/* ---------- 加载 app.js（会自启动） ---------- */
require(path.join(web, 'app.js'));

const st = YB.app.st;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

setTimeout(async () => {
  console.log('\n集成冒烟（桩数据）');

  ok('loadMarket 跑通并产出 market', !!st.market, st.market ? 'ok' : 'null');
  if (!st.market) {
    console.log('\n通过 ' + pass + ' / 失败 ' + fail);
    process.exit(1);
  }

  const m = st.market;
  ok('情绪评分已生成', !!m.emotion && typeof m.emotion.mes === 'number', m.emotion && m.emotion.mes);
  ok('高度天花板已计算', m.emotion.heightCap === 3, m.emotion.heightCap);
  ok('两市量能已计算', !!m.volume, m.volume ? m.volume.mainLabel : 'null');
  ok('量能识别为下行（撤退或走弱）',
    m.volume && (m.volume.trendKey === 'retreat' || m.volume.trendKey === 'weak'),
    m.volume && m.volume.trendKey);
  ok('量能中枢下移被识别', m.volume && m.volume.center.key === 'down',
    m.volume && m.volume.center.label);
  ok('月度量能序列覆盖多个月', m.volume && m.volume.monthly.length >= 4,
    m.volume && m.volume.monthly.length);
  ok('120 日分位已计算', m.volume && m.volume.position.p120 != null,
    m.volume && m.volume.position.p120);
  ok('下行时主标签不用「温和」', m.volume && m.volume.mainLabel !== '温和',
    m.volume && m.volume.mainLabel);
  ok('龙头已识别', !!m.leader, m.leader && m.leader.name);
  ok('龙头是九阳股份（人气主导）', m.leader && m.leader.code === '002242',
    m.leader && m.leader.name + ' ' + m.leader.leaderScore);
  ok('涨停池已评分', st.short && st.short.list.length === ZT_POOL.length,
    st.short && st.short.list.length);
  ok('梯队带个股列表', m.ladder.length > 0 && Array.isArray(m.ladder[0].list));

  // 渲染一次，确保 UI 能吃下这份数据
  try {
    const html = YB.ui.renderMarket(st);
    ok('市场页渲染成功', html.indexOf('两市量能') >= 0 && html.length > 500, html.length);
  } catch (e) {
    ok('市场页渲染成功', false, e.message);
  }

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
}, 300);
/* ---------- 快照：秒开的核心链路 ---------- */
(async () => {
  await new Promise(r => setTimeout(r, 80));

  const snap = YB.util.store.get('snap.market', null);
  ok('加载完成后写入了本地快照', !!(snap && snap.market), snap && snap.v);
  ok('快照带版本号，结构变更时能作废旧数据', snap && snap.v === 3, snap && snap.v);
  ok('快照精简了梯队（只保留渲染字段）',
    snap && snap.market.ladder && snap.market.ladder[0] &&
    Object.keys(snap.market.ladder[0].list[0]).length <= 8,
    snap && snap.market.ladder && snap.market.ladder[0] &&
    Object.keys(snap.market.ladder[0].list[0]).join(','));

  const size = JSON.stringify(snap).length;
  ok('快照体积在安全范围（< 900KB）', size < 900000, (size / 1024).toFixed(0) + 'KB');

  // 清空内存态后从快照恢复
  const realMarket = st.market;
  st.market = null;
  const restored = YB.app.restoreSnapshot();
  ok('能从快照恢复出市场态', restored === true && !!st.market.emotion, restored);
  ok('恢复后标记为 stale，界面会提示正在刷新', st.market && st.market.stale === true, st.market && st.market.stale);

  // 恢复后仍能正常渲染（字段被精简过，最容易在这里崩）
  let html = '';
  try {
    html = YB.ui.renderMarket({ market: st.market, short: st.short, ladderPick: null, tab: 'market' });
    ok('快照数据能正常渲染市场页', html.length > 500, html.length + ' 字符');
  } catch (e) {
    ok('快照数据能正常渲染市场页', false, e.message);
  }

  // 版本不匹配时应作废
  const bad = JSON.parse(JSON.stringify(snap));
  bad.v = 1;
  YB.util.store.set('snap.market', bad);
  st.market = null;
  ok('旧版本快照被作废（不会渲染错结构）', YB.app.restoreSnapshot() === false);

  // 恢复现场
  st.market = realMarket;
  YB.util.store.set('snap.market', snap);
})();

console.log('\nDONE');