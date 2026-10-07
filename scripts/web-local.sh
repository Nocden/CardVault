#!/usr/bin/env bash
# Web app on a local validator with two simulated cards and two test wallets.
# Good for rehearsing the demo without Phantom, cards or internet.
# Needs: solana CLI, Java 17, Node 20+, sim/setup.sh done, program built, client npm install.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SO="$ROOT/program/target/deploy/card_vault.so"
PROGRAM_ID=$(grep -oP 'declare_id!\("\K[^"]+' "$ROOT/program/programs/card_vault/src/lib.rs")
[ -f "$SO" ] || { echo "Build the program first: cd program && anchor build"; exit 1; }

WORK=$(mktemp -d)
cleanup() { kill $(jobs -p) 2>/dev/null || true; }
trap cleanup EXIT INT TERM

solana-test-validator --reset --quiet --ledger "$WORK/ledger" --bpf-program "$PROGRAM_ID" "$SO" > "$WORK/validator.log" 2>&1 &
"$ROOT/sim/run.sh" 9025 > "$WORK/card-main.log" 2>&1 &
"$ROOT/sim/run.sh" 9026 > "$WORK/card-recovery.log" 2>&1 &
for i in $(seq 1 60); do solana -u localhost cluster-version >/dev/null 2>&1 && break; sleep 1; done
for p in 9025 9026; do for i in $(seq 1 60); do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && break; sleep 1; done; done

for k in wallet1 wallet2; do
  solana-keygen new --no-bip39-passphrase -s -o "$WORK/$k.json" >/dev/null
  solana -u localhost airdrop 20 "$(solana-keygen pubkey "$WORK/$k.json")" >/dev/null
done

cd "$ROOT/client"
echo "Open http://localhost:8787 and pick a test wallet (PIN of simulated cards: 1234). Ctrl+C to stop."
MAIN_CARD=sim:9025 RECOVERY_CARD=sim:9026 RPC_URL=http://127.0.0.1:8899 CARD_VAULT_PROGRAM_ID=$PROGRAM_ID \
  DEV_WALLETS="$WORK/wallet1.json,$WORK/wallet2.json" NODE_NO_WARNINGS=1 npx tsx src/bridge.ts
