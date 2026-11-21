/* ============================================================
 * 野人量化 · 界面渲染
 * ============================================================ */
(function (YB) {
  'use strict';

  const U = YB.util, E = YB.engine;
  const esc = U.escapeHtml;

  /* ---------------- 图标 ---------------- */
  const ICON = {
    market: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l5-6 4 3 5-7 4 4"/><path d="M3 21h18"/></svg>',
    picks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h6"/><circle cx="18" cy="16" r="3"/></svg>',
    portfolio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7.5" width="18" height="12.5" rx="2.5"/><path d="M8.5 7.5V6a2 2 0 012-2h3a2 2 0 012 2v1.5"/><path d="M3 12.5h18"/><path d="M12 12.5v2"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    risk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 4v6c0 4.5-3.2 7.4-8 8-4.8-.6-8-3.5-8-8V7l8-4z"/><path d="M9.5 12l1.8 1.8L15 10"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.6 1.6 0 008 19.4a1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H2a2 2 0 110-4h.1A1.6 1.6 0 004.6 8a1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V2a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H22a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 11-3-6.7"/><path d="M21 4v5h-5"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13.5A8.5 8.5 0 019.5 3a8.5 8.5 0 1010.5 10.5z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6"/></svg>',
    empty: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    scan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"/><path d="M3 12h18"/></svg>'
  };

  function card(title, sub, body, opts) {
    const o = opts || {};
    return '<section class="card' + (o.cls ? ' ' + o.cls : '') + '">' +
      (title ? '<div class="card-hd"><div class="card-title">' + esc(title) + '</div>' +
        (sub ? '<div class="card-sub">' + esc(sub) + '</div>' : '') +
        (o.right ? '<div class="spacer"></div>' + o.right : '') + '</div>' : '') +
      '<div class="card-bd' + (o.tight ? ' tight' : '') + '">' + body + '</div></section>';
  }

  function tagsHtml(arr) {
    if (!arr || !arr.length) return '';
    return '<div class="stock-tags">' + arr.map((t) => {
      let cls = 'tag';
      if (/龙一|绝对龙头|并列|中军|首板潮/.test(t)) cls += ' hot';
      else if (/高位|炸板/.test(t)) cls += ' warn';
      else if (/孤|跟风/.test(t)) cls += ' dim';
      return '<span class="' + cls + '">' + esc(t) + '</span>';
    }).join('') + '</div>';
  }

  /* ==========================================================
   * 市场视图
   * ========================================================== */
  function renderMarket(st) {
    const m = st.market || {};
    const em = m.emotion;
    const idx = m.indexes || [];

    if (!em) {
      return '<div class="card"><div class="card-bd"><div class="empty">' +
        ICON.empty + '<div>正在获取市场数据…</div></div></div></div>' +
        skeletonBlock() + skeletonBlock();
    }

    /* 指数 */
    let html = '<div class="index-row">' + idx.map((i) => {
      const cls = U.pctClass(i.pct);
      return '<div class="index-cell">' +
        '<div class="index-name">' + esc(i.name) + '</div>' +
        '<div class="index-price num ' + cls + '">' + i.price.toFixed(2) + '</div>' +
        '<div class="index-pct num ' + cls + '">' + U.fmtPct(i.pct) + '</div>' +
        '</div>';
    }).join('') + '</div>';

    /* 两市量能水位 */
    if (m.volume) html += volumeCard(m.volume);

    /* 情绪主卡 */
    const phaseCls = em.phaseKey;
    const markerLeft = Math.max(2, Math.min(98, em.mes));
    html += '<section class="card" style="margin-top:12px">' +
      '<div class="emotion-hero">' +
        '<div class="emotion-top">' +
          '<div class="emotion-score num">' + em.mes + '<small>/100</small></div>' +
          '<div class="emotion-meta">' +
            '<div class="emotion-phase">' + esc(em.phase) + '</div>' +
            '<div class="emotion-cap">建议仓位上限 ' + em.maxPosition + '% · 首仓 ' + em.firstPosition + '%</div>' +
          '</div>' +
        '</div>' +
        '<div class="meter"><div class="meter-marker" style="left:' + markerLeft + '%"></div></div>' +
        '<div class="meter-scale"><span>冰点</span><span>试错</span><span>主升</span><span>高潮</span></div>' +
        '<div class="advice-box"><b>' + esc(em.advice.title) + '</b> · ' + esc(em.advice.text) +
          (em.retreatRisk >= 2 ? '<br><b style="color:var(--warn)">退潮预警</b>：' +
            esc(em.retreatVotes.join('、')) : '') +
        '</div>' +
      '</div>' +
      '<div class="stat-grid">' +
        stat(em.inputs.zt, '涨停', 'up') +
        stat(em.inputs.dt, '跌停', em.inputs.dt > 5 ? 'down' : '') +
        stat(em.inputs.zb, '炸板', '') +
        stat(em.inputs.maxBoard + '板', '最高连板', '') +
      '</div>' +
      '</section>';

    /* 分项拆解 */
    const itemsHtml = '<div class="items">' + em.items.map((it) => {
      const w = Math.round(it.ratio * 100);
      return '<div class="item-row">' +
        '<span class="item-name">' + esc(it.name) + '</span>' +
        '<span class="item-bar"><i style="width:' + w + '%"></i></span>' +
        '<span class="item-val num">' + it.score.toFixed(1) + '</span>' +
        '</div>';
    }).join('') + '</div>';
    html += card('情绪分项', null, itemsHtml, { tight: true });

    /* 高度天花板 */
    const hAdv = em.heightAdvice;
    if (hAdv) {
      const sup = em.heightCap <= 3;
      html += card('高度天花板', null, '' +
        '<div class="kv" style="grid-template-columns:repeat(3,1fr)">' +
          kv('今日最高', em.todayBoard + ' 板', em.todayBoard >= 6 ? 'up' : '') +
          kv('近5日峰值', em.heightPeak5 == null ? '—' : em.heightPeak5 + ' 板') +
          kv('判定', em.heightLabel, sup ? 'down' : 'up') +
        '</div>' +
        '<div class="advice-box" style="margin-top:12px' +
          (sup ? ';border-left-color:var(--warn)' : '') + '">' +
          '<b>' + esc(hAdv.title) + '</b> · ' + esc(hAdv.text) +
          (em.wideButFlat
            ? '<br><b style="color:var(--warn)">普涨但无高度</b>：涨停家数多不代表短线好做，' +
              '资金分散在低位轮动，接力资金不起来高度就没有空间。'
            : '') +
        '</div>' +
        (m.leader ? leaderButton(m.leader) : ''), { tight: true });
    }

    /* 涨停梯队 */
    const ladder = m.ladder || [];
    if (ladder.length) {
      html += card('涨停梯队', null, ladderHtml(ladder, st), { tight: true });
    }

    /* 昨日涨停今日表现 */
    if (m.premium) {
      const p = m.premium;
      const cls = U.pctClass(p.avgPct);
      html += card('昨停今日表现', null, '' +
        '<div class="kv">' +
          '<div class="kv-cell"><div class="k">平均溢价</div><div class="v ' + cls + '">' +
            U.fmtPct(p.avgPct) + '</div></div>' +
          '<div class="kv-cell"><div class="k">晋级率</div><div class="v">' +
            (p.advanceRate * 100).toFixed(0) + '%</div></div>' +
          '<div class="kv-cell"><div class="k">样本</div><div class="v">' + p.count + ' 只</div></div>' +
        '</div>', { tight: true });
    }

    /* 板块主线 */
    const sectors = m.sectors || [];
    if (sectors.length) {
      const max = sectors[0].count || 1;
      const rows = sectors.map((s) => {
        const w = Math.max(8, (s.count / max) * 100);
        return '<button class="bar-item bar-btn" data-sector="' + esc(s.name) + '">' +
          '<span class="bar-name" title="' + esc(s.name) + '">' + esc(s.name) + '</span>' +
          '<span class="bar-track"><span class="bar-fill" style="width:' + w + '%"></span>' +
            '<span class="bar-cnt">' + s.count + '</span></span>' +
          '<span class="bar-leader">' + esc(s.leader ? s.leader.name : '') + '</span>' +
          '<span class="bar-chev">' + ICON.chevron + '</span>' +
          '</button>';
      }).join('');
      html += card('板块涨停榜', null, '<div class="bar-list">' + rows + '</div>', { tight: true });
    }

    html += '<div class="footer-note">' +
      (m.updatedAt ? U.fmtTime(m.updatedAt) : '—') +
      (m.stale ? ' · 刷新中' : '') + '</div>';
    return html;
  }

  /**
   * 两市量能卡：绝对水位决定「指数能不能走趋势」，
   * 环比方向决定「放量该做机构票还是缩量该做短线核心」。
   */
  /**
   * 两市量能卡。
   *
   * 这张卡回答的是「现在是什么量、这个量意味着什么」，不是「今天比上周多还是少」。
   * 四个层次从外到内：水位（绝对值）→ 中枢（半年台阶）→ 位置（分位）→ 性质（量价配合）。
   * 月度柱状图是复盘价值最高的部分——台阶下移一眼就能看出来。
   */
  function volumeCard(v) {
    const FULL = 2.5e12;
    const pct = Math.max(1, Math.min(100, v.turnover / FULL * 100));
    const markPct = 1.5e12 / FULL * 100;
    const ok = v.canSupportIndex;

    const c = v.center || {};
    const pos = v.position || {};
    const nat = v.nature || {};
    const ma = v.ma || {};

    const bad = c.key === 'down' || nat.key === 'shrinkDown' || nat.key === 'expandDown';
    const good = c.key === 'up' && nat.key === 'expandUp';

    const stateCls = bad ? ' bad' : good ? ' ok' : '';

    /* ---- 月度量能柱：复盘的核心视觉 ---- */
    const months = (v.monthly || []).slice(-7);
    let monthBars = '';
    if (months.length >= 3) {
      const mx = Math.max.apply(null, months.map(function (m) { return m.avg; }));
      monthBars = '<div class="vm-wrap">' +
        '<div class="vm-title">月均量能（亿手）' +
          '<em>台阶' + (c.key === 'down' ? '下移' : c.key === 'up' ? '上移' : '走平') + '</em></div>' +
        '<div class="vm-row">' +
        months.map(function (m) {
          const h = Math.max(6, Math.round(m.avg / mx * 54));
          return '<span class="vm-col' + (m.partial ? ' partial' : '') + '">' +
            '<b class="vm-val">' + (m.avg / 1e8).toFixed(1) + '</b>' +
            '<i class="vm-bar" style="height:' + h + 'px"></i>' +
            '<em class="vm-m">' + m.month.slice(5) + '月</em>' +
          '</span>';
        }).join('') +
        '</div></div>';
    }

    /* ---- 均量对比 ---- */
    // 单位统一为「亿手」，与复盘口径一致
    const f2 = function (x) { return x > 0 ? (x / 1e8).toFixed(2) : '—'; };
    const maRow = '<div class="kv grid3" style="margin-top:12px">' +
      kv('20日均量', f2(ma.d20), ma.d20 && ma.d120 && ma.d20 / ma.d120 < 0.92 ? 'warnc' : '') +
      kv('60日均量', f2(ma.d60)) +
      kv('120日均量', f2(ma.d120)) +
      '</div>';

    /* ---- 位置与中枢变化 ---- */
    const bits = [];
    if (pos.p120 != null) {
      bits.push('今日量在近 120 日的 <b>' + Math.round(pos.p120 * 100) + '%</b> 分位（' +
        esc(pos.label) + '）');
    }
    if (c.slope != null) {
      bits.push('60 日均量较 20 日前 <b>' + (c.slope >= 0 ? '+' : '') +
        (c.slope * 100).toFixed(1) + '%</b>');
    }

    return '<section class="card"><div class="card-hd">' +
      '<div class="card-title">两市量能</div>' +
      '<div class="card-sub">' + esc(c.label || '') +
        (nat.label && nat.label !== '量价未知' ? ' · ' + esc(nat.label) : '') + '</div>' +
      '</div>' +
      '<div class="card-bd">' +
        '<div class="vol-top">' +
          '<span class="vol-amt num">' + (v.yi / 1e4).toFixed(2) + '<small>万亿</small></span>' +
          '<span class="vol-lv' + stateCls + '">' + esc(v.mainLabel) + '</span>' +
          '<span class="vol-sup' + (ok ? ' ok' : '') + '">指数' + esc(v.support) + '</span>' +
        '</div>' +
        '<div class="vol-bar">' +
          '<i class="vol-fill' + stateCls + '" style="width:' + pct + '%"></i>' +
          '<span class="vol-mark" style="left:' + markPct + '%"></span>' +
        '</div>' +
        '<div class="vol-scale"><span>0</span><span>1.5万亿 分水岭</span><span>2.5万亿</span></div>' +

        maRow +
        monthBars +
        (bits.length ? '<div class="vol-bits">' + bits.join('　·　') + '</div>' : '') +

        '<div class="vol-summary' + stateCls + '">' +
          '<span class="vol-sum-tag">' + esc(nat.label || '判断') + '</span>' +
          esc(v.summary || '') +
        '</div>' +
        (v.play ? '<div class="vol-play">' + esc(v.play) + '</div>' : '') +
      '</div></section>';
  }

  function stat(v, k, cls) {
    return '<div class="stat"><div class="stat-v num ' + (cls || '') + '">' + v + '</div>' +
      '<div class="stat-k">' + esc(k) + '</div></div>';
  }

  function ladderHtml(ladder, st) {
    const pick = st && st.ladderPick;
    let html = '<div class="ladder">' + ladder.map((l) => {
      const hot = l.boards >= 3 ? ' hot' : '';
      const on = pick === l.boards ? ' on' : '';
      return '<button class="ladder-cell' + hot + on + '" data-ladder="' + l.boards + '">' +
        '<b>' + l.count + '</b><span>' + (l.boards >= 20 ? '最高' : l.boards + '板') + '</span>' +
        '</button>';
    }).join('') + '</div>';

    const group = pick != null ? ladder.filter((l) => l.boards === pick)[0] : null;
    if (group && group.list && group.list.length) {
      html += '<div class="ladder-hd"><b>' + group.boards + ' 板</b> · ' + group.list.length +
        ' 只<em>点股票看K线</em></div>' +
        '<div class="ladder-list">' + group.list.map(ladderRow).join('') + '</div>';
    } else if (pick != null) {
      html += '<div class="ladder-hd">该档暂无数据</div>';
    } else {
      html += '<div class="ladder-tip">点上方数字展开该档个股</div>';
    }
    return html;
  }

  /** 龙头类型：连板龙头 / 涨停龙头 / 人气龙头（未涨停） */
  function leaderKind(l) {
    if ((l.boards || 0) >= 2) return '连板龙头';
    if ((l.boards || 0) === 1) return '涨停龙头';
    return '人气龙头';
  }

  function leaderButton(l) {
    return '<button class="h-leader" data-kline="' + esc(l.code) +
      '" data-name="' + esc(l.name) + '">' +
      '<span class="h-leader-l">' + ((l.boards || 0) >= 1 ? '聚焦龙头' : '人气龙头') + '</span>' +
      '<span class="h-leader-n">' + esc(l.name) +
        '<em>' + leaderKind(l) +
        ((l.boards || 0) > 0 ? ' · ' + l.boards + ' 板' : ' · 今日未涨停') +
        ' · 龙头度 ' + l.leaderScore + '</em></span>' +
      '<span class="h-leader-go">看K线 ›</span>' +
      '</button>';
  }

  function ladderRow(x) {
    const cls = U.pctClass(x.pct);
    return '<button class="lstock" data-kline="' + esc(x.code) + '" data-name="' + esc(x.name) + '">' +
      '<span class="lstock-l">' +
        '<span class="lstock-name">' + esc(x.name) + '</span>' +
        '<span class="lstock-meta">' + esc(x.code) +
          (x.industry ? ' · ' + esc(x.industry) : '') + '</span>' +
      '</span>' +
      '<span class="lstock-r">' +
        '<span class="lstock-price num ' + cls + '">' + x.price.toFixed(2) + '</span>' +
        '<span class="lstock-seal num">封 ' + U.fmtAmount(x.sealAmount) + '</span>' +
      '</span>' +
      '</button>';
  }

  function skeletonBlock() {
    return '<div class="card"><div class="card-bd">' +
      '<div class="skeleton" style="height:15px;width:40%;margin-bottom:12px"></div>' +
      '<div class="skeleton" style="height:11px;width:100%;margin-bottom:8px"></div>' +
      '<div class="skeleton" style="height:11px;width:82%;margin-bottom:8px"></div>' +
      '<div class="skeleton" style="height:11px;width:64%"></div>' +
      '</div></div>';
  }

  /* ==========================================================
   * 选股视图
   * ========================================================== */
  function renderPicks(st) {
    const tab = st.pickTab || 'short';
    let html = '<div class="segment">' +
      '<button data-picktab="short" class="' + (tab === 'short' ? 'on' : '') + '">短线情绪池</button>' +
      '<button data-picktab="swing" class="' + (tab === 'swing' ? 'on' : '') + '">波段资金池</button>' +
      '</div>';

    if (tab === 'short') html += renderShort(st);
    else html += renderSwing(st);
    return html;
  }

  function renderShort(st) {
    const p = st.short;
    if (!p) return skeletonBlock() + skeletonBlock();
    const list = p.list || [];
    if (!list.length) {
      return '<div class="card"><div class="card-bd"><div class="empty">' + ICON.empty +
        '<div>今日暂无涨停数据<br><span style="font-size:11px">非交易日或盘前，涨停池为空</span></div>' +
        '</div></div></div>';
    }

    const em = st.market && st.market.emotion;
    const leader = st.market && st.market.leader;
    let html = '';

    if (em && em.heightSuppressed) {
      html += '<div class="focus-warn">' +
        '<b>高度压在 ' + em.heightCap + ' 板</b>' +
        '<span>' + esc(em.heightAdvice.text) + '</span>' +
        (leader ? '<span class="focus-leader">当前龙头：' + esc(leader.name) +
          '（' + leaderKind(leader) + ' · 龙头度 ' + leader.leaderScore +
          (leader.inPool === false ? ' · 今日未涨停' : '') + '）</span>' : '') +
        '</div>';
    }

    if (em && em.maxPosition <= 10) {
      html += '<div class="notice" style="margin-bottom:12px">当前情绪阶段（' + esc(em.phase) +
        '）仓位上限仅 ' + em.maxPosition + '%，下列标的仅供观察，不建议开新仓。</div>';
    }
    const top = list.slice(0, 40);
    html += '<section class="card"><div class="card-hd"><div class="card-title">涨停池评分</div>' +
      '<div class="card-sub">' + list.length + ' 只 · 按评分排序</div></div>' +
      '<div style="padding:0">' + top.map((x) => stockRow(x, st)).join('') + '</div></section>';

    html += '<div class="notice" style="margin-top:12px">评分 = 板块地位30 + 连板高度22 + 封单强度16 + ' +
      '市值适配14 + 换手健康10 + 封板时间8。红色标签为符合「只做龙一/中军」的标的，' +
      '灰色为跟风与杂毛，黄色为风险提示。</div>';
    return html;
  }

  function stockRow(x, st) {
    const cls = U.pctClass(x.pct);
    const g = 'g' + (x.grade || 'D');
    const flags = (x.flags || []).map((f) => {
      const veto = /ST|北交所|杂毛|巨换手|反复炸板/.test(f);
      return '<div class="flag' + (veto ? ' veto' : '') + '">' + esc(f) + '</div>';
    }).join('');

    return '<div class="stock' + (x.isLeader ? ' is-leader' : '') +
      (x.focusOnly ? ' is-focus' : '') + '" data-stock="' + esc(x.code) + '" data-kind="short">' +
      '<div class="stock-main">' +
        '<div class="score-badge ' + g + '">' + x.score + '</div>' +
        '<div class="stock-id">' +
          '<div class="stock-name">' + esc(x.name) +
            '<span class="stock-code">' + esc(x.code) + '</span></div>' +
          tagsHtml(x.tags) +
        '</div>' +
        '<div class="stock-right">' +
          '<div class="stock-price num ' + cls + '">' + x.price.toFixed(2) + '</div>' +
          '<div class="stock-pct num ' + cls + '">' + U.fmtPct(x.pct) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="stock-detail">' +
        '<div class="kv">' +
          '<div class="kv-cell"><div class="k">连板</div><div class="v">' + x.boards + ' 板</div></div>' +
          '<div class="kv-cell"><div class="k">封单/流通</div><div class="v">' +
            (x.sealRatio * 100).toFixed(1) + '%</div></div>' +
          '<div class="kv-cell"><div class="k">封单额</div><div class="v">' +
            U.fmtAmount(x.sealAmount) + '</div></div>' +
          '<div class="kv-cell"><div class="k">换手</div><div class="v">' + x.turnover.toFixed(1) + '%</div></div>' +
          '<div class="kv-cell"><div class="k">流通市值</div><div class="v">' +
            (x.floatCap / 1e8).toFixed(0) + '亿</div></div>' +
          '<div class="kv-cell"><div class="k">板块地位</div><div class="v">' +
            (x.sector ? esc(x.sector) + ' #' + x.rank : '—') + '</div></div>' +
        '</div>' +
        (flags ? '<div class="flag-list">' + flags + '</div>' : '') +
        '<div class="signal buy"><span class="s-name">仓位参考</span><span>' +
          planText(st, x) + '</span></div>' +
        '<div class="pos-actions">' +
          '<button class="btn" data-kline="' + esc(x.code) + '" data-name="' + esc(x.name) + '">看K线</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function planText(st, x) {
    const em = st.market && st.market.emotion;
    if (!em) return '—';
    const p = E.plan({
      capital: U.store.get('capital', 100000),
      phaseKey: em.phaseKey,
      score: x.score,
      veto: x.veto,
      stopPct: U.store.get('stopPct', 6)
    });
    if (p.suggested === 0) return '不建议开仓（' + em.phase + '）';
    return '首仓 ' + p.firstEntry + '%（约 ' + p.firstAmount.toLocaleString('zh-CN') + ' 元），' +
      '上限 ' + p.suggested + '% · 止损 -' + p.stopPct + '%';
  }

  function renderSwing(st) {
    const s = st.swing;
    let html = '';

    if (!s || !s.items) {
      html += '<div class="card"><div class="card-bd">' +
        '<div class="empty" style="padding:22px 10px 18px">' +
          '<div style="font-size:13px;color:var(--text);margin-bottom:6px">月线资金流扫描</div>' +
          '<div style="line-height:1.75">连续 4-5 个月放量（红量柱）、累计涨幅 ≤50%<br>' +
          '周线上升 · 20 日线拐头 · 日线缩量阴线</div>' +
        '</div>' +
        '<button class="btn btn-primary btn-block" id="btnSwingScan"' +
          (st.swingScanning ? ' disabled' : '') + '>' + ICON.scan +
          (st.swingScanning ? '扫描中…' : '开始扫描') + '</button>' +
        (st.swingScanning ? '<div class="progress-line"><i id="swingProg" style="width:' +
          (st.swingProgress || 0) + '%"></i></div>' : '') +
        '</div></div>';
      if (!st.swingScanning) {
        html += '<div class="notice">扫描需要逐只拉取日线（约 1 年半）并聚合成周线、月线，' +
          '耗时 10-25 秒。数据源为腾讯行情，不受东财限流影响。</div>';
      }
      return html;
    }

    const items = s.items;
    const readyCnt = items.filter((i) => i.buyReady).length;
    html += '<div class="segment" style="margin-bottom:12px">' +
      '<button data-swfilter="ready" class="' + ((s.filter || 'ready') === 'ready' ? 'on' : '') + '">可买点 ' +
        readyCnt + '</button>' +
      '<button data-swfilter="all" class="' + (s.filter === 'all' ? 'on' : '') + '">全部 ' + items.length + '</button>' +
      '</div>';

    const shown = s.filter === 'all' ? items : items.filter((i) => i.buyReady);
    if (!shown.length) {
      html += '<div class="card"><div class="card-bd"><div class="empty">' + ICON.empty +
        '<div>本次扫描没有完全符合的标的<br>月线堆量是稀缺形态，宁可错过</div>' +
        '<div style="margin-top:8px"><button class="btn" data-swfilter="all" style="font-size:12px">' +
        '查看全部 ' + items.length + ' 只扫描结果</button></div></div></div></div>';
    } else {
      html += '<section class="card">' + shown.map((i) => swingRow(i)).join('') + '</section>';
    }

    html += '<div class="notice" style="margin-top:12px">扫描范围：成交额榜前 100 只中，' +
      '流通市值 20-800 亿、60 日涨幅未过 60% 的候选（本次 ' + (s.scanned || items.length) + ' 只）。' +
      '月线堆量本是稀缺形态，命中少是正常的。</div>';

    html += '<button class="btn btn-block" id="btnSwingScan" style="margin-top:12px">' + ICON.scan +
      ' 重新扫描</button>';
    return html;
  }

  function swingRow(i) {
    const g = 'g' + (i.grade || 'D');
    const tags = [];
    if (i.heapMonths >= 4) tags.push('月线堆量' + i.heapMonths + '月');
    if (i.weekUp) tags.push('周线向上');
    if (i.ma20Up) tags.push('20日线拐头');
    if (i.conditions.shrink) tags.push('极致缩量');
    if (i.conditions.yin) tags.push('阴线');
    if (i.conditions.hasLimitUp) tags.push('前有涨停');
    if (i.buyReady) tags.push('买点成立');

    return '<div class="stock" data-stock="' + esc(i.code) + '" data-kind="swing">' +
      '<div class="stock-main">' +
        '<div class="score-badge ' + g + '">' + i.score + '</div>' +
        '<div class="stock-id">' +
          '<div class="stock-name">' + esc(i.name) + '<span class="stock-code">' + esc(i.code) + '</span></div>' +
          tagsHtml(tags) +
        '</div>' +
        '<div class="stock-right">' +
          '<div class="stock-price num ' + U.pctClass(i.pct) + '">' + i.price.toFixed(2) + '</div>' +
          '<div class="stock-pct num ' + U.pctClass(i.pct) + '">' + U.fmtPct(i.pct) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="stock-detail">' +
        '<div class="kv">' +
          '<div class="kv-cell"><div class="k">放量月数</div><div class="v">' + i.heapMonths + ' 个月</div></div>' +
          '<div class="kv-cell"><div class="k">6月涨幅</div><div class="v">' + U.fmtPct(i.gather, 0) + '</div></div>' +
          '<div class="kv-cell"><div class="k">今日量/5日</div><div class="v">' +
            (i.volShrink * 100).toFixed(0) + '%</div></div>' +
          '<div class="kv-cell"><div class="k">距250日高</div><div class="v">' +
            (i.pos250 * 100).toFixed(0) + '%</div></div>' +
          '<div class="kv-cell"><div class="k">20日线</div><div class="v">' + i.ma20.toFixed(2) + '</div></div>' +
          '<div class="kv-cell"><div class="k">流通市值</div><div class="v">' +
            ((i.floatCap || 0) / 1e8).toFixed(0) + '亿</div></div>' +
        '</div>' +
        (i.buyReady
          ? '<div class="signal buy"><span class="s-name">买点成立</span><span>缩量阴线回踩不破 20 日线，' +
            '符合「买阴不买阳」<span class="s-note">持有预期：涨 30% 减一次仓，其余躺到 2 浪</span></span></div>'
          : '<div class="signal"><span class="s-name" style="color:var(--text-2)">观察</span><span>' +
            '条件未全部满足，进入波段池等日线信号</span></div>') +
        '<div class="pos-actions">' +
          '<button class="btn" data-kline="' + esc(i.code) + '" data-name="' + esc(i.name) + '">看K线</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ==========================================================
   * 风控视图
   * ========================================================== */
  function renderRisk(st) {
    const em = st.market && st.market.emotion;
    const capital = U.store.get('capital', 100000);
    const stopPct = U.store.get('stopPct', 6);
    const plan = em ? E.plan({
      capital, phaseKey: em.phaseKey, stopPct,
      riskBudgetPct: U.store.get('riskBudget', 2), score: 70
    }) : null;

    let html = '';

    /* 仓位计算器 */
    const rows = E.POSITION_TABLE;
    html += card('仓位刻度', null, '' +
      '<div class="kv" style="grid-template-columns:repeat(3,1fr)">' +
        '<div class="kv-cell"><div class="k">总资金</div><div class="v">' +
          (capital / 10000).toFixed(1) + ' 万</div></div>' +
        '<div class="kv-cell"><div class="k">单笔止损</div><div class="v">-' + stopPct + '%</div></div>' +
        '<div class="kv-cell"><div class="k">单笔风险预算</div><div class="v">' +
          U.store.get('riskBudget', 2) + '%</div></div>' +
      '</div>' +
      (plan ? '<div class="advice-box" style="margin-top:12px">' +
        '<b>' + esc(em.phase) + '</b> · ' + plan.note +
        '<br>单笔最大亏损控制在 ' + plan.singleRisk.toLocaleString('zh-CN') + ' 元以内' +
        '</div>' : '') +
      '<div style="display:flex;gap:8px;margin-top:12px">' +
        '<button class="btn" style="flex:1" id="btnCapital">改资金</button>' +
        '<button class="btn" style="flex:1" id="btnStop">改止损</button>' +
      '</div>');

    /* 阶段表 */
    const PHASE_ROWS = [
      { key: 'freeze', name: '冰点期',   hint: '空仓' },
      { key: 'thaw',   name: '冰点修复', hint: '10% 试错' },
      { key: 'trial',  name: '试错期',   hint: '小仓试错' },
      { key: 'main',   name: '主升期',   hint: '回封加仓' },
      { key: 'peak',   name: '高潮期',   hint: '只减不加' }
    ];
    html += card('各阶段仓位上限', null, '' +
      '<div class="bar-list">' + PHASE_ROWS.map((r) => {
        const cap = rows[r.key].max;
        const w = cap === 0 ? 2 : cap;
        const active = em && em.phaseKey === r.key;
        return '<div class="bar-item">' +
          '<span class="bar-name"' + (active ? ' style="font-weight:700;color:var(--accent)"' : '') + '>' +
            r.name + (active ? ' ●' : '') + '</span>' +
          '<span class="bar-track"><span class="bar-fill" style="width:' + w + '%;' +
            'background:linear-gradient(90deg,var(--accent),color-mix(in srgb,var(--accent) 30%,transparent))"></span>' +
            '<span class="bar-cnt">' + cap + '%</span></span>' +
          '<span class="bar-leader">' + esc(r.hint) + '</span>' +
        '</div>';
      }).join('') + '</div>', { tight: true });

    /* 交易纪律 */
    const checks = U.store.get('checks', {});
    const checklist = [
      'c1|开仓前已定好止盈止损价',
      'c2|首仓只做试错仓（10%），不一次打满',
      'c3|只做龙一或中军，杂毛一个不看',
      'c4|竞价额是否达到昨日成交额的 8%-10%',
      'c5|9:20 前只看不动（可撤单，诱多诱空）',
      'c6|下跌途中绝不补仓、不做 T 摊成本',
      'c7|大赚之后、大亏之后都空仓一天',
      'c8|单笔亏损触及 -5%~-7% 无条件砍'
    ];
    html += card('每日执行清单', null, checklist.map((line) => {
      const [id, text] = line.split('|');
      const done = checks[id];
      return '<div class="check-item' + (done ? ' done' : '') + '" data-check="' + id + '">' +
        '<span class="check-box">' + ICON.check + '</span>' +
        '<span class="check-text">' + esc(text) + '</span></div>';
    }).join(''), { tight: true });

    /* 黑名单 */
    html += card('黑名单', null, E.BLACKLIST.map((b) =>
      '<div class="switch-row"><div class="switch-label">' + esc(b.k) +
      '<div class="switch-desc">' + esc(b.v) + '</div></div></div>'
    ).join(''), { tight: true });

    html += '<div class="notice">止损不是失败，死扛才是深渊。大亏的真正根源是下跌过程中加仓，不是市场。</div>';
    return html;
  }

  /* ==========================================================
   * 通用小件
   * ========================================================== */
  /** 金额：1.23万 / 4,567 */
  function money(v, sign) {
    const a = Math.abs(v);
    let s;
    if (a >= 1e8) s = (a / 1e8).toFixed(2) + '亿';
    else if (a >= 1e4) s = (a / 1e4).toFixed(2) + '万';
    else s = a.toFixed(a >= 100 ? 0 : 2);
    return (v < 0 ? '-' : (sign ? '+' : '')) + '¥' + s;
  }

  function kv(k, v, cls) {
    return '<div class="kv-cell"><div class="k">' + esc(k) + '</div>' +
      '<div class="v num ' + (cls || '') + '">' + v + '</div></div>';
  }

  /** 二级页面顶部：返回 + 标题 */
  function pageHead(title, desc) {
    return '<div class="page-head">' +
      '<button class="page-back" data-nav="back" aria-label="返回">' + ICON.back + '</button>' +
      '<div class="page-head-txt">' +
        '<div class="page-head-title">' + esc(title) + '</div>' +
        (desc ? '<div class="page-head-desc">' + esc(desc) + '</div>' : '') +
      '</div></div>';
  }

  /** 设置项行：左侧标签，右侧当前值 + 箭头 */
  function menuRow(opt) {
    const clickable = !!(opt.nav || opt.act);
    return '<button class="menu-row' + (clickable ? '' : ' static') + '"' +
      (opt.nav ? ' data-nav="' + opt.nav + '"' : '') +
      (opt.act ? ' data-act="' + opt.act + '"' : '') + '>' +
      '<span class="menu-label">' + esc(opt.label) +
        (opt.desc ? '<span class="menu-desc">' + esc(opt.desc) + '</span>' : '') + '</span>' +
      (opt.value ? '<span class="menu-value">' + esc(opt.value) + '</span>' : '') +
      (clickable ? '<span class="menu-chev">' + ICON.chevron + '</span>' : '') +
      '</button>';
  }

  /* ==========================================================
   * 持仓视图
   * ========================================================== */
  function renderPortfolio(st) {
    const snap = st.pf;
    if (!snap) {
      return '<div class="card"><div class="card-bd"><div class="empty">' +
        ICON.portfolio + '<div>正在获取持仓行情…</div></div></div></div>';
    }
    if (!snap.rows.length) return emptyPortfolio(snap);

    const pnlCls = U.pctClass(snap.totalPnl);
    const todayCls = U.pctClass(snap.totalToday);
    const over = snap.phaseMax != null && snap.totalWeight > snap.phaseMax + 0.5;

    let html = '<section class="card">' +
      '<div class="pf-hero">' +
        '<div class="pf-label">持仓市值</div>' +
        '<div class="pf-mv num">' + money(snap.totalMV) + '</div>' +
        '<div class="pf-pnl">' +
          '<span class="num ' + pnlCls + '">' + money(snap.totalPnl, true) + '</span>' +
          '<span class="num ' + pnlCls + '">' + U.fmtPct(snap.totalPnlPct) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">' +
        stat(money(snap.totalToday, true), '今日盈亏', todayCls) +
        stat(snap.count + ' 只', '持仓数', '') +
        stat(snap.totalWeight.toFixed(0) + '%', '总仓位', over ? 'up' : '') +
      '</div>' +
      '<div class="card-bd" style="padding-top:12px">' +
        positionBar(snap, over) +
      '</div>' +
      '</section>';

    /* 体检：把持仓和情绪阶段、止损纪律对一遍 */
    const issues = YB.pf.audit(snap);
    if (issues.length) {
      html += '<div class="audit">' + issues.map((i) =>
        '<div class="audit-item ' + i.level + '">' +
          '<span class="audit-mark"></span>' +
          '<span class="audit-txt"><b>' + esc(i.title) + '</b>' + esc(i.desc) + '</span>' +
        '</div>').join('') + '</div>';
    }

    html += '<section class="card" style="margin-top:12px">' +
      '<div class="card-hd"><div class="card-title">持仓明细</div>' +
        '<div class="card-sub">按市值排序 · 点开看详情</div></div>' +
      '<div style="padding:0">' + snap.rows.map((r) => posRow(r)).join('') + '</div></section>';

    /* 交割单 */
    const rz = YB.pf.realized();
    if (rz.count) {
      const rzCls = U.pctClass(rz.total);
      html += card('交割单', '已实现 ' + money(rz.total, true) + ' · 胜率 ' + rz.winRate.toFixed(0) + '%',
        rz.list.slice(0, 8).map((r) =>
          '<div class="close-row">' +
            '<span class="close-name">' + esc(r.name) + '</span>' +
            '<span class="close-meta num">' + r.cost.toFixed(2) + ' → ' + r.exitPrice.toFixed(2) + '</span>' +
            '<span class="close-pnl num ' + U.pctClass(r.pnl) + '">' + money(r.pnl, true) + '</span>' +
          '</div>').join('') +
        (rz.count > 8 ? '<div class="close-more">仅显示最近 8 笔，共 ' + rz.count + ' 笔</div>' : ''),
        { tight: true });
    }

    html += '<button class="btn btn-primary btn-block" id="btnAddPos" style="margin-top:4px">' +
      ICON.plus + ' 添加持仓</button>';

    if (!st.pfLoading && snap.quoted < snap.count) {
      html += '<div class="notice" style="margin-top:12px">' +
        (snap.count - snap.quoted) + ' 只标的暂未取到行情（停牌或代码有误），先按成本价计入。</div>';
    }
    return html;
  }

  function emptyPortfolio(snap) {
    return '<div class="card"><div class="card-bd">' +
      '<div class="empty" style="padding:34px 16px 22px">' + ICON.portfolio +
      '<div style="font-size:14px;color:var(--text);margin-bottom:8px">还没有持仓记录</div>' +
      '<div style="line-height:1.8">只记龙一和中军，首仓 10% 试错<br>' +
      '跌破止损线会自动标红提醒</div></div>' +
      '<button class="btn btn-primary btn-block" id="btnAddPos">' + ICON.plus + ' 添加持仓</button>' +
      '</div></div>' +
      '<div class="card" style="margin-top:12px"><div class="card-bd" style="padding:0">' +
        menuRow({ label: '总资金', desc: '仓位占比的分母', value: money(snap.capital), act: 'capital' }) +
      '</div></div>' +
      '<div class="notice" style="margin-top:12px">持仓只存在本机（localStorage），不上传任何服务器。' +
      '同一标的多次买入会按加权平均成本自动合并。</div>';
  }

  /** 仓位进度条：填充 = 当前仓位，竖线 = 情绪阶段上限 */
  function positionBar(snap, over) {
    const w = Math.max(0, Math.min(100, snap.totalWeight));
    const max = snap.phaseMax;
    return '<div class="pos-bar">' +
      '<i class="pos-bar-fill' + (over ? ' over' : '') + '" style="width:' + w + '%"></i>' +
      (max != null && max > 0 && max < 100
        ? '<span class="pos-bar-mark" style="left:' + max + '%"></span>' : '') +
      '</div>' +
      '<div class="pos-bar-legend">' +
        '<span>总仓位 <b class="' + (over ? 'up' : '') + '">' + snap.totalWeight.toFixed(1) + '%</b></span>' +
        (max != null ? '<span>' + esc(snap.phaseName) + '上限 ' + max + '%</span>' : '') +
        '<span class="pos-bar-cap" data-act="capital">总资金 ' + money(snap.capital) + ' ›</span>' +
      '</div>';
  }

  function posRow(r) {
    const cls = U.pctClass(r.pnl);
    const bad = r.status === 'stop';
    const near = r.status === 'near';
    return '<div class="stock pos" data-pos="' + r.id + '">' +
      '<div class="stock-main">' +
        '<div class="stock-id">' +
          '<div class="stock-name">' + esc(r.name) +
            '<span class="stock-code">' + esc(r.code) + '</span>' +
            (bad ? '<span class="tag hot">已破止损</span>' :
             near ? '<span class="tag warn">逼近止损</span>' : '') +
          '</div>' +
          '<div class="pos-sub num">' + r.shares + ' 股 · 成本 ' + r.cost.toFixed(2) +
            ' · 仓位 ' + r.weight.toFixed(1) + '%</div>' +
        '</div>' +
        '<div class="stock-right">' +
          '<div class="stock-price num ' + cls + '">' + money(r.pnl, true) + '</div>' +
          '<div class="stock-pct num ' + cls + '">' + U.fmtPct(r.pnlPct) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="stock-detail">' +
        '<div class="kv">' +
          kv('现价', r.price.toFixed(2), U.pctClass(r.pct)) +
          kv('市值', money(r.marketValue)) +
          kv('今日', money(r.todayPnl, true), U.pctClass(r.todayPnl)) +
          kv('止损价', r.stopPrice.toFixed(2), bad ? 'down' : '') +
          kv('距止损', r.toStopPct.toFixed(1) + '%', r.toStopPct < 3 ? 'up' : '') +
          kv('成本额', money(r.costValue)) +
        '</div>' +
        (r.note ? '<div class="pos-note">' + esc(r.note) + '</div>' : '') +
        '<div class="pos-actions">' +
          '<button class="btn" data-kline="' + esc(r.code) + '" data-name="' + esc(r.name) + '">K线</button>' +
          '<button class="btn" data-pos-act="edit">编辑</button>' +
          '<button class="btn" data-pos-act="close">清仓</button>' +
          '<button class="btn danger" data-pos-act="del">删除</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ==========================================================
   * K 线详情页
   * ========================================================== */
  const PERIODS = [['day', '日K'], ['week', '周K'], ['month', '月K']];

  function maAt(bars, n, i) {
    if (i == null || i + 1 < n) return null;
    let sum = 0;
    for (let k = i - n + 1; k <= i; k++) sum += bars[k].close;
    return sum / n;
  }

  /** 十字光标信息条：日期 / 开高低收 / 量 / 均线 */
  function klineInfo(b, i, bars) {
    if (!b || !bars || !bars.length) return '';
    const idx = i == null ? bars.length - 1 : i;
    const cur = bars[idx] || b;
    const prev = bars[idx - 1] || cur;
    const pct = prev.close > 0 ? (cur.close / prev.close - 1) * 100 : 0;
    const cls = U.pctClass(pct);

    let html = '<div class="ki-row">' +
      '<span class="ki-date num">' + esc(cur.date || '') + '</span>' +
      '<span class="ki-item">开<b class="num ' + cls + '">' + cur.open.toFixed(2) + '</b></span>' +
      '<span class="ki-item">高<b class="num ' + cls + '">' + cur.high.toFixed(2) + '</b></span>' +
      '<span class="ki-item">低<b class="num ' + cls + '">' + cur.low.toFixed(2) + '</b></span>' +
      '<span class="ki-item">收<b class="num ' + cls + '">' + cur.close.toFixed(2) + '</b></span>' +
      '<span class="ki-item">' + U.fmtPct(pct) + '</span>' +
      '</div>';

    const mas = [5, 10, 20, 60].map((n) => ({ n: n, v: maAt(bars, n, idx) }));
    html += '<div class="ki-row ki-ma">' +
      mas.map((m, k) => '<span class="ki-ma-item ma' + k + '">MA' + m.n +
        ' <b class="num">' + (m.v == null ? '--' : m.v.toFixed(2)) + '</b></span>').join('') +
      '</div>' +
      '<div class="ki-row ki-ma ki-volrow">' +
        '<span class="ki-item ki-vol">成交量 <b class="num">' + YB.kline.fmtVol(cur.vol) + '</b></span>' +
        '<span class="ki-item ki-vol">均线 ' + mas.filter(function (m) { return m.v != null; }).length +
          '/4 有效</span>' +
      '</div>';
    return html;
  }

  /* ---------------- 个股页的四个信息层 ---------------- */

  /** 行情条：现价 + 当日全字段。开高低之外补上换手、量比、市值、估值 */
  /* ==========================================================
   * 个股页
   *
   * 设计原则：用布局表达层级，不用文字解释。
   *   价格最大 → 决策次之 → 图表最大面积 → 指标网格最小
   * 卡片标题、副标题、说明段落、图例标签全部去掉，
   * 因为「需要解释才看得懂」本身就是布局没做好的证据。
   * ========================================================== */

  const VERDICT_CLS = { buy: 'up', watch: 'warn', avoid: 'mute' };

  /**
   * 价格行：现价 + 涨跌幅 + 两个当前最相关的指标。
   * 指标随模式切换——分时看均价/高低（判日内买卖力道），
   * 日K 看换手/量比（判量能是否配合）。不放无关数字。
   */
  function pxRow(q, price, pct, cls, k, mode) {
    const f = function (v, d) { return v == null || !isFinite(v) ? '—' : Number(v).toFixed(d == null ? 2 : d); };
    const extras = [];

    if (mode === 'minute' && k && k.minute && k.minute.length > 2) {
      const pts = k.minute;
      let last = pts[pts.length - 1];
      let hi = -Infinity, lo = Infinity;
      pts.forEach(function (p) {
        if (p.price > hi) hi = p.price;
        if (p.price < lo) lo = p.price;
      });
      const avgCls = last.avg && last.price >= last.avg ? 'up' : 'down';
      extras.push('均价 <b class="' + avgCls + '">' + f(last.avg) + '</b>');
      extras.push('高 <b>' + f(hi) + '</b>');
      extras.push('低 <b>' + f(lo) + '</b>');
    } else if (q) {
      if (q.turnover > 0) extras.push('换手 <b>' + f(q.turnover, 1) + '%</b>');
      if (q.volRatio > 0) extras.push('量比 <b>' + f(q.volRatio, 2) + '</b>');
    }

    return '<div class="px-row">' +
      '<div class="px-main">' +
        '<span class="px-price num ' + cls + '">' + f(price) + '</span>' +
        '<span class="px-pct num ' + cls + '">' + U.fmtPct(pct) + '</span>' +
      '</div>' +
      (extras.length ? '<div class="px-ex num">' + extras.join('　') + '</div>' : '') +
      '</div>';
  }

  /** 决策：一行结论 + 三个执行价，不解释 */
  function decisionBar(a) {
    const plan = a.plan;
    const vc = VERDICT_CLS[a.verdict] || 'mute';
    const lead = (a.reasons || [])[0] || '';
    const off = plan.suggested === 0 ? ' off' : '';

    return '<div class="dv">' +
      '<div class="dv-line">' +
        '<b class="dv-v ' + vc + '">' + esc(a.verdictText) + '</b>' +
        (lead ? '<span class="dv-r">' + esc(lead) + '</span>' : '') +
      '</div>' +
      '<div class="dv-nums">' +
        '<span class="dv-n"><em>止损</em><b class="num down">' + YB.util.fmtPrice(plan.stopPrice) + '</b></span>' +
        '<span class="dv-n"><em>目标</em><b class="num up">' + YB.util.fmtPrice(plan.target1) + '</b></span>' +
        '<span class="dv-n"><em>仓位</em><b class="num' + off + '">' + plan.suggested + '%</b></span>' +
      '</div>' +
      '</div>';
  }

  /**
   * 指标网格：所有派生数据压缩成 3 列，只留标签和数值。
   * 顺序按决策使用频率：位置 → 压力支撑 → 强弱 → 涨停基因。
   */
  function dataGrid(a, k) {
    const p = a.position || {};
    const t = a.tech || {};
    const g = a.gene || {};
    const rs = a.rs || {};
    const c = k.chips || null;
    const vv = p.vol || {};

    const f = function (v, d) { return v == null || !isFinite(v) ? '—' : Number(v).toFixed(d == null ? 2 : d); };
    const sg = function (v, d) { return v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + f(v, d) + '%'; };
    const cell = function (k2, v, cls) {
      return '<span class="dg-c"><em>' + esc(k2) + '</em><b class="num ' + (cls || '') + '">' + v + '</b></span>';
    };

    const rows = [];

    /* 位置 */
    rows.push(cell('成本', p.vwap60 == null ? '—' : f(p.vwap60)) +
      cell('偏离', p.devFromCost == null ? '—' : sg(p.devFromCost, 1),
        p.devFromCost > 25 ? 'warnc' : '') +
      (c ? cell('获利', Math.round(c.profitRatio * 100) + '%',
        c.profitRatio >= 0.7 ? 'up' : c.profitRatio <= 0.3 ? 'down' : '')
        : cell('分位', p.pos60 == null ? '—' : Math.round(p.pos60 * 100) + '%')));

    /* 压力支撑 */
    rows.push(cell('压力', t.resistance == null ? '—' : f(t.resistance), 'warnc') +
      cell('支撑', t.support == null ? '—' : f(t.support)) +
      cell('均线', esc(t.align || '—'),
        t.align === '多头排列' ? 'up' : t.align === '空头排列' ? 'down' : ''));

    /* 强弱 + 板块 */
    rows.push(cell('RS', rs.rs == null ? '—' : f(rs.rs, 2),
        rs.rs >= 1.05 ? 'up' : rs.rs <= 0.95 ? 'down' : '') +
      cell('量能', vv.r60 == null ? '—' : f(vv.r60, 1) + 'x',
        vv.r60 > 1.8 ? 'warnc' : '') +
      (a.sector ? cell('板块', esc(a.sector.name) + ' ' + a.sector.rank + '/' + a.sector.total)
        : cell('集中度', c && c.concentration != null ? f(c.concentration, 1) + '%' : '—')));

    /* 涨停基因 */
    if (g.count != null) {
      rows.push(cell('涨停', g.count + '次') +
        cell('次日', g.avgNext == null ? '—' : sg(g.avgNext, 1),
          g.avgNext >= 2 ? 'up' : g.avgNext < 0 ? 'down' : '') +
        cell('连板', g.continueRate == null ? '—' : Math.round(g.continueRate * 100) + '%'));
    }

    return '<div class="dg">' + rows.map(function (r) {
      return '<div class="dg-r">' + r + '</div>';
    }).join('') + '</div>';
  }

  /** 主图切换：两个词，无边框 */
  function chartSwitch(mode) {
    const items = [['minute', '分时'], ['day', '日K']];
    return '<div class="cs">' + items.map(function (m) {
      return '<button data-chart="' + m[0] + '" class="' + (mode === m[0] ? 'on' : '') + '">' +
        m[1] + '</button>';
    }).join('') + '</div>';
  }

  function renderKline(st) {
    const k = st.kline;
    if (!k) return pageHead('K线', '') + skeletonBlock();

    const head = pageHead(k.name || k.code, k.code);
    if (k.loading) return head + skeletonBlock();
    if (k.error || !k.view || k.view.length < 2) {
      return head + '<div class="chart-box"><div class="empty">' + ICON.empty +
        '<div>' + esc(k.error || '暂无数据') + '</div></div></div>';
    }

    const q = k.quote;
    const bars = k.view;
    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2] || last;
    const price = q && q.price > 0 ? q.price : last.close;
    const pct = q ? q.pct : (prev.close > 0 ? (last.close / prev.close - 1) * 100 : 0);
    const cls = U.pctClass(pct);
    const A = k.analysis;
    const mode = k.chart || 'day';

    return head +
      pxRow(q, price, pct, cls, k, mode) +
      (A ? decisionBar(A) : '') +
      chartSwitch(mode) +
      '<div class="chart-box"><canvas id="mainChart"></canvas></div>' +
      (mode === 'day'
        ? '<div class="cz"><button data-zoom="out">−</button><button data-zoom="in">+</button></div>'
        : '') +
      (A ? dataGrid(A, k) : '');
  }

  function renderSector(st) {

    const sub = st.stack && st.stack[st.stack.length - 1];

    const name = sub && sub.key;

    const pool = (st.short && st.short.list) || [];

    const d = name ? YB.engine.sectorDetail(name, pool, st.hotList || []) : null;



    if (!d) {

      const loading = !st.short;

      return pageHead(name || '板块', '') +

        '<div class="card"><div class="card-bd"><div class="empty">' + ICON.empty +

        '<div>' + (loading

          ? '正在加载该板块个股…'

          : '没有该板块的标的<br>可能已断板或数据尚未更新') +

        '</div></div></div></div>';

    }



    let html = pageHead(d.name,

      d.limitUpCount + ' 只涨停' +

      (d.count > d.limitUpCount ? ' · ' + (d.count - d.limitUpCount) + ' 只强势' : '') +

      (d.maxBoards > 0 ? ' · ' + d.maxBoards + ' 板最高' : ''));



    /* 汇总 */

    html += '<div class="card"><div class="card-bd" style="padding:14px 16px">' +

      '<div class="kv" style="grid-template-columns:repeat(3,1fr)">' +

        kv('涨停 / 强势', d.limitUpCount + ' / ' + (d.count - d.limitUpCount)) +

        kv('最高板', d.maxBoards + ' 板') +

        kv('板块成交', U.fmtAmount(d.amount)) +

      '</div>' +

      '</div></div>';



    /* 成员 */

    html += '<section class="card">' + d.list.map(function (x, i) {

      return aesRow(x, i);

    }).join('') + '</section>';



    return html;

  }

  /** 审美分等级色 */
  function aesCls(g) {
    return g === 'S' ? ' s' : g === 'A' ? ' a' : g === 'B' ? ' b' : '';
  }

  function aesRow(x, i) {
    const cls = U.pctClass(x.pct);
    const parts = x.aesParts || {};
    return '<button class="aes-row" data-kline="' + esc(x.code) +
      '" data-name="' + esc(x.name) + '">' +
      '<span class="aes-rank">' + (i + 1) + '</span>' +
      '<span class="aes-mid">' +
        '<span class="aes-name">' + esc(x.name) +
          '<em class="aes-grade' + aesCls(x.aesGrade) + '">' + x.aesGrade + '</em>' +
          (x.isLeader ? '<em class="aes-tag">龙头</em>' : '') +
        '</span>' +
        '<span class="aes-meta">' + esc(x.code) +
          (x.boards > 0 ? ' · ' + x.boards + ' 板' : ' · 未涨停') +
          (x.breakTimes > 0 ? ' · 炸' + x.breakTimes : '') +
        '</span>' +
        '<span class="aes-bars">' +
          [['pos', 30], ['pop', 25], ['seal', 20], ['time', 15], ['turn', 10]].map(function (d) {
            const w = Math.round(Math.min((parts[d[0]] || 0) / d[1], 1) * 100);
            return '<i class="aes-bar" style="width:' + Math.max(w, 2) + '%"></i>';
          }).join('') +
        '</span>' +
      '</span>' +
      '<span class="aes-right">' +
        '<span class="aes-score num">' + x.aes + '</span>' +
        '<span class="aes-pct num ' + cls + '">' + U.fmtPct(x.pct) + '</span>' +
        '<span class="aes-seal num">封 ' + U.fmtAmount(x.sealAmount) + '</span>' +
      '</span>' +
      '</button>';
  }

  function renderSettings(st) {

    const theme = U.Theme.get();

    const ver = YB.update ? YB.update.current() : { name: '—', code: 0 };

    /* 更新项右侧只在有结论时给字：没检查过就不占位，避免一屏都是状态词 */
    const ust = YB.update ? YB.update.state : null;
    let upValue = '';
    if (YB.update) {
      const sm = YB.update.summary();
      if (ust && ust.checking) upValue = '检查中';
      else if (sm.hasUpdate) upValue = 'v' + sm.latest.versionName;
      else if (ust && ust.error) upValue = '失败';
      else if (sm.latest) upValue = '已最新';
    }

    const health = YB.net.health;

    const refreshSec = U.store.get('refreshSec', 30);

    const hist = U.store.get('hist', {}) || {};

    const histCount = Object.keys(hist).length;



    // 数据源健康摘要，只给一个词，详情进二级页看

    const t = health.tencent, e = health.eastmoney;

    const isBad = (h) => h && h.fail > h.ok;

    let srcValue = '未使用';

    if (t || e) srcValue = (isBad(t) || isBad(e)) ? '有源异常' : '正常';



    let html = '';



    html += card('外观', null, '' +

      '<div class="radio-group">' +

        ['auto', 'light', 'dark'].map((k) =>

          '<button data-theme-pref="' + k + '" class="' + (theme === k ? 'on' : '') + '">' +

          ({ auto: '跟随系统', light: '亮色', dark: '暗色' })[k] + '</button>').join('') +

      '</div>', { tight: true });



    html += '<section class="card" style="padding:0">' +

      menuRow({

        label: '行情与数据源', desc: '腾讯为主，东财兜底',

        value: srcValue, nav: 'datasource'

      }) +

      menuRow({

        label: '高级', desc: '刷新 · 缓存 · 本地数据',

        value: refreshSec + ' 秒', nav: 'advanced'

      }) +

      menuRow({

        label: '软件更新', desc: '从 GitHub 拉取新版本',

        value: upValue, nav: 'update'

      }) +

      menuRow({

        label: '关于', desc: '模型说明与免责声明',

        value: 'v' + ver.name, nav: 'about'

      }) +

      '</section>';

    html += '<div class="footer-note">野人量化 v' + esc(ver.name) + '</div>';

    return html;

  }

  function renderSettingsSub(st) {
    const sub = st.stack && st.stack[st.stack.length - 1];
    if (!sub) return renderSettings(st);
    if (sub.name === 'datasource') return renderDataSourcePage();
    if (sub.name === 'advanced') return renderAdvancedPage();
    if (sub.name === 'about') return renderAboutPage();
    if (sub.name === 'update') return renderUpdatePage();
    return renderSettings(st);
  }

  function renderDataSourcePage() {
    const health = YB.net.health;
    const pref = U.store.get('sourcePref', 'auto');

    const rows = [
      { k: 'tencent', n: '腾讯行情', d: 'qt.gtimg.cn · 主数据源，无频率限制' },
      { k: 'eastmoney', n: '东方财富', d: 'push2ex · 涨停池与涨跌分布' },
      { k: 'sina', n: '新浪财经', d: 'hq.sinajs.cn · 备用行情' }
    ].map((s) => {
      const h = health[s.k];
      const ok = h && h.ok > 0;
      const bad = h && h.fail > 0 && (!h.ok || h.fail > h.ok);
      const label = !h ? '未使用' : (h.ok + ' 成功 / ' + h.fail + ' 失败');
      return '<div class="switch-row"><div class="switch-label">' + s.n +
        '<div class="switch-desc">' + s.d + '</div></div>' +
        '<span class="src-badge"><span class="dot' + (bad ? ' bad' : ok ? '' : ' warnc') + '"></span>' +
        label + '</span></div>';
    }).join('');

    let html = pageHead('行情与数据源', '东财限流严重，行情默认走腾讯');

    html += card('各源状态', null, rows, { tight: true });

    html += card('优先级', null,
      '<div class="radio-group">' +
        [['auto', '自动容灾'], ['tencent', '只用腾讯'], ['sina', '新浪优先']].map((k) =>
          '<button data-srcpref="' + k[0] + '" class="' + (pref === k[0] ? 'on' : '') + '">' +
          k[1] + '</button>').join('') +
      '</div>' +
      '<div class="notice" style="margin-top:12px">纯前端 JSONP 直连，没有中转服务器。' +
      '「自动容灾」会按腾讯 → 新浪的顺序依次尝试。东财请求已做串行排队（间隔 380ms），' +
      '被限流时会自动改用上一份缓存数据。</div>', { tight: true });

    return html;
  }

  function renderAdvancedPage() {
    const autoRefresh = U.store.get('autoRefresh', true);
    const refreshSec = U.store.get('refreshSec', 30);
    const hist = U.store.get('hist', {}) || {};
    const histCount = Object.keys(hist).length;
    const posCount = YB.pf.list().length;
    const closedCount = YB.pf.closedList().length;

    let html = pageHead('高级', '刷新频率与本地数据');

    html += card('行情刷新', null, '' +
      '<div class="switch-row"><div class="switch-label">盘中自动刷新' +
        '<div class="switch-desc">交易时段按间隔刷新；15:00 收盘后补拉一次最终数据，然后停止</div></div>' +
        '<button class="btn" data-toggle="autoRefresh" style="padding:6px 12px;font-size:12px">' +
        (autoRefresh ? '已开启' : '已关闭') + '</button></div>' +
      '<div class="switch-row" style="border-bottom:0"><div class="switch-label">刷新间隔' +
        '<div class="switch-desc">越短越费流量，30 秒已足够</div></div></div>' +
      '<div class="radio-group">' +
        [15, 30, 60, 120].map((s) =>
          '<button data-refresh-sec="' + s + '" class="' + (refreshSec === s ? 'on' : '') + '">' +
          s + '秒</button>').join('') +
      '</div>', { tight: true });

    html += '<section class="card" style="padding:0">' +
      '<div class="card-hd" style="padding-bottom:10px"><div class="card-title">本地数据</div></div>' +
      menuRow({
        label: '行情缓存', desc: 'K线 / 涨停池的临时缓存，清了会重新拉',
        value: '清空', act: 'clearcache'
      }) +
      menuRow({
        label: '复盘记录', desc: '每日情绪快照，用于回看周期',
        value: histCount + ' 天', act: 'clearhist'
      }) +
      menuRow({
        label: '持仓与交割单', desc: '当前 ' + posCount + ' 只 / ' + closedCount + ' 笔已清仓',
        value: '清空', act: 'clearpos'
      }) +
      '<div class="notice" style="margin:12px 14px 14px">以上数据全部保存在本机浏览器，' +
      '不会上传。卸载应用或清除应用数据会一并丢失。</div>' +
      '</section>';

    html += '<button class="btn btn-block danger-outline" data-act="resetall" style="margin-top:4px">' +
      '重置全部设置与数据</button>';

    return html;
  }

  /**
   * 软件更新。
   *
   * 只在「能升级」或「刚失败」时多说一句，其余状态只留一行版本对比。
   * 更新这件事不该占用户注意力，能升就升，升完就走。
   */
  function renderUpdatePage() {
    const up = YB.update;
    if (!up) {
      return pageHead('软件更新', '') +
        '<div class="card"><div class="card-bd"><div class="empty">当前环境不支持应用内更新</div></div></div>';
    }

    const cur = up.current();
    const sm = up.summary();
    const s = up.state;
    const lat = sm.latest;

    let html = pageHead('软件更新', 'v' + cur.name);

    html += '<div class="up-head">' +
      '<span class="up-v">v' + esc(cur.name) + '</span>' +
      (lat
        ? '<span class="up-sep">' + (sm.hasUpdate ? '→' : '·') + '</span>' +
          '<span class="up-v' + (sm.hasUpdate ? ' new' : '') + '">v' + esc(lat.versionName) + '</span>'
        : '') +
      '</div>';

    if (s.checking) {
      html += '<div class="up-tip">正在检查…</div>';
    } else if (s.error) {
      html += '<div class="up-tip bad">' + esc(s.error) + '</div>';
    } else if (sm.hasUpdate) {
      html += '<div class="up-tip">有新版本可用</div>';
    } else if (lat) {
      html += '<div class="up-tip ok">已是最新</div>';
    }

    if (sm.hasUpdate && sm.notes.length) {
      html += '<ul class="up-notes">' + sm.notes.map(function (n) {
        return '<li>' + esc(n) + '</li>';
      }).join('') + '</ul>';
    }

    if (s.downloading) {
      const pct = s.total > 0 ? Math.min(100, Math.round(s.done / s.total * 100)) : 0;
      html += '<div class="up-prog"><i style="width:' + (s.total > 0 ? pct : 18) + '%"></i></div>' +
        '<div class="up-tip">' + esc(s.stage || '下载中') +
        (s.total > 0 ? ' ' + pct + '%' : '') + '</div>';
    }
    if (s.installError) {
      html += '<div class="up-tip bad">' + esc(s.installError) + '</div>';
    }

    html += '<div class="up-acts">';
    if (sm.hasUpdate && !s.downloading) {
      html += '<button class="btn btn-primary btn-block" data-up="install">下载并安装</button>';
    }
    html += '<button class="btn btn-block" data-up="check"' +
      (s.checking ? ' disabled' : '') + '>' + (s.checking ? '检查中…' : '检查更新') + '</button>';
    if (!up.hasNative()) {
      html += '<button class="btn btn-block" data-up="page">打开发布页</button>';
    } else if (sm.hasUpdate) {
      html += '<button class="btn btn-block" data-up="page">下载不畅？打开发布页</button>';
    }
    html += '</div>';

    if (lat) {
      const bits = [];
      if (lat.size) bits.push((lat.size / 1024).toFixed(0) + ' KB');
      if (lat.releasedAt) bits.push(String(lat.releasedAt).slice(0, 10));
      if (sm.from) bits.push('源 ' + sm.from);
      if (bits.length) html += '<div class="up-meta">' + bits.join(' · ') + '</div>';
    }

    return html;
  }

  function renderAboutPage() {
    const html = pageHead('关于', '野人量化 v' + (YB.update ? YB.update.current().name : '—')) +
      card('这个工具做了什么', null, '' +
        '<div style="font-size:12.5px;line-height:1.8;color:var(--text-2)">' +
        '把《全能野人交易方法完整总结》里的规则量化为可计算指标：' +
        '情绪周期（7 项加权）、涨停池评分（6 维）、月线资金流、九类买点的可判定子集，' +
        '以及仓位与止损的硬约束。' +
        '<br><br>所有指标都是规则化归纳，不是原文照录。' +
        '</div>', { tight: true }) +
      card('数据来源', null, '' +
        menuRow({ label: '腾讯行情', desc: 'qt.gtimg.cn / proxy.finance.qq.com', value: '主源' }) +
        menuRow({ label: '东方财富', desc: 'push2ex / push2his', value: '涨停池' }) +
        menuRow({ label: '新浪财经', desc: 'hq.sinajs.cn', value: '备用' }), { tight: true }) +
      card('免责声明', null, '' +
        '<div class="notice" style="border-color:transparent;background:color-mix(in srgb,var(--warn) 9%,transparent)">' +
        '本工具不构成任何投资建议。超短不适合大多数人——这一点原作者本人反复强调。' +
        '<br><br>一年 250 个交易日，绝大多数是无效交易；能在 90% 的无效时间里不亏不赚，已经是高手。' +
        '<br><br>股市有风险，入市需谨慎。</div>', { tight: true });

    return html;
  }

  /* ---------------- Toast ---------------- */
  let toastTimer = null;
  function toast(msg) {
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.className = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
  }

  YB.ui = {
    ICON, card, toast, money, pageHead, menuRow,
    renderMarket, renderPicks, renderPortfolio, renderRisk, renderKline, klineInfo,
    renderSector,
    renderSettings, renderSettingsSub
  };
})(window.YB);
