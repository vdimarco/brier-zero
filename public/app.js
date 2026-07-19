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

// "The Market" is not an LLM: it is TxODDS's StablePrice bookmaker
// consensus, delivered on-chain by TxLINE on Solana.
const MARKET_ID = 'txodds/market';
const MARKET_ATTRIBUTION = 'TxODDS StablePrice · TxLINE on Solana';

/* "The Market" labels are tap targets that open the shared sourcing modal
   (#market-modal in index.html): dashed underline + ? mark for affordance. */
function marketLabel(inner) {
  return `<span class="market-tip" tabindex="0" role="button" aria-haspopup="dialog" aria-label="What is The Market and where do its numbers come from?">${inner}<span class="market-tip-mark" aria-hidden="true">?</span></span>`;
}

/* Everyone who ever competed: the active roster plus retired entrants
   (models substituted out mid-tournament, e.g. swapped for their lab's
   newest release before the final). Display and scoring lookups go
   through this so historical forecasts never disappear from the page. */
function entrantsOf(state) {
  return state.entrants ?? state.models ?? [];
}
function entrantById(state, id) {
  return entrantsOf(state).find((m) => m.id === id);
}
/* Ranking runs on shrunken skill vs the coin flip (see lib/scoring.js):
   every entrant carries ten phantom coin-flip matches, so newcomers
   start neutral and rise with evidence instead of being gated. Average
   Brier stays the headline number; avgSkill is its human-readable
   difficulty-adjusted companion. */
function fmtSkill(s) {
  if (s == null) return '-';
  const v = (Math.abs(s) * 100).toFixed(1);
  return `${s < 0 ? '−' : '+'}${v}%`;
}

/* Page-wide view: 'lab' (default) folds each lab's entrants — across
   mid-tournament substitutions — into one continuous record; 'model'
   shows every entrant separately. The toggle in the leaderboard header
   switches every panel at once (leaderboard, podium, chart, match
   cards, ticker, detail). */
let viewMode = 'lab';
// Session-only persistence: a toggle sticks while browsing, but every
// fresh visit starts on the by-lab view.
try { if (sessionStorage.getItem('brierView') === 'model') viewMode = 'model'; } catch { /* private mode */ }
function setViewMode(mode) {
  if (mode === viewMode) return;
  viewMode = mode;
  try { sessionStorage.setItem('brierView', mode); } catch { /* private mode */ }
  if (lastState) renderAll(lastState);
}
/* The segmented By lab / By model control. Rendered both at the top of
   the page (The competitors) and above the leaderboard; clicks are
   delegated document-wide so every instance works. */
function viewToggleHtml(state) {
  if (!state.leaderboardByLab) return '';
  return `<div class="lb-view" role="group" aria-label="Leaderboard view">
    <button class="lb-view-btn${viewMode === 'lab' ? ' active' : ''}" data-view="lab" aria-pressed="${viewMode === 'lab'}" title="One continuous record per lab — a substituted model's history carries over">By lab</button>
    <button class="lb-view-btn${viewMode === 'model' ? ' active' : ''}" data-view="model" aria-pressed="${viewMode === 'model'}" title="Every model separately — substituted models keep their own records">By model</button>
    <span class="lb-view-hint">${viewMode === 'lab'
      ? 'One record per lab: when a lab substituted its newest model before the final, the line carries on.'
      : 'Every entrant separately: substituted models keep their own full records.'}</span>
  </div>`;
}
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('.lb-view-btn');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      setViewMode(btn.dataset.view);
    }
  }, true);
}
function boardOf(state) {
  return viewMode === 'lab' && state.leaderboardByLab ? state.leaderboardByLab : state.leaderboard;
}
/* Labs derived from the entrants list: one display entry per lab, with
   `members` (active first — the config order) for forecast lookups. */
function labsOf(state) {
  const labs = new Map();
  for (const m of entrantsOf(state)) {
    const key = m.lab ?? m.id;
    let lab = labs.get(key);
    if (!lab) {
      lab = { id: key, label: m.labLabel ?? m.label ?? key, icon: m.icon ?? null, members: [] };
      labs.set(key, lab);
    }
    if (m.labLabel) lab.label = m.labLabel;
    lab.icon ??= m.icon ?? null;
    lab.members.push(m);
  }
  return [...labs.values()];
}
function displayEntrants(state) {
  return viewMode === 'lab' ? labsOf(state) : entrantsOf(state);
}
/* The forecast a display entrant holds on a match: its own row in model
   view; in lab view the lab's official entry — a live-locked forecast
   beats a retro reconstruction, then the active member beats a retired
   one (mirrors labLeaderboard in lib/scoring.js). */
function predOf(match, ent) {
  if (!ent.members) return match.predictions[ent.id];
  let pick = null;
  let pickScore = Infinity;
  for (const member of ent.members) {
    const p = match.predictions[member.id];
    if (!p) continue;
    const score = (p.retro ? 2 : 0) + (member.retired ? 1 : 0);
    if (score < pickScore) {
      pick = p;
      pickScore = score;
    }
  }
  return pick;
}
/* The lineage line under a lab row: retired → active, oldest first. */
function memberChain(row) {
  return row.members && row.members.length > 1 ? [...row.members].reverse().join(' → ') : null;
}

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

/* Hover/focus popover explaining the Brier score. Used wherever "Brier"
   appears as a label or next to a score so readers don't have to scroll
   for the definition. `compact` drops the examples for tight cells. */
const BRIER_TIP_BODY = `
  <strong class="brier-tip-title">What is a Brier score?</strong>
  <p>A Brier score measures how well a probability forecast matches the real outcome. For every possible result you square the gap between the probability you gave it and what actually happened (1 for the true result, 0 for the others), then sum those squares.</p>
  <ul>
    <li><b>0</b> — perfect forecast (you put 100% on the winner)</li>
    <li><b>0.5</b> — two-way coin flip (knockout ties)</li>
    <li><b>0.667</b> — three-way coin flip (group-stage 1X2)</li>
    <li><b>2</b> — maximally wrong (100% on a result that didn't happen)</li>
  </ul>
  <p class="brier-tip-foot"><b>Lower is better.</b> Being right with the right amount of confidence beats loud conviction in the wrong direction — that calibration is what this cup ranks.</p>
`;

function brierTip(label = 'Brier', { compact = false } = {}) {
  const body = compact
    ? `<strong class="brier-tip-title">Brier score</strong>
       <p>How close a probability forecast was to the real outcome. <b>0</b> is perfect, a coin flip is <b>0.5</b> (knockout) or <b>0.667</b> (group), <b>2</b> is maximally wrong. <b>Lower is better.</b></p>`
    : BRIER_TIP_BODY;
  return `<span class="brier-tip" tabindex="0" role="button" aria-label="What is a Brier score?">
    <span class="brier-tip-label">${esc(label)}<span class="brier-tip-mark" aria-hidden="true">?</span></span>
    <span class="brier-tip-pop" role="tooltip">${body}</span>
  </span>`;
}

// Click/tap outside closes any open tip; tip itself toggles on click so
// touch devices get the same definition without a true hover.
function wireBrierTips(root = document) {
  const tips = root.querySelectorAll?.('.brier-tip') ?? [];
  for (const tip of tips) {
    if (tip.dataset.wired) continue;
    tip.dataset.wired = '1';
    tip.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const open = tip.classList.contains('open');
      document.querySelectorAll('.brier-tip.open').forEach((t) => t.classList.remove('open'));
      if (!open) tip.classList.add('open');
    });
    tip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        tip.click();
      }
      if (e.key === 'Escape') tip.classList.remove('open');
    });
  }
}
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest?.('.brier-tip')) {
      document.querySelectorAll('.brier-tip.open').forEach((t) => t.classList.remove('open'));
    }
  });

  // The Market sourcing modal. Delegated in the capture phase so a trigger
  // nested inside a clickable leaderboard row opens the modal instead of
  // navigating into the model detail.
  const marketModal = () => document.getElementById('market-modal');
  const openMarketModal = () => { const m = marketModal(); if (m) { m.hidden = false; document.body.classList.add('mkt-open'); m.querySelector('.mkt-close')?.focus(); } };
  const closeMarketModal = () => { const m = marketModal(); if (m && !m.hidden) { m.hidden = true; document.body.classList.remove('mkt-open'); } };
  document.addEventListener('click', (e) => {
    const proofBtn = e.target.closest?.('.proof-badge[data-proof]');
    const copyBtn = e.target.closest?.('.proof-copy[data-copy]');
    if (proofBtn) {
      e.preventDefault();
      e.stopPropagation();
      const id = proofBtn.dataset.proof;
      const match = lastState?.matches.find((m) => m.id === id);
      const proof = lastState?.proofs?.[id];
      if (match && proof) renderProofModal(match, proof);
    } else if (copyBtn) {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard?.writeText(copyBtn.dataset.copy).then(() => toast('Hash copied')).catch(() => {});
    } else if (e.target.closest?.('[data-proof-close]')) {
      e.preventDefault();
      e.stopPropagation();
      closeProofModal();
    } else if (e.target.closest?.('.market-tip')) {
      e.preventDefault();
      e.stopPropagation();
      openMarketModal();
    } else if (e.target.closest?.('[data-mkt-close]')) {
      e.preventDefault();
      e.stopPropagation();
      closeMarketModal();
    }
  }, true);
  document.addEventListener('keydown', (e) => {
    const tip = e.target.closest?.('.market-tip');
    if (tip && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      e.stopPropagation();
      openMarketModal();
    }
    const badge = e.target.closest?.('.proof-badge[data-proof]');
    if (badge && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      e.stopPropagation();
      const match = lastState?.matches.find((m) => m.id === badge.dataset.proof);
      const proof = lastState?.proofs?.[badge.dataset.proof];
      if (match && proof) renderProofModal(match, proof);
    }
    if (e.key === 'Escape') {
      closeMarketModal();
      closeProofModal();
      // Close tip popovers too, wherever focus is.
      document.querySelectorAll('.brier-tip.open').forEach((t) => t.classList.remove('open'));
    }
  }, true);
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

// A single forecast's Brier score against the finished match, settled in
// the market it priced. Null while unknowable (no result, ineligible, or a
// forecast made for a different fixture). Shared by the card and detail so
// scoring never drifts between them.
function predBrier(p, match) {
  if (!p?.probs || !p.eligible) return null;
  const sameFixture = !p.fixture || p.fixture === `${match.home.name} vs ${match.away.name}`;
  if (!sameFixture) return null;
  const market = predMarket(p);
  const outcome = match.outcomes ? match.outcomes[market] : match.outcome;
  if (!outcome) return null;
  return MARKET_OUTCOMES[market].reduce(
    (sum, o) => sum + (p.probs[o] - (outcome === o ? 1 : 0)) ** 2, 0
  );
}

// The order models are listed for a match, best first. A finished match
// ranks by Brier (who called it right); a live or upcoming one ranks by
// how much probability each model puts on the current favourite (most
// confident first). Models with no forecast sink to the bottom. Every
// per-match list uses this, so ranking reads the same everywhere.
function rankModels(models, preds, match, market) {
  const consensus = consensusOf(preds, market);
  const outs = MARKET_OUTCOMES[market];
  const fav = consensus
    ? outs.reduce((a, o) => ((consensus[o] ?? 0) > (consensus[a] ?? 0) ? o : a), outs[0])
    : outs[0];
  const finished = match.status.state === 'post';
  const rankVal = (m) => {
    const p = preds[m.id];
    if (!p || !p.probs) return -Infinity;
    if (finished) { const b = predBrier(p, match); if (b != null) return 100 - b; }
    return p.probs[fav] ?? 0;
  };
  return [...models].sort((a, b) => rankVal(b) - rankVal(a));
}

// Deep link to a panel (a match or a model), shareable and reopenable: on
// load renderDetail reads the same hash and reopens the panel.
function shareLink(hash) {
  return `${location.origin}${location.pathname}#${hash}`;
}

