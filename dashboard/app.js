// Field Ledger. Reads window.RADAR, written beside this page by main.ts. No network.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA || typeof document === 'undefined') return;
  var root = document.getElementById('ledger');
  if (!root) return;

  var FAMILY = {
    lend: 'Supply USDC, borrow about a quarter, and repay within a week so the wallet completes a credit cycle.',
    dex: 'Add liquidity, prefer a stable pool, and swap once through the same pool.',
    predict: 'Buy one bounded market, then a second smaller one, and do not leave a near-settled share.',
    perps: 'Post margin, cap notional at 2×, and flip the position once so there are two round trips.',
    options: 'Buy one short-dated option, then a second smaller ticket. The premium is the cost you can lose.',
    cdp: 'Mint against collateral at 30% LTV or less, repay, and mint once more.',
    rwa: 'Finish KYC before sending funds, hold the receipt, and redeem on the app’s own page.',
    curator: 'Read the vault’s cap and manager, deposit, and do not loop the shares.',
    allocator: 'Deposit into the named strategy, claim once, and do not restake the yield elsewhere.',
    yield: 'Deposit into the primary vault and harvest only when the reward clears the gas.',
    aggregator: 'Deposit into the autocompounder and do not stake the receipt in a second farm.',
    lev: 'Use 1.5× or less, write down the liquidation price, and unwind on a schedule.',
    basis: 'Deposit only when the posted funding rate is positive, and leave if it stays negative.',
    insurance: 'Buy 30 days of cover on a protocol you already use, and read the claim rules first.',
    pay: 'Send two payments, on different days, between two wallets you control.',
    stake: 'Stake and keep the receipt here. Do not restake it while the hold is open.',
    chain: 'Bridge in through the app’s own link, then use the funds on-chain on a second day.',
    stable: 'Mint, hold, and move a slice once. Redeem if the price breaks 0.99.',
    gov: 'Deposit if a lock is required, and vote on every live proposal during the hold.',
    otc: 'Rest a limit you would actually fill, and replace it if it sits for a day.',
    index: 'Buy the index only if the constituent list is visible, and sell if a name you would not hold appears.',
    btc: 'Lock BTC the app itself lists, and exit if the receipt drifts more than 1% from BTC.',
    cedefi: 'Finish the account link before the deposit, and reconcile the on-chain receipt weekly.',
    bridge: 'Bridge out, use the funds once on the other side, and bridge back on the same route.',
    generic: 'Deposit into the market the home screen offers, then use one other function a week later.'
  };

  function r4(n) { return Number((Math.round(n * 10000) / 10000).toFixed(4)); }

  // The board’s integer, rebuilt from the stored factors. Same multiply order as lib/model.ts.
  function recompute(row) {
    var f = row.factors;
    return Math.max(1, Math.round(row.tvl_usd * f.multiple * f.size * f.growth * f.age * f.chain * f.breadth * f.wrapper));
  }

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var sign = n < 0 ? '-' : '';
    var v = Math.abs(n);
    if (v >= 1e9) return sign + '$' + trimNum(v / 1e9) + 'B';
    if (v >= 1e6) return sign + '$' + trimNum(v / 1e6) + 'M';
    if (v >= 1e3) return sign + '$' + trimNum(v / 1e3) + 'K';
    return sign + '$' + Math.round(v);
  }
  function trimNum(n) {
    var s = n >= 100 ? n.toFixed(1) : n.toFixed(2);
    return s.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  }
  function fmtFull(n) {
    return (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var q = new URLSearchParams((location.hash || '').replace(/^#/, ''));
    var dir = q.get('dir') === 'asc' ? 1 : -1;
    return {
      q: q.get('q') || '',
      category: q.get('category') || 'all',
      chain: q.get('chain') || 'all',
      tvl: Number(q.get('tvl') || 0) || 0,
      watch: q.get('watch') === '1',
      sort: q.get('sort') || 'implied',
      dir: dir,
      tab: q.get('tab') === 'live' ? 'live' : 'pre',
      p: q.get('p') || ''
    };
  }
  var state = readHash();

  function writeHash() {
    var q = new URLSearchParams();
    if (state.q) q.set('q', state.q);
    if (state.category !== 'all') q.set('category', state.category);
    if (state.chain !== 'all') q.set('chain', state.chain);
    if (state.tvl) q.set('tvl', String(state.tvl));
    if (state.watch) q.set('watch', '1');
    if (state.sort !== 'implied') q.set('sort', state.sort);
    if (state.dir > 0) q.set('dir', 'asc');
    if (state.tab === 'live') q.set('tab', 'live');
    if (state.p) q.set('p', state.p);
    var next = q.toString();
    if (next) history.replaceState(null, '', '#' + next);
    else history.replaceState(null, '', location.pathname + location.search);
  }

  function rationale(row) {
    var f = row.factors;
    var cat = row.category || 'Uncategorized';
    var how;
    if (f.method === 'median') how = 'the median mcap/TVL of ' + f.n + ' traded ' + cat + ' protocols in this snapshot';
    else if (f.method === 'pair') how = 'the two traded ' + cat + ' comparables agree, so their median is used' + (f.multiple >= DATA.model.multiple_max ? ' and then capped at ' + DATA.model.multiple_max : '');
    else if (f.method === 'shrunk') how = 'the two traded ' + cat + ' comparables disagree, so the figure is halfway to the snapshot median of ' + DATA.global_multiple;
    else if (f.method === 'sibling') how = cat + ' has fewer than two clean comparables, so the multiple is borrowed from ' + f.basis + ' (' + f.sibling_n + ' traded protocols)';
    else how = 'there is no clean comparable, so this is the snapshot-wide median of ' + DATA.global_multiple;
    var age = row.age_days === null ? 'the listing date is unreported, so the age factor is 0.90' : 'it has been listed ' + row.age_days + ' days with no token on record';
    var g = row.change_7d === null ? '7-day TVL change is unreported and treated as flat' : '7-day TVL change is ' + fmtPct(row.change_7d) + ', clamped to ' + f.growth_pct + '%';
    var chain = (row.chains && row.chains[0]) || 'an unnamed chain';
    var chainHow = f.chain_method === 'median'
      ? chain + ' trades at ' + f.chain + '× the global median across ' + f.chain_n + ' protocols'
      : chain + ' has only ' + f.chain_n + ' traded comparables, so the chain factor stays at 1';
    var wrap = f.wrapper === 1 ? '' : ' The watchlist requires this row even though the category is a wrapper, so a 0.35 factor is applied.';
    return row.name + ' records no token. The multiple ' + f.multiple + ' is ' + how + '. Size ' + f.size + ' tapers TVL above and below $100M. Growth ' + f.growth + ' because ' + g + '. Age ' + f.age + ' because ' + age + '. Chain ' + f.chain + ' because ' + chainHow + '. Breadth ' + f.breadth + ' for ' + row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + '.' + wrap;
  }

  function splitStep(s) {
    var c = s.indexOf(' Cost: ');
    var t = s.indexOf(' Time: ');
    if (c < 0 || t < 0) return { action: s, cost: '', time: '' };
    return { action: s.slice(0, c), cost: s.slice(c + 7, t).replace(/\.$/, ''), time: s.slice(t + 7).replace(/\.$/, '') };
  }

  function mast() {
    return el('header', { class: 'mast' },
      el('div', null,
        el('div', { class: 'kicker', text: 'Token launch radar' }),
        el('h1', { text: 'Field Ledger' }),
        el('p', { class: 'deck', text: 'Protocols that record no token, ranked by what a launch would be worth if the market priced them the way it prices protocols that already trade. Wrapped, staked and bridged products are left out. The watchlist is covered in full.' })
      ),
      el('div', { class: 'mast-side' },
        el('div', { class: 'mast-date', text: DATA.as_of }),
        el('p', { text: DATA.counts.protocols + ' protocols in the snapshot' }),
        el('p', { text: 'Floor ' + fmtUsd(DATA.floor_usd) + ' · ' + DATA.model_version })
      )
    );
  }

  function stats() {
    var top = DATA.rows[0];
    return el('section', { class: 'stats' },
      el('div', { class: 'stat' }, el('b', { text: String(DATA.counts.ranked) }), el('span', { text: 'Ranked, no token on record' })),
      el('div', { class: 'stat' }, el('b', { text: DATA.counts.watchlist + ' / ' + DATA.counts.watchlist }), el('span', { text: 'Watchlist covered' })),
      el('div', { class: 'stat' }, el('b', { text: String(DATA.counts.early) }), el('span', { text: 'Early names below the floor' })),
      el('div', { class: 'stat' }, el('b', { text: fmtUsd(top.implied_value_usd) }), el('span', { text: 'Top implied value · ' + top.name }))
    );
  }

  function options(values, current, allLabel) {
    var nodes = [el('option', { value: 'all', text: allLabel, selected: current === 'all' ? 'selected' : null })];
    values.forEach(function (v) {
      nodes.push(el('option', { value: v.value, text: v.label, selected: current === v.value ? 'selected' : null }));
    });
    return nodes;
  }

  function controls() {
    var cats = {};
    var chains = {};
    DATA.rows.forEach(function (r) {
      var c = r.category || 'Uncategorized';
      cats[c] = (cats[c] || 0) + 1;
      (r.chains || []).forEach(function (ch) { chains[ch] = (chains[ch] || 0) + 1; });
    });
    var catList = Object.keys(cats).sort().map(function (c) { return { value: c, label: c + ' (' + cats[c] + ')' }; });
    var chainList = Object.keys(chains).sort(function (a, b) { return chains[b] - chains[a] || (a < b ? -1 : 1); })
      .map(function (c) { return { value: c, label: c + ' (' + chains[c] + ')' }; });
    var search = el('input', { id: 'q', type: 'search', value: state.q, placeholder: 'Name, slug, category, chain', 'aria-label': 'Search the ledger' });
    search.addEventListener('input', function () { state.q = search.value; state.p = ''; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Category' }, options(catList, state.category, 'All categories'));
    cat.addEventListener('change', function () { state.category = cat.value; state.p = ''; writeHash(); render(); });
    var chain = el('select', { id: 'chain', 'aria-label': 'Chain' }, options(chainList, state.chain, 'All chains'));
    chain.addEventListener('change', function () { state.chain = chain.value; state.p = ''; writeHash(); render(); });
    var floors = [0, 10000000, 50000000, 100000000, 250000000];
    var tvl = el('select', { id: 'tvl', 'aria-label': 'Minimum TVL' }, floors.map(function (n) {
      return el('option', { value: String(n), text: n === 0 ? 'Any TVL' : 'TVL ≥ ' + fmtUsd(n), selected: state.tvl === n ? 'selected' : null });
    }));
    tvl.addEventListener('change', function () { state.tvl = Number(tvl.value) || 0; state.p = ''; writeHash(); render(); });
    function tab(id, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === id ? 'true' : 'false', text: label, onclick: function () { state.tab = id; state.p = ''; writeHash(); render(); } });
    }
    var watch = el('button', { type: 'button', class: 'watch', 'aria-pressed': state.watch ? 'true' : 'false', text: state.watch ? 'Watchlist only' : 'Watchlist + early', onclick: function () { state.watch = !state.watch; state.p = ''; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chain),
      el('div', { class: 'field' }, el('label', { for: 'tvl', text: 'TVL' }), tvl),
      el('div', { class: 'field' }, el('span', { text: 'Book' }), el('div', { class: 'tabs' }, tab('pre', 'No token'), tab('live', 'Already trading'))),
      state.tab === 'pre' ? el('div', { class: 'field' }, el('span', { text: 'List' }), watch) : null
    );
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watch && !r.on_watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorized') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.tvl && r.tvl_usd < state.tvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function sorted(list) {
    var key = state.sort;
    var dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -1e18 : a.change_7d; bv = b.change_7d === null ? -1e18 : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? 1e18 : a.age_days; bv = b.age_days === null ? 1e18 : b.age_days; }
      else if (key === 'multiple') { av = a.factors.multiple; bv = b.factors.multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function sortTh(key, label) {
    var on = state.sort === key;
    return el('th', { scope: 'col' }, el('button', {
      type: 'button', 'data-on': on ? 'true' : 'false',
      text: label + (on ? (state.dir < 0 ? ' ↓' : ' ↑') : ''),
      onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
        writeHash(); render();
      }
    }));
  }

  function openRow(slug) {
    state.p = slug;
    writeHash();
    render();
    window.scrollTo(0, 0);
  }

  function boardTable(list) {
    if (!list.length) {
      return el('div', { class: 'panel empty' },
        el('h2', { text: 'Nothing matches' }),
        el('p', { text: 'Clear the search or widen the category, chain or TVL filter.' }),
        el('button', { class: 'linkish', type: 'button', text: 'Clear filters', onclick: function () {
          state.q = ''; state.category = 'all'; state.chain = 'all'; state.tvl = 0; state.watch = false; writeHash(); render();
        } })
      );
    }
    var max = list[0].implied_value_usd || 1;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var body = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down';
      var chains = (r.chains && r.chains.length) ? r.chains[0] + (r.chains.length > 1 ? ' +' + (r.chains.length - 1) : '') : '—';
      body.appendChild(el('tr', {
        tabindex: '0',
        onclick: function () { openRow(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRow(r.slug); } }
      },
        el('td', { class: 'num rank', text: String(r.rank) }),
        el('td', null, el('span', { class: 'name', text: r.name }), r.on_watchlist ? el('span', { class: 'pill', text: 'WL' }) : null, el('span', { class: 'sub', text: r.slug })),
        el('td', { text: r.category || 'Uncategorized' }),
        el('td', { text: chains }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: r.factors.multiple.toFixed(2) + '×' }),
        el('td', null, el('div', { class: 'bar' },
          el('span', { class: 'track', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(4, Math.round(r.implied_value_usd / max * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        ))
      ));
    });
    return el('div', { class: 'panel' }, el('table', null,
      el('thead', null, el('tr', null,
        el('th', { scope: 'col', text: 'Rank' }), sortTh('name', 'Protocol'), el('th', { scope: 'col', text: 'Category' }),
        el('th', { scope: 'col', text: 'Chain' }), sortTh('tvl', 'TVL'), sortTh('growth', '7d'),
        sortTh('age', 'Age'), sortTh('multiple', 'Multiple'), sortTh('implied', 'Implied')
      )),
      body
    ));
  }

  function liveTable() {
    var body = el('tbody');
    DATA.live.forEach(function (r) {
      body.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'name', text: r.name }), el('span', { class: 'sub', text: r.symbol || r.slug })),
        el('td', { text: r.category || 'Uncategorized' }),
        el('td', { text: (r.chains && r.chains[0]) || '—' }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { text: 'Token already trades' })
      ));
    });
    return el('div', { class: 'panel' }, el('table', null,
      el('thead', null, el('tr', null,
        el('th', { text: 'Protocol' }), el('th', { text: 'Category' }), el('th', { text: 'Chain' }),
        el('th', { text: 'TVL' }), el('th', { text: '7d' }), el('th', { text: 'Market cap' }), el('th', { text: 'Status' })
      )),
      body
    ));
  }

  function modelNote() {
    var m = DATA.model;
    return el('details', null,
      el('summary', { text: 'How the implied value is computed' }),
      el('p', { class: 'model-copy', text: 'Implied value = round(TVL × category multiple × size × growth × age × chain × breadth × wrapper). The category multiple is the median market-cap-to-TVL ratio of protocols in that category that already trade, after dropping ratios outside ' + m.ratio_min + ' to ' + m.ratio_max + ', versioned pools and exchanges. Two agreeing comparables are enough; a lone comparable is not. A thin category borrows a sibling category (curators borrow allocators, prediction markets borrow dexes, chains borrow canonical bridges). Size is (TVL / $100M) to the power ' + m.size_power + ', clamped. Growth applies ' + m.growth_weight + ' of the 7-day TVL change after clamping it to ' + m.growth_floor + '% … ' + m.growth_cap + '%. Age is 0.72 under 45 days, 0.86 under 120, 1.00 under 240, 1.14 under 730, 1.02 under 1460, 0.84 after that, and 0.90 if the listing date is missing. Chain moves the figure only when at least ' + m.chain_min_n + ' traded protocols list that chain first. Breadth adds 2% per extra chain, up to five. A watchlist wrapper is kept and multiplied by ' + m.wrapper_factor + '. No protocol name is special-cased. ' + DATA.comparable_n + ' traded protocols set the multiples; the snapshot median is ' + DATA.global_multiple + '.' })
    );
  }

  function banner(list) {
    var bits = [];
    if (state.q) bits.push('search “' + state.q.trim() + '”');
    if (state.category !== 'all') bits.push(state.category);
    if (state.chain !== 'all') bits.push(state.chain);
    if (state.tvl) bits.push('TVL ≥ ' + fmtUsd(state.tvl));
    if (state.watch) bits.push('watchlist only');
    var label = bits.length ? ('Showing ' + bits.join(' · ') + ' · ' + list.length + ' of ' + DATA.rows.length) : ('Showing all ' + list.length + ' ranked protocols');
    return el('div', { class: 'banner' },
      el('span', { text: label }),
      bits.length ? el('button', { type: 'button', text: 'Clear filters', onclick: function () {
        state.q = ''; state.category = 'all'; state.chain = 'all'; state.tvl = 0; state.watch = false; writeHash(); render();
      } }) : null
    );
  }

  function detail(row) {
    var again = recompute(row);
    var ok = again === row.implied_value_usd;
    var f = row.factors;
    var steps = row.farm_steps.map(splitStep);
    var chain = (row.chains && row.chains.length) ? row.chains.join(', ') : 'an unnamed chain';
    return el('article', null,
      el('button', { class: 'back', type: 'button', text: '← Back to the board', onclick: function () { state.p = ''; writeHash(); render(); } }),
      el('div', { class: 'detail-grid' },
        el('div', null,
          el('div', { class: 'eyebrow', text: 'Rank ' + row.rank + ' of ' + DATA.counts.ranked + (row.on_watchlist ? ' · watchlist' : ' · below the floor') }),
          el('h2', { text: row.name }),
          el('p', { class: 'sub', text: (row.category || 'Uncategorized') + ' · ' + chain + ' · listed ' + (row.listed_at || 'date unreported') }),
          el('div', { class: 'value', text: fmtFull(row.implied_value_usd) }),
          el('p', { class: 'eyebrow', text: 'Implied launch value, not a price' }),
          el('p', { class: 'rationale', text: rationale(row) }),
          el('p', { class: ok ? 'check' : 'check warn', text: ok ? ('Recomputed on this page as ' + fmtFull(again) + ', the same integer the board carries.') : ('Recomputed ' + fmtFull(again) + ', which differs from the board.') }),
          el('div', { class: 'factors' },
            factor('TVL', fmtFull(row.tvl_usd), 'deposits on record'),
            factor('Multiple', f.multiple.toFixed(4), f.method + ' · ' + f.basis),
            factor('Size', f.size.toFixed(4), 'taper around $100M TVL'),
            factor('Growth', f.growth.toFixed(4), row.change_7d === null ? '7d unreported' : fmtPct(row.change_7d) + ' clamped'),
            factor('Age', f.age.toFixed(4), row.age_days === null ? 'listing date missing' : row.age_days + ' days listed'),
            factor('Chain', f.chain.toFixed(4), f.chain_method === 'median' ? f.chain_n + ' comps' : 'too few comps'),
            factor('Breadth', f.breadth.toFixed(4), row.chains.length + ' chains'),
            factor('Wrapper', f.wrapper.toFixed(2), f.wrapper === 1 ? 'not a wrapper' : 'watchlist wrapper')
          ),
          el('p', { class: 'math', text: fmtFull(row.tvl_usd) + ' × ' + f.multiple + ' × ' + f.size + ' × ' + f.growth + ' × ' + f.age + ' × ' + f.chain + ' × ' + f.breadth + ' × ' + f.wrapper + ' = ' + fmtFull(row.implied_value_usd) })
        ),
        el('div', null,
          el('h3', { text: 'How to farm it' }),
          el('p', { class: 'blurb', text: FAMILY[row.family] || FAMILY.generic }),
          el('ol', { style: 'list-style:none;margin:0;padding:0' }, steps.map(function (s, i) {
            return el('li', { class: 'step' },
              el('div', { class: 'n', text: String(i + 1) }),
              el('div', null, el('div', { text: s.action }), el('span', { class: 'meta', text: 'Cost ' + s.cost + ' · Time ' + s.time }))
            );
          }))
        )
      )
    );
  }

  function factor(k, v, note) {
    return el('div', { class: 'factor' }, el('span', { text: k }), el('b', { text: v }), el('span', { text: note }));
  }

  function render() {
    root.textContent = '';
    var wrap = el('div', { class: 'wrap' });
    wrap.appendChild(mast());
    if (state.p && state.tab !== 'live') {
      var row = null;
      for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === state.p) row = DATA.rows[i];
      if (row) wrap.appendChild(detail(row));
      else {
        wrap.appendChild(el('p', { text: 'That protocol is not on this board.' }));
        wrap.appendChild(el('button', { class: 'back', type: 'button', text: '← Back to the board', onclick: function () { state.p = ''; writeHash(); render(); } }));
      }
    } else {
      wrap.appendChild(stats());
      wrap.appendChild(controls());
      if (state.tab === 'live') {
        wrap.appendChild(el('div', { class: 'banner' }, el('span', { text: DATA.live.length + ' protocols that already trade, one row per symbol, set aside from the ranking. ' + DATA.counts.tokened + ' snapshot rows record a token; ' + DATA.counts.derivative + ' pre-token rows were dropped as wrappers, stakes, bridges or exchanges.' })));
        wrap.appendChild(liveTable());
      } else {
        var list = sorted(filtered());
        wrap.appendChild(banner(list));
        wrap.appendChild(boardTable(list));
        wrap.appendChild(el('p', { class: 'formula-line', text: 'implied = round( TVL × multiple × size × growth × age × chain × breadth × wrapper )' }));
        wrap.appendChild(el('p', { class: 'foot', text: DATA.counts.tokened + ' protocols already record a token and are not ranked. ' + DATA.counts.derivative + ' others record no token but are a wrapped, staked, bridged, versioned or exchange product, so they are left out unless the watchlist names them. Figures are from the ' + DATA.as_of + ' snapshot. An implied value is this model’s estimate, not a market price and not a date a token will exist.' }));
        wrap.appendChild(modelNote());
      }
    }
    root.appendChild(wrap);
  }

  render();
  window.addEventListener('hashchange', function () { state = readHash(); render(); });
})();
