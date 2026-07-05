/* Brier Zero frontend: polls /api/state and renders leaderboard + matches.
   Poll cadence tightens to 20s while a match is live. */

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

function consensusOf(modelsMap) {
  const list = Object.values(modelsMap ?? {}).filter((p) => p.probs);
  if (!list.length) return null;
  const c = { home: 0, draw: 0, away: 0 };
  for (const p of list) for (const o of ['home', 'draw', 'away']) c[o] += p.probs[o] / list.length;
  return c;
}

function forecastRow(model, pred, match, bestBrier) {
  const name = esc(model.label);
  if (!pred || (!pred.probs && !pred.error)) {
    return `<div class="frow"><div class="fmodel">${name}</div><div class="fnote">no forecast yet</div><div></div></div>`;
  }
  if (!pred.probs) {
    return `<div class="frow"><div class="fmodel">${name}</div><div class="ferr" title="${esc(pred.error)}">failed: ${esc(pred.error.slice(0, 60))}</div></div>`;
  }
  const { home, draw, away } = pred.probs;
  const tip = `${esc(pred.rationale || '')}${pred.demo ? ' [demo forecast]' : ''}`;
  let brierCell = '<div></div>';
  let best = '';
  if (match.outcome && pred.brier != null) {
    best = pred.brier === bestBrier ? ' best' : '';
    brierCell = `<div class="fbrier">${pred.brier.toFixed(3)}</div>`;
  } else if (!pred.eligible && match.status.state !== 'pre') {
    brierCell = '<div class="fbrier" title="Collected after kickoff, excluded from scoring">late</div>';
  }
  return `<div class="frow${best}" title="${tip}">
    <div class="fmodel">${name}${pred.demo ? ' (demo)' : ''}</div>
    <div class="bar" role="img" aria-label="${name}: ${esc(match.home.name)} win ${pct(home)}%, draw ${pct(draw)}%, ${esc(match.away.name)} win ${pct(away)}%">
      ${seg('home', home, `${match.home.name} win`)}${seg('draw', draw, 'Draw')}${seg('away', away, `${match.away.name} win`)}
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
  const preds = {};
  let bestBrier = null;
  for (const m of state.models) {
    const p = match.predictions[m.id];
    if (!p) continue;
    const copy = { ...p };
    const sameFixture = !p.fixture || p.fixture === `${match.home.name} vs ${match.away.name}`;
    if (match.outcome && p.probs && p.eligible && sameFixture) {
      copy.brier = ['home', 'draw', 'away'].reduce(
        (sum, o) => sum + (p.probs[o] - (match.outcome === o ? 1 : 0)) ** 2, 0
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
      // Consensus: the mean of every stored model forecast for this match.
      const consensus = consensusOf(preds);
      outcomeHead = `<div class="outcome-head" title="Consensus of ${withProbs.length} model forecasts">
        <span class="ol"><i class="swatch swatch-home"></i>${esc(home.name)} <b>${pct(consensus.home)}%</b></span>
        <span class="ol"><i class="swatch swatch-draw"></i>Draw <b>${pct(consensus.draw)}%</b></span>
        <span class="ol"><i class="swatch swatch-away"></i>${esc(away.name)} <b>${pct(consensus.away)}%</b></span>
      </div>`;
      const consensusPred = {
        probs: consensus,
        rationale: `Average of ${withProbs.length} model forecasts`,
        eligible: true,
      };
      if (match.outcome) {
        consensusPred.brier = ['home', 'draw', 'away'].reduce(
          (sum, o) => sum + (consensus[o] - (match.outcome === o ? 1 : 0)) ** 2, 0
        );
      }
      collapsed = forecastRow({ label: 'Consensus' }, consensusPred, match, null);
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
      ${isRetro ? '<div class="retro-note" title="Forecast after the match with the standard pre-kickoff prompt. Model training data predates this tournament, so results were unknowable, but these lack the pre-kickoff timestamp proof.">backfilled forecast</div>' : ''}
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
    ${isDone && match.outcome ? `<div class="fnote" style="margin-top:6px">90-minute result: ${
      match.outcome === 'draw' ? 'draw' : esc(match[match.outcome].name) + ' win'
    }${match.outcome === 'draw' && (home.shootoutScore != null || match.status.name !== 'STATUS_FULL_TIME') ? ' (decided after regulation)' : ''}</div>` : ''}
    ${body}
  </article>`;
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
      return `<div class="lb-row${i === 0 && r.avgBrier != null ? ' leader' : ''}">
        <div class="lb-rank">${r.avgBrier == null ? '-' : i + 1}</div>
        <div><span class="lb-name">${esc(r.label)}</span><span class="lb-slug">${esc(r.model)}</span></div>
        <div class="lb-score">
          <div class="lb-brier">${r.avgBrier == null ? '-' : r.avgBrier.toFixed(3)}</div>
          <div class="lb-meta">${r.scored} scored${r.retroScored ? ` (${r.retroScored} backfilled)` : ''} / ${r.predicted} forecast${r.predicted === 1 ? '' : 's'}</div>
        </div>
      </div>`;
    })
    .join('')}</div>`;
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
   consensus, each in-play snapshot, and (when finished) the actual result. */
function detailPoints(match) {
  const points = [];
  const locked = consensusOf(match.predictions);
  if (locked) points.push({ label: 'Locked', sub: 'pre-kickoff', probs: locked });
  for (const snap of match.snapshots ?? []) {
    const c = consensusOf(snap.models);
    if (c) points.push({ label: snap.detail, sub: `${snap.score[0]}:${snap.score[1]}`, probs: c, snap });
  }
  if (match.outcome) {
    points.push({
      label: 'FT', sub: `${match.home.score}:${match.away.score}`,
      probs: { home: 0, draw: 0, away: 0, [match.outcome]: 1 },
      final: true,
    });
  }
  return points;
}

function evolutionChart(match, points) {
  const W = 660, H = 240, padL = 36, padR = 30, padT = 12, padB = 34;
  const n = points.length;
  const x = (i) => (n === 1 ? W / 2 : padL + (i * (W - padL - padR)) / (n - 1));
  const y = (p) => padT + (1 - p) * (H - padT - padB);
  const series = [
    { key: 'home', color: 'var(--home)', name: match.home.name },
    { key: 'draw', color: 'var(--draw)', name: 'Draw' },
    { key: 'away', color: 'var(--away)', name: match.away.name },
  ];
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="How the consensus win probabilities moved over time">`;
  for (const g of [0, 0.5, 1]) {
    svg += `<line x1="${padL}" y1="${y(g)}" x2="${W - padR}" y2="${y(g)}" stroke="var(--hairline)" stroke-width="1"/>`;
    svg += `<text x="${padL - 6}" y="${y(g) + 4}" text-anchor="end" font-size="10" fill="var(--ink-3)">${g * 100}</text>`;
  }
  for (const s of series) {
    if (n > 1) {
      const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.probs[s.key]).toFixed(1)}`).join('');
      svg += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
    }
    points.forEach((p, i) => {
      svg += `<circle cx="${x(i).toFixed(1)}" cy="${y(p.probs[s.key]).toFixed(1)}" r="4" fill="${s.color}">` +
        `<title>${esc(s.name)}: ${pct(p.probs[s.key])}% at ${esc(p.label)}${p.sub ? ` (${esc(p.sub)})` : ''}</title></circle>`;
    });
  }
  points.forEach((p, i) => {
    svg += `<text x="${x(i).toFixed(1)}" y="${H - 18}" text-anchor="middle" font-size="10.5" font-weight="600" fill="var(--ink-2)">${esc(p.label)}</text>`;
    if (p.sub) svg += `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--ink-3)">${esc(p.sub)}</text>`;
  });
  svg += '</svg>';
  return svg;
}