let toastTimer = null;
function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// Share a match: the native sheet on phones, a copied link elsewhere.
async function shareMatch(match) {
  const url = shareLink(`m/${match.id}`);
  const title = `${match.home.name} vs ${match.away.name} · The Brier Cup`;
  const text = `${match.home.name} vs ${match.away.name} — watch frontier AI models and the betting market forecast this ${match.stage} match, live.`;
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Link copied'); }
  catch { window.prompt('Copy this link', url); }
}

function forecastRow(model, pred, match, bestBrier) {
  // plainName goes into attributes (title/aria-label); name is visible HTML
  // and may carry the market-tip markup, whose quotes would break attributes.
  const plainName = esc(model.label);
  const name = model.id === MARKET_ID ? marketLabel(plainName) : plainName;
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
    brierCell = `<div class="fbrier" title="Brier score for this match — lower is better">${pred.brier.toFixed(3)}</div>`;
  } else if (!pred.eligible && match.status.state !== 'pre') {
    brierCell = '<div class="fbrier" title="Collected after kickoff, excluded from scoring">late</div>';
  }
  const aria = outs.map((o) => `${outcomeLabel(match, o, market)} ${pct(pred.probs[o])}%`).join(', ');
  return `<div class="frow${best}" title="${tip}">
    <div class="fmodel">${crest}${name}${pred.demo ? ' (demo)' : ''}</div>
    <div class="bar" role="img" aria-label="${plainName}: ${esc(aria)}">
      ${outs.map((o) => seg(o, pred.probs[o], outcomeLabel(match, o, market))).join('')}
    </div>
    ${brierCell}
  </div>`;
}

/* Live TxODDS StablePrice line for this fixture: raw decimal odds plus the
   de-vigged implied probabilities the market trades under on the
   leaderboard. Streams from TxLINE (odds on Solana) while the match is
   upcoming or in play. */
function oddsStrip(match) {
  const mo = match.marketOdds;
  const market = matchMarket(match);
  const outs = MARKET_OUTCOMES[market];
  const probs = outs.map((o) =>
    `<span class="ol">${o === 'draw' ? 'Draw' : esc(match[o].name)} <b>${pct(mo.probs[o])}%</b></span>`
  ).join(' ');
  const prices = `${mo.prices.home} / ${mo.prices.draw} / ${mo.prices.away}`;
  return `<div class="odds-strip" title="TxODDS StablePrice consensus, vig removed (raw 1X2: ${esc(prices)}, overround ${((mo.overround - 1) * 100).toFixed(1)}%). Delivered by TxLINE on Solana.">
    <img class="crest" src="/icons/market.svg" alt=""> <span class="odds-label">Live odds <span class="odds-source">· TxODDS on Solana</span></span> ${probs}
  </div>`;
}

// Final-score Merkle proof verified against TxODDS's on-chain
// daily_scores_roots PDA (scripts/verify-results.js). Only rendered when
// validateStat.view() returned true for this match.
function proofBadge(state, match) {
  const p = state.proofs?.[match.id];
  if (!p?.verified) return '';
  const title = `Final score Merkle-proved against the root TxODDS committed on Solana (epoch day ${p.epochDay}) — tap for the receipt`;
  return `<button class="proof-badge" data-proof="${esc(match.id)}"
    aria-haspopup="dialog" title="${esc(title)}">Score verified on Solana ✓</button>`;
}

// Solscan link for the on-chain daily-roots account. Explorer link is kept
// too (proof.explorerUrl); Solscan is the one the spec asks for.
function solscanUrl(proof) {
  const q = proof.cluster && proof.cluster !== 'mainnet' ? `?cluster=${proof.cluster}` : '';
  return `https://solscan.io/account/${proof.pda}${q}`;
}

// Settlement-proof receipt: the leaf identity, the recomputed daily root vs
// the on-chain root they must match, the Merkle path when a verify run has
// persisted it, and a one-click link to the on-chain account so a judge can
// verify the root independently.
function renderProofModal(match, proof) {
  const el = document.getElementById('proof-modal');
  if (!el || !proof) return;
  const hs = match.home.score ?? '?';
  const as = match.away.score ?? '?';
  const market = matchMarket(match);
  const settled = match.outcome
    ? (market === 'advance'
        ? `${esc(match[match.outcome].name)} advanced`
        : match.outcome === 'draw' ? 'Draw' : `${esc(match[match.outcome].name)} won`)
    : '—';
  const hash = (h) => `<code class="proof-hash">${esc(h)}</code><button class="proof-copy" data-copy="${esc(h)}" title="Copy hash" aria-label="Copy hash">⧉</button>`;
  const rootsMatch = proof.root && proof.onchainRoot && proof.root === proof.onchainRoot;

  // Merkle path (leaf → siblings → root), only if a verify run persisted it.
  let pathHtml = '';
  const nodes = proof.merklePath;
  if (Array.isArray(nodes) && nodes.length) {
    pathHtml = `<div class="proof-block">
      <div class="proof-k">Merkle path · leaf → root</div>
      <ol class="proof-path">
        <li><span class="proof-step-tag">leaf</span>${hash(proof.leafHash || '(full-time score stat)')}</li>
        ${nodes.map((n, i) => `<li><span class="proof-step-tag">h${i + 1}</span>${hash(n.hash ?? n)}</li>`).join('')}
        <li><span class="proof-step-tag">root</span>${hash(proof.root)}</li>
      </ol>
    </div>`;
  }

  el.innerHTML = `<div class="mkt-scrim" data-proof-close></div>
  <section class="mkt-panel proof-panel" role="dialog" aria-modal="true" aria-labelledby="proof-title">
    <button class="mkt-close" data-proof-close aria-label="Close">✕</button>
    <h3 id="proof-title">Settlement proof</h3>
    <p class="proof-sub">${esc(match.home.name)} <b>${hs}–${as}</b> ${esc(match.away.name)} · ${esc(match.stage)}</p>
    <div class="proof-block">
      <div class="proof-k">Settled outcome</div>
      <div class="proof-v">${settled}</div>
    </div>
    <div class="proof-block">
      <div class="proof-k">The leaf</div>
      <div class="proof-v">Full-time score stat (TxODDS stat key ${esc(proof.statKey ?? 1002)}) · fixture ${esc(proof.fixtureId ?? '—')}${proof.seq != null ? ` · seq ${esc(proof.seq)}` : ''}</div>
    </div>
    ${pathHtml}
    <div class="proof-block">
      <div class="proof-k">Recomputed daily root</div>
      <div class="proof-v">${proof.root ? hash(proof.root) : '—'}</div>
    </div>
    <div class="proof-block">
      <div class="proof-k">On-chain daily root ${rootsMatch ? '<span class="proof-ok">✓ match</span>' : ''}</div>
      <div class="proof-v">${proof.onchainRoot ? hash(proof.onchainRoot) : '—'}</div>
    </div>
    <div class="proof-links">
      <a class="proof-link" href="${esc(solscanUrl(proof))}" target="_blank" rel="noopener">Open on Solscan ↗</a>
      ${proof.explorerUrl ? `<a class="proof-link proof-link-2" href="${esc(proof.explorerUrl)}" target="_blank" rel="noopener">Solana Explorer ↗</a>` : ''}
    </div>
    <p class="proof-foot">This match's settled score is a leaf in TxODDS's Merkle daily root, published on Solana (${esc(proof.cluster || 'devnet')}${proof.epochDay != null ? `, epoch day ${esc(proof.epochDay)}` : ''}). Recompute the path yourself — if any hash differed, the badge would not show.</p>
  </section>`;
  el.hidden = false;
  document.body.classList.add('mkt-open');
  el.querySelector('.mkt-close')?.focus();
}

