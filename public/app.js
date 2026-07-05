/* Brier Zero frontend: polls /api/state and renders leaderboard + matches.
   Poll cadence tightens to 20s while a match is live. */

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

let timer = null;
let collecting = false;

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
  let body;
  if (hasAny) {
    body = `<div class="forecasts">
      ${state.models.map((m) => forecastRow(m, preds[m.id], match, bestBrier)).join('')}
    </div>`;
  } else if (match.status.state === 'pre' && match.teamsTbd) {
    body = `<div class="forecasts"><div class="fnote">Forecasts open once both teams are decided.</div></div>`;
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
    <div class="match-head">
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
          <div class="lb-meta">${r.scored} scored / ${r.predicted} forecast${r.predicted === 1 ? '' : 's'}</div>
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

  el.innerHTML =
    group('LIVE NOW', live, true) +
    group('UPCOMING', pre) +
    group('FINISHED', done) ||
    '<div class="empty">No matches in the current window.</div>';

  for (const btn of el.querySelectorAll('.collect')) {
    btn.addEventListener('click', () => collect(btn.dataset.match));
  }
}

function renderBanner(state) {
  const el = $('#banner');
  if (state.demoMode) {
    el.innerHTML = `<div class="banner">Demo mode is on: forecasts below are deterministic placeholders, not real model calls. Unset <code>DEMO_MODE</code> and set <code>OPENROUTER_API_KEY</code> for the real competition.</div>`;
  } else if (!state.predictorReady) {
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
      : state.predictorReady
        ? 'Live: ESPN scores + OpenRouter forecasts'
        : 'Live scores only';

    renderBanner(state);
    renderLeaderboard(state);
    renderMatches(state);

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
