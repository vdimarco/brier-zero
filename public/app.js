/* Brier Zero frontend: polls /api/state and renders leaderboard + matches.
   Poll cadence tightens to 12s while a match is live. */

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

let timer = null;
let collecting = false;
let lastState = null;
// Cards the user expanded stay expanded across the polling re-renders.
const expandedMatches = new Set();
let showAllFinished = false;
const FINISHED_PREVIEW = 8;

const fmtKickoff = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});

// Closing a detail panel clears the #m/... or #p/... hash. Setting
// location.hash = '' leaves an empty fragment, and browsers treat "no
// fragment" as "scroll to top of document" - so every close snapped the
// page back to the header. replaceState drops the hash without touching
// scroll position; it does not fire hashchange, so the re-render is
// triggered by hand.
function closeDetail() {
  history.replaceState(null, '', location.pathname + location.search);
  if (lastState) renderDetail(lastState);
}

function pct(p) {
  return Math.round(p * 100);
}

function countdown(iso) {
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return 'kicking off';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 48) return `in ${Math.floor(h / 24)} days`;
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}

function seg(kind, p, label) {
  const w = pct(p);
  const text = w >= 12 ? `<span>${w}</span>` : '';
  return `<div class="seg seg-${kind}" style="flex:${Math.max(w, 0.5)}" title="${esc(label)}: ${w}%">${text}</div>`;
}

/* Markets: group-stage matches price the 90-minute result (home/draw/away);
   knockout matches price who advances (home/away, no draw). Forecasts are
   stamped with the market they priced, so a legacy 90-minute forecast on a
   knockout match keeps rendering (and scoring) as a three-way bar. */
const MARKET_OUTCOMES = { regulation: ['home', 'draw', 'away'], advance: ['home', 'away'] };
// Per-model snapshot entries carry no market stamp; a prob set without a
// draw key can only be the two-way advancement market.
const predMarket = (p) =>
  p?.market === 'advance' || (p?.market == null && p?.probs && p.probs.draw == null)
    ? 'advance'
    : 'regulation';
const matchMarket = (m) => (m?.market === 'advance' ? 'advance' : 'regulation');
const outcomeLabel = (match, o, market) =>
  o === 'draw' ? 'Draw' : market === 'advance' ? `${match[o].name} advances` : `${match[o].name} win`;

// The market a match's consensus is shown in: the match's own market when
// any stored forecast priced it, otherwise whatever the forecasts priced
// (knockout matches forecast before the market switch).
function displayMarketOf(modelsMap, match) {
  const want = matchMarket(match);
  const list = Object.values(modelsMap ?? {}).filter((p) => p.probs);
  if (!list.length || list.some((p) => predMarket(p) === want)) return want;
  return predMarket(list[0]);
}

function consensusOf(modelsMap, market = 'regulation') {
  const outs = MARKET_OUTCOMES[market];
  const list = Object.values(modelsMap ?? {}).filter((p) => p.probs && predMarket(p) === market);
  if (!list.length) return null;
  const c = {};
  for (const o of outs) c[o] = 0;
  for (const p of list) for (const o of outs) c[o] += p.probs[o] / list.length;
  return c;
}

function forecastRow(model, pred, match, bestBrier) {
  const name = esc(model.label);
  const crest = model.icon
    ? `<img class="crest" src="${esc(model.icon)}" alt="" onerror="this.style.visibility='hidden'">`
    : '';
  if (!pred || (!pred.probs && !pred.error)) {
    return `<div class="frow"><div class="fmodel">${crest}${name}</div><div class="fnote">no forecast yet</div><div></div></div>`;
  }
  if (!pred.probs) {
    return `<div class="frow"><div class="fmodel">${crest}${name}</div><div class="ferr" title="${esc(pred.error)}">failed: ${esc(pred.error.slice(0, 60))}</div></div>`;
  }
  const market = predMarket(pred);
  const outs = MARKET_OUTCOMES[market];
  const tip = `${esc(pred.rationale || '')}${pred.demo ? ' [demo forecast]' : ''}`;
  let brierCell = '<div></div>';
  let best = '';
  if (pred.brier != null) {
    best = pred.brier === bestBrier ? ' best' : '';
    brierCell = `<div class="fbrier">${pred.brier.toFixed(3)}</div>`;
  } else if (!pred.eligible && match.status.state !== 'pre') {
    brierCell = '<div class="fbrier" title="Collected after kickoff, excluded from scoring">late</div>';
  }
  const aria = outs.map((o) => `${outcomeLabel(match, o, market)} ${pct(pred.probs[o])}%`).join(', ');
  return `<div class="frow${best}" title="${tip}">
    <div class="fmodel">${crest}${name}${pred.retro ? '*' : ''}${pred.demo ? ' (demo)' : ''}</div>
    <div class="bar" role="img" aria-label="${name}: ${esc(aria)}">
      ${outs.map((o) => seg(o, pred.probs[o], outcomeLabel(match, o, market))).join('')}
    </div>
    ${brierCell}
  </div>`;
}

