/**
 * 生成个股详情页的静态预览（真实数据）
 *
 * 用途：在没有真机、浏览器截图工具不可用时，仍能核对页面结构与样式。
 * 运行：node tools/preview-kline.js 002242
 * 产物：build/preview-kline-<code>.html（直接用浏览器打开）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'www');
const code = process.argv[2] || '002242';

/* ---------- 最小浏览器环境 ---------- */
global.window = {};
global.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  dispatchEvent: () => {},
  getElementById: () => null,
  documentElement: { setAttribute: () => {}, getAttribute: () => 'dark' },
  createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} })
};
global.CustomEvent = class { constructor(n, o) { this.type = n; this.detail = o && o.detail; } };
global.navigator = { userAgent: 'node' };
global.getComputedStyle = () => ({ getPropertyValue: () => '' });
global.localStorage = null;

['util.js', 'net.js', 'sources.js', 'engine.js', 'portfolio.js', 'kline.js', 'ui.js']
  .forEach((f) => require(path.join(WEB, 'js', f)));

const YB = global.window.YB;

/* ---------- 拉真实数据 ---------- */
function fetchText(url) {
  const { execFileSync } = require('child_process');
  return execFileSync('curl', ['-s', '-m', '20', url], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function txCode(c) {
  const s = String(c).replace(/\D/g, '').slice(-6);
  if (/^(60|68|9)/.test(s) && !/^920/.test(s)) return 'sh' + s;
  if (/^(4|8|920)/.test(s)) return 'bj' + s;
  return 'sz' + s;
}

function loadKline(tx, count) {
  const url = 'https://proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get?_var=k&param=' +
    tx + ',day,,,' + count + ',qfq';
  const raw = fetchText(url);
  const json = JSON.parse(raw.slice(raw.indexOf('=') + 1));
  const node = json.data[tx];
  const key = Object.keys(node).filter((k) => Array.isArray(node[k]) && k.endsWith('day'))[0];
  return node[key].map((r) => ({
    date: r[0], open: +r[1], close: +r[2], high: +r[3], low: +r[4], vol: +r[5]
  }));
}

function loadQuote(tx) {
  const { execFileSync } = require('child_process');
  const buf = execFileSync('curl', ['-s', '-m', '20', 'https://qt.gtimg.cn/q=' + tx],
    { maxBuffer: 8 * 1024 * 1024 });
  // 腾讯行情是 GBK，必须显式解码，否则股票名会乱码
  let txt;
  try {
    txt = new TextDecoder('gbk').decode(buf);
  } catch (e) {
    txt = buf.toString('latin1');
  }
  const body = txt.split('="')[1] || '';
  const f = body.replace(/";?\s*$/, '').split('~');
  if (f.length < 50) return null;
  const num = (v) => (v === '' || v == null ? 0 : Number(v));
  return {
    code: f[2], name: f[1],
    price: num(f[3]), prev: num(f[4]), open: num(f[5]),
    pct: num(f[32]), high: num(f[33]), low: num(f[34]),
    vol: num(f[6]), amount: num(f[37]) * 1e4,
    turnover: num(f[38]), pe: num(f[39]), volRatio: num(f[49]),
    floatCap: num(f[44]) * 1e8, totalCap: num(f[45]) * 1e8
  };
}

function loadMinute(tx) {
  try {
    const raw = fetchText('https://proxy.finance.qq.com/ifzqgtimg/appstock/app/minute/query?_var=m&code=' + tx);
    const json = JSON.parse(raw.slice(raw.indexOf('=') + 1));
    const arr = json.data[tx].data.data;
    const out = [];
    let lv = 0, la = 0;
    arr.forEach(function (line) {
      const p = String(line).split(/\s+/);
      if (p.length < 3 || !/^\d{4}$/.test(p[0])) return;
      const hh = +p[0].slice(0, 2), mm = +p[0].slice(2, 4);
      const price = +p[1], cv = +p[2], ca = p[3] ? +p[3] : 0;
      if (!(price > 0)) return;
      out.push({
        t: hh * 60 + mm, price: price,
        vol: Math.max(0, cv - lv), cumVol: cv,
        avg: cv > 0 && ca > 0 ? ca / (cv * 100) : price
      });
      lv = cv; la = ca;
    });
    return out.length > 2 ? out : null;
  } catch (e) {
    return null;
  }
}

console.log('拉取 ' + code + ' 数据…');
const tx = txCode(code);
const bars = loadKline(tx, 320);
const idxBars = loadKline('sh000001', 320);
const quote = loadQuote(tx);
console.log('K线 ' + bars.length + ' 根，最新 ' + bars[bars.length - 1].date +
  ' 收 ' + bars[bars.length - 1].close);

/* ---------- 造一个接近真实的上下文 ---------- */
const last = bars[bars.length - 1];
const price = quote && quote.price > 0 ? quote.price : last.close;

const emotion = YB.engine.emotion({
  zt: 23, dt: 71, zb: 24, maxBoard: 3,
  up: 1400, down: 3900, volRatio: 0.9, premium: -1.2
});

// 传 --pool 时模拟「这只票正在涨停池里」的上下文；默认按当前真实状态（可能已断板）
const inPool = process.argv.indexOf('--pool') >= 0;
const reasonOpen = process.argv.indexOf('--open') >= 0;
const poolItem = inPool ? {
  veto: false, relay: 'ceiling', isLeader: true, score: 88,
  breakTimes: 13, flags: [], industry: '家电'
} : null;

const analysis = YB.engine.analyzeStock(bars, quote || {}, {
  code: code,
  indexBars: idxBars,
  emotion: emotion,
  poolItem: poolItem,
  capital: 100000,
  stopPct: 6,
  phaseKey: emotion.phaseKey
});

if (!analysis) {
  console.error('分析失败，K 线不足');
  process.exit(1);
}

if (inPool) analysis.sector = { name: '家电', rank: 1, total: 4, limitUp: 2 };

// 分时
const minute = loadMinute(tx);
console.log('分时点数: ' + (minute ? minute.length : 0));

// 筹码：流通股本 = 流通市值 ÷ 现价
const fcap = quote && quote.floatCap > 0 ? quote.floatCap : 0;
const chips = YB.engine.computeChips(bars, {
  price: price,
  bins: 96,
  floatShares: fcap > 0 ? fcap / price : 0
});
if (chips) {
  console.log('筹码: 平均成本 ' + chips.avgCost.toFixed(2) +
    ' 获利 ' + Math.round(chips.profitRatio * 100) + '%' +
    ' 集中度 ' + chips.concentration.toFixed(1) + '%');
}

/* ---------- 渲染 ---------- */
const chartMode = (function () {
  const i = process.argv.indexOf('--chart');
  return i >= 0 ? process.argv[i + 1] : 'day';
})();

const st = {
  stack: [{ name: 'kline', code: code }],
  kline: {
    code: code, name: analysis.name || quote && quote.name || code,
    period: 'day', loading: false, chart: chartMode,
    view: bars, bars: { day: bars }, quote: quote, analysis: analysis,
    reasonOpen: reasonOpen, minute: minute, chips: chips
  }
};

const body = YB.ui.renderKline(st);

const css = fs.readFileSync(path.join(WEB, 'css', 'app.css'), 'utf8');

const klineSrc = fs.readFileSync(path.join(WEB, 'js', 'kline.js'), 'utf8');
const barsJson = JSON.stringify(bars.slice(-160));

const html = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>个股页预览 · ${code}</title>
<style>
${css}
/* 预览：结构与真实 App 保持一致（body > main#view），
   不要套额外的居中容器——那会让整体右移，右侧按钮被裁。
   注意 app.css 用的是 main#view 选择器，这里必须用 main 标签。 */
html, body {
  margin: 0; padding: 0;
  width: 390px; max-width: 390px;
  background: var(--bg); color: var(--text);
  font-family: var(--font);
  overflow-x: hidden;
}
.page-head { position: static; }
</style>
</head>
<body>
<main id="view">${body}</main>
<script>window.YB = {};</script>
<script>${klineSrc}</script>
<script>
  var BARS = ${barsJson};
  var MODE = ${JSON.stringify(chartMode)};
  var MINUTE = ${JSON.stringify(minute)};
  var CHIPS = ${JSON.stringify(chips)};
  var PREV = ${JSON.stringify(quote && quote.prev || 0)};
  var cv = document.getElementById('mainChart');
  function paint() {
    if (!cv || !window.YB || !window.YB.kline) return;
    var K = window.YB.kline;
    if (MODE === 'minute') {
      if (!MINUTE || MINUTE.length < 2) {
        var g = cv.getContext('2d');
        g.fillStyle = '#626b76'; g.font = '12px sans-serif'; g.textAlign = 'center';
        g.fillText('分时数据未取到', cv.clientWidth / 2, cv.clientHeight / 2);
        return;
      }
      K.drawMinute(cv, MINUTE, { prevClose: PREV });
    } else if (MODE === 'chips') {
      if (!CHIPS) {
        var g2 = cv.getContext('2d');
        g2.fillStyle = '#626b76'; g2.font = '12px sans-serif'; g2.textAlign = 'center';
        g2.fillText('筹码数据未计算', cv.clientWidth / 2, cv.clientHeight / 2);
        return;
      }
      K.drawChips(cv, CHIPS, {});
    } else {
      K.draw(cv, BARS, { visible: 22, axisFormat: 'day', chips: CHIPS });
    }
  }
  requestAnimationFrame(paint);
  setTimeout(paint, 120);
  window.addEventListener('resize', paint);
</script>
</body>
</html>`;

const outDir = path.join(ROOT, 'build');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'preview-kline-' + code + (inPool ? '-pool' : '') +
  (reasonOpen ? '-open' : '') + '-' + chartMode + '.html');
fs.writeFileSync(out, html, 'utf8');

console.log('\n【结论】' + analysis.verdict + ' / ' + analysis.verdictText);
console.log('【理由】' + analysis.reasons.join('；'));
console.log('【价位】止损 ' + analysis.plan.stopPrice + '（' + analysis.plan.stopBasis + '）' +
  ' 目标 ' + analysis.plan.target1 + ' 仓位 ' + analysis.plan.suggested + '%');
console.log('【基因】' + analysis.gene.count + ' 次涨停，次日均值 ' +
  (analysis.gene.avgNext == null ? '—' : analysis.gene.avgNext.toFixed(2) + '%'));
console.log('\n已生成：' + out);
