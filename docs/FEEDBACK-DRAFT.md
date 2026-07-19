# TxODDS / TxLINE developer feedback — DRAFT (edit before sending)

Notes gathered while building The Brier Cup. First-person items are
placeholders for the human to confirm, tone-check, and expand.

## What worked well

- StablePrice as a consensus line is exactly the right primitive for
  scoring forecasters — de-vigging from one feed beats reconciling many
  bookmakers.
- The stat-validation endpoint returning the full Merkle path made
  client-side re-verification straightforward (`recomputeRoot` is ~30
  lines); simulating `validateStat` with `.view()` avoided paying for a
  transaction just to check a settlement.
- The World Cup free tier requiring only an activated token (no TxL
  balance) kept setup friction low.

## Friction / requests

- No single "advances" price is quoted for knockout ties — we derive it
  from the 1X2 line with a documented draw split. A two-way market on the
  feed would remove that modeling step.
- Raw 1X2 decimals arrive embedded in prose (`rationale`) rather than as
  structured fields in our stored records — structured price fields on the
  score/odds records would remove regex parsing.
- (placeholder) rate limits / reconnect behavior during live windows.
- (placeholder) docs gaps encountered during TxLINE setup.

## Would build next

- Settlement receipts as a first-class TxLINE artifact (leaf + path +
  PDA reference in one payload) so any consumer can render a "verified"
  badge without joining two endpoints.