function matchCard(match, state) {
  const { home, away } = match;
  const isLive = match.status.state === 'in';
  const isDone = match.status.state === 'post';

  let center;
  let meta;
  if (match.status.state === 'pre') {
    center = '<span class="vs">vs</span>';
    meta = `${esc(fmtKickoff.format(new Date(match.kickoff)))}<br>${countdown(match.kickoff)}`;
  } else {
    center = `<span class="scoreline">${home.score ?? 0} : ${away.score ?? 0}</span>`;
    const cls = isLive ? 'status-live' : 'status-ft';
    meta = `<span class="${cls}">${esc(match.status.detail)}</span><br>${esc(match.stage)}`;
  }

  // Attach Brier scores for finished matches so rows can rank themselves.
  // Each forecast settles under the market it priced: a legacy 90-minute
  // forecast on a knockout match scores against the regulation outcome.
  const preds = {};
  let bestBrier = null;
  for (const m of state.models) {
    const p = match.predictions[m.id];
    if (!p) continue;
    const copy = { ...p };
    const sameFixture = !p.fixture || p.fixture === `${match.home.name} vs ${match.away.name}`;
    const market = predMarket(p);
    const outcome = match.outcomes ? match.outcomes[market] : match.outcome;
    if (outcome && p.probs && p.eligible && sameFixture) {
      copy.brier = MARKET_OUTCOMES[market].reduce(
        (sum, o) => sum + (p.probs[o] - (outcome === o ? 1 : 0)) ** 2, 0
      );
      bestBrier = bestBrier == null ? copy.brier : Math.min(bestBrier, copy.brier);
    }
    preds[m.id] = copy;
  }

  const hasAny = Object.keys(preds).length > 0;
  const isRetro = Object.values(preds).some((p) => p.retro);
  let body;
  if (hasAny) {
    const withProbs = Object.values(preds).filter((p) => p.probs);
    const isOpen = expandedMatches.has(match.id);
    let outcomeHead = '';
    let collapsed = '';
    if (withProbs.length) {
      // Consensus: the mean of every stored forecast priced in the market
      // this match is displayed in (knockout: who advances).
      const market = displayMarketOf(preds, match);
      const outs = MARKET_OUTCOMES[market];
      const consensus = consensusOf(preds, market);
      const inMarket = withProbs.filter((p) => predMarket(p) === market).length;
      const advTag = market === 'advance' ? ' to advance' : '';
      outcomeHead = `<div class="outcome-head" title="Consensus of ${inMarket} model forecasts">
        ${outs.map((o) => `<span class="ol"><i class="swatch swatch-${o}"></i>${
          o === 'draw' ? 'Draw' : `${esc(match[o].name)}${advTag}`
        } <b>${pct(consensus[o])}%</b></span>`).join('\n        ')}
      </div>`;
      const consensusPred = {
        probs: consensus,
        market,
        rationale: `Average of ${inMarket} model forecasts`,
        eligible: true,
      };
      const outcome = match.outcomes ? match.outcomes[market] : match.outcome;
      if (outcome) {
        consensusPred.brier = outs.reduce(
          (sum, o) => sum + (consensus[o] - (outcome === o ? 1 : 0)) ** 2, 0
        );
      }
      collapsed = forecastRow({ label: `Consensus${isRetro ? '*' : ''}` }, consensusPred, match, null);
    } else {
      collapsed = `<div class="fnote">All model calls failed for this match.</div>`;
    }
    body = `<div class="forecasts">
      ${outcomeHead}
      ${isOpen
        ? state.models.map((m) => forecastRow(m, preds[m.id], match, bestBrier)).join('')
        : collapsed}
      <button class="toggle-models" data-toggle="${esc(match.id)}" aria-expanded="${isOpen}">
        ${isOpen ? 'Hide models' : `Compare ${Object.keys(preds).length} models`}
      </button>
    </div>`;
  } else if (match.status.state === 'pre' && match.teamsTbd) {
    body = `<div class="forecasts"><div class="fnote">Forecasts open once both teams are decided.</div></div>`;
  } else if (match.status.state === 'pre' && state.hosted && !state.predictorReady) {
    body = `<div class="forecasts"><div class="fnote">Forecasts are collected automatically before kickoff.</div></div>`;
  } else if (match.status.state === 'pre') {
    const disabled = !state.predictorReady || collecting;
    const hint = state.predictorReady
      ? 'Ask all seven models for their probabilities now.'
      : 'Set OPENROUTER_API_KEY on the server to enable forecasting.';
    body = `<div class="forecasts"><div class="fnote">No forecasts collected yet.</div>
      <button class="collect" data-match="${esc(match.id)}" ${disabled ? 'disabled' : ''} title="${esc(hint)}">
        ${collecting ? 'Collecting forecasts' : 'Collect forecasts'}
      </button></div>`;
  } else {
    body = `<div class="forecasts"><div class="fnote">No forecasts were collected before this match.</div></div>`;
  }

  return `<article class="match${isLive ? ' live' : ''}">
    <div class="match-head" data-detail="${esc(match.id)}" role="button" tabindex="0"
         title="Open match detail: forecasts over time" aria-label="Open detail for ${esc(home.name)} vs ${esc(away.name)}">
      <div class="fixture">
        <img class="flag" src="${esc(home.logo)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <span class="team team-h">${esc(home.name)}</span>
        ${center}
        <span class="team team-a">${esc(away.name)}</span>
        <img class="flag" src="${esc(away.logo)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      </div>
      <div class="match-meta">${meta}</div>
    </div>
    ${isDone && match.outcome ? `<div class="fnote" style="margin-top:6px">${
      matchMarket(match) === 'advance'
        ? `Advanced: ${esc(match[match.outcome].name)}${
            home.shootoutScore != null || away.shootoutScore != null
              ? ' (on penalties)'
              : match.outcomes?.regulation === 'draw' ? ' (in extra time)' : ''
          }`
        : `90-minute result: ${match.outcome === 'draw' ? 'draw' : esc(match[match.outcome].name) + ' win'}${
            match.outcome === 'draw' && (home.shootoutScore != null || match.status.name !== 'STATUS_FULL_TIME') ? ' (decided after regulation)' : ''
          }`
    }</div>` : ''}
    ${body}
  </article>`;
}

