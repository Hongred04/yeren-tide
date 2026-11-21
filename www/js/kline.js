/* ============================================================
 * 野人量化 · K 线图
 *
 * 手写 canvas 渲染，不引任何图表库。参照手机炒股软件的常见布局：
 *   主图（蜡烛 + MA5/10/20/60） / 副图（成交量 + 量均线） / 右侧价格轴 / 底部日期轴
 * 支持按住出现十字光标，读取某根 K 线的开高低收。
 *
 * 坐标约定：所有绘制都在 CSS 像素下进行，通过 setTransform(dpr) 做高分屏适配。
 * ============================================================ */
(function (YB) {
  'use strict';

  const PAD_L = 4;
  const PAD_R = 46;     // 右侧价格轴宽度
  const PAD_T = 8;
  const AXIS_H = 14;
  const GAP = 12;

  const MA_DEFS = [
    { n: 5, dark: '#f0b90b', light: '#c98a06' },
    { n: 10, dark: '#4da3ff', light: '#2f7fd1' },
    { n: 20, dark: '#c07ff0', light: '#8e5bb5' },
    { n: 60, dark: '#4ec9b0', light: '#1f8f7f' }
  ];

  function cssVar(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name);
      return (v && v.trim()) || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function palette() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
      dark: dark,
      up: cssVar('--up', '#f5475b'),
      down: cssVar('--down', '#1fbf75'),
      text: cssVar('--text', '#e9edf2'),
      text2: cssVar('--text-2', '#98a3b0'),
      text3: cssVar('--text-3', '#626b76'),
      border: cssVar('--border', '#242a33'),
      surface: cssVar('--surface', '#14181d'),
      ma: MA_DEFS.map((d) => (dark ? d.dark : d.light))
    };
  }

  /** 简单移动平均，返回与 bars 等长的数组，前置为 null */
  function maSeries(bars, n) {
    const out = new Array(bars.length).fill(null);
    let sum = 0;
    for (let i = 0; i < bars.length; i++) {
      sum += bars[i].close;
      if (i >= n) sum -= bars[i - n].close;
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }

  function fmtNum(v, digits) {
    if (v == null || !isFinite(v)) return '--';
    return v.toFixed(digits == null ? 2 : digits);
  }

  function fmtVol(shou) {
    if (!isFinite(shou) || shou <= 0) return '--';
    if (shou >= 1e8) return (shou / 1e8).toFixed(2) + '亿';
    if (shou >= 1e4) return (shou / 1e4).toFixed(1) + '万';
    return String(Math.round(shou));
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  var lastLayout = null;   // 记录当前画布布局，供坐标换算复用

  function draw(canvas, bars, opt) {
    const o = opt || {};
    const pal = palette();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const W = canvas.clientWidth || 320;
    const H = canvas.clientHeight || 360;

    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'middle';

    if (!bars || bars.length < 2) {
      ctx.fillStyle = pal.text3;
      ctx.textAlign = 'center';
      ctx.fillText(o.emptyText || '暂无K线数据', W / 2, H / 2);
      lastLayout = null;
      return;
    }

    /* 只画最近 visible 根：日线 320 根挤在手机宽度里会变成一排细线，
       但均线要用全量数据算，否则左端会缺段。 */
    const n = bars.length;
    const visible = Math.max(15, Math.min(o.visible || n, n));
    const from = n - visible;

    const volH = Math.max(46, Math.round(H * 0.19));
    const mainH = H - PAD_T - volH - GAP - AXIS_H - 4;
    /* 筹码叠加：在主图右侧划出一条竖向筹码带（同花顺/通达信的做法）。
       比「切到独立筹码页」有用得多——成本分布和 K 线位置必须同屏对照，
       才能回答「这一波涨到哪会被套牢盘压住」。 */
    const chipDist = o.chips && o.chips.dist ? o.chips.dist : null;
    const chipW = chipDist ? Math.round(W * 0.22) : 0;
    const axisW = 38;
    const plotW = Math.max(60, W - PAD_L - axisW - chipW);
    const chipLeft = PAD_L + plotW;

    const cw = plotW / visible;
    const bw = Math.max(1.2, Math.min(cw * 0.66, 14));

    const maS = MA_DEFS.map((d) => maSeries(bars, d.n));

    /* ---- 价格区间（只看可见区间） ---- */
    let hi = -Infinity, lo = Infinity;
    for (let i = from; i < n; i++) {
      if (bars[i].high > hi) hi = bars[i].high;
      if (bars[i].low < lo) lo = bars[i].low;
    }
    for (let m = 0; m < maS.length; m++) {
      const ser = maS[m];
      for (let i = from; i < n; i++) {
        const v = ser[i];
        if (v != null) { if (v > hi) hi = v; if (v < lo) lo = v; }
      }
    }
    if (!isFinite(hi) || !isFinite(lo)) { hi = 1; lo = 0; }
    if (hi - lo < 1e-6) { hi = lo + Math.max(lo * 0.02, 0.02); }
    const pricePad = (hi - lo) * 0.06;
    const top = hi + pricePad, bot = lo - pricePad;

    const py = (v) => PAD_T + (top - v) / (top - bot) * mainH;
    const cx = (i) => PAD_L + cw * (i - from + 0.5);
    // 当前价：判断筹码是获利盘还是套牢盘（draw 里原本没有这个变量）
    const curPrice = bars[n - 1].close;

    lastLayout = {
      W: W, H: H, plotW: plotW, n: n, from: from, visible: visible, cw: cw,
      mainTop: PAD_T, mainH: mainH, volH: volH,
      volTop: PAD_T + mainH + GAP,
      top: top, bot: bot, bars: bars,
      px: PAD_L,
      right: PAD_L + plotW,
      chipLeft: chipLeft,
      chipW: chipW
    };

    /* ---- 网格与价格轴 ---- */
    const gridCount = 4;
    ctx.lineWidth = 1;
    for (let i = 0; i <= gridCount; i++) {
      const v = bot + (top - bot) * (i / gridCount);
      const y = Math.round(py(v)) + 0.5;
      ctx.strokeStyle = pal.border;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(PAD_L + plotW, y);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // 价格刻度放在筹码带右侧，与主流软件一致
      ctx.fillStyle = pal.text3;
      ctx.textAlign = 'right';
      ctx.fillText(fmtNum(v, v >= 100 ? 1 : 2), W - 4, y);
    }

    /* ---- 蜡烛 ---- */
    for (let i = from; i < n; i++) {
      const b = bars[i];
      const rising = b.close >= b.open;
      const color = rising ? pal.up : pal.down;
      const x = cx(i);

      ctx.strokeStyle = color;
      ctx.fillStyle = color;

      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, py(b.high));
      ctx.lineTo(Math.round(x) + 0.5, py(b.low));
      ctx.stroke();

      const yo = py(b.open), yc = py(b.close);
      const yTop = Math.min(yo, yc);
      const h = Math.max(Math.abs(yc - yo), 1);
      const left = Math.round(x - bw / 2);
      const wBody = Math.max(Math.round(bw), 1);

      if (bw <= 2) {
        ctx.fillRect(left, yTop, 1, h);
      } else if (rising) {
        // 阳线空心，贴近国内软件观感
        ctx.fillStyle = pal.surface;
        ctx.fillRect(left, Math.round(yTop), wBody, Math.max(Math.round(h), 1));
        ctx.strokeRect(left + 0.5, Math.round(yTop) + 0.5,
          Math.max(wBody - 1, 1), Math.max(Math.round(h) - 1, 1));
      } else {
        ctx.fillRect(left, Math.round(yTop), wBody, Math.max(Math.round(h), 1));
      }
    }

    /* ---- 筹码分布（画在右侧带内，位于 K 线之下不遮挡） ---- */
    if (chipDist) {
      try {
      const chipRight = chipLeft + chipW;
      let maxR = 0;
      chipDist.forEach(function (d) {
        if (d.price < bot || d.price > top) return;
        if (d.ratio > maxR) maxR = d.ratio;
      });

      if (maxR > 0) {
        const lockColor = pal.dark ? '#5b8fd6' : '#7aa8e0';
        const barHc = Math.max(1, mainH / chipDist.length * 0.92);

        ctx.save();
        ctx.beginPath();
        ctx.rect(chipLeft, PAD_T, chipW, mainH);
        ctx.clip();

        chipDist.forEach(function (d) {
          if (d.price < bot || d.price > top) return;
          const y = py(d.price);
          const w = (d.ratio / maxR) * chipW * 0.94;
          const gained = d.price <= curPrice;
          ctx.fillStyle = gained ? pal.up : lockColor;
          ctx.globalAlpha = gained ? 0.55 : 0.42;
          ctx.fillRect(chipRight - w, y - barHc / 2, w, barHc);
          ctx.globalAlpha = 1;
        });

        /* 现价线贯穿筹码带，一眼看出上下各有多少筹码 */
        const yP = py(curPrice);
        ctx.strokeStyle = pal.accent;
        ctx.globalAlpha = 0.85;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(chipLeft, yP);
        ctx.lineTo(chipRight, yP);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;

        ctx.restore();

        // 顶部标注获利/套牢占比
        ctx.font = '9px ui-monospace, Menlo, monospace';
        ctx.textAlign = 'right';
        ctx.fillStyle = pal.up;
        ctx.fillText('获利 ' + Math.round(o.chips.profitRatio * 100) + '%', chipRight - 2, PAD_T + 12);
        ctx.fillStyle = lockColor;
        ctx.fillText('套牢 ' + Math.round((1 - o.chips.profitRatio) * 100) + '%', chipRight - 2, PAD_T + 24);
        ctx.font = '10px ui-monospace, Menlo, monospace';
      }
      } catch (e) { /* 筹码画失败不能拖垮主图 */ }
    }

    /* ---- 均线 ---- */
    for (let m = 0; m < maS.length; m++) {
      const ser = maS[m];
      ctx.strokeStyle = pal.ma[m];
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      let started = false;
      for (let i = from; i < n; i++) {
        if (ser[i] == null) continue;
        const y = py(ser[i]);
        if (!started) { ctx.moveTo(cx(i), y); started = true; }
        else ctx.lineTo(cx(i), y);
      }
      ctx.stroke();
    }

    /* ---- 均线图例（画进画布，省掉 DOM 里的一行标签） ---- */
    const legendY = PAD_T + 6;
    let legendX = PAD_L + 2;
    ctx.font = '9px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'left';
    for (let m = 0; m < maS.length; m++) {
      const v = maS[m][n - 1];
      if (v == null) continue;
      const txt = 'MA' + MA_DEFS[m].n;
      ctx.fillStyle = pal.ma[m];
      ctx.fillText(txt, legendX, legendY);
      legendX += ctx.measureText(txt).width + 3;
    }
    ctx.font = '10px ui-monospace, Menlo, monospace';

    /* ---- 成交量 ---- */
    let vmax = 0;
    for (let i = from; i < n; i++) if (bars[i].vol > vmax) vmax = bars[i].vol;
    if (vmax <= 0) vmax = 1;
    const volTop = PAD_T + mainH + GAP;
    const volBase = volTop + volH;

    for (let i = from; i < n; i++) {
      const b = bars[i];
      const h = Math.max((b.vol / vmax) * (volH - 4), 0.6);
      ctx.fillStyle = b.close >= b.open ? pal.up : pal.down;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(Math.round(cx(i) - bw / 2), volBase - h, Math.max(Math.round(bw), 1), h);
      ctx.globalAlpha = 1;
    }

    const vma = (function () {
      const out = new Array(n).fill(null);
      let sum = 0;
      for (let i = 0; i < n; i++) {
        sum += bars[i].vol;
        if (i >= 5) sum -= bars[i - 5].vol;
        if (i >= 4) out[i] = sum / 5;
      }
      return out;
    })();
    ctx.strokeStyle = pal.ma[0];
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    let vStarted = false;
    for (let i = from; i < n; i++) {
      if (vma[i] == null) continue;
      const y = volBase - (vma[i] / vmax) * (volH - 4);
      if (!vStarted) { ctx.moveTo(cx(i), y); vStarted = true; }
      else ctx.lineTo(cx(i), y);
    }
    ctx.stroke();

    /* ---- 日期轴 ---- */
    ctx.fillStyle = pal.text3;
    const labelCount = 4;
    const axisY = H - 7;
    for (let k = 0; k < labelCount; k++) {
      const i = from + Math.round((visible - 1) * k / (labelCount - 1));
      const d = (bars[i] && bars[i].date) || '';
      const short = o.axisFormat === 'month' || o.axisFormat === 'week'
        ? d.slice(2, 7).replace('-', '/') : d.slice(5);
      let tx = cx(i);
      if (k === 0) { ctx.textAlign = 'left'; tx = PAD_L + 1; }
      else if (k === labelCount - 1) { ctx.textAlign = 'right'; tx = PAD_L + plotW - 1; }
      else ctx.textAlign = 'center';
      ctx.fillText(short, tx, axisY);
    }

    /* ---- 十字光标 ---- */
    if (o.cross != null && o.cross >= from && o.cross < n) {
      const i = o.cross;
      const b = bars[i];
      const x = cx(i);

      ctx.strokeStyle = pal.text2;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, PAD_T);
      ctx.lineTo(x, volBase);
      ctx.stroke();
      const yPrice = py(b.close);
      ctx.beginPath();
      ctx.moveTo(PAD_L, yPrice);
      ctx.lineTo(PAD_L + plotW, yPrice);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // 右轴价格气泡
      const label = fmtNum(b.close, 2);
      const tw = ctx.measureText(label).width + 10;
      const bx = W - Math.min(tw, axisW - 4);
      const bwid = Math.min(tw, axisW - 4);
      ctx.fillStyle = pal.text2;
      roundRect(ctx, bx, yPrice - 8, bwid, 16, 3);
      ctx.fill();
      ctx.fillStyle = pal.dark ? '#0b0d10' : '#ffffff';
      ctx.textAlign = 'left';
      ctx.fillText(label, bx + 5, yPrice);

      // 左上角显示该根的完整数据（替代原先的 DOM 信息行）
      const infoY = PAD_T + 20;
      const prevB = bars[i - 1] || b;
      const chg = prevB.close > 0 ? (b.close / prevB.close - 1) * 100 : 0;
      ctx.font = '9.5px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = pal.text2;
      const infoTxt = (b.date || '') +
        '  开' + fmtNum(b.open, 2) +
        '  高' + fmtNum(b.high, 2) +
        '  低' + fmtNum(b.low, 2) +
        '  收' + fmtNum(b.close, 2) +
        '  ' + (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%' +
        '  量' + fmtVol(b.vol);
      ctx.fillText(infoTxt, PAD_L + 2, infoY);
      ctx.font = '10px ui-monospace, Menlo, monospace';

      // 底部日期气泡
      const dlabel = b.date || '';
      const dw = ctx.measureText(dlabel).width + 10;
      const dx = Math.max(PAD_L, Math.min(x - dw / 2, PAD_L + plotW - dw));
      const dy = axisY - 7;
      ctx.fillStyle = pal.text2;
      roundRect(ctx, dx, dy, dw, 14, 3);
      ctx.fill();
      ctx.fillStyle = pal.dark ? '#0b0d10' : '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(dlabel, dx + dw / 2, dy + 7);
    }
  }

  /** 把触点换算成 K 线下标 */
  function indexAt(clientX) {
    const L = lastLayout;
    if (!L) return null;
    const slot = Math.floor((clientX - L.px) / L.cw);
    const bar = L.from + slot;
    return Math.max(L.from, Math.min(L.n - 1, bar));
  }

  /**
   * 绑定触摸交互。cb(bar, index) 在十字光标移动时回调。
   * 返回解绑函数。
   */
  function attach(canvas, bars, cb, opts) {
    let idx = null;
    const base = opts || {};

    function repaint() {
      draw(canvas, bars, {
        cross: idx, visible: base.visible,
        axisFormat: base.axisFormat, chips: base.chips
      });
    }

    /* 手势方向判定
     *
     * 图表占据屏幕一半高度，如果吞掉所有触摸事件，手指在图上就再也滑不动页面——
     * 这是真实发生过的 bug。正确做法是按方向分流：
     *   横向拖动 → 看图（接管并阻止默认滚动）
     *   纵向拖动 → 交给页面滚动（立刻放弃接管）
     * 用 touch-action: pan-y 让浏览器保留纵向滚动，横向事件仍会派发给我们。
     */
    let startX = 0, startY = 0;
    let mode = null;          // null=未判定 / 'h'=横向看图 / 'v'=纵向滚动
    const DIR_THRESHOLD = 6;

    function onStart(ev) {
      if (!bars || !bars.length) return;
      const t = ev.touches && ev.touches[0];
      if (!t) return;
      startX = t.clientX;
      startY = t.clientY;
      mode = null;
      // 这里刻意不 preventDefault：还没判断方向，不能先掐断滚动
    }

    function onMove(ev) {
      if (!bars || !bars.length) return;
      const t = ev.touches && ev.touches[0];
      if (!t) return;

      const dx = Math.abs(t.clientX - startX);
      const dy = Math.abs(t.clientY - startY);

      if (mode === null) {
        if (dx < DIR_THRESHOLD && dy < DIR_THRESHOLD) return;   // 还没滑够，继续等
        if (dx > dy) {
          mode = 'h';
        } else {
          mode = 'v';          // 纵向手势：交还给页面，之后不再干预
          return;
        }
      }
      if (mode === 'v') return;

      if (ev.cancelable) ev.preventDefault();
      const i = indexAt(t.clientX);
      if (i == null || i === idx) return;
      idx = i;
      repaint();
      if (cb) cb(bars[i], i);
    }

    function onEnd(ev) {
      // 轻点（没有发生方向判定）：在该位置显示十字光标，方便查看单根 K 线
      if (mode === null && idx == null && ev && ev.changedTouches && ev.changedTouches[0]) {
        const t = ev.changedTouches[0];
        const dd = Math.abs(t.clientX - startX) + Math.abs(t.clientY - startY);
        if (dd < DIR_THRESHOLD * 2) {
          const i = indexAt(t.clientX);
          if (i != null) {
            idx = i; repaint(); if (cb) cb(bars[i], i);
            mode = 'h';
            return;
          }
        }
      }
      mode = null;
      if (idx == null) return;
      idx = null;
      repaint();
      if (cb) cb(null, -1);
    }

    canvas.addEventListener('touchstart', onStart, { passive: true });
    canvas.addEventListener('touchmove', onMove, { passive: false });
    canvas.addEventListener('touchend', onEnd);
    canvas.addEventListener('touchcancel', onEnd);

    // 鼠标：方便在电脑上预览
    function onMouseDown(ev) {
      const r = canvas.getBoundingClientRect();
      const i = indexAt(ev.clientX);
      if (i == null) return;
      idx = i; repaint(); if (cb) cb(bars[i], i);
    }
    function onMouseMove(ev) {
      if (idx == null) return;
      const i = indexAt(ev.clientX);
      if (i == null || i === idx) return;
      idx = i; repaint(); if (cb) cb(bars[i], i);
    }
    function onMouseUp() { onEnd(); }
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    let rt = null;
    function onResize() {
      clearTimeout(rt);
      // rect 从未声明过（历史遗留），这里只重算布局再重绘即可
      rt = setTimeout(() => { repaint(); }, 120);
    }
    window.addEventListener('resize', onResize);

    return function detach() {
      canvas.removeEventListener('touchstart', onStart);
      canvas.removeEventListener('touchmove', onMove);
      canvas.removeEventListener('touchend', onEnd);
      canvas.removeEventListener('touchcancel', onEnd);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('resize', onResize);
    };
  }

  /* ==========================================================
   * 分时图
   *
   * 与日 K 分开实现：分时的时间轴是「交易日内的分钟」，不是自然日，
   * 且必须以昨收为中轴做对称价格轴——这样涨跌的视觉比例才正确。
   * ========================================================== */

  /** 交易分钟 → 横轴序号（上午 0-120，下午 120-240，午休压缩掉） */
  function tToSlot(t) {
    if (t <= 690) return Math.max(0, t - 570);          // 9:30-11:30
    if (t >= 780) return Math.min(240, 120 + (t - 780)); // 13:00-15:00
    return 120;                                          // 午休归于 120
  }

  function drawMinute(canvas, points, opt) {
    const o = opt || {};
    const pal = palette();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const W = canvas.clientWidth || 320;
    const H = canvas.clientHeight || 300;

    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'middle';

    if (!points || points.length < 2) {
      ctx.fillStyle = pal.text3;
      ctx.textAlign = 'center';
      ctx.fillText('暂无分时数据', W / 2, H / 2);
      return;
    }

    const prevClose = o.prevClose > 0 ? o.prevClose : points[0].price;
    const volH = Math.max(40, Math.round(H * 0.24));
    const mainH = H - PAD_T - volH - GAP - AXIS_H - 2;

    /* 分时用「左价格、右涨跌幅」的双轴布局（与主流软件一致）。
       早期把两者都塞在右侧，46px 根本放不下两列数字，直接重叠。 */
    const AX_L = 42;      // 左侧价格轴
    const AX_R = 44;      // 右侧涨跌幅轴
    const plotW = Math.max(40, W - AX_L - AX_R);
    const plotL = AX_L;

    /* 价格区间：以昨收为中心对称，保证涨跌幅的视觉比例不失真 */
    let maxDev = 0;
    points.forEach(function (p) {
      const d = Math.abs(p.price - prevClose);
      if (d > maxDev) maxDev = d;
      if (p.avg) {
        const d2 = Math.abs(p.avg - prevClose);
        if (d2 > maxDev) maxDev = d2;
      }
    });
    if (maxDev <= 0) maxDev = prevClose * 0.01;
    maxDev *= 1.08;
    const top = prevClose + maxDev;
    const bot = prevClose - maxDev;

    const py = function (v) { return PAD_T + (top - v) / (top - bot) * mainH; };
    const px = function (slot) { return plotL + (slot / 240) * plotW; };

    /* 网格线 + 左侧价格 + 右侧涨跌幅 */
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const v = bot + (top - bot) * (i / 4);
      const y = Math.round(py(v)) + 0.5;

      ctx.strokeStyle = pal.border;
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.moveTo(plotL, y);
      ctx.lineTo(plotL + plotW, y);
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.fillStyle = pal.text3;
      ctx.textAlign = 'right';
      ctx.fillText(fmtNum(v, 2), plotL - 5, y);

      const dev = (v / prevClose - 1) * 100;
      ctx.fillStyle = dev > 0.05 ? pal.up : dev < -0.05 ? pal.down : pal.text3;
      ctx.textAlign = 'left';
      ctx.fillText((dev >= 0 ? '+' : '') + dev.toFixed(1) + '%', plotL + plotW + 5, y);
    }

    /* 昨收基准线：必须单独画，不能指望网格正好落在昨收上 */
    const yPrev = Math.round(py(prevClose)) + 0.5;
    ctx.strokeStyle = pal.text3;
    ctx.globalAlpha = 0.9;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(plotL, yPrev);
    ctx.lineTo(plotL + plotW, yPrev);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    /* 纵向时间网格 */
    [60, 120, 180].forEach(function (slot) {
      const x = Math.round(px(slot)) + 0.5;
      ctx.strokeStyle = pal.border;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(x, PAD_T);
      ctx.lineTo(x, PAD_T + mainH);
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    /* 价格线 + 均价线 */
    const last = points[points.length - 1];
    const lineColor = last.price >= prevClose ? pal.up : pal.down;

    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    points.forEach(function (p, i) {
      const x = px(tToSlot(p.t)), y = py(p.price);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 价格线下方淡填充
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = lineColor;
    ctx.lineTo(px(tToSlot(last.t)), PAD_T + mainH);
    ctx.lineTo(px(tToSlot(points[0].t)), PAD_T + mainH);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = pal.ma[0];
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    let started = false;
    points.forEach(function (p) {
      if (!(p.avg > 0)) return;
      const x = px(tToSlot(p.t)), y = py(p.avg);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    });
    ctx.stroke();

    /* 成交量 */
    let vmax = 0;
    points.forEach(function (p) { if (p.vol > vmax) vmax = p.vol; });
    if (vmax <= 0) vmax = 1;
    const volTop = PAD_T + mainH + GAP;
    const volBase = volTop + volH;
    const bw = Math.max(1, plotW / 240 * 0.8);

    points.forEach(function (p, i) {
      const h = Math.max((p.vol / vmax) * (volH - 3), 0.5);
      const x = px(tToSlot(p.t));
      // 与上一分钟比较：涨的分钟红、跌的分钟绿（软件通行口径）
      const prevP = i > 0 ? points[i - 1].price : prevClose;
      ctx.fillStyle = p.price >= prevP ? pal.up : pal.down;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(x - bw / 2, volBase - h, bw, h);
      ctx.globalAlpha = 1;
    });

    /* 时间轴 */
    ctx.fillStyle = pal.text3;
    const marks = [[0, '09:30'], [60, '10:30'], [120, '11:30'], [180, '14:00'], [240, '15:00']];
    marks.forEach(function (m, i) {
      const x = px(m[0]);
      if (i === 0) { ctx.textAlign = 'left'; }
      else if (i === marks.length - 1) { ctx.textAlign = 'right'; }
      else ctx.textAlign = 'center';
      ctx.fillText(m[1], x, H - 7);
    });

    /* 现价小标签（右轴） */
    const yLast = py(last.price);
    const label = fmtNum(last.price, 2);
    const tw = ctx.measureText(label).width + 10;
    ctx.fillStyle = lineColor;
    roundRect(ctx, plotL - tw - 3, yLast - 8, tw, 16, 3);
    ctx.fill();
    ctx.fillStyle = pal.dark ? '#0b0d10' : '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(label, plotL - tw / 2 - 3, yLast);
  }

  /* ==========================================================
   * 筹码分布
   *
   * 横向柱状：纵轴是价格（上高下低），横轴是筹码量。
   * 现价以下的筹码是获利的（红），以上是套牢的（绿）——
   * 这个颜色区分是筹码图最有价值的信息：套牢盘决定上方压力。
   * ========================================================== */
  function drawChips(canvas, chips, opt) {
    const o = opt || {};
    const pal = palette();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const W = canvas.clientWidth || 320;
    const H = canvas.clientHeight || 300;

    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'middle';

    if (!chips || !chips.dist || !chips.dist.length) {
      ctx.fillStyle = pal.text3;
      ctx.textAlign = 'center';
      ctx.fillText('暂无筹码数据', W / 2, H / 2);
      return;
    }

    const dist = chips.dist;
    const price = o.price > 0 ? o.price : chips.price;

    /* 取景范围用 90% 成本区间，而不是全部历史价格。
       否则几个月前低位的零星筹码会把价格轴拉到 6~35 元，
       真正密集的区间被压成一条线，什么也看不出来。 */
    let lo = chips.lo, hi = chips.hi;
    if (chips.p5 > 0 && chips.p95 > chips.p5) {
      const span = chips.p95 - chips.p5;
      lo = Math.max(chips.lo, chips.p5 - span * 0.1);
      hi = Math.min(chips.hi, chips.p95 + span * 0.1);
    }

    const boxL = 44, boxR = 52;
    const plotW = W - boxL - boxR;
    const plotH = H - 8;

    const yOf = function (p) { return 4 + (hi - p) / (hi - lo) * (plotH - 8); };

    // 只统计取景范围内筹码的最大值，让可见区间的柱子能撑满宽度
    let maxRatio = 0;
    dist.forEach(function (d) {
      if (d.price < lo || d.price > hi) return;
      if (d.ratio > maxRatio) maxRatio = d.ratio;
    });
    if (maxRatio <= 0) maxRatio = 1;

    const barH = Math.max(1, plotH / dist.length * 0.92);

    ctx.save();
    ctx.beginPath();
    ctx.rect(boxL, 2, plotW, plotH - 4);
    ctx.clip();
    dist.forEach(function (d) {
      if (d.price < lo || d.price > hi) return;   // 取景外不画
      const bh = (d.ratio / maxRatio) * plotW;
      const y = yOf(d.price);
      const gained = d.price <= price;
      ctx.fillStyle = gained ? pal.up : pal.down;
      ctx.globalAlpha = gained ? 0.6 : 0.42;
      ctx.fillRect(boxL, y - barH / 2, Math.max(bh, 0.5), barH);
      ctx.globalAlpha = 1;
    });
    ctx.restore();

    /* 价格刻度 */
    ctx.fillStyle = pal.text3;
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const p = hi - (hi - lo) * (i / 4);
      const y = yOf(p);
      ctx.fillText(fmtNum(p, 2), boxL - 6, y);
      ctx.strokeStyle = pal.border;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.moveTo(boxL, Math.round(y) + 0.5);
      ctx.lineTo(boxL + plotW, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    /* 现价线 */
    const yPrice = yOf(price);
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(boxL, yPrice);
    ctx.lineTo(boxL + plotW, yPrice);
    ctx.stroke();
    ctx.setLineDash([]);

    const label = '现价 ' + fmtNum(price, 2);
    const tw = ctx.measureText(label).width + 8;
    ctx.fillStyle = pal.accent;
    roundRect(ctx, boxL + plotW - tw, yPrice - 7, tw, 14, 3);
    ctx.fill();
    ctx.fillStyle = pal.dark ? '#0b0d10' : '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(label, boxL + plotW - tw + 4, yPrice);

    /* 平均成本线 */
    if (chips.avgCost > 0 && chips.avgCost >= lo && chips.avgCost <= hi) {
      const yAvg = yOf(chips.avgCost);
      ctx.strokeStyle = pal.ma[1];
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(boxL, yAvg);
      ctx.lineTo(boxL + plotW, yAvg);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = pal.ma[1];
      ctx.textAlign = 'left';
      ctx.fillText('成本 ' + fmtNum(chips.avgCost, 2), boxL + 3, yAvg - 6);
    }

    /* 右侧说明：获利比例 */
    ctx.textAlign = 'left';
    ctx.fillStyle = pal.text3;
    ctx.fillText('获利', boxL + plotW + 8, 16);
    ctx.fillStyle = pal.up;
    ctx.fillText(Math.round(chips.profitRatio * 100) + '%', boxL + plotW + 8, 30);
    ctx.fillStyle = pal.text3;
    ctx.fillText('套牢', boxL + plotW + 8, 52);
    ctx.fillStyle = pal.down;
    ctx.fillText(Math.round((1 - chips.profitRatio) * 100) + '%', boxL + plotW + 8, 66);
  }

  YB.kline = { draw, attach, drawMinute, drawChips, tToSlot,
    palette, fmtVol, fmtNum, layout: function () { return lastLayout; } };
})(window.YB);
