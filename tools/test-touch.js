/**
 * 触摸手势测试：验证「横向看图、纵向滚页面」的分流是否正确。
 *
 * 背景：K 线原来用 touch-action: none + 无差别 preventDefault，
 * 导致手指按在图表上就滑不动页面。这类 bug 在真机上才暴露，
 * 所以在这里用事件桩把它钉住。
 */
const path = require('path');

global.window = { devicePixelRatio: 1, addEventListener: () => {}, removeEventListener: () => {} };
global.document = { documentElement: { getAttribute: () => 'dark' } };
global.getComputedStyle = () => ({ getPropertyValue: () => '' });

require(path.join('G:/数据文件/work/2026-11-19-09-46-28/www/js', 'util.js'));
require(path.join('G:/数据文件/work/2026-11-19-09-46-28/www/js', 'kline.js'));
const K = global.window.YB.kline;

const noop = () => {};
function makeCtx() {
  return {
    setTransform: noop, clearRect: noop, beginPath: noop, moveTo: noop, lineTo: noop,
    stroke: noop, fill: noop, fillRect: noop, strokeRect: noop, fillText: noop,
    measureText: (t) => ({ width: String(t).length * 6 }),
    setLineDash: noop, save: noop, restore: noop,
    arcTo: noop, quadraticCurveTo: noop, arc: noop, closePath: noop,
    translate: noop, scale: noop, rotate: noop, clip: noop,
    font: '', textBaseline: '', textAlign: '', lineWidth: 1, globalAlpha: 1,
    strokeStyle: '', fillStyle: ''
  };
}

const handlers = {};
const canvas = {
  clientWidth: 360, clientHeight: 420, width: 0, height: 0,
  getContext: () => makeCtx(),
  addEventListener: (name, fn) => { handlers[name] = fn; },
  style: {}
};

const bars = [];
let px = 30;
for (let i = 0; i < 120; i++) {
  const o = px, c = +(px * (1 + Math.sin(i / 8) * 0.02)).toFixed(2);
  bars.push({ date: '2026-0' + (1 + (i % 9)) + '-' + String((i % 28) + 1).padStart(2, '0'),
    open: o, close: c, high: +(Math.max(o, c) * 1.01).toFixed(2),
    low: +(Math.min(o, c) * 0.99).toFixed(2), vol: 1e6 });
  px = c;
}

K.draw(canvas, bars, { visible: 30, axisFormat: 'day' });
K.attach(canvas, bars, () => {}, { visible: 30, axisFormat: 'day' });

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  → ' + detail : '')); }
}

function touch(x, y) {
  return { touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }],
    cancelable: true, prevented: false,
    preventDefault() { this.prevented = true; } };
}

console.log('触摸手势分流\n');

// 1) 按下时不能阻止默认行为，否则一开始就掐断滚动
{
  const e = touch(200, 200);
  handlers.touchstart(e);
  ok('touchstart 不阻止默认行为（否则页面滑不动）', e.prevented === false, e.prevented);
}

// 2) 纵向滑动：交给页面滚动
{
  handlers.touchstart(touch(200, 200));
  const e = touch(201, 240);      // 主要向下移动
  handlers.touchmove(e);
  ok('纵向滑动不阻止默认行为（页面可以滚）', e.prevented === false, e.prevented);
}

// 3) 横向滑动：接管，用于看 K 线
{
  handlers.touchstart(touch(200, 200));
  const e = touch(260, 202);      // 主要横向移动
  handlers.touchmove(e);
  ok('横向滑动阻止默认行为（接管看图）', e.prevented === true, e.prevented);
}

// 4) 纵向判定之后，后续横向位移也不应重新接管（避免滚动中途被抢）
{
  handlers.touchstart(touch(200, 200));
  handlers.touchmove(touch(201, 260));   // 先纵向
  const e = touch(280, 262);             // 再横向
  handlers.touchmove(e);
  ok('一旦判定为纵向就不再抢事件', e.prevented === false, e.prevented);
}

// 5) 微小抖动不应误判为横向
{
  handlers.touchstart(touch(200, 200));
  const e = touch(202, 201);
  handlers.touchmove(e);
  ok('小于阈值的抖动不触发接管', e.prevented === false, e.prevented);
}

// 6) 轻点：显示十字光标（回调收到下标）
{
  let got = null;
  const h2 = {};
  const c2 = Object.assign({}, canvas, {
    addEventListener: (n, f) => { h2[n] = f; }
  });
  K.draw(c2, bars, { visible: 30, axisFormat: 'day' });
  K.attach(c2, bars, (bar, i) => { got = i; }, { visible: 30, axisFormat: 'day' });
  h2.touchstart(touch(200, 200));
  h2.touchend(touch(200, 201));
  ok('轻点图表显示该根 K 线的十字光标', got != null && got >= 0, got);
}

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