/* Leaderboard trend: has the model's second half of matches scored
   better or worse than its first half? Needs a few matches either side
   to say anything meaningful. */
function trendOf(perMatch) {
  if (!perMatch || perMatch.length < 6) return null;
  const mid = Math.ceil(perMatch.length / 2);
  const avg = (list) => list.reduce((a, p) => a + p.brier, 0) / list.length;
  const diff = avg(perMatch.slice(0, mid)) - avg(perMatch.slice(mid));
  if (Math.abs(diff) < 0.01) return 'flat';
  return diff > 0 ? 'up' : 'down';
}

/* Small inline chart of the running-average Brier score, match by match,
   so the leaderboard shows how each model has tracked over time without
   opening its detail page. Auto-scaled to the model's own range since it
   is read for shape, not absolute value. */
function sparkline(perMatch) {
  if (!perMatch || perMatch.length < 2) return '';
  const n = perMatch.length;
  let cum = 0;
  const cums = perMatch.map((p, i) => { cum += p.brier; return cum / (i + 1); });
  const W = 108, H = 28, pad = 3;
  const yMin = Math.min(...cums), yMax = Math.max(...cums);
  const span = Math.max(yMax - yMin, 0.015);
  const x = (i) => pad + (i * (W - 2 * pad)) / (n - 1);
  const y = (v) => pad + (1 - (v - yMin) / span) * (H - 2 * pad);
  const path = cums.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return `<svg class="spark-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Running average Brier score over ${n} matches, from ${cums[0].toFixed(3)} to ${cums[n - 1].toFixed(3)}">
    <path d="${path}" fill="none" stroke="var(--pitch)" stroke-width="1.6" stroke-linejoin="round"/>
    <circle cx="${x(n - 1).toFixed(1)}" cy="${y(cums[n - 1]).toFixed(1)}" r="2.2" fill="var(--pitch)"/>
  </svg>`;
}