function renderDetail(state) {
  const el = $('#detail');
  const m = location.hash.match(/^#m\/(\d+)/);
  if (!m) { el.innerHTML = ''; document.body.style.overflow = ''; return; }
  const match = state.matches.find((x) => x.id === m[1]);
  if (!match) { el.innerHTML = ''; return; }
  const points = detailPoints(match);
  const isLive = match.status.state === 'in';

  const snapRows = (match.snapshots ?? []).slice().reverse().map((snap) => {
    const c = consensusOf(snap.models);
    if (!c) return '';
    return `<div class="snap-row">
      <span class="snap-when">${esc(snap.detail)} <span class="snap-score">${snap.score[0]}:${snap.score[1]}</span></span>
      <span class="snap-probs">${esc(match.home.name)} <b>${pct(c.home)}%</b> · Draw <b>${pct(c.draw)}%</b> · ${esc(match.away.name)} <b>${pct(c.away)}%</b></span>
    </div>`;
  }).join('');

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
    <h3>Consensus over time</h3>
    ${points.length ? `<div class="chart">${evolutionChart(match, points)}</div>` : '<div class="fnote">No forecasts yet.</div>'}
    <p class="fnote">Only the locked pre-kickoff forecast counts for the leaderboard. In-play points are fresh forecasts given the score at that moment; FT is the actual result.</p>
    ${snapRows ? `<h3>In-play updates</h3><div class="snap-list">${snapRows}</div>` : (isLive ? '<p class="fnote">In-play updates are collected every ~20 minutes while the match runs.</p>' : '')}
    <h3>Locked forecasts</h3>
    <div class="forecasts">${lockedRows}</div>
  </section>`;
  document.body.style.overflow = 'hidden';
  for (const c of el.querySelectorAll('[data-close]')) {
    c.addEventListener('click', () => { location.hash = ''; });
  }
}

window.addEventListener('hashchange', () => { if (lastState) renderDetail(lastState); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && location.hash.startsWith('#m/')) location.hash = '';
});

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
    renderBanner(state);
    renderLeaderboard(state);
    renderMatches(state);
    renderDetail(state);
    if (state.prompts) {
      $('#prompt-locked').textContent = state.prompts.locked;
      $('#prompt-live').textContent = state.prompts.live;
    }

    const anyLive = state.matches.some((m) => m.status.state === 'in');
    schedule(anyLive ? 20000 : 60000);
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
