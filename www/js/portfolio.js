/* ============================================================
 * 野人量化 · 持仓模块
 *
 * 参考 GitHub 上 portfolio tracker 的常见做法：
 *   1. 纯本地持久化（localStorage），不做后端
 *   2. 同一标的多次买入按「加权平均成本」合并
 *   3. 未实现盈亏与已实现盈亏分开统计（清仓后进交割单）
 *   4. 所有派生指标（市值/盈亏/仓位占比）都是现价 × 数量的纯函数
 *
 * 与野人体系打通的地方：仓位占比按「总资金」而不是「持仓总市值」算，
 * 因为他的仓位上限（冰点 0%、试错 20%、主升 50%）分母一直是总资金。
 * ============================================================ */
(function (YB) {
  'use strict';

  const U = YB.util;
  const KEY_POS = 'positions';
  const KEY_CLOSED = 'closed';

  /* ---------------- 基础读写 ---------------- */

  function list() {
    const arr = U.store.get(KEY_POS, []);
    return Array.isArray(arr) ? arr : [];
  }

  function save(arr) {
    U.store.set(KEY_POS, arr);
    return arr;
  }

  function closedList() {
    const arr = U.store.get(KEY_CLOSED, []);
    return Array.isArray(arr) ? arr : [];
  }

  function uid() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ---------------- 增删改 ---------------- */

  function findIndexByCode(arr, code) {
    for (let i = 0; i < arr.length; i++) if (arr[i].code === code) return i;
    return -1;
  }

  /**
   * 新增持仓。同代码已存在时按加权平均成本合并，
   * 这是券商 App 的标准行为，也避免同一只票出现两行。
   */
  function add(p) {
    const arr = list();
    const shares = Math.max(1, Math.round(U.num(p.shares)));
    const cost = U.num(p.cost);
    if (!p.code || shares <= 0 || cost <= 0) return null;

    const idx = findIndexByCode(arr, p.code);
    if (idx >= 0) {
      const old = arr[idx];
      const total = old.shares + shares;
      old.cost = (old.shares * old.cost + shares * cost) / total;
      old.shares = total;
      if (p.name && !old.name) old.name = p.name;
      save(arr);
      return old;
    }

    const item = {
      id: uid(),
      code: String(p.code).slice(-6),
      name: p.name || p.code,
      shares: shares,
      cost: cost,
      note: p.note || '',
      openedAt: U.dateStr(),
      stopPct: p.stopPct || null
    };
    arr.push(item);
    save(arr);
    return item;
  }

  function update(id, patch) {
    const arr = list();
    const i = arr.findIndex((x) => x.id === id);
    if (i < 0) return null;
    const p = arr[i];
    if (patch.shares != null) {
      const s = Math.round(U.num(patch.shares));
      if (s <= 0) { arr.splice(i, 1); save(arr); return null; }
      p.shares = s;
    }
    if (patch.cost != null && U.num(patch.cost) > 0) p.cost = U.num(patch.cost);
    if (patch.note != null) p.note = patch.note;
    if (patch.name) p.name = patch.name;
    if (patch.stopPct != null) p.stopPct = U.num(patch.stopPct) || null;
    save(arr);
    return p;
  }

  function remove(id) {
    const arr = list().filter((x) => x.id !== id);
    save(arr);
    return arr;
  }

  /** 清仓：移出持仓，写入交割单 */
  function close(id, exitPrice) {
    const arr = list();
    const i = arr.findIndex((x) => x.id === id);
    if (i < 0) return null;
    const p = arr[i];
    const ep = U.num(exitPrice) || p.cost;
    const pnl = (ep - p.cost) * p.shares;
    const rec = {
      id: 'c' + Date.now().toString(36),
      code: p.code,
      name: p.name,
      shares: p.shares,
      cost: p.cost,
      exitPrice: ep,
      pnl: pnl,
      pnlPct: p.cost > 0 ? (ep / p.cost - 1) * 100 : 0,
      openedAt: p.openedAt,
      exitAt: U.dateStr()
    };
    const cl = closedList();
    cl.unshift(rec);
    // 交割单只留最近 200 条，避免 localStorage 无限膨胀
    U.store.set(KEY_CLOSED, cl.slice(0, 200));
    arr.splice(i, 1);
    save(arr);
    return rec;
  }

  function clearClosed() {
    U.store.set(KEY_CLOSED, []);
  }

  function reset() {
    save([]);
    U.store.set(KEY_CLOSED, []);
  }

  /* ---------------- 计算 ---------------- */

  /**
   * 把持仓与当前行情合成一份可直接渲染的快照。
   * @param {Object} quotes  { code: {price, prev, pct, name} }
   * @param {Number} capital 总资金
   * @param {Number} globalStopPct 全局止损幅度（%）
   * @param {Object} phase  { maxPosition, phase } 当前情绪阶段
   */
  function snapshot(quotes, capital, globalStopPct, phase) {
    const arr = list();
    const cap = U.num(capital) || 100000;
    const gStop = U.num(globalStopPct) || 6;
    const q = quotes || {};

    let totalMV = 0, totalCost = 0, totalToday = 0, quoted = 0;

    const rows = arr.map((p) => {
      const quote = q[p.code] || null;
      const hasQuote = !!(quote && quote.price > 0);
      if (hasQuote) quoted++;

      const price = hasQuote ? quote.price : p.cost;
      const prev = hasQuote && quote.prev > 0 ? quote.prev : price;
      const marketValue = price * p.shares;
      const costValue = p.cost * p.shares;
      const pnl = marketValue - costValue;
      const pnlPct = p.cost > 0 ? (price / p.cost - 1) * 100 : 0;
      const todayPnl = hasQuote ? (price - prev) * p.shares : 0;
      const todayPct = hasQuote && prev > 0 ? (price / prev - 1) * 100 : 0;

      const stopPct = p.stopPct || gStop;
      const stopPrice = +(p.cost * (1 - stopPct / 100)).toFixed(2);
      const nearLine = p.cost * (1 - stopPct * 0.6 / 100);

      let status = 'ok';
      if (hasQuote && price <= stopPrice) status = 'stop';
      else if (hasQuote && price <= nearLine) status = 'near';

      totalMV += marketValue;
      totalCost += costValue;
      totalToday += todayPnl;

      return {
        id: p.id,
        code: p.code,
        name: (hasQuote && quote.name) || p.name || p.code,
        shares: p.shares,
        cost: p.cost,
        price: price,
        pct: hasQuote ? quote.pct : 0,
        hasQuote: hasQuote,
        marketValue: marketValue,
        costValue: costValue,
        pnl: pnl,
        pnlPct: pnlPct,
        todayPnl: todayPnl,
        todayPct: todayPct,
        stopPct: stopPct,
        stopPrice: stopPrice,
        toStopPct: price > 0 ? (price / stopPrice - 1) * 100 : 0,
        weight: cap > 0 ? marketValue / cap * 100 : 0,
        status: status,
        note: p.note,
        openedAt: p.openedAt
      };
    });

    // 按市值降序，大仓位在前
    rows.sort((a, b) => b.marketValue - a.marketValue);

    const totalPnl = totalMV - totalCost;
    const totalPnlPct = totalCost > 0 ? (totalMV / totalCost - 1) * 100 : 0;
    const totalWeight = cap > 0 ? totalMV / cap * 100 : 0;

    // 每只票在持仓内部的占比，用于分布条
    rows.forEach((r) => {
      r.share = totalMV > 0 ? r.marketValue / totalMV * 100 : 0;
    });

    return {
      rows: rows,
      capital: cap,
      totalMV: totalMV,
      totalCost: totalCost,
      totalPnl: totalPnl,
      totalPnlPct: totalPnlPct,
      totalToday: totalToday,
      totalWeight: totalWeight,
      count: rows.length,
      quoted: quoted,
      phaseMax: phase ? phase.maxPosition : null,
      phaseName: phase ? phase.phase : ''
    };
  }

  /* ---------------- 风控体检 ----------------
   * 把持仓和情绪阶段、止损纪律对一遍，输出可直接展示的问题列表。
   * 这里的每一条都对应文档里的硬约束，不是装饰性的提醒。
   */
  function audit(snap) {
    const out = [];
    if (!snap || !snap.rows.length) return out;

    // 1) 已破止损（文档：短线 -5%~-7% 触发即砍，不眨眼）
    snap.rows.forEach((r) => {
      if (r.status === 'stop') {
        out.push({
          level: 'danger',
          title: r.name + ' 已跌破止损线',
          desc: '现价 ' + r.price.toFixed(2) + ' ≤ 止损价 ' + r.stopPrice.toFixed(2) +
            '（-' + r.stopPct + '%），浮亏 ' + U.fmtPct(r.pnlPct)
        });
      }
    });

    // 2) 接近止损
    snap.rows.forEach((r) => {
      if (r.status === 'near') {
        out.push({
          level: 'warn',
          title: r.name + ' 逼近止损线',
          desc: '距止损价还有 ' + r.toStopPct.toFixed(1) + '%，提前想好预案'
        });
      }
    });

    // 3) 总仓位超过情绪阶段上限（文档第八章：未稳定前用固定仓位）
    if (snap.phaseMax != null && snap.totalWeight > snap.phaseMax + 0.5) {
      out.push({
        level: 'danger',
        title: '总仓位超出阶段上限',
        desc: '当前 ' + snap.totalWeight.toFixed(0) + '%，' + snap.phaseName +
          '建议不超过 ' + snap.phaseMax + '%'
      });
    }

    // 4) 单只票超过阶段上限（等于把试错仓一次打满）
    if (snap.phaseMax != null && snap.phaseMax > 0) {
      snap.rows.forEach((r) => {
        if (r.weight > snap.phaseMax + 0.5) {
          out.push({
            level: 'warn',
            title: r.name + ' 单只仓位偏重',
            desc: '占总资金 ' + r.weight.toFixed(0) + '%，超过 ' + snap.phaseName +
              '上限 ' + snap.phaseMax + '%'
          });
        }
      });
    }

    // 5) 持仓只数（他自述常态 4 只左右）
    if (snap.count > 5) {
      out.push({
        level: 'warn',
        title: '持仓过于分散',
        desc: '当前 ' + snap.count + ' 只，超过 5 只很难盯住，通常 4 只左右'
      });
    }

    // 6) 黑名单标的（文档第十章）
    snap.rows.forEach((r) => {
      if (/ST/i.test(r.name)) {
        out.push({ level: 'warn', title: r.name + ' 属于 ST 标的', desc: '黑名单：不碰' });
      } else if (/^(8|4|920)/.test(r.code)) {
        out.push({ level: 'warn', title: r.name + ' 属于北交所', desc: '流动性差，非系统内标的' });
      }
    });

    return out;
  }

  /** 已实现盈亏汇总 */
  function realized() {
    const cl = closedList();
    let pnl = 0, win = 0, lose = 0;
    cl.forEach((r) => {
      pnl += r.pnl || 0;
      if ((r.pnl || 0) > 0) win++; else if ((r.pnl || 0) < 0) lose++;
    });
    return {
      list: cl,
      total: pnl,
      count: cl.length,
      win: win,
      lose: lose,
      winRate: cl.length ? win / cl.length * 100 : 0
    };
  }

  YB.pf = {
    list, save, closedList, add, update, remove, close, clearClosed, reset,
    snapshot, audit, realized
  };
})(window.YB);