function renderLeaderboard(state) {
  const el = $('#leaderboard');
  const scored = state.leaderboard.filter((r) => r.scored > 0);
  if (!scored.length) {
    el.classList.remove('skeleton-block');
    el.innerHTML = `<div class="empty">No scored matches yet. The table fills in as soon as a match with locked forecasts finishes.</div>`;
    return;
  }
  el.classList.remove('skeleton-block');
  el.innerHTML = `<div class="lb-wrap">${state.leaderboard
    .map((r, i) => {
      const trend = trendOf(r.perMatch);
      const trendBadge = trend === 'up'
        ? '<span class="lb-trend lb-trend-up" title="Scored better in its second half of matches than its first">▲ improving</span>'
        : trend === 'down'
        ? '<span class="lb-trend lb-trend-down" title="Scored worse in its second half of matches than its first">▼ cooling</span>'
        : '';
      return `<div class="lb-row${i === 0 && r.avgBrier != null ? ' leader' : ''}" data-model="${esc(r.model)}" role="button" tabindex="0" title="Open ${esc(r.label)}: performance over time" aria-label="Open performance detail for ${esc(r.label)}">
        <div class="lb-rank">${r.avgBrier == null ? '-' : i + 1}</div>
        <div class="lb-id">${
          (state.models.find((m) => m.id === r.model)?.icon)
            ? `<img class="crest crest-lg" src="${esc(state.models.find((m) => m.id === r.model).icon)}" alt="" onerror="this.style.visibility='hidden'">`
            : ''
        }<div><span class="lb-name">${esc(r.label)}</span><span class="lb-slug">${esc(r.model)}</span>${
          sparkline(r.perMatch) ? `<div class="lb-spark">${sparkline(r.perMatch)}${trendBadge}</div>` : ''
        }</div></div>
        <div class="lb-score">
          <div class="lb-brier">${r.avgBrier == null ? '-' : r.avgBrier.toFixed(3)}</div>
          <div class="lb-meta">${r.scored} scored / ${r.predicted} forecast${r.predicted === 1 ? '' : 's'}</div>
        </div>
      </div>`;
    })
    .join('')}</div>${
    state.leaderboard.some((r) => r.retroScored)
      ? `<p class="footnote">Includes backfilled matches: forecast after the fact with the same prompt. Every model's training data predates this tournament, so the results were unknowable to them, but these forecasts lack the pre-kickoff lock.</p>`
      : ''
  }`;
  for (const row of el.querySelectorAll('[data-model]')) {
    const open = () => { location.hash = `p/${encodeURIComponent(row.dataset.model)}`; };
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  }
}

function renderMatches(state) {
  const el = $('#matches');
  el.classList.remove('skeleton-block');
  const live = state.matches.filter((m) => m.status.state === 'in');
  const pre = state.matches.filter((m) => m.status.state === 'pre');
  const done = state.matches.filter((m) => m.status.state === 'post').reverse();

  const group = (title, list, liveDot = false) =>
    list.length
      ? `<div class="group-title">${liveDot ? '<span class="live-dot" aria-hidden="true"></span>' : ''}${title}</div>
         <div class="match-grid">${list.map((m) => matchCard(m, state)).join('')}</div>`
      : '';

  const doneShown = showAllFinished ? done : done.slice(0, FINISHED_PREVIEW);
  const moreBtn =
    done.length > FINISHED_PREVIEW
      ? `<button class="toggle-models show-finished" id="toggle-finished">${
          showAllFinished ? 'Show fewer' : `Show all ${done.length} finished matches`
        }</button>`
      : '';

  el.innerHTML =
    group('LIVE NOW', live, true) +
    group('UPCOMING', pre) +
    group('FINISHED', doneShown) + moreBtn ||
    '<div class="empty">No matches in the current window.</div>';

  const fbtn = el.querySelector('#toggle-finished');
  if (fbtn) fbtn.addEventListener('click', () => {
    showAllFinished = !showAllFinished;
    renderMatches(lastState ?? state);
  });

  for (const btn of el.querySelectorAll('.collect')) {
    btn.addEventListener('click', () => collect(btn.dataset.match));
  }
  for (const btn of el.querySelectorAll('.toggle-models')) {
    btn.addEventListener('click', () => {
      const id = btn.dataset.toggle;
      if (expandedMatches.has(id)) expandedMatches.delete(id);
      else expandedMatches.add(id);
      if (lastState) renderMatches(lastState);
    });
  }
  for (const head of el.querySelectorAll('[data-detail]')) {
    const open = () => { location.hash = `m/${head.dataset.detail}`; };
    head.addEventListener('click', open);
    head.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  }
}

/* Match detail: forecasts over time. Points are the locked pre-kickoff
   consensus, each in-play snapshot, and (when finished) the actual result.
   Everything is shown in one market, so mixed-market history (a knockout
   match forecast before the market switch) filters to the display market. */
function detailPoints(match, market) {
  const points = [];
  const locked = consensusOf(match.predictions, market);
  if (locked) points.push({ label: 'Locked', probs: locked });
  for (const snap of match.snapshots ?? []) {
    if ((snap.market === 'advance' ? 'advance' : 'regulation') !== market) continue;
    const c = consensusOf(snap.models, market);
    if (c) points.push({ label: snap.detail, sub: `${snap.score[0]}:${snap.score[1]}`, probs: c, snap });
  }
  const outcome = match.outcomes ? match.outcomes[market] : match.outcome;
  if (outcome) {
    const probs = {};
    for (const o of MARKET_OUTCOMES[market]) probs[o] = o === outcome ? 1 : 0;
    points.push({
      label: market === 'advance' ? 'Result' : 'FT',
      sub: `${match.home.score}:${match.away.score}`,
      probs,
      final: true,
    });
  }
  return points;
}

/* The timeline is rendered as one bar row per moment, in the same visual
   language as the forecast rows: locked consensus, then each in-play
   consensus, then the result as a one-hot bar. */
function timelineRows(match, points, market) {
  const outs = MARKET_OUTCOMES[market];
  return `<div class="forecasts">${points.map((p) => `
    <div class="frow trow${p.final ? ' trow-final' : ''}">
      <div class="fmodel twhen">${esc(p.label)}${p.sub ? `<span class="tsub">${esc(p.sub)}</span>` : ''}</div>
      <div class="bar" role="img" aria-label="${esc(p.label)}: ${outs.map((o) => `${outcomeLabel(match, o, market)} ${pct(p.probs[o] ?? 0)}%`).join(', ')}">
        ${outs.map((o) => seg(o, p.probs[o] ?? 0, outcomeLabel(match, o, market))).join('')}
      </div>
      <div></div>
    </div>`).join('')}
  </div>`;
}

/* Model detail: performance over time. Running-average Brier vs the
   field, per-match dots, the coin-flip baseline, and a form strip. */
function modelChart(points, fieldPoints) {
  const W = 660, H = 240, padL = 40, padR = 20, padT = 12, padB = 26;
  const n = points.length;
  const yMax = Math.max(1, Math.ceil(Math.max(...points.map((p) => p.brier), 0.7) * 4) / 4);
  const x = (i) => (n === 1 ? W / 2 : padL + (i * (W - padL - padR)) / (n - 1));
  const y = (v) => padT + (1 - Math.min(v, yMax) / yMax) * (H - padT - padB);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Running average Brier score over the tournament">`;
  for (const g of [0, 0.5, 1].filter((v) => v <= yMax)) {
    svg += `<line x1="${padL}" y1="${y(g)}" x2="${W - padR}" y2="${y(g)}" stroke="var(--hairline)" stroke-width="1"/>`;
    svg += `<text x="${padL - 6}" y="${y(g) + 4}" text-anchor="end" font-size="10" fill="var(--ink-3)">${g}</text>`;
  }
  svg += `<line x1="${padL}" y1="${y(2 / 3)}" x2="${W - padR}" y2="${y(2 / 3)}" stroke="var(--ink-3)" stroke-width="1" stroke-dasharray="4 4"/>`;
  svg += `<text x="${W - padR}" y="${y(2 / 3) - 5}" text-anchor="end" font-size="10" fill="var(--ink-3)">coin flip 0.667</text>`;
  if (n > 1 && fieldPoints) {
    const fpath = fieldPoints.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    svg += `<path d="${fpath}" fill="none" stroke="var(--draw)" stroke-width="2"/>`;
    svg += `<text x="${x(n - 1) - 8}" y="${y(fieldPoints[n - 1]) - 7}" text-anchor="end" font-size="10.5" font-weight="650" fill="var(--ink-3)">field</text>`;
  }
  points.forEach((p, i) => {
    svg += `<circle cx="${x(i).toFixed(1)}" cy="${y(p.brier).toFixed(1)}" r="3" fill="var(--hairline)">` +
      `<title>${esc(p.shortName)}: ${p.brier.toFixed(3)}</title></circle>`;
  });
  if (n > 1) {
    const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.cum).toFixed(1)}`).join('');
    svg += `<path d="${path}" fill="none" stroke="var(--pitch)" stroke-width="2.5" stroke-linejoin="round"/>`;
  }
  points.forEach((p, i) => {
    svg += `<circle cx="${x(i).toFixed(1)}" cy="${y(p.cum).toFixed(1)}" r="3.5" fill="var(--pitch)">` +
      `<title>After ${esc(p.shortName)}: average ${p.cum.toFixed(3)}</title></circle>`;
  });
  svg += `<text x="${x(n - 1) - 8}" y="${y(points[n - 1].cum) + 16}" text-anchor="end" font-size="10.5" font-weight="700" fill="var(--pitch)">running avg</text>`;
  svg += `<text x="${padL}" y="${H - 6}" font-size="10" fill="var(--ink-3)">matches in kickoff order, dots are single-match scores</text>`;
  svg += '</svg>';
  return svg;
}

function renderModelDetail(state, modelId) {
  const el = $('#detail');
  const row = state.leaderboard.find((r) => r.model === modelId);
  const meta = state.models.find((m) => m.id === modelId);
  if (!row || !meta) { el.innerHTML = ''; return; }
  const rank = state.leaderboard.filter((r) => r.avgBrier != null).findIndex((r) => r.model === modelId) + 1;

  let cum = 0;
  const points = row.perMatch.map((p, i) => {
    cum += p.brier;
    return { ...p, cum: cum / (i + 1) };
  });
  // Field: mean per-match Brier across all models, accumulated in the
  // same match order this model was scored in.
  const fieldByMatch = {};
  for (const r of state.leaderboard)
    for (const p of r.perMatch) (fieldByMatch[p.matchId] ??= []).push(p.brier);
  let fcum = 0;
  const fieldPoints = points.map((p, i) => {
    const list = fieldByMatch[p.matchId] ?? [p.brier];
    fcum += list.reduce((a, b) => a + b, 0) / list.length;
    return fcum / (i + 1);
  });

  const best = points.length ? points.reduce((a, b) => (b.brier < a.brier ? b : a)) : null;
  const worst = points.length ? points.reduce((a, b) => (b.brier > a.brier ? b : a)) : null;
  const beats = (p) => p.brier < (p.baseline ?? 2 / 3);
  const form = points.slice(-10).map((p) =>
    `<span class="form-chip ${beats(p) ? 'form-good' : 'form-poor'}" title="${esc(p.shortName)}: ${p.brier.toFixed(3)}">${beats(p) ? 'W' : 'L'}</span>`
  ).join('');

  el.innerHTML = `<div class="detail-scrim" data-close></div>
  <section class="detail-panel" role="dialog" aria-modal="true" aria-label="Model performance">
    <div class="detail-head">
      <div class="lb-id">
        ${meta.icon ? `<img class="crest crest-lg" src="${esc(meta.icon)}" alt="">` : ''}
        <div>
          <div class="detail-title">${esc(row.label)}</div>
          <div class="fnote">${esc(row.model)}${rank ? ` · rank ${rank} of ${state.leaderboard.length}` : ''}</div>
        </div>
      </div>
      <button class="detail-close" data-close aria-label="Close">✕</button>
    </div>
    <div class="stat-row">
      <div class="stat"><div class="stat-v">${row.avgBrier == null ? '-' : row.avgBrier.toFixed(3)}</div><div class="stat-l">avg Brier</div></div>
      <div class="stat"><div class="stat-v">${row.scored}</div><div class="stat-l">scored</div></div>
      <div class="stat"><div class="stat-v">${points.filter(beats).length}</div><div class="stat-l">beat the coin flip</div></div>
    </div>
    ${points.length ? `
    <h3>Average over the tournament</h3>
    <div class="chart">${modelChart(points, fieldPoints)}</div>
    <h3>Form, last ${Math.min(10, points.length)}</h3>
    <div class="form-strip">${form}</div>
    <p class="fnote">W beats the know-nothing baseline for its market (0.667 three-way group match, 0.5 two-way knockout), L does not.</p>
    ${best ? `<p class="fnote">Best call: ${esc(best.shortName)} at ${best.brier.toFixed(3)}. Roughest: ${esc(worst.shortName)} at ${worst.brier.toFixed(3)}.</p>` : ''}
    ` : '<p class="fnote">No scored forecasts yet.</p>'}
  </section>`;
  document.body.style.overflow = 'hidden';
  for (const c of el.querySelectorAll('[data-close]')) {
    c.addEventListener('click', closeDetail);
  }
}

function renderDetail(state) {
  const el = $('#detail');
  const pm = location.hash.match(/^#p\/(.+)/);
  if (pm) { renderModelDetail(state, decodeURIComponent(pm[1])); return; }
  const m = location.hash.match(/^#m\/(\d+)/);
  if (!m) { el.innerHTML = ''; document.body.style.overflow = ''; return; }
  const match = state.matches.find((x) => x.id === m[1]);
  if (!match) { el.innerHTML = ''; return; }
  const market = displayMarketOf(match.predictions, match);
  const points = detailPoints(match, market);
  const isLive = match.status.state === 'in';

  const lockedRows = Object.keys(match.predictions).length
    ? state.models.map((mod) => forecastRow(mod, match.predictions[mod.id], match, null)).join('')
    : '<div class="fnote">No locked forecasts for this match.</div>';

  el.innerHTML = `<div class="detail-scrim" data-close></div>
  <section class="detail-panel" role="dialog" aria-modal="true" aria-label="Match detail">
    <div class="detail-head">
      <div>
        <div class="detail-title">${esc(match.home.name)} <span class="scoreline${isLive ? '' : ''}">${
          match.status.state === 'pre' ? 'vs' : `${match.home.score ?? 0} : ${match.away.score ?? 0}`
        }</span> ${esc(match.away.name)}</div>
        <div class="fnote">${esc(match.status.state === 'pre' ? fmtKickoff.format(new Date(match.kickoff)) : match.status.detail)} · ${esc(match.stage)}${isLive ? ' · live' : ''}</div>
      </div>
      <button class="detail-close" data-close aria-label="Close">✕</button>
    </div>
    ${points.length > 1 ? `<h3>How the forecast moved</h3>
    ${timelineRows(match, points, market)}
    <p class="fnote">${market === 'advance' ? 'Knockout market: probability of advancing, extra time and penalties included. ' : ''}Consensus at each moment: the locked pre-kickoff forecast is the only one that scores; in-play rows are fresh forecasts after every goal, card, and period change; the last row is the actual result.</p>` :
    (isLive ? '<p class="fnote">In-play updates land here after every goal, red card, and period change, plus every ~10 quiet minutes.</p>' : '')}
    <h3>Locked forecasts</h3>
    <div class="forecasts">${lockedRows}</div>
  </section>`;
  document.body.style.overflow = 'hidden';
  for (const c of el.querySelectorAll('[data-close]')) {
    c.addEventListener('click', closeDetail);
  }
}

window.addEventListener('hashchange', () => { if (lastState) renderDetail(lastState); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (location.hash.startsWith('#m/') || location.hash.startsWith('#p/'))) closeDetail();
});

/* Trophy race: consensus tournament-winner probability per team, over
   time. Ranked list of the current favorites plus an evolution chart
   once there is more than one collection round. Colors deliberately
   avoid green: the page chrome is pitch-green throughout, and a green
   series line disappeared into it. */
const TROPHY_COLORS = ['#2563eb', '#f59e0b', '#7c3aed', '#dc2626', '#0891b2', '#a3550a'];

function outrightConsensus(entry) {
  const lists = Object.values(entry.models).filter((m) => m.probs);
  if (!lists.length) return null;
  const c = {};
  for (const t of entry.teams) c[t] = lists.reduce((s, m) => s + (m.probs[t] ?? 0), 0) / lists.length;
  return c;
}

const fmtTrophyTick = new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});
const fmtTrophyFull = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});
// A retro round-boundary anchor gets its own label ("Round of 16 start");
// a live collection round is identified by date and time, since several
// can land on the same day and a bare date can't tell them apart.
const tickLabel = (h) => h.label ?? fmtTrophyTick.format(new Date(h.at));

/* Points are spaced by index, not by elapsed time: the two retro anchors
   sit weeks before the live collection rounds, and scaling the x-axis to
   real time would crush every recent point into a sliver on the right. */
function trophyChart(history, topTeams) {
  const W = 700, H = 320, padL = 58, padR = 108, padT = 18, padB = 56;
  const n = history.length;
  const series = topTeams.map((t, i) => ({ team: t, color: TROPHY_COLORS[i % TROPHY_COLORS.length] }));
  const yMax = Math.max(0.3, ...history.flatMap((h) => topTeams.map((t) => h.consensus[t] ?? 0))) * 1.15;
  const x = (i) => (n === 1 ? padL : padL + (i * (W - padL - padR)) / (n - 1));
  const y = (v) => padT + (1 - v / yMax) * (H - padT - padB);
  const rotateTicks = n > 5;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Consensus probability of winning the tournament, per team over time">`;
  for (const g of [0, yMax / 2, yMax]) {
    svg += `<line x1="${padL}" y1="${y(g).toFixed(1)}" x2="${W - padR}" y2="${y(g).toFixed(1)}" stroke="var(--hairline)" stroke-width="1" stroke-dasharray="${g === 0 ? '0' : '3 4'}"/>`;
    svg += `<text x="${padL - 8}" y="${y(g).toFixed(1)}" dy="3.5" text-anchor="end" font-size="10.5" fill="var(--ink-3)">${Math.round(g * 100)}%</text>`;
  }

  for (const s of series) {
    const path = history.map((h, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(h.consensus[s.team] ?? 0).toFixed(1)}`).join('');
    svg += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    history.forEach((h, i) => {
      svg += `<circle cx="${x(i).toFixed(1)}" cy="${y(h.consensus[s.team] ?? 0).toFixed(1)}" r="3.5" fill="${s.color}" stroke="var(--surface)" stroke-width="1.5">` +
        `<title>${esc(s.team)}: ${pct(h.consensus[s.team] ?? 0)}% at ${esc(h.label ?? fmtTrophyFull.format(new Date(h.at)))}</title></circle>`;
    });
  }

  // End-of-line labels replace a separate color legend; nudge apart any
  // that land within 15px of each other so close final values don't
  // overlap into an unreadable stack.
  const ends = series
    .map((s) => ({ ...s, y: y(history[n - 1].consensus[s.team] ?? 0) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) {
    if (ends[i].y - ends[i - 1].y < 15) ends[i].y = ends[i - 1].y + 15;
  }
  for (const s of ends) {
    svg += `<text x="${x(n - 1) + 8}" y="${s.y.toFixed(1)}" dy="3.5" font-size="11.5" font-weight="700" fill="${s.color}">${esc(s.team)}</text>`;
  }

  history.forEach((h, i) => {
    const label = esc(tickLabel(h));
    svg += rotateTicks
      ? `<text x="${x(i).toFixed(1)}" y="${H - padB + 10}" text-anchor="end" font-size="10" fill="var(--ink-3)" transform="rotate(-32 ${x(i).toFixed(1)} ${H - padB + 10})">${label}</text>`
      : `<text x="${x(i).toFixed(1)}" y="${H - padB + 18}" text-anchor="middle" font-size="10" fill="var(--ink-3)">${label}</text>`;
  });
  svg += '</svg>';
  return svg;
}

function renderTrophy(state) {
  const section = $('#trophy-section');
  const el = $('#trophy');
  const history = (state.outright ?? [])
    .map((e) => ({ at: e.at, label: e.label, teams: e.teams, consensus: outrightConsensus(e), models: e.models }))
    .filter((e) => e.consensus)
    .sort((a, b) => new Date(a.at) - new Date(b.at));
  if (!history.length) { section.hidden = true; return; }
  section.hidden = false;
  const latest = history[history.length - 1];
  const ranked = latest.teams
    .map((t) => ({ team: t, p: latest.consensus[t] ?? 0 }))
    .sort((a, b) => b.p - a.p);
  const logos = {};
  for (const m of state.matches) for (const s of [m.home, m.away]) if (s.logo) logos[s.name] = s.logo;
  const top = ranked.slice(0, 6);
  const spread = (t) => {
    const ps = Object.values(latest.models).filter((m) => m.probs).map((m) => m.probs[t] ?? 0);
    return `${esc(t)}: models range ${pct(Math.min(...ps))}% to ${pct(Math.max(...ps))}%`;
  };
  el.innerHTML = `<div class="trophy-card">
    <div class="trophy-list">
      ${ranked.slice(0, 8).map((r, i) => `
        <div class="trophy-row" title="${spread(r.team)}">
          <span class="trophy-rank${i === 0 ? ' gold' : ''}">${i + 1}</span>
          ${logos[r.team] ? `<img class="flag" src="${esc(logos[r.team])}" alt="" onerror="this.style.visibility='hidden'">` : ''}
          <span class="trophy-team">${esc(r.team)}</span>
          <span class="trophy-bar"><i style="width:${Math.max(2, Math.round((r.p / (top[0].p || 1)) * 100))}%"></i></span>
          <span class="trophy-p">${pct(r.p)}%</span>
        </div>`).join('')}
      ${ranked.length > 8 ? `<div class="fnote">${ranked.slice(8).map((r) => `${esc(r.team)} ${pct(r.p)}%`).join(', ')}</div>` : ''}
    </div>
    ${history.length > 1
      ? `<div class="trophy-chart">
          <div class="chart">${trophyChart(history, top.map((r) => r.team))}</div>
        </div>`
      : `<p class="fnote">Collected ${esc(new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(latest.at)))}. The over-time chart appears after the next collection round.</p>`}
  </div>`;
}

/* Featured match: the live game, or the next kickoff, big and up front. */
function renderFeatured(state) {
  const el = $('#featured');
  const live = state.matches.find((m) => m.status.state === 'in');
  const next = state.matches
    .filter((m) => m.status.state === 'pre' && !m.teamsTbd)
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))[0];
  const m = live ?? next;
  if (!m) { el.innerHTML = ''; return; }
  const market = displayMarketOf(m.predictions, m);
  const c = consensusOf(m.predictions, market);
  const pick = c
    ? `models say ${esc(c.home >= c.away ? m.home.name : m.away.name)} ${pct(Math.max(c.home, c.away))}%${market === 'advance' ? ' to advance' : ''}`
    : '';
  el.innerHTML = live
    ? `<button class="feat" data-go="m/${esc(m.id)}">
        <span class="feat-tag feat-live">LIVE ${esc(m.status.detail)}</span>
        <span class="feat-fixture">${esc(m.home.name)} <b>${m.home.score ?? 0} : ${m.away.score ?? 0}</b> ${esc(m.away.name)}</span>
        ${pick ? `<span class="feat-note">${pick}</span>` : ''}
      </button>`
    : `<button class="feat" data-go="m/${esc(m.id)}">
        <span class="feat-tag">NEXT</span>
        <span class="feat-fixture">${esc(m.home.name)} <b>v</b> ${esc(m.away.name)}</span>
        <span class="feat-note">${esc(countdown(m.kickoff))}${pick ? `, ${pick}` : ''}</span>
      </button>`;
  el.querySelector('.feat').addEventListener('click', () => { location.hash = `m/${m.id}`; });
}

/* Ticker: one broadcast strip of live updates, built from state. Items
   click through to the relevant panel. Only re-rendered when content
   changes, so the scroll never jumps. */
let tickerContent = '';
function renderTicker(state) {
  const items = []; // { html, go }
  const live = state.matches.filter((m) => m.status.state === 'in');
  for (const m of live) {
    const go = `m/${m.id}`;
    items.push({ go, html: `<span class="tick-live">LIVE</span> ${esc(m.status.detail)} ${esc(m.home.name)} ${m.home.score ?? 0}-${m.away.score ?? 0} ${esc(m.away.name)}` });
    const events = m.keyEvents ?? [];
    if (events.length) items.push({ go, html: esc(events[events.length - 1]) });
    const snaps = m.snapshots ?? [];
    const last = snaps[snaps.length - 1];
    const snapMarket = last?.market === 'advance' ? 'advance' : 'regulation';
    const c = last && consensusOf(last.models, snapMarket);
    if (c) {
      const fav = c.home >= c.away ? m.home.name : m.away.name;
      items.push({ go, html: `Models now: ${esc(fav)} ${pct(Math.max(c.home, c.away))}% to ${snapMarket === 'advance' ? 'advance' : 'win'}` });
    }
  }
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  for (const m of state.matches.filter((x) => x.status.state === 'post' && x.outcome && new Date(x.kickoff) > dayAgo)) {
    let call = '';
    let best = null;
    for (const [id, p] of Object.entries(m.predictions ?? {})) {
      if (!p.probs || !p.eligible) continue;
      const market = predMarket(p);
      const outcome = m.outcomes ? m.outcomes[market] : m.outcome;
      if (!outcome) continue;
      const b = MARKET_OUTCOMES[market].reduce((s, o) => s + (p.probs[o] - (outcome === o ? 1 : 0)) ** 2, 0);
      if (best == null || b < best) {
        best = b;
        const mod = state.models.find((x) => x.id === id);
        call = mod ? ` best call ${esc(mod.label)} ${b.toFixed(2)}` : '';
      }
    }
    items.push({ go: `m/${m.id}`, html: `<span class="tick-ft">FT</span> ${esc(m.home.name)} ${m.home.score}-${m.away.score} ${esc(m.away.name)}${call}` });
  }
  for (const m of state.matches.filter((x) => x.status.state === 'pre' && !x.teamsTbd).slice(0, 3)) {
    const c = consensusOf(m.predictions, displayMarketOf(m.predictions, m));
    items.push({ go: `m/${m.id}`, html: `Next: ${esc(m.home.name)} v ${esc(m.away.name)} ${countdown(m.kickoff)}${
      c ? `, models say ${esc(c.home >= c.away ? m.home.name : m.away.name)} ${pct(Math.max(c.home, c.away))}%` : ''
    }` });
  }
  const leader = state.leaderboard.find((r) => r.avgBrier != null);
  if (leader) items.push({ go: `p/${encodeURIComponent(leader.model)}`, html: `<span class="tick-gold">Brier Cup leader</span> ${esc(leader.label)} ${leader.avgBrier.toFixed(3)}` });

  const sep = '<span class="tick-sep" aria-hidden="true">&#9670;</span>';
  const half = items
    .map((it) => `<button class="tick-item" data-go="${esc(it.go)}">${it.html}</button>`)
    .join(sep) + sep;
  if (half === tickerContent) return;
  tickerContent = half;
  const el = $('#ticker');
  if (!items.length) { el.innerHTML = ''; return; }
  // Two copies of the content; the animation slides one full copy for a
  // seamless loop. On updates the halves are swapped in place so the
  // running animation (and scroll position) is preserved.
  let track = el.querySelector('.ticker-track');
  if (!track) {
    el.innerHTML = `<div class="ticker-track">
      <span class="tick-half"></span>
      <span class="tick-half" aria-hidden="true"></span>
    </div>`;
    track = el.querySelector('.ticker-track');
  }
  for (const h of track.querySelectorAll('.tick-half')) h.innerHTML = half;
  track.style.animationDuration = `${Math.max(20, Math.round(track.scrollWidth / 2 / 55))}s`;
}

// One delegated handler; ticker items survive in-place content swaps.
// Pointer or touch contact pauses the scroll so the target holds still.
$('#ticker').addEventListener('click', (e) => {
  const item = e.target.closest('.tick-item');
  if (item) location.hash = item.dataset.go;
});
for (const evt of ['pointerdown', 'touchstart']) {
  $('#ticker').addEventListener(evt, () => {
    const el = $('#ticker');
    el.classList.add('paused');
    setTimeout(() => el.classList.remove('paused'), 4000);
  }, { passive: true });
}

function renderBanner(state) {
  const el = $('#banner');
  if (state.demoMode) {
    el.innerHTML = `<div class="banner">Demo mode is on: forecasts below are deterministic placeholders, not real model calls. Unset <code>DEMO_MODE</code> and set <code>OPENROUTER_API_KEY</code> for the real competition.</div>`;
  } else if (!state.predictorReady && !state.hosted) {
    el.innerHTML = `<div class="banner">Live scores are flowing, but no forecaster is configured. Set <code>OPENROUTER_API_KEY</code> (one key covers all seven models via OpenRouter) and restart the server. Upcoming matches are forecast automatically from then on.</div>`;
  } else {
    el.innerHTML = '';
  }
}

async function collect(matchId) {
  if (collecting) return;
  collecting = true;
  refresh(); // repaint buttons as disabled
  try {
    const res = await fetch('/api/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(matchId ? { matchId } : {}),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || res.statusText);
  } catch (err) {
    $('#banner').innerHTML = `<div class="banner error">Forecast collection failed: ${esc(err.message)}</div>`;
  } finally {
    collecting = false;
    await refresh(true);
  }
}

async function refresh(force = false) {
  try {
    const res = await fetch('/api/state');
    const state = await res.json();
    if (!res.ok) throw new Error(state.error || res.statusText);

    $('#source-status').textContent = state.demoMode
      ? 'Demo mode'
      : state.predictorReady || state.hosted
        ? 'Live scores + locked forecasts'
        : 'Live scores only';

    lastState = state;
    renderFeatured(state);
    renderTicker(state);
    renderTrophy(state);
    renderBanner(state);
    renderLeaderboard(state);
    renderMatches(state);
    renderDetail(state);
    if (state.prompts) {
      $('#prompt-locked').textContent = state.prompts.locked;
      $('#prompt-live').textContent = state.prompts.live;
      if (state.prompts.lockedKnockout) $('#prompt-locked-ko').textContent = state.prompts.lockedKnockout;
      if (state.prompts.liveKnockout) $('#prompt-live-ko').textContent = state.prompts.liveKnockout;
    }

    const anyLive = state.matches.some((m) => m.status.state === 'in');
    schedule(anyLive ? 12000 : 60000);
  } catch (err) {
    $('#source-status').textContent = 'Connection problem';
    const banner = $('#banner');
    if (!banner.innerHTML.includes('banner error')) {
      banner.innerHTML = `<div class="banner error">Could not load data: ${esc(err.message)}. Retrying.</div>`;
    }
    schedule(15000);
  }
}

function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(refresh, ms);
}

refresh();
