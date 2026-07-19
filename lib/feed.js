// The match feed, as the rest of the app sees it: ESPN's scoreboard is the
// canonical source of fixtures, scores, and settlement (battle-tested all
// tournament), and when TXODDS credentials are configured every active
// match is enriched with the live TxLINE StablePrice line (match.marketOdds)
// — the same de-vigged consensus that trades on the leaderboard as "the
// market". TxLINE trouble never breaks the feed: enrichment is best-effort.

import { fetchMatches as espnFetchMatches } from './espn.js';
import { attachMarketOdds, txoddsReady, txoddsStatus } from './txodds.js';

export { periodRank } from './espn.js';
export { txoddsStatus };

export async function fetchMatches(opts = {}) {
  const matches = await espnFetchMatches(opts);
  if (txoddsReady()) {
    try {
      await attachMarketOdds(matches);
    } catch (err) {
      console.error('[feed] odds enrichment failed:', err.message);
    }
  }
  return matches;
}
