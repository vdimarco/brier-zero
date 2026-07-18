// Lab-grouped knockout backtest: run a slate of top-tier models, grouped by
// lab, against every resolved knockout match with the EXACT locked pre-kickoff
// prompt, and rank them best-in-lab and overall. Read-only research: writes a
// combined report to data/backtests/knockout-labs.json, nothing enters the
// live ledger.
//
//   node scripts/lab-backtest.js [--concurrency 3] [--out file]
//
// Honesty contract (same as lib/backtest.js): a backtest is not a locked
// forecast — the prompt carries no result, but there is no pre-kickoff
// timestamp proof, so these figures never touch the live leaderboard.

import fs from 'node:fs';
import path from 'node:path';
import { fetchMatches } from '../lib/espn.js';
import { backtestModel } from '../lib/backtest.js';

// Top-tier / newest flagship per lab (OpenRouter slugs, grouped by lab).
// A lab may carry several generations so "best-in-lab" is a real contest.
const SLATE = [
  // Anthropic
  { lab: 'Anthropic', id: 'anthropic/claude-opus-4.8', label: 'Opus 4.8' },
  { lab: 'Anthropic', id: 'anthropic/claude-sonnet-5', label: 'Sonnet 5' },
  { lab: 'Anthropic', id: 'anthropic/claude-opus-4.7', label: 'Opus 4.7' },
  { lab: 'Anthropic', id: 'anthropic/claude-fable-5', label: 'Fable 5' },
  { lab: 'Anthropic', id: 'anthropic/claude-sonnet-4.5', label: 'Sonnet 4.5' },
  // OpenAI
  { lab: 'OpenAI', id: 'openai/gpt-5.6-luna-pro', label: 'GPT-5.6 Luna Pro' },
  { lab: 'OpenAI', id: 'openai/gpt-5.5-pro', label: 'GPT-5.5 Pro' },
  { lab: 'OpenAI', id: 'openai/gpt-5.1', label: 'GPT-5.1' },
  // Google
  { lab: 'Google', id: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
  { lab: 'Google', id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  // xAI
  { lab: 'xAI', id: 'x-ai/grok-4.5', label: 'Grok 4.5' },
  { lab: 'xAI', id: 'x-ai/grok-4.3', label: 'Grok 4.3' },
  // Single flagship each
  { lab: 'DeepSeek', id: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
  { lab: 'Moonshot', id: 'moonshotai/kimi-k3', label: 'Kimi K3' },
  { lab: 'Z.ai', id: 'z-ai/glm-5.2', label: 'GLM 5.2' },
  { lab: 'Qwen', id: 'qwen/qwen3.7-max', label: 'Qwen3.7 Max' },
];

const KNOCKOUT_STAGES = new Set(['round of 32', 'round of 16', 'quarterfinals', 'semifinals']);

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const concurrency = Number(arg('concurrency', 3)) || 3;
const outFile = arg('out', 'data/backtests/knockout-labs.json');
const resume = process.argv.includes('--resume');

// Resume support: reuse any model that already scored the full match set with
// zero failures, so a re-run after a key top-up only spends on the gaps.
const priorById = new Map();
if (resume && fs.existsSync(outFile)) {
  try {
    const prev = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    for (const lab of Object.values(prev.labs || {})) {
      for (const m of lab) priorById.set(m.id, m);
    }
  } catch { /* ignore a malformed prior report */ }
}

const all = await fetchMatches();
const knockout = all
  .filter((m) => m.status.state === 'post' && m.outcome && !m.teamsTbd && KNOCKOUT_STAGES.has(String(m.stage)))
  .sort((a, b) => a.id.localeCompare(b.id));
const matchIds = knockout.map((m) => m.id);

console.log(`Knockout phase to date: ${matchIds.length} matches`);
const stageCounts = {};
for (const m of knockout) stageCounts[m.stage] = (stageCounts[m.stage] || 0) + 1;
console.log('  ' + Object.entries(stageCounts).map(([s, n]) => `${s}: ${n}`).join(', '));
console.log(`Slate: ${SLATE.length} models across ${new Set(SLATE.map((s) => s.lab)).size} labs`);
console.log(`Running ${SLATE.length} × ${matchIds.length} = ${SLATE.length * matchIds.length} backtests (concurrency ${concurrency})\n`);

const results = [];
for (let i = 0; i < SLATE.length; i++) {
  const entry = SLATE[i];
  process.stdout.write(`[${i + 1}/${SLATE.length}] ${entry.lab} — ${entry.label} (${entry.id}) ... `);

  const cached = priorById.get(entry.id);
  if (cached && cached.scored === matchIds.length && !cached.failed && cached.avgBrier != null) {
    results.push(cached);
    console.log(`reused avg Brier ${cached.avgBrier.toFixed(3)} (${cached.scored}/${matchIds.length}, cached)`);
    continue;
  }

  try {
    const report = await backtestModel({ model: entry.id, label: entry.label, matchIds, store: false, concurrency });
    const s = report.summary;
    results.push({
      lab: entry.lab,
      id: entry.id,
      label: entry.label,
      scored: s.scored,
      failed: s.failed,
      avgBrier: s.avgBrier,
      avgBaseline: s.avgBaseline,
      beatFieldMean: s.beatFieldMean,
      perMatch: report.matches.map((r) => ({ matchId: r.matchId, shortName: r.shortName, stage: r.stage, brier: r.brier ?? null, error: r.error ?? null })),
    });
    console.log(`avg Brier ${s.avgBrier?.toFixed(3) ?? 'n/a'} (${s.scored}/${s.requested} scored${s.failed ? `, ${s.failed} failed` : ''})`);
  } catch (err) {
    results.push({ lab: entry.lab, id: entry.id, label: entry.label, scored: 0, failed: matchIds.length, avgBrier: null, error: String(err.message || err).slice(0, 200) });
    console.log(`FAILED: ${String(err.message || err).slice(0, 120)}`);
  }
}

// Rank overall and within lab (lower Brier = better).
const scored = results.filter((r) => r.avgBrier != null).sort((a, b) => a.avgBrier - b.avgBrier);
scored.forEach((r, i) => { r.overallRank = i + 1; });
const byLab = {};
for (const r of results) (byLab[r.lab] = byLab[r.lab] || []).push(r);
for (const lab of Object.keys(byLab)) {
  byLab[lab].sort((a, b) => (a.avgBrier ?? 99) - (b.avgBrier ?? 99));
  byLab[lab].forEach((r, i) => { r.labRank = r.avgBrier != null ? i + 1 : null; r.bestInLab = r.avgBrier != null && i === 0; });
}

const coinFlip = scored.length ? scored[0].avgBaseline : null;
const report = {
  method: 'retro-backtest',
  note: 'Top-tier models grouped by lab, run over the resolved knockout phase with the exact locked pre-kickoff advance-market prompt. Backtest only: no pre-kickoff timestamp proof, never enters the live leaderboard.',
  at: new Date().toISOString(),
  matchCount: matchIds.length,
  matchIds,
  stageCounts,
  coinFlip,
  labs: byLab,
  overall: scored.map((r) => ({ lab: r.lab, label: r.label, id: r.id, avgBrier: r.avgBrier, overallRank: r.overallRank, bestInLab: r.bestInLab })),
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(report, null, 2));

console.log(`\n=== Best-in-lab (avg Brier over ${matchIds.length} knockout matches, lower is better) ===`);
for (const lab of Object.keys(byLab)) {
  const rows = byLab[lab];
  console.log(`\n${lab}`);
  for (const r of rows) {
    const mark = r.bestInLab ? ' ★ best-in-lab' : '';
    const rank = r.overallRank ? `  #${r.overallRank} overall` : '';
    console.log(`  ${(r.avgBrier != null ? r.avgBrier.toFixed(3) : 'FAILED').padStart(7)}  ${r.label}${mark}${rank}`);
  }
}
console.log(`\nCoin-flip baseline: ${coinFlip?.toFixed(3) ?? 'n/a'}`);
console.log(`\nReport written to ${outFile}`);
