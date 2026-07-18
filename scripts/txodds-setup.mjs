#!/usr/bin/env node
// TxLINE (TXODDS) one-time token activation.
//
// The World Cup free tier needs no TxL tokens — just one on-chain subscribe
// transaction from your Solana wallet, then this script turns that
// transaction into an API token:
//
//   1. Subscribe on-chain (once). Easiest paths:
//        - the TxLINE app: https://txline.txodds.com  (connect wallet,
//          pick the free World Cup tier), or
//        - the official examples: github.com/txodds/tx-on-chain
//          (examples/devnet/scripts/subscription_free_tier.ts)
//      Either way you end up with a transaction signature (txSig).
//        mainnet program: 9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA
//        devnet  program: 6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J
//
//   2. Run this script with that signature and the SAME wallet's keypair:
//        node scripts/txodds-setup.mjs \
//          --txsig <subscribe tx signature> \
//          --keypair ~/.config/solana/id.json \
//          [--env mainnet|devnet]
//
//   It starts a guest session, signs `${txSig}::${jwt}` with your wallet
//   key (ed25519, in-process — the key never leaves this machine), calls
//   /token/activate, and prints the TXODDS_API_TOKEN for your .env.
//
// No dependencies: Solana keys are ed25519, which node:crypto speaks
// natively.

import fs from 'node:fs';
import { createPrivateKey, sign } from 'node:crypto';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}

const txSig = args.get('txsig');
const keypairPath = args.get('keypair');
const env = (args.get('env') || process.env.TXODDS_ENV || 'mainnet').toLowerCase();
const leagues = args.get('leagues') ? args.get('leagues').split(',').map(Number) : [];

if (!txSig || !keypairPath) {
  console.error('Usage: node scripts/txodds-setup.mjs --txsig <sig> --keypair <path/to/id.json> [--env mainnet|devnet]');
  process.exit(1);
}

const ORIGIN = env === 'devnet' ? 'https://txline-dev.txodds.com' : 'https://txline.txodds.com';

// A Solana CLI keypair file is a JSON array of 64 bytes: 32-byte ed25519
// seed followed by the 32-byte public key. node:crypto takes the seed via
// a PKCS8 wrapper.
function loadEd25519(path) {
  const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (!Array.isArray(raw) || raw.length < 32) {
    throw new Error('keypair file is not a Solana JSON keypair (array of bytes)');
  }
  const seed = Buffer.from(raw.slice(0, 32));
  const pkcs8 = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    seed,
  ]);
  return createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
}

const key = loadEd25519(keypairPath);

console.error(`[1/3] guest session at ${ORIGIN}/auth/guest/start`);
const authRes = await fetch(`${ORIGIN}/auth/guest/start`, { method: 'POST' });
if (!authRes.ok) throw new Error(`guest auth HTTP ${authRes.status}`);
const { token: jwt } = await authRes.json();
if (!jwt) throw new Error('guest auth returned no token');

console.error('[2/3] signing activation message with your wallet key');
const message = Buffer.from(`${txSig}::${jwt}`);
const walletSignature = sign(null, message, key).toString('base64');

console.error(`[3/3] activating at ${ORIGIN}/api/token/activate`);
const actRes = await fetch(`${ORIGIN}/api/token/activate`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${jwt}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ txSig, walletSignature, leagues }),
});
// /api/token/activate returns 200 with the token as a bare text/plain
// body on success, not JSON — only fall back to the JSON `token` field
// when the body actually parses as JSON. A one-time txSig is burned by
// this call, so misreading a successful text/plain response as a failure
// (by assuming JSON) would strand the caller with no way to retry.
const rawBody = await actRes.text();
let token = null;
let parsed = null;
try {
  parsed = JSON.parse(rawBody);
} catch {
  // not JSON — handled below via the plain-text fallback
}
if (parsed && typeof parsed === 'object') {
  token = parsed.token ?? null;
} else if (actRes.ok && rawBody.trim() && !rawBody.includes('\n')) {
  token = rawBody.trim();
}
if (!actRes.ok || !token) {
  console.error('Activation failed:', actRes.status, JSON.stringify(parsed ?? rawBody));
  process.exit(1);
}

console.log('');
console.log('Success! Add these to your .env:');
console.log('');
console.log(`TXODDS_API_TOKEN=${token}`);
if (env !== 'mainnet') console.log(`TXODDS_ENV=${env}`);
console.log('');
console.log('Then restart the server — "The Market" joins the leaderboard.');