function closeProofModal() {
  const el = document.getElementById('proof-modal');
  if (el && !el.hidden) { el.hidden = true; document.body.classList.remove('mkt-open'); }
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
  for (const m of displayEntrants(state)) {
    const p = predOf(match, m);
    if (!p) continue;
    const copy = { ...p };
    const b = predBrier(p, match);
    if (b != null) {
      copy.brier = b;
      bestBrier = bestBrier == null ? b : Math.min(bestBrier, b);
    }
    preds[m.id] = copy;
  }

  const hasAny = Object.keys(preds).length > 0;
  let body;
  if (hasAny) {
    const withProbs = Object.values(preds).filter((p) => p.probs);
    const isOpen = expandedMatches.has(match.id);
    const market = displayMarketOf(preds, match);
    let outcomeHead = '';
    let collapsed = '';
    if (withProbs.length) {
      // Consensus: the mean of every stored forecast priced in the market
      // this match is displayed in (knockout: who advances).
      const outs = MARKET_OUTCOMES[market];
      const consensus = consensusOf(preds, market);
      const inMarket = withProbs.filter((p) => predMarket(p) === market).length;
      const advTag = market === 'advance' ? ' to advance' : '';
      outcomeHead = `<div class="outcome-head" title="Consensus of ${inMarket} model forecasts">
        ${outs.map((o) => `<span class="ol"><i class="swatch swatch-${o}"></i><span class="ol-label">${
          o === 'draw' ? 'Draw' : `${esc(match[o].name)}${advTag}`
        }</span> <b>${pct(consensus[o])}%</b></span>`).join('\n        ')}
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
      collapsed = forecastRow({ label: 'Consensus' }, consensusPred, match, null);
    } else {
      collapsed = `<div class="fnote">All model calls failed for this match.</div>`;
    }
    body = `<div class="forecasts">
      ${outcomeHead}
      ${isOpen
        ? rankModels(displayEntrants(state), preds, match, market).map((m) => forecastRow(m, preds[m.id], match, bestBrier)).join('')
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
      ? 'Ask every competitor — the AI field and the market — for probabilities now.'
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
    ${match.marketOdds ? oddsStrip(match) : ''}
    ${isDone ? proofBadge(state, match) : ''}
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

// Soft, CVD-friendly palette — Market/blue leads, then distinct warm/cool pairs.
const MODEL_COLORS = ['#1d4ed8', '#c2410c', '#0f766e', '#7c3aed', '#b45309', '#be123c', '#0369a1', '#4d7c0f', '#9333ea'];
const LB_GEO = { W: 760, H: 360, padL: 48, padR: 108, padT: 28, padB: 58 };
let lbDismiss = null; // the current dismiss-on-outside-tap listener

/* The knockout-phase series shared by the chart renderer and its hover
   handler: each entrant's shrunken running skill vs the coin flip, match
   by match. Skill normalizes match difficulty (an easy rout no longer
   flatters everyone) and the ten-phantom-match shrinkage anchors every
   line at zero, so the old small-sample dip at the start is gone. Points
   sit at a match's true chronological slot even when a model is missing
   one, so lines stay comparable instead of drifting out of alignment. */
const CHART_SHRINK = 10;
function leaderboardSeries(state) {
  const koMatches = state.matches
    .filter((m) => m.market === 'advance' && m.status.state === 'post')
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  if (koMatches.length < 2) return null;
  const n = koMatches.length;
  const indexOf = new Map(koMatches.map((m, i) => [m.id, i]));
  const series = boardOf(state).map((row, i) => {
    const byMatch = new Map((row.perMatch ?? []).map((p) => [p.matchId, p]));
    let skillSum = 0, count = 0;
    const points = [];
    for (const km of koMatches) {
      const p = byMatch.get(km.id);
      if (!p) continue;
      const idx = indexOf.get(km.id);
      skillSum += (p.baseline - p.brier) / p.baseline;
      count++;
      points.push({ idx, cum: skillSum / (count + CHART_SHRINK), brier: p.brier, shortName: km.shortName });
    }
    if (points.length < 2) return null;
    return { model: row.model, label: row.label, color: MODEL_COLORS[i % MODEL_COLORS.length], points };
  }).filter(Boolean);
  if (!series.length) return null;
  const cums = series.flatMap((s) => s.points.map((p) => p.cum));
  const yMax = Math.max(0.1, ...cums) * 1.15;
  const yMin = Math.min(0, ...cums) - 0.015;
  return { koMatches, n, series, yMax, yMin };
}

/* Combined view of every model's knockout-phase form. The group stage is
   over, so this is deliberately scoped to the knockouts rather than the
   full-tournament average shown per row. */
function leaderboardChart(state) {
  const data = leaderboardSeries(state);
  if (!data) return null;
  const { koMatches, n, series, yMax, yMin } = data;
  const { W, H, padL, padR, padT, padB } = LB_GEO;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const x = (i) => (n === 1 ? padL : padL + (i * plotW) / (n - 1));
  const y = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * plotH;
  const step = n > 12 ? Math.ceil(n / 8) : Math.max(1, Math.ceil(n / 10));

  // Leader = highest final shrunken skill (sharpest). Emphasize it; fade the rest.
  const ranked = series
    .map((s) => ({ s, final: s.points[s.points.length - 1].cum }))
    .sort((a, b) => b.final - a.final);
  const leaderId = ranked[0]?.s.model;
  const isLeader = (s) => s.model === leaderId;

  let svg = `<svg class="lb-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Shrunken running skill versus the coin flip for every model over the knockout phase">`;
  svg += `<defs>
    <linearGradient id="lb-plot-bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f7f8f4"/>
      <stop offset="100%" stop-color="#eef3ea"/>
    </linearGradient>
    <linearGradient id="lb-good-zone" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="rgba(10,122,51,0.10)"/>
      <stop offset="55%" stop-color="rgba(10,122,51,0.03)"/>
      <stop offset="100%" stop-color="rgba(10,122,51,0)"/>
    </linearGradient>
    <filter id="lb-glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="2.2" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>`;

  // Soft plot panel
  svg += `<rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" rx="12" fill="url(#lb-plot-bg)"/>`;
  // Higher skill is better — a gentle green wash along the top.
  svg += `<rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH * 0.55}" rx="0" fill="url(#lb-good-zone)" transform="translate(0 ${(2 * padT + plotH * 0.55).toFixed(1)}) scale(1 -1)"/>`;
  svg += `<rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" rx="12" fill="none" stroke="rgba(23,46,22,0.06)" stroke-width="1"/>`;

  // Horizontal guides — 0 is the coin flip itself.
  for (const g of [0, yMax / 2, yMax / 1.15]) {
    const gy = y(g);
    const isBase = g === 0;
    svg += `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" stroke="${isBase ? 'rgba(82,81,78,0.55)' : 'rgba(23,46,22,0.07)'}" stroke-width="${isBase ? 1.5 : 1}" stroke-dasharray="${isBase ? '5 4' : '2 5'}"/>`;
    svg += `<text x="${padL - 10}" y="${gy.toFixed(1)}" dy="3.5" text-anchor="end" font-size="11" font-weight="600" fill="var(--ink-3)">${isBase ? '0%' : `+${Math.round(g * 100)}%`}</text>`;
  }
  svg += `<text x="12" y="${(padT + plotH / 2).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="var(--ink-3)" transform="rotate(-90 12 ${(padT + plotH / 2).toFixed(1)})" letter-spacing="0.04em">SKILL ↑ BETTER</text>`;

  // Coin-flip label pill on the zero line
  {
    const lx = W - padR - 8;
    const ly = y(0) - 10;
    svg += `<rect x="${(lx - 52).toFixed(1)}" y="${(ly - 11).toFixed(1)}" width="56" height="16" rx="8" fill="rgba(255,255,255,0.92)" stroke="rgba(23,46,22,0.08)"/>`;
    svg += `<text x="${(lx - 24).toFixed(1)}" y="${ly.toFixed(1)}" dy="3.5" text-anchor="middle" font-size="9.5" font-weight="700" fill="var(--ink-3)" letter-spacing="0.02em">coin flip</text>`;
  }

  // Field lines first (non-leaders), then the leader on top.
  const drawOrder = [...series].sort((a, b) => (isLeader(a) ? 1 : 0) - (isLeader(b) ? 1 : 0));
  for (const s of drawOrder) {
    const leader = isLeader(s);
    // Stepped (step-after): a standing holds flat until the next match
    // settles it, so the line changes only where a result landed rather
    // than sloping between them as if it drifted.
    const path = s.points
      .map((p, j) => (j
        ? `H${x(p.idx).toFixed(1)}V${y(p.cum).toFixed(1)}`
        : `M${x(p.idx).toFixed(1)},${y(p.cum).toFixed(1)}`))
      .join('');
    // Soft under-glow for the leader only
    if (leader) {
      svg += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="6" stroke-opacity="0.14" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    svg += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="${leader ? 3 : 1.75}" stroke-opacity="${leader ? 1 : 0.72}" stroke-linejoin="round" stroke-linecap="round"${leader ? ' filter="url(#lb-glow)"' : ''}/>`;
    // Endpoints only — mid-series dots cluttered the old chart.
    const last = s.points[s.points.length - 1];
    const first = s.points[0];
    for (const p of [first, last]) {
      svg += `<circle cx="${x(p.idx).toFixed(1)}" cy="${y(p.cum).toFixed(1)}" r="${leader ? 4 : 3}" fill="${s.color}" stroke="#fff" stroke-width="1.6">` +
        `<title>${esc(s.label)} after ${esc(p.shortName)}: ${fmtSkill(p.cum)} vs coin flip</title></circle>`;
    }
  }

  // End labels as color pills, de-overlapped
  const ends = series
    .map((s) => ({
      ...s,
      leader: isLeader(s),
      idx: s.points[s.points.length - 1].idx,
      y: y(s.points[s.points.length - 1].cum),
      final: s.points[s.points.length - 1].cum,
    }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) {
    if (ends[i].y - ends[i - 1].y < 15) ends[i].y = ends[i - 1].y + 15;
  }
  for (const s of ends) {
    const label = s.label;
    // Approx monospaced width for bold 10.5px labels + padding / star.
    const tw = Math.ceil(label.length * 6.8 + (s.leader ? 28 : 18));
    const tx = W - padR + 6;
    const ty = Math.min(Math.max(s.y, padT + 8), H - padB - 8);
    svg += `<rect x="${tx}" y="${(ty - 9).toFixed(1)}" width="${tw}" height="18" rx="9" fill="${s.color}" opacity="${s.leader ? 1 : 0.9}"/>`;
    if (s.leader) {
      svg += `<text x="${tx + 9}" y="${ty.toFixed(1)}" dy="3.5" font-size="9" fill="#fff" opacity="0.95">★</text>`;
      svg += `<text x="${tx + 20}" y="${ty.toFixed(1)}" dy="3.5" font-size="10.5" font-weight="700" fill="#fff">${esc(label)}</text>`;
    } else {
      svg += `<text x="${tx + 9}" y="${ty.toFixed(1)}" dy="3.5" font-size="10.5" font-weight="700" fill="#fff">${esc(label)}</text>`;
    }
  }

  // X-axis match ticks (sparse, angled)
  koMatches.forEach((km, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    const xi = x(i);
    svg += `<line x1="${xi.toFixed(1)}" y1="${(padT + plotH).toFixed(1)}" x2="${xi.toFixed(1)}" y2="${(padT + plotH + 4).toFixed(1)}" stroke="rgba(23,46,22,0.18)" stroke-width="1"/>`;
    svg += `<text x="${xi.toFixed(1)}" y="${H - padB + 14}" text-anchor="end" font-size="9.5" font-weight="600" fill="var(--ink-3)" transform="rotate(-30 ${xi.toFixed(1)} ${H - padB + 14})">${esc(km.shortName)}</text>`;
  });

  svg += `<line class="lb-cross" x1="0" y1="${padT}" x2="0" y2="${H - padB}" stroke="var(--pitch)" stroke-width="1.25" stroke-dasharray="3 4" opacity="0"/>`;
  svg += '</svg>';
  return svg;
}

/* Hover/tap for the knockout chart: a crosshair snaps to the nearest
   match and the tooltip lists every model's running-average Brier as of
   that match, best first, so the reader can name each line. Mirrors the
   trophy chart's interaction. */
function attachLeaderboardHover(wrap, state) {
  const svg = wrap.querySelector('.lb-svg');
  const cross = svg && svg.querySelector('.lb-cross');
  const data = leaderboardSeries(state);
  if (!svg || !cross || !data) return;
  const { koMatches, n, series } = data;
  const { W, padL, padR } = LB_GEO;
  const plotW = W - padL - padR;
  const xAt = (i) => (n === 1 ? padL : padL + (i * plotW) / (n - 1));

  // Each model's running average carried forward to every column, so a
  // model missing a later match still reads at its last known value.
  const cols = koMatches.map((km, i) => {
    const rows = series.map((s) => {
      let cur = null;
      for (const p of s.points) { if (p.idx <= i) cur = p; else break; }
      return cur ? { label: s.label, color: s.color, v: cur.cum } : null;
    }).filter(Boolean).sort((a, b) => b.v - a.v);
    return { label: km.shortName, rows };
  });

  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  wrap.appendChild(tip);

  const indexFromClientX = (clientX) => {
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = 0;
    const sx = pt.matrixTransform(svg.getScreenCTM().inverse()).x;
    return Math.max(0, Math.min(n - 1, Math.round((sx - padL) / (plotW / (n - 1)))));
  };
  const show = (clientX) => {
    const i = indexFromClientX(clientX);
    const col = cols[i];
    const gx = xAt(i);
    cross.setAttribute('x1', gx); cross.setAttribute('x2', gx); cross.setAttribute('opacity', '1');
    tip.innerHTML = `<div class="tt-head">After ${esc(col.label)}</div>` +
      col.rows.map((r) => `<div class="tt-row"><span class="tt-sw" style="background:${r.color}"></span><span class="tt-team">${esc(r.label)}</span><b>${fmtSkill(r.v)}</b></div>`).join('');
    tip.hidden = false;
    const wrapRect = wrap.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    const colX = svgRect.left - wrapRect.left + (gx / W) * svgRect.width;
    let left = colX + 14;
    if (left + tip.offsetWidth > wrapRect.width - 4) left = colX - tip.offsetWidth - 14;
    tip.style.left = `${Math.max(4, Math.min(left, wrapRect.width - tip.offsetWidth - 4))}px`;
  };
  const hide = () => { tip.hidden = true; cross.setAttribute('opacity', '0'); };

  svg.style.touchAction = 'pan-y';
  svg.addEventListener('mousemove', (e) => show(e.clientX));
  svg.addEventListener('mouseleave', hide);
  svg.addEventListener('touchstart', (e) => { if (e.touches[0]) show(e.touches[0].clientX); }, { passive: true });
  svg.addEventListener('touchmove', (e) => { if (e.touches[0]) show(e.touches[0].clientX); }, { passive: true });
  if (lbDismiss) document.removeEventListener('pointerdown', lbDismiss);
  lbDismiss = (e) => { if (!wrap.contains(e.target)) hide(); };
  document.addEventListener('pointerdown', lbDismiss);
}

// The probability a forecast assigned to a team ADVANCING: a two-way
// forecast states it directly; a legacy three-way forecast (priced
// before the market switch) splits its draw mass, since a 90-minute
// draw is settled by a near-coin-flip shootout.
function advancerProb(pred, outcome) {
  if (!pred?.probs) return null;
  if (pred.probs.draw == null) return pred.probs[outcome] ?? 0;
  return (pred.probs[outcome] ?? 0) + (pred.probs.draw ?? 0) / 2;
}

/* The event where every model got it wrong: the finished knockout tie
   where not one model gave the team that actually advanced better than
   an even chance. Ranked by how low the field's average was on the
   advancer, so the single most collective miss surfaces. */
function collectiveMiss(state) {
  let best = null;
  for (const m of state.matches) {
    if (m.market !== 'advance' || m.status.state !== 'post') continue;
    const outcome = m.outcomes ? m.outcomes.advance : m.outcome;
    if (outcome !== 'home' && outcome !== 'away') continue;
    const eligible = displayEntrants(state)
      .map((e) => predOf(m, e))
      .filter((p) => p && p.eligible && p.probs);
    if (eligible.length < 5) continue;
    const aps = eligible.map((p) => advancerProb(p, outcome));
    if (!aps.every((v) => v < 0.5)) continue; // not a unanimous miss
    const avg = aps.reduce((s, v) => s + v, 0) / aps.length;
    if (!best || avg < best.avg) best = { m, outcome, avg, count: eligible.length };
  }
  if (!best) return null;
  const { m, outcome, avg, count } = best;
  return {
    id: m.id,
    advanced: m[outcome].name,
    favored: (outcome === 'home' ? m.away : m.home).name,
    avgPct: avg,
    count,
    score: `${m.home.score ?? 0}-${m.away.score ?? 0}`,
    stage: m.stage,
  };
}

/* The view toggle at the top of the page, in The Competitors section. */
function renderViewToggle(state) {
  const el = $('#view-toggle');
  if (el) el.innerHTML = viewToggleHtml(state);
}

// Chips follow the active view (labs by default) and click through to the
// competitor's performance detail; The Market's label keeps its sourcing
// modal, so a tap on the label opens sourcing, elsewhere opens detail.
function renderRoster(state) {
  const el = $('#roster');
  if (!el) return;
  el.innerHTML = displayEntrants(state).map((m) => {
    const crest = m.icon
      ? `<img class="crest" src="${esc(m.icon)}" alt="" onerror="this.style.visibility='hidden'">`
      : '';
    const title = m.id === MARKET_ID ? ` title="The betting market itself: ${MARKET_ATTRIBUTION}"` : '';
    const label = m.id === MARKET_ID ? marketLabel(`<span>${esc(m.label)}</span>`) : `<span>${esc(m.label)}</span>`;
    return `<button class="roster-chip" data-model="${esc(m.id)}"${title} aria-label="Open performance detail for ${esc(m.label)}">${crest}${label}</button>`;
  }).join('');
  for (const chip of el.querySelectorAll('[data-model]')) {
    chip.addEventListener('click', (e) => {
      // The market-tip inside the chip opens the sourcing modal instead
      // (its capture-phase handler runs first and stops propagation).
      if (e.target.closest('.market-tip')) return;
      location.hash = `p/${encodeURIComponent(chip.dataset.model)}`;
    });
  }
}

/* The knockout-form chart. It lives under the belief-shift chart in the
   trophy card — both read as "how the race moved", so they sit together
   rather than one being stranded above the standings table. */
function koFormCardHtml(state) {
  const koChart = leaderboardChart(state);
  if (!koChart) return '';
  return `<div class="lb-chart-card">
    <div class="lb-chart-head">
      <h3 class="lb-chart-title">Knockout form</h3>
      <p class="lb-chart-sub">Shrunken skill vs the coin flip · higher is sharper · ★ marks the current leader</p>
    </div>
    <div class="chart lb-chart-plot">${koChart}</div>
    <p class="fnote lb-chart-note">Each match scores (coin flip − Brier) ÷ coin flip, accumulated from the round of 32 with ten phantom coin-flip matches, so every line starts at 0% and early noise is damped. The dashed line is the coin flip itself. Hover any match for a full standing.</p>
  </div>`;
}

// Hero hook: the machines-vs-market standing in one live sentence, computed
// from the same leaderboard rows the table renders. Nothing new is fetched.
function renderHeroHook(state) {
  const el = document.getElementById('hero-hook');
  if (!el) return;
  const board = (state.leaderboard ?? []).filter((r) => r.scored > 0);
  const market = board.find((r) => r.model === MARKET_ID);
  if (!board.length || !market) { el.hidden = true; return; }
  const marketPos = board.indexOf(market);
  const machinesAhead = board.slice(0, marketPos).filter((r) => r.model !== MARKET_ID);
  const aiCount = (state.models ?? []).filter((m) => m.id !== MARKET_ID).length || 9;
  let line;
  if (machinesAhead.length) {
    const bestM = machinesAhead[0];
    line = `Right now, <b>${machinesAhead.length} of ${aiCount} machines</b> are beating the market — best: <b>${esc(bestM.label)}</b>, ${bestM.avgBrier.toFixed(3)} Brier vs the market's ${market.avgBrier.toFixed(3)}.`;
  } else {
    line = `Right now, <b>the market is beating every machine</b> — ${market.avgBrier.toFixed(3)} Brier vs the best AI's ${board.find((r) => r.model !== MARKET_ID)?.avgBrier?.toFixed(3) ?? '—'}.`;
  }
  const banks = state.bankroll ? Object.values(state.bankroll.models).filter((m) => m.betsPlaced > 0) : [];
  if (banks.length) {
    const top = banks.reduce((a, b) => (b.bankroll > a.bankroll ? b : a));
    const label = entrantById(state, top.model)?.label ?? top.model;
    line += ` <b>${esc(label)}</b> has turned 1,000 paper units into <b>${fmtUnits(top.bankroll)}</b>.`;
  }
  el.innerHTML = line;
  el.hidden = false;
}

// ------------------------------------------------------------ bankroll ----
// The Bankroll: paper-trading ledger computed server-side (lib/bankroll.js).
// Virtual units only, never money.

const BANK_TIP = '1,000 paper units at tournament start. Quarter-Kelly bets on its biggest edge vs the TxODDS StablePrice line, only when edge > 2%. Settled by the same Merkle-verified scores as the Brier board. Virtual units — no real money.';
const fmtUnits = (n) => Math.round(n).toLocaleString('en-US');

function bankChip(state, modelId) {
  const b = state.bankroll?.models?.[modelId];
  if (!b || !b.betsPlaced) return '';
  const up = b.bankroll >= (state.bankroll.startingBankroll ?? 1000);
  return ` · <span class="lb-bank ${up ? 'lb-bank-up' : 'lb-bank-down'}" title="${esc(BANK_TIP)}">${fmtUnits(b.bankroll)}u</span>`;
}

// Tiny inline SVG polyline of a bankroll series (paper units over matches).
function bankSpark(series, starting = 1000) {
  if (!series || series.length < 2) return '';
  const vals = [starting, ...series.map((p) => p.after)];
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const W = 96, H = 26, P = 2;
  const pts = vals.map((v, i) => {
    const x = P + (i / (vals.length - 1)) * (W - 2 * P);
    const y = H - P - ((v - min) / span) * (H - 2 * P);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  // Baseline at the starting bankroll, when it sits inside the range.
  const by = H - P - ((starting - min) / span) * (H - 2 * P);
  const up = vals[vals.length - 1] >= starting;
  return `<svg class="bank-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
    ${starting >= min && starting <= max ? `<line x1="0" y1="${by.toFixed(1)}" x2="${W}" y2="${by.toFixed(1)}" class="bank-base"/>` : ''}
    <polyline points="${pts}" class="${up ? 'bank-line-up' : 'bank-line-down'}"/>
  </svg>`;
}

function renderBankroll(state) {
  const section = document.getElementById('bankroll-section');
  const el = document.getElementById('bankroll');
  if (!section || !el) return;
  const bk = state.bankroll;
  const rows = bk ? Object.values(bk.models).filter((m) => m.betsPlaced > 0 || m.noBets > 0) : [];
  if (!rows.length) { section.hidden = true; return; }
  section.hidden = false;
  rows.sort((a, b) => b.bankroll - a.bankroll);
  const start = bk.startingBankroll ?? 1000;
  el.innerHTML = `<div class="bank-wrap">${rows.map((r, i) => {
    const meta = entrantById(state, r.model);
    const hit = r.betsPlaced ? `${r.wins}/${r.betsPlaced}` : '—';
    const up = r.bankroll >= start;
    return `<div class="bank-row${i === 0 ? ' leader' : ''}" data-model="${esc(r.model)}" role="button" tabindex="0" aria-label="Open bet ledger for ${esc(meta?.label ?? r.model)}">
      <div class="bank-rank">${i + 1}</div>
      <div class="lb-id">${meta?.icon ? `<img class="crest" src="${esc(meta.icon)}" alt="" onerror="this.style.visibility='hidden'">` : ''}
        <span class="bank-name">${esc(meta?.label ?? r.model)}</span></div>
      ${bankSpark(r.series, start)}
      <div class="bank-cells">
        <span class="bank-units ${up ? 'lb-bank-up' : 'lb-bank-down'}">${fmtUnits(r.bankroll)}</span>
        <span class="bank-meta">${r.betsPlaced} bets · hit ${hit}${r.noBets ? ` · sat out ${r.noBets}` : ''}</span>
        <span class="bank-meta">${r.biggestWin ? `best +${fmtUnits(r.biggestWin.pnl)} (${esc(r.biggestWin.shortName)})` : ''}${r.biggestWin && r.biggestLoss ? ' · ' : ''}${r.biggestLoss ? `worst −${fmtUnits(-r.biggestLoss.pnl)} (${esc(r.biggestLoss.shortName)})` : ''}</span>
      </div>
    </div>`;
  }).join('')}</div>
  <p class="footnote">Paper trading with <b>virtual units</b> — no real money anywhere. Each model starts with 1,000 units and places at most one bet per match: quarter-Kelly on its biggest edge against the locked TxODDS StablePrice line, only when the edge clears 2%; otherwise it sits out. Group-stage bets settle at the raw bookmaker line (vig included); knockout bets settle at fair (de-vigged) odds, since no single "advances" price is quoted. Settled by the same Merkle-verified scores as the leaderboard. The Market doesn't get a bankroll: it can't bet against itself. Tap a row for the full bet ledger.</p>`;
  for (const row of el.querySelectorAll('[data-model]')) {
    const open = () => { location.hash = `p/${encodeURIComponent(row.dataset.model)}`; };
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  }
}

// The bet ledger for one model, rendered inside the model detail panel.
function betLedgerHtml(state, modelId) {
  const bets = state.bankroll?.bets?.filter((b) => b.modelId === modelId);
  if (!bets?.length) return '';
  const rows = [...bets].reverse().map((b) => {
    if (b.result === 'no_bet') {
      return `<tr class="bet-nobet"><td>${esc(b.shortName)}</td><td colspan="3">no bet — no edge over 2%</td><td class="bet-num">${fmtUnits(b.bankrollAfter)}</td></tr>`;
    }
    const sideName = b.outcome === 'draw' ? 'Draw' : (b.outcome === 'home' ? esc(b.shortName.split(' @ ')[1] ?? 'home') : esc(b.shortName.split(' @ ')[0] ?? 'away'));
    return `<tr class="bet-${b.result}">
      <td>${esc(b.shortName)}</td>
      <td>${sideName} @ ${b.odds.toFixed(2)}${b.oddsType === 'fair' ? '<span class="bet-fair" title="No raw advances price is quoted; settled at fair (de-vigged) odds">f</span>' : ''}</td>
      <td class="bet-num">${b.stake.toFixed(1)}</td>
      <td class="bet-num bet-pnl">${b.pnl >= 0 ? '+' : '−'}${Math.abs(b.pnl).toFixed(1)}</td>
      <td class="bet-num">${fmtUnits(b.bankrollAfter)}</td>
    </tr>`;
  }).join('');
  return `<h3>Bet ledger <span class="bet-paper">paper units</span></h3>
  <p class="fnote">Quarter-Kelly vs the locked TxODDS line, newest first. Sitting out is a decision too, so no-bets are shown. <b>f</b> marks knockout bets settled at fair (de-vigged) odds.</p>
  <div class="bet-scroll"><table class="bet-table">
    <thead><tr><th>Match</th><th>Backed</th><th class="bet-num">Stake</th><th class="bet-num">P&amp;L</th><th class="bet-num">Bank</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function renderLeaderboard(state) {
  const el = $('#leaderboard');
  const board = boardOf(state);
  const scored = board.filter((r) => r.scored > 0);
  if (!scored.length) {
    el.classList.remove('skeleton-block');
    el.innerHTML = `<div class="empty">No scored matches yet. The table fills in as soon as a match with locked forecasts finishes.</div>`;
    return;
  }
  el.classList.remove('skeleton-block');
  const miss = collectiveMiss(state);
  el.innerHTML = `${viewToggleHtml(state)}${miss ? `<button class="lb-miss" data-go="m/${esc(miss.id)}" aria-label="Open ${esc(miss.advanced)} versus ${esc(miss.favored)} detail">
    <span class="lb-miss-tag">Nobody saw it coming</span>
    <span class="lb-miss-body">All ${miss.count} models backed <b>${esc(miss.favored)}</b>, but <b>${esc(miss.advanced)}</b> went through ${esc(miss.score)} in the ${esc(miss.stage)}. The field gave ${esc(miss.advanced)} an average of just <b>${pct(miss.avgPct)}%</b> to advance.</span>
  </button>` : ''}<div class="lb-wrap">${(() => {
    let rank = 0;
    return board.map((r) => {
      const live = r.scored > 0;
      if (live) rank += 1;
      const crown = live && rank === 1;
      const trend = trendOf(r.perMatch);
      const trendBadge = trend === 'up'
        ? '<span class="lb-trend lb-trend-up" title="Scored better in its second half of matches than its first">▲ improving</span>'
        : trend === 'down'
        ? '<span class="lb-trend lb-trend-down" title="Scored worse in its second half of matches than its first">▼ cooling</span>'
        : '';
      const icon = entrantById(state, r.model)?.icon ?? r.icon;
      const skillTip = 'Skill vs the coin flip: (baseline − Brier) ÷ baseline per match, averaged. 0% matches guessing, +100% is perfection. Ranking uses the shrunken version — ten phantom coin-flip matches — so a tiny sample starts neutral instead of leaping the table.';
      return `<div class="lb-row${crown ? ' leader' : ''}" data-model="${esc(r.model)}" role="button" tabindex="0" title="Open ${esc(r.label)}: performance over time" aria-label="Open performance detail for ${esc(r.label)}">
        <div class="lb-rank">${live ? rank : '-'}</div>
        <div class="lb-id">${
          icon
            ? `<img class="crest crest-lg" src="${esc(icon)}" alt="" onerror="this.style.visibility='hidden'">`
            : ''
        }<div><span class="lb-name">${r.model === MARKET_ID ? marketLabel(esc(r.label)) : esc(r.label)}</span><span class="lb-slug">${r.model === MARKET_ID ? MARKET_ATTRIBUTION : esc(memberChain(r) ?? r.model)}</span></div></div>
        ${sparkline(r.perMatch) ? `<div class="lb-spark">${sparkline(r.perMatch)}${trendBadge}</div>` : '<div class="lb-spark"></div>'}
        <div class="lb-score">
          <div class="lb-brier" title="Average Brier score — lower is better">${r.avgBrier == null ? '-' : r.avgBrier.toFixed(3)}</div>
          <div class="lb-meta" title="${esc(skillTip)}">${r.avgSkill == null ? '' : `<b>${fmtSkill(r.avgSkill)}</b> vs coin flip · `}${r.predicted} forecast${r.predicted === 1 ? '' : 's'}${bankChip(state, r.model)}</div>
        </div>
      </div>`;
    }).join('');
  })()}</div><p class="footnote">Scored over the <b>knockout phase and beyond</b> — the group stage is played out before the field narrows and doesn't count toward the cup. Ranked by <b>shrunken skill vs the coin flip</b>: each match scores (baseline − Brier) ÷ baseline, and every entrant carries ten phantom coin-flip matches. A newcomer starts neutral and earns rank as real matches accumulate — a hot two-match sample can't leapfrog a long record. Average Brier stays the headline number.</p>`;
  wireBrierTips(el);
  for (const row of el.querySelectorAll('[data-model]')) {
    const open = () => { location.hash = `p/${encodeURIComponent(row.dataset.model)}`; };
    row.addEventListener('click', (e) => {
      // Don't navigate into the model when the reader is opening the tip.
      if (e.target.closest('.brier-tip')) return;
      open();
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  }
  const missBtn = el.querySelector('.lb-miss');
  if (missBtn) missBtn.addEventListener('click', () => { location.hash = missBtn.dataset.go; });
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

// The match minute a timeline point sits at, for the time axis. Kickoff is
// 0; a clock like 90'+3' is 93; half-time/extra-time/shootout map to the
// stage they belong to; the result has no clock and is placed by the caller.
function pointMinute(label) {
  const s = String(label);
  if (/^lock/i.test(s)) return 0;
  const m = s.match(/(\d+)(?:'?\+(\d+))?/);
  if (m) return Math.min(135, +m[1] + (m[2] ? +m[2] : 0));
  if (/half|ht/i.test(s)) return 45;
  if (/shoot|pen/i.test(s)) return 122;
  if (/et|overtime|extra/i.test(s)) return 105;
  return null;
}

/* Horizontal time chart: match minute on the x-axis, the consensus split as
   stacked bands that fill 100% (the knockout market's two teams, or
   home/draw/away in the group stage). The boundary between bands shifts as
   the forecast moves through the game; goals are marked where the score
   changed. It reads for momentum at a glance; the bar rows below carry the
   exact per-moment numbers. */
function timelineChart(match, points, market) {
  const outs = MARKET_OUTCOMES[market];
  const fill = { home: 'var(--home)', draw: 'var(--draw)', away: 'var(--away)' };
  const W = 680, H = 208, padL = 12, padR = 96, padT = 24, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = points.length;
  const subOf = (p) => p.sub || '0:0';

  // Minute per point, made strictly increasing so points never collide; the
  // result (no clock) lands just past the last timed point.
  const mins = points.map((p) => (p.final ? null : pointMinute(p.label)));
  let lastTimed = 0;
  for (const m of mins) if (m != null) lastTimed = Math.max(lastTimed, m);
  for (let i = 0; i < n; i++) if (mins[i] == null) mins[i] = lastTimed + 4;
  for (let i = 1; i < n; i++) if (mins[i] <= mins[i - 1]) mins[i] = mins[i - 1] + 1;
  const maxMin = mins[n - 1] || 90;
  const x = (mi) => padL + (mi / maxMin) * plotW;
  const y = (v) => padT + (1 - v) * plotH;

  const bottoms = points.map((p) => {
    let cum = 0; const b = {};
    for (const o of outs) { b[o] = cum; cum += (p.probs[o] ?? 0); }
    return b;
  });

  let svg = `<svg class="tl-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Consensus forecast over match time, ${esc(match.home.name)} versus ${esc(match.away.name)}">`;
  for (const o of outs) {
    const top = points.map((p, i) => `${x(mins[i]).toFixed(1)},${y(bottoms[i][o] + (p.probs[o] ?? 0)).toFixed(1)}`);
    const bot = points.map((p, i) => `${x(mins[i]).toFixed(1)},${y(bottoms[i][o]).toFixed(1)}`).reverse();
    svg += `<polygon points="${[...top, ...bot].join(' ')}" fill="${fill[o]}" opacity="0.9"/>`;
  }
  for (let k = 0; k < outs.length - 1; k++) {
    const o = outs[k];
    const edge = points.map((p, i) => `${x(mins[i]).toFixed(1)},${y(bottoms[i][o] + (p.probs[o] ?? 0)).toFixed(1)}`).join(' ');
    svg += `<polyline points="${edge}" fill="none" stroke="var(--surface)" stroke-width="1.3" stroke-linejoin="round"/>`;
  }

  // Goal markers: a dashed line and the new scoreline wherever it changed.
  const xTicks = [{ m: 0, t: "0'" }];
  for (let i = 1; i < n; i++) {
    if (subOf(points[i]) === subOf(points[i - 1])) continue;
    const gx = x(mins[i]);
    svg += `<line x1="${gx.toFixed(1)}" y1="${padT}" x2="${gx.toFixed(1)}" y2="${H - padB}" stroke="var(--ink)" stroke-width="1" stroke-dasharray="2 3" opacity="0.45"/>`;
    svg += `<text x="${gx.toFixed(1)}" y="${(padT - 7).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="var(--ink)">${esc(subOf(points[i]).replace(':', '-'))}</text>`;
    if (!points[i].final) xTicks.push({ m: mins[i], t: `${Math.round(mins[i])}'` });
  }
  xTicks.push({ m: maxMin, t: market === 'advance' ? 'FT' : 'FT' });

  // Right-edge direct labels: each outcome's final share, nudged apart.
  const last = points[n - 1];
  let labels = outs.map((o) => ({ o, v: last.probs[o] ?? 0, y: y(bottoms[n - 1][o] + (last.probs[o] ?? 0) / 2) }))
    .filter((l) => l.v >= 0.06).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
  for (const l of labels) {
    const name = l.o === 'draw' ? 'Draw' : esc(match[l.o].name);
    const ty = Math.min(Math.max(l.y, padT + 4), H - padB);
    svg += `<text x="${W - padR + 7}" y="${ty.toFixed(1)}" dy="3.5" font-size="11" fill="var(--ink-2)"><tspan font-weight="700" fill="var(--ink)">${name}</tspan> ${pct(l.v)}%</text>`;
  }

  for (const t of xTicks) {
    svg += `<text x="${x(t.m).toFixed(1)}" y="${H - 9}" text-anchor="middle" font-size="9.5" fill="var(--ink-3)">${esc(t.t)}</text>`;
  }
  svg += '</svg>';
  return svg;
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
  // Resolve against the current view's board first, then the other one,
  // so both lab ids (#p/anthropic) and entrant ids (#p/anthropic%2F...)
  // open regardless of the active view.
  let rows = boardOf(state);
  let row = rows.find((r) => r.model === modelId);
  for (const other of [state.leaderboard, state.leaderboardByLab]) {
    if (!row && other) { rows = other; row = other.find((r) => r.model === modelId); }
  }
  const meta = (row ? { id: row.model, label: row.label, icon: row.icon ?? entrantById(state, modelId)?.icon } : entrantById(state, modelId));
  if (!row || !meta) { el.innerHTML = ''; return; }
  const rankedRows = rows.filter((r) => r.scored > 0);
  const rank = rankedRows.findIndex((r) => r.model === modelId) + 1;

  let cum = 0;
  const points = row.perMatch.map((p, i) => {
    cum += p.brier;
    return { ...p, cum: cum / (i + 1) };
  });
  // Field: mean per-match Brier across all models, accumulated in the
  // same match order this model was scored in.
  const fieldByMatch = {};
  for (const r of rows)
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
          <div class="detail-title">${row.model === MARKET_ID ? marketLabel(esc(row.label)) : esc(row.label)}</div>
          <div class="fnote">${row.model === MARKET_ID ? MARKET_ATTRIBUTION : esc(memberChain(row) ?? row.model)}${rank ? ` · rank ${rank} of ${rankedRows.length}` : ''}</div>
        </div>
      </div>
      <button class="detail-close" data-close aria-label="Close">✕</button>
    </div>
    <div class="stat-row">
      <div class="stat"><div class="stat-v">${row.avgBrier == null ? '-' : row.avgBrier.toFixed(3)}</div><div class="stat-l">avg ${brierTip('Brier', { compact: true })}</div></div>
      <div class="stat"><div class="stat-v">${fmtSkill(row.avgSkill)}</div><div class="stat-l" title="Average of (coin flip − Brier) ÷ coin flip per match. 0% matches guessing; ranking shrinks this toward zero with ten phantom coin-flip matches.">skill vs coin flip</div></div>
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
    ${betLedgerHtml(state, modelId)}
  </section>`;
  document.body.style.overflow = 'hidden';
  wireBrierTips(el);
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
  const isDone = match.status.state === 'post';

  // Attach each model's Brier so finished games can rank best-first and
  // show the score; ranking falls back to confidence before a result.
  const detailPreds = {};
  let bestBrier = null;
  for (const mod of displayEntrants(state)) {
    const p = predOf(match, mod);
    if (!p) continue;
    const copy = { ...p };
    const b = predBrier(p, match);
    if (b != null) { copy.brier = b; bestBrier = bestBrier == null ? b : Math.min(bestBrier, b); }
    detailPreds[mod.id] = copy;
  }

  // A plain-language read of where the models stand: who they favour, how
  // strongly, and how far apart they are — the heart of a follow-along page.
  const consensus = consensusOf(detailPreds, market);
  let pickHtml = '';
  if (consensus) {
    const outs = MARKET_OUTCOMES[market];
    const fav = outs.reduce((a, o) => ((consensus[o] ?? 0) > (consensus[a] ?? 0) ? o : a), outs[0]);
    const favName = fav === 'draw' ? 'a draw' : esc(match[fav].name);
    const verb = market === 'advance' ? 'to advance' : fav === 'draw' ? '' : 'to win';
    const modelProbs = Object.values(detailPreds)
      .filter((p) => p.probs && predMarket(p) === market)
      .map((p) => p.probs[fav] ?? 0);
    const lo = modelProbs.length ? pct(Math.min(...modelProbs)) : null;
    const hi = modelProbs.length ? pct(Math.max(...modelProbs)) : null;
    const spread = lo != null && hi > lo ? ` <span class="gp-range">(models range ${lo}–${hi}%)</span>` : '';
    const lead = isDone ? 'The models favoured' : isLive ? 'The models now favour' : 'The models favour';
    pickHtml = `<div class="game-pick">${lead} <b>${favName}</b> ${verb} — <b>${pct(consensus[fav])}%</b> consensus${spread}</div>`;
  }

  const lockedRows = Object.keys(match.predictions).length
    ? rankModels(displayEntrants(state), detailPreds, match, market)
        .map((mod) => forecastRow(mod, detailPreds[mod.id], match, bestBrier)).join('')
    : '<div class="fnote">No locked forecasts for this match.</div>';
  const rankNote = isDone
    ? 'Ranked best call first — lowest Brier is the sharpest forecast.'
    : 'Ranked by confidence in the favourite, most sure first.';

  el.innerHTML = `<div class="detail-scrim" data-close></div>
  <section class="detail-panel game-panel" role="dialog" aria-modal="true" aria-label="Match detail">
    <div class="detail-head">
      <div class="game-head">
        <div class="game-teams">
          <img class="flag" src="${esc(match.home.logo)}" alt="" onerror="this.style.visibility='hidden'">
          <span class="game-team">${esc(match.home.name)}</span>
          <span class="game-score${isLive ? ' live' : ''}">${
            match.status.state === 'pre' ? 'vs' : `${match.home.score ?? 0} : ${match.away.score ?? 0}`
          }</span>
          <span class="game-team game-team-a">${esc(match.away.name)}</span>
          <img class="flag" src="${esc(match.away.logo)}" alt="" onerror="this.style.visibility='hidden'">
        </div>
        <div class="game-sub">${isLive ? '<span class="game-livedot" aria-hidden="true"></span>' : ''}${
          esc(match.status.state === 'pre' ? fmtKickoff.format(new Date(match.kickoff)) : match.status.detail)
        } · ${esc(match.stage)}</div>
      </div>
      <div class="detail-actions">
        <button class="detail-share" aria-label="Share this match">Share</button>
        <button class="detail-close" data-close aria-label="Close">✕</button>
      </div>
    </div>
    ${pickHtml}
    ${points.length > 1 ? `<h3>How the forecast moved</h3>
    <div class="chart tl-chart">${timelineChart(match, points, market)}</div>
    ${timelineRows(match, points, market)}
    <p class="fnote">${market === 'advance' ? 'Knockout market: probability of advancing, extra time and penalties included. ' : ''}Consensus at each moment across the match clock: the locked pre-kickoff forecast is the only one that scores; in-play points are fresh forecasts after every goal, card, and period change; the last point is the actual result.${
      ''
    }</p>` :
    (isLive ? '<p class="fnote">In-play updates land here after every goal, red card, and period change, plus every ~10 quiet minutes.</p>' : '')}
    <h3>${isDone ? 'How each model called it' : 'Model predictions'}</h3>
    <div class="forecasts">${lockedRows}</div>
    <p class="fnote">${rankNote}</p>
  </section>`;
  document.body.style.overflow = 'hidden';
  for (const c of el.querySelectorAll('[data-close]')) {
    c.addEventListener('click', closeDetail);
  }
  const shareBtn = el.querySelector('.detail-share');
  if (shareBtn) shareBtn.addEventListener('click', () => shareMatch(match));
}

window.addEventListener('hashchange', () => { if (lastState) renderDetail(lastState); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (location.hash.startsWith('#m/') || location.hash.startsWith('#p/'))) closeDetail();
});

/* Trophy race: consensus tournament-winner probability per team, over
   time, drawn as normalized stacked bars. Each collection round is a
   column that fills the full height (the field's probability sums to
   100%), so the chart shows how belief consolidates around the favorites
   as rounds are played. The ever-contenders each get a color band; the
   rest of the field pools into a muted band on top. Colors deliberately
   avoid green (the page chrome is pitch-green) and are CVD-validated. */
const TROPHY_COLORS = [
  '#2563eb', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777',
  '#a3550a', '#4338ca', '#ea580c', '#0369a1', '#9f1239', '#c026d3',
  '#ca8a04', '#be123c', '#6d28d9',
];
const TROPHY_FIELD = '#c7c6bd';
const FIELD_KEY = '__others__';
const FIELD_LABEL = 'Others';

function outrightConsensus(entry) {
  const lists = Object.values(entry.models).filter((m) => m.probs);
  if (!lists.length) return null;
  const c = {};
  for (const t of entry.teams) c[t] = lists.reduce((s, m) => s + (m.probs[t] ?? 0), 0) / lists.length;
  return c;
}

const fmtTrophyDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const fmtTrophyFull = new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});
// A round's tooltip header: the retro anchor's own name, else its date+time.
const trophyRoundLabel = (h) => h.label ?? fmtTrophyFull.format(new Date(h.at));
// One geometry, shared by the renderer and the hover handler so the
// crosshair lands exactly on the columns the SVG drew. The chart runs
// the full card width; the right pad holds the direct labels.
// padL holds the percentage scale, padB the round dates, padR the direct
// team labels. Breathing room on every side: the plot is dense enough
// without the ink running to the card edge.
const TROPHY_GEO = { W: 1160, H: 400, padL: 44, padR: 132, padT: 18, padB: 34 };
let trophyDismiss = null; // the current dismiss-on-outside-tap listener

/* Rounds are spaced by index, not elapsed time: the two retro anchors sit
   weeks before the live rounds, and a real-time x-axis would crush every
   recent point into a sliver. Each round is a discrete stacked bar filling
   the full height (the field sums to 100%); segments stack bottom-to-top
   in `contenders` order (strongest at the baseline); everything else
   pools into the Field. */
function trophyChart(history, contenders) {
  const n = history.length;
  const { W, H, padL, padR, padT, padB } = TROPHY_GEO;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const band = plotW / n;
  const barW = band; // columns butt together: no gap between rounds
  const colX = (i) => padL + i * band;
  const y = (v) => padT + (1 - v) * plotH; // v is a cumulative share in [0,1]

  const bands = contenders.map((t, i) => ({ key: t, label: t, color: TROPHY_COLORS[i % TROPHY_COLORS.length] }));
  bands.push({ key: FIELD_KEY, label: FIELD_LABEL, color: TROPHY_FIELD, muted: true });

  const valAt = (key, i) => {
    const c = history[i].consensus;
    if (key === FIELD_KEY) return Math.max(0, 1 - contenders.reduce((s, t) => s + (c[t] ?? 0), 0));
    return c[key] ?? 0;
  };
  // Cumulative bottom offset of each band at each round.
  const bottoms = history.map((_, i) => {
    let cum = 0;
    return bands.map((b) => { const bot = cum; cum += valAt(b.key, i); return bot; });
  });

  let svg = `<svg class="trophy-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Consensus probability of winning the tournament, per team, as a share of the field over time">`;

  // The whole plot is clipped to one rounded rect so the outer corners
  // stay soft while neighbouring columns butt together. Segments carry no
  // stroke - a stroke would paint a surface line down the shared vertical
  // edges too - so the gap between stacked values is drawn afterwards as
  // horizontal separators only.
  // Percentage scale down the left edge, with a tick reaching to the plot.
  // The gridlines stop at the plot edge rather than crossing it — over
  // saturated stacked bars they would only add noise.
  for (const q of [0, 0.25, 0.5, 0.75, 1]) {
    const ty = y(q);
    svg += `<line x1="${padL - 6}" y1="${ty.toFixed(1)}" x2="${padL}" y2="${ty.toFixed(1)}" stroke="rgba(23,46,22,0.18)" stroke-width="1"/>`;
    svg += `<text x="${padL - 11}" y="${ty.toFixed(1)}" dy="3.5" text-anchor="end" font-size="10.5" font-weight="600" fill="var(--ink-3)">${Math.round(q * 100)}%</text>`;
  }

  svg += `<clipPath id="tplot"><rect x="${padL}" y="${padT}" width="${plotW.toFixed(1)}" height="${plotH}" rx="6"/></clipPath>`;
  svg += '<g clip-path="url(#tplot)">';
  history.forEach((_, i) => {
    const cx = colX(i).toFixed(1);
    bands.forEach((bandDef, bi) => {
      const v = valAt(bandDef.key, i);
      if (v <= 0) return;
      const yTop = y(bottoms[i][bi] + v);
      const h = v * plotH;
      svg += `<rect x="${cx}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${bandDef.color}" opacity="${bandDef.muted ? 0.5 : 0.92}"/>`;
    });
  });
  history.forEach((_, i) => {
    const cx = colX(i);
    bands.forEach((bandDef, bi) => {
      if (bi === bands.length - 1) return;
      const v = valAt(bandDef.key, i);
      if (v <= 0) return;
      const yTop = y(bottoms[i][bi] + v);
      svg += `<line x1="${cx.toFixed(1)}" y1="${yTop.toFixed(1)}" x2="${(cx + barW).toFixed(1)}" y2="${yTop.toFixed(1)}" stroke="var(--surface)" stroke-width="2"/>`;
    });
  });
  // A hairline between neighbouring rounds: enough to read the columns as
  // discrete without reopening the gap.
  for (let i = 1; i < n; i++) {
    const cx = colX(i).toFixed(1);
    svg += `<line x1="${cx}" y1="${padT}" x2="${cx}" y2="${padT + plotH}" stroke="var(--surface)" stroke-width="1" opacity="0.85"/>`;
  }
  svg += '</g>';
  // A soft frame so the plot reads as one object once it has padding
  // around it, matching the knockout-form chart's plot border.
  svg += `<rect x="${padL}" y="${padT}" width="${plotW.toFixed(1)}" height="${plotH}" rx="6" fill="none" stroke="rgba(23,46,22,0.08)" stroke-width="1"/>`;

  // Direct labels at the right edge: a color swatch plus the team and its
  // current share, vertically centred on each band and nudged apart so
  // neighbours never overlap. Eliminated bands (0% now) carry no label.
  const labels = bands
    .map((band, bi) => ({
      band,
      v: valAt(band.key, n - 1),
      y: y(bottoms[n - 1][bi] + valAt(band.key, n - 1) / 2),
    }))
    .filter((L) => L.v >= 0.012)
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
  }
  const lx = W - padR + 8;
  for (const L of labels) {
    const ty = Math.min(Math.max(L.y, padT + 6), H - padB - 2);
    svg += `<rect x="${lx}" y="${(ty - 4.5).toFixed(1)}" width="9" height="9" rx="2" fill="${L.band.color}"${L.band.muted ? ' opacity="0.6"' : ''}/>`;
    svg += `<text x="${lx + 14}" y="${ty.toFixed(1)}" dy="3.5" font-size="11.5" fill="var(--ink-2)">` +
      `<tspan font-weight="700" fill="${L.band.muted ? 'var(--ink-3)' : 'var(--ink)'}">${esc(L.band.label)}</tspan> ${pct(L.v)}%</text>`;
  }

  // X axis: a short date under each column, shown only when the day changes
  // so a cluster of same-day rounds reads as one clean label. A minimum
  // pitch between labels keeps neighbouring dates from colliding when two
  // different days sit in adjacent columns.
  const LABEL_PITCH = 44;
  let lastDay = '';
  let lastLabelX = -Infinity;
  history.forEach((h, i) => {
    const d = fmtTrophyDay.format(new Date(h.at));
    if (d === lastDay) return;
    lastDay = d;
    const tx = colX(i) + barW / 2;
    if (tx - lastLabelX < LABEL_PITCH) return;
    lastLabelX = tx;
    svg += `<text x="${tx.toFixed(1)}" y="${padT + plotH + 17}" text-anchor="middle" font-size="10.5" fill="var(--ink-3)">${esc(d)}</text>`;
  });
  // Crosshair the hover handler moves and reveals; hidden until then.
  svg += `<line class="trophy-cross" x1="0" y1="${padT}" x2="0" y2="${H - padB}" stroke="var(--ink)" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>`;
  svg += '</svg>';
  return svg;
}

/* Hover/tap interaction for the stacked bars: a crosshair snaps to the
   nearest round and an HTML tooltip lists every team's share that round,
   country names spelled out. Pointer events cover mouse and touch alike;
   the SVG keeps vertical page scroll (touch-action: pan-y) so a tap reads
   the column while a vertical swipe still scrolls. */
function attachTrophyHover(wrap, history, contenders) {
  const svg = wrap.querySelector('.trophy-svg');
  const cross = svg && svg.querySelector('.trophy-cross');
  const n = history.length;
  if (!svg || !cross || n < 2) return;
  const { W, padL, padR } = TROPHY_GEO;
  const plotW = W - padL - padR;
  const band = plotW / n;
  const xAt = (i) => padL + i * band + band / 2; // column centre

  const cols = history.map((h) => {
    const field = Math.max(0, 1 - contenders.reduce((s, t) => s + (h.consensus[t] ?? 0), 0));
    const rows = [
      ...contenders.map((t, k) => ({ team: t, color: TROPHY_COLORS[k % TROPHY_COLORS.length], v: h.consensus[t] ?? 0 })),
      { team: FIELD_LABEL, color: TROPHY_FIELD, v: field, muted: true },
    ].filter((r) => r.v >= 0.005).sort((a, b) => b.v - a.v);
    return { label: trophyRoundLabel(h), rows };
  });

  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  wrap.appendChild(tip);

  const indexFromClientX = (clientX) => {
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = 0;
    const sx = pt.matrixTransform(svg.getScreenCTM().inverse()).x;
    return Math.max(0, Math.min(n - 1, Math.floor((sx - padL) / band)));
  };

  const show = (clientX) => {
    const i = indexFromClientX(clientX);
    const col = cols[i];
    const gx = xAt(i);
    cross.setAttribute('x1', gx);
    cross.setAttribute('x2', gx);
    cross.setAttribute('opacity', '1');
    tip.innerHTML = `<div class="tt-head">${esc(col.label)}</div>` +
      col.rows.map((r) => `<div class="tt-row"><span class="tt-sw" style="background:${r.color}${r.muted ? ';opacity:.6' : ''}"></span><span class="tt-team">${esc(r.team)}</span><b>${pct(r.v)}%</b></div>`).join('');
    tip.hidden = false;
    const wrapRect = wrap.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    const colX = svgRect.left - wrapRect.left + (gx / W) * svgRect.width;
    let left = colX + 14;
    if (left + tip.offsetWidth > wrapRect.width - 4) left = colX - tip.offsetWidth - 14;
    tip.style.left = `${Math.max(4, Math.min(left, wrapRect.width - tip.offsetWidth - 4))}px`;
  };
  const hide = () => { tip.hidden = true; cross.setAttribute('opacity', '0'); };

  // Vertical page scroll still works over the chart (pan-y); horizontal
  // drags and taps read a column. Touch handlers are explicit because
  // synthesized pointer events from touch are unreliable across engines.
  svg.style.touchAction = 'pan-y';
  svg.addEventListener('mousemove', (e) => show(e.clientX));
  svg.addEventListener('mouseleave', hide);
  svg.addEventListener('touchstart', (e) => { if (e.touches[0]) show(e.touches[0].clientX); }, { passive: true });
  svg.addEventListener('touchmove', (e) => { if (e.touches[0]) show(e.touches[0].clientX); }, { passive: true });

  // A single dismiss-on-outside-tap listener, replaced (not stacked) each
  // time the trophy card re-renders on a poll.
  if (trophyDismiss) document.removeEventListener('pointerdown', trophyDismiss);
  trophyDismiss = (e) => { if (!wrap.contains(e.target)) hide(); };
  document.addEventListener('pointerdown', trophyDismiss);
}

/* Knockout stages in tournament order. 3rd-place is omitted from the
   championship bracket (it sits beside the final as a footnote). */
const BRACKET_STAGES = [
  { key: 'round of 32', short: 'R32', full: 'Round of 32' },
  { key: 'round of 16', short: 'R16', full: 'Round of 16' },
  { key: 'quarterfinals', short: 'QF', full: 'Quarter-finals' },
  { key: 'semifinals', short: 'SF', full: 'Semi-finals' },
  { key: 'final', short: 'Final', full: 'Final' },
];

function winnerSide(match) {
  if (match.status?.state !== 'post') return null;
  // Prefer the advance market (who went through, incl. pens); fall back.
  return match.outcomes?.advance ?? match.outcome ?? null;
}

function winnerName(match) {
  const side = winnerSide(match);
  if (side === 'home' || side === 'away') return match[side].name;
  return null;
}

function shortTeam(name) {
  // Compact labels for the bracket grid; full name stays in title.
  if (!name) return 'TBD';
  if (name.length <= 11) return name;
  const parts = name.split(/[\s-]+/);
  if (parts.length >= 2) return parts.map((p) => p.slice(0, 3)).join(' ').slice(0, 11);
  return name.slice(0, 10);
}

/* Order an earlier round so its pairs feed the next round top-to-bottom.
   Winners of consecutive feeder matches become the two sides of one
   later match; that gives the visual "fork" of a real bracket. */
function orderFeeders(prevRound, nextRound) {
  const remaining = [...prevRound];
  const ordered = [];
  const take = (pred) => {
    const i = remaining.findIndex(pred);
    if (i < 0) return null;
    return remaining.splice(i, 1)[0];
  };
  for (const next of nextRound) {
    const home = next.home?.name;
    const away = next.away?.name;
    const a = take((m) => {
      const w = winnerName(m);
      return w === home || (!w && (m.home.name === home || m.away.name === home));
    }) || take((m) => m.home.name === home || m.away.name === home);
    const b = take((m) => {
      const w = winnerName(m);
      return w === away || (!w && (m.home.name === away || m.away.name === away));
    }) || take((m) => m.home.name === away || m.away.name === away);
    if (a) ordered.push(a);
    if (b) ordered.push(b);
  }
  ordered.push(...remaining);
  return ordered;
}

function buildBracket(matches) {
  const by = Object.fromEntries(BRACKET_STAGES.map((s) => [s.key, []]));
  for (const m of matches) {
    if (by[m.stage]) by[m.stage].push(m);
  }
  for (const s of BRACKET_STAGES) {
    by[s.key].sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  }
  // Walk final → R32 so each round is reordered under its parent.
  for (let i = BRACKET_STAGES.length - 1; i > 0; i--) {
    const later = by[BRACKET_STAGES[i].key];
    const earlier = by[BRACKET_STAGES[i - 1].key];
    if (later.length && earlier.length) {
      by[BRACKET_STAGES[i - 1].key] = orderFeeders(earlier, later);
    }
  }
  return by;
}

function renderBracketMatch(match, probs, logos) {
  if (!match) {
    return `<div class="bk-match bk-empty"><div class="bk-side"><span class="bk-name">TBD</span></div><div class="bk-side"><span class="bk-name">TBD</span></div></div>`;
  }
  const done = match.status?.state === 'post';
  const live = match.status?.state === 'in';
  const win = winnerSide(match);
  const sides = ['home', 'away'].map((side) => {
    const t = match[side];
    const name = t?.name || 'TBD';
    const isWin = done && win === side;
    const isLose = done && win && win !== side;
    const score = done || live ? (t?.score ?? 0) : '';
    const p = probs?.[name];
    const flag = logos[name]
      ? `<img class="bk-flag" src="${esc(logos[name])}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
      : `<span class="bk-flag bk-flag-empty"></span>`;
    return `<div class="bk-side${isWin ? ' win' : ''}${isLose ? ' lose' : ''}" title="${esc(name)}${p != null ? ` · ${pct(p)}% to lift the trophy` : ''}">
      ${flag}
      <span class="bk-name">${esc(shortTeam(name))}</span>
      ${p != null && !done ? `<span class="bk-prob">${pct(p)}%</span>` : ''}
      ${score !== '' ? `<span class="bk-score">${score}</span>` : ''}
    </div>`;
  }).join('');
  const stateCls = live ? ' live' : done ? ' done' : ' pre';
  const href = match.id ? `href="#m/${esc(match.id)}"` : '';
  return `<a class="bk-match${stateCls}" ${href} data-match="${esc(match.id || '')}">
    ${sides}
  </a>`;
}

/* Classic left-to-right bracket: each round is a column of nested pairs
   so CSS can draw the }-shaped fork into the next round. */
function renderKnockoutBracket(matches, probs, logos) {
  const by = buildBracket(matches);
  const hasAny = BRACKET_STAGES.some((s) => by[s.key].length);
  if (!hasAny) return '';

  // One column per stage. Matches are nested in pairs so CSS can draw the
  // }-shaped fork into the next round; flex grow keeps vertical alignment.
  const stageLists = BRACKET_STAGES.map((s, si) => {
    const list = [...(by[s.key] || [])];
    const expected = 16 / (2 ** si);
    while (list.length < expected) list.push(null);
    return list;
  });

  // The third-place tie hangs under the final in the same column: it is
  // the other half of that last matchday, not a footnote to the whole
  // bracket.
  const third = matches.find((m) => m.stage === '3rd place match');
  const thirdHtml = third
    ? `<div class="bk-third">
        <span class="bk-third-label">3rd place</span>
        ${renderBracketMatch(third, probs, logos)}
      </div>`
    : '';

  const cols = BRACKET_STAGES.map((stage, si) => {
    const list = stageLists[si];
    let body;
    if (si === BRACKET_STAGES.length - 1) {
      body = `<div class="bk-leaf bk-final-leaf">${renderBracketMatch(list[0], probs, logos)}</div>${thirdHtml}`;
    } else {
      const pairs = [];
      for (let i = 0; i < list.length; i += 2) {
        pairs.push(`<div class="bk-pair">
          <div class="bk-pair-kids">
            <div class="bk-leaf">${renderBracketMatch(list[i], probs, logos)}</div>
            <div class="bk-leaf">${renderBracketMatch(list[i + 1], probs, logos)}</div>
          </div>
          <div class="bk-fork" aria-hidden="true"></div>
        </div>`);
      }
      body = pairs.join('');
    }
    return `<div class="bk-round" data-stage="${esc(stage.key)}">
      <div class="bk-round-label">${esc(stage.short)}<span class="bk-round-full">${esc(stage.full)}</span></div>
      <div class="bk-col">${body}</div>
    </div>`;
  }).join('');

  return `<div class="bracket-wrap">
    <div class="bracket" role="img" aria-label="World Cup knockout bracket from round of 32 to the final">
      ${cols}
    </div>
    <p class="fnote bk-legend">Winners in gold. Click any tie for the models' forecasts. Probabilities are the models' consensus chance of lifting the trophy.</p>
  </div>`;
}

/* Hero panel: the leading contenders to lift the trophy, one column per
   team, each with the individual model forecasts that make up the
   consensus stacked beneath it. Capped at two columns so the panel stays
   a hero summary — when more of the field is alive, these are the top
   two and the full picture lives in the trophy section. */
const HERO_CONSENSUS_TEAMS = 2;
function renderHeroConsensus(state) {
  const el = $('#hero-consensus');
  if (!el) return;
  const latest = (state.outright ?? [])
    .map((e) => ({ at: e.at, teams: e.teams, consensus: outrightConsensus(e), models: e.models }))
    .filter((e) => e.consensus)
    .sort((a, b) => new Date(a.at) - new Date(b.at))
    .pop();
  if (!latest) { el.hidden = true; el.innerHTML = ''; return; }

  const ranked = latest.teams
    .map((t) => ({ team: t, p: latest.consensus[t] ?? 0 }))
    .sort((a, b) => b.p - a.p)
    .slice(0, HERO_CONSENSUS_TEAMS);
  if (!ranked.length) { el.hidden = true; el.innerHTML = ''; return; }

  const logos = {};
  for (const m of state.matches ?? []) {
    for (const s of [m.home, m.away]) if (s.logo) logos[s.name] = s.logo;
  }
  // One row per model that published probabilities this round, sharpest
  // call on this team first, so the spread inside the consensus is legible.
  const breakdown = (team) => Object.entries(latest.models)
    .filter(([, m]) => m.probs && m.probs[team] != null)
    .map(([id, m]) => ({
      id,
      label: entrantById(state, id)?.label ?? id,
      icon: entrantById(state, id)?.icon ?? null,
      p: m.probs[team],
    }))
    .sort((a, b) => b.p - a.p);

  el.hidden = false;
  el.innerHTML = `<div class="hc-head">AI consensus to win it all</div>
    <div class="hc-grid">
      ${ranked.map((r, i) => `
        <div class="hc-team${i === 0 ? ' leader' : ''}">
          <div class="hc-team-head">
            ${logos[r.team] ? `<img class="hc-flag" src="${esc(logos[r.team])}" alt="" onerror="this.style.visibility='hidden'">` : ''}
            <span class="hc-name">${esc(r.team)}</span>
            <span class="hc-p">${pct(r.p)}%</span>
          </div>
          <div class="hc-models">
            ${breakdown(r.team).map((m) => `
              <button class="hc-model" data-model="${esc(m.id)}" title="${esc(m.label)} gives ${esc(r.team)} ${pct(m.p)}% to lift the trophy" aria-label="Open performance detail for ${esc(m.label)}">
                ${m.icon ? `<img class="crest" src="${esc(m.icon)}" alt="" onerror="this.style.visibility='hidden'">` : ''}
                <span class="hc-model-name">${esc(m.label)}</span>
                <b class="hc-model-p">${pct(m.p)}%</b>
              </button>`).join('')}
          </div>
        </div>`).join('')}
    </div>`;
  for (const btn of el.querySelectorAll('[data-model]')) {
    btn.addEventListener('click', () => { location.hash = `p/${encodeURIComponent(btn.dataset.model)}`; });
  }
}

function renderTrophy(state) {
  const section = $('#trophy-section');
  const el = $('#trophy');
  const history = (state.outright ?? [])
    .map((e) => ({ at: e.at, label: e.label, teams: e.teams, consensus: outrightConsensus(e), models: e.models }))
    .filter((e) => e.consensus)
    .sort((a, b) => new Date(a.at) - new Date(b.at));
  const koMatches = (state.matches ?? []).filter((m) =>
    BRACKET_STAGES.some((s) => s.key === m.stage) || m.stage === '3rd place match'
  );
  // Show the section when we have either outright probs or knockout fixtures.
  if (!history.length && !koMatches.length) { section.hidden = true; return; }
  section.hidden = false;

  const latest = history[history.length - 1];
  const ranked = latest
    ? latest.teams
      .map((t) => ({ team: t, p: latest.consensus[t] ?? 0 }))
      .sort((a, b) => b.p - a.p)
    : [];
  const probs = Object.fromEntries(ranked.map((r) => [r.team, r.p]));
  const logos = {};
  for (const m of state.matches ?? []) {
    for (const s of [m.home, m.away]) if (s.logo) logos[s.name] = s.logo;
  }
  // A team gets its own band if it is still alive OR it was ever a real
  // contender (peak consensus >= 5%). That keeps every remaining team on
  // the chart AND lets a knocked-out favourite - Brazil, Portugal - keep
  // its band and visibly collapse to zero at the round it went out.
  const PEAK_BAND = 0.05;
  const peak = {};
  for (const h of history) for (const t of h.teams) peak[t] = Math.max(peak[t] ?? 0, h.consensus[t] ?? 0);
  const aliveNow = new Set((latest?.teams ?? []).filter((t) => (latest.consensus[t] ?? 0) > 0));
  const contenders = Object.keys(peak)
    .filter((t) => aliveNow.has(t) || peak[t] >= PEAK_BAND)
    .sort((a, b) => peak[b] - peak[a]);
  const spread = (t) => {
    if (!latest) return esc(t);
    const ps = Object.values(latest.models).filter((m) => m.probs).map((m) => m.probs[t] ?? 0);
    if (!ps.length) return esc(t);
    return `${esc(t)}: models range ${pct(Math.min(...ps))}% to ${pct(Math.max(...ps))}%`;
  };

  const chartHtml = history.length > 1
    ? `<div class="trophy-chart">
        <div class="trophy-chart-head">How belief shifted each round</div>
        <div class="chart">${trophyChart(history, contenders)}</div>
        <p class="fnote">Each column is a collection round, stacked to 100%. A band pinches to zero the moment that team is knocked out. Hover for the full breakdown.</p>
      </div>`
    : history.length === 1
      ? `<p class="fnote">Collected ${esc(new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(latest.at)))}. The over-time chart appears after the next collection round.</p>`
      : '';

  el.innerHTML = `
    <div class="trophy-card">
      ${chartHtml}
      ${koFormCardHtml(state)}
    </div>
    ${renderKnockoutBracket(koMatches, probs, logos)}`;
  const chartWrap = el.querySelector('.trophy-chart');
  if (chartWrap && history.length > 1) attachTrophyHover(chartWrap, history, contenders);
  const koWrap = el.querySelector('.lb-chart-card');
  if (koWrap) attachLeaderboardHover(koWrap, state);
}

/* Podium: the current top three, front and centre in the hero band. Same
   ranking rules as the leaderboard — shrunken skill, unscored rows
   don't medal. */
function renderPodium(state) {
  const el = $('#podium');
  if (!el) return;
  const scoredRows = boardOf(state).filter((r) => r.scored > 0);
  const top = scoredRows.slice(0, 3);
  if (top.length < 2) { el.innerHTML = ''; return; }
  // The headline question is "does anything beat the bookies?" — say the
  // market's relative standing plainly, right under the podium.
  const mi = scoredRows.findIndex((r) => r.model === MARKET_ID);
  let marketStrip = '';
  if (mi >= 0) {
    const m = scoredRows[mi];
    const ahead = scoredRows.slice(0, mi).map((r) => r.label);
    const text = mi === 0
      ? `<b>The Market leads the whole field.</b> After ${m.scored} scored matches, no AI outranks the bookmakers' consensus — avg Brier ${m.avgBrier.toFixed(3)}, ${fmtSkill(m.avgSkill)} vs the coin flip.`
      : `<b>${esc(ahead.join(' and '))} ${ahead.length === 1 ? 'is' : 'are'} ahead of The Market.</b> The bookmakers' consensus sits #${mi + 1} of ${scoredRows.length} — avg Brier ${m.avgBrier.toFixed(3)}, ${fmtSkill(m.avgSkill)} vs the coin flip over ${m.scored} matches.`;
    marketStrip = `<button class="podium-market" data-model="${esc(MARKET_ID)}" aria-label="The Market's standing. Open performance detail.">
      <img class="crest" src="/icons/market.svg" alt="" onerror="this.style.visibility='hidden'">
      <span>${text} <span class="podium-market-src">TxODDS StablePrice · TxLINE on Solana</span></span>
    </button>`;
  }
  const PLACE_WORD = { 1: 'First', 2: 'Second', 3: 'Third' };
  const slot = (r, place) => {
    if (!r) {
      // Fewer than three scored entrants: the step stands empty until the
      // next match scores someone.
      return `<div class="podium-slot podium-${place} podium-vacant" aria-label="${PLACE_WORD[place]} place: vacant">
        <span class="podium-name">Up for grabs</span>
        <span class="podium-brier">in the final</span>
        <span class="podium-step" aria-hidden="true">${place}</span>
      </div>`;
    }
    const icon = entrantById(state, r.model)?.icon ?? r.icon;
    return `<button class="podium-slot podium-${place}" data-model="${esc(r.model)}"
      aria-label="${PLACE_WORD[place]} place: ${esc(r.label)}, average Brier ${r.avgBrier.toFixed(3)}. Open performance detail.">
      ${place === 1 ? '<span class="podium-crown" aria-hidden="true">🏆</span>' : ''}
      ${icon ? `<img class="podium-crest" src="${esc(icon)}" alt="" onerror="this.style.visibility='hidden'">` : ''}
      <span class="podium-name">${esc(r.label)}</span>
      <span class="podium-brier">${r.avgBrier.toFixed(3)}</span>
      <span class="podium-step" aria-hidden="true">${place}</span>
    </button>`;
  };
  el.innerHTML = `<div class="podium" role="group" aria-label="Current top three, by average Brier score">
    ${slot(top[1], 2)}${slot(top[0], 1)}${slot(top[2], 3)}
  </div>
  <p class="podium-note">The leaderboard's top three · knockout phase · average Brier · lower is sharper</p>
  ${marketStrip}`;
  for (const s of el.querySelectorAll('[data-model]')) {
    s.addEventListener('click', () => { location.hash = `p/${encodeURIComponent(s.dataset.model)}`; });
  }
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
        const mod = entrantById(state, id);
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
  const leader = boardOf(state).find((r) => r.scored > 0);
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
    el.innerHTML = `<div class="banner">Live scores are flowing, but no forecaster is configured. Set <code>OPENROUTER_API_KEY</code> (one key covers the whole AI roster via OpenRouter) and restart the server. Upcoming matches are forecast automatically from then on.</div>`;
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

/* One render pass over every panel — the polling refresh and the
   by-lab/by-model view toggle both go through here. */
function renderAll(state) {
  renderPodium(state);
  renderHeroHook(state);
  renderHeroConsensus(state);
  renderFeatured(state);
  renderTicker(state);
  renderTrophy(state);
  renderBanner(state);
  renderViewToggle(state);
  renderRoster(state);
  renderLeaderboard(state);
  renderBankroll(state);
  renderMatches(state);
  renderDetail(state);
  // Static tips in index.html (leaderboard explainer) + any re-rendered ones.
  wireBrierTips(document);
}

async function refresh(force = false) {
  try {
    const res = await fetch('/api/state');
    const state = await res.json();
    if (!res.ok) throw new Error(state.error || res.statusText);

    lastState = state;
    renderAll(state);
    if (state.prompts) {
      $('#prompt-locked').textContent = state.prompts.locked;
      $('#prompt-live').textContent = state.prompts.live;
      if (state.prompts.lockedKnockout) $('#prompt-locked-ko').textContent = state.prompts.lockedKnockout;
      if (state.prompts.liveKnockout) $('#prompt-live-ko').textContent = state.prompts.liveKnockout;
    }

    const anyLive = state.matches.some((m) => m.status.state === 'in');
    schedule(anyLive ? 12000 : 60000);
  } catch (err) {
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
