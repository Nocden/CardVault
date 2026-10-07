#!/usr/bin/env bash
# Full local demo: local Solana validator + two simulated cards + CLI.
# Needs: solana CLI (solana-test-validator), Java 17, Node 20+,
#        sim/setup.sh done, program built (cd program && anchor build), client npm install.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SO="$ROOT/program/target/deploy/card_vault.so"
PROGRAM_ID=$(grep -oP 'declare_id!\("\K[^"]+' "$ROOT/program/programs/card_vault/src/lib.rs")
[ -f "$SO" ] || { echo "Build the program first: cd program && anchor build"; exit 1; }

WORK=$(mktemp -d)
cleanup() { kill $(jobs -p) 2>/dev/null || true; }
trap cleanup EXIT

echo "Starting local validator with card_vault at $PROGRAM_ID ..."
solana-test-validator --reset --quiet --ledger "$WORK/ledger" --bpf-program "$PROGRAM_ID" "$SO" > "$WORK/validator.log" 2>&1 &
echo "Starting simulated cards on 9025 (main) and 9026 (recovery) ..."
"$ROOT/sim/run.sh" 9025 > "$WORK/card-main.log" 2>&1 &
"$ROOT/sim/run.sh" 9026 > "$WORK/card-recovery.log" 2>&1 &

for i in $(seq 1 60); do solana -u localhost cluster-version >/dev/null 2>&1 && break; sleep 1; done
for p in 9025 9026; do for i in $(seq 1 60); do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && break; sleep 1; done; done
sleep 2

for k in owner new thief; do solana-keygen new --no-bip39-passphrase -s -o "$WORK/$k.json" >/dev/null; done
for k in owner new thief; do solana -u localhost airdrop 10 "$(solana-keygen pubkey "$WORK/$k.json")" >/dev/null; done

cd "$ROOT/client"
export RPC_URL=http://127.0.0.1:8899 CARD_VAULT_PROGRAM_ID=$PROGRAM_ID OWNER_KEYPAIR="$WORK/owner.json" NODE_NO_WARNINGS=1
cli() { npx tsx src/cli.ts "$@"; }
OWNER=$(solana-keygen pubkey "$WORK/owner.json"); NEW=$(solana-keygen pubkey "$WORK/new.json")

echo; echo "== 1. Recovery card public key";  REC=$(CARD=sim:9026 cli pubkey | awk 'NR==1{print $3}'); echo "$REC"
echo; echo "== 2. Create vault (main card = 9025)"; CARD=sim:9025 cli init "$REC"
echo; echo "== 3. Deposit 3 SOL";               CARD=sim:9025 cli deposit 3
echo; echo "== 4. Withdraw 0.5 SOL (owner key + card + PIN)"; echo 1234 | CARD=sim:9025 cli withdraw "$NEW" 0.5
echo; echo "== 5. Withdraw 2 SOL (card refuses: over its limit)"; echo 1234 | CARD=sim:9025 cli withdraw "$NEW" 2 || true
echo; echo "== 6. Attacks the program must block"
CARD=sim:9025 RECOVERY_CARD=sim:9026 npx tsx src/attacks.ts
echo; echo "== 7. Phantom key stolen -> recovery card moves vault to a NEW owner key"
echo 1234 | CARD=sim:9026 PAYER_KEYPAIR="$WORK/new.json" cli recover "$NEW" "$OWNER"
echo; echo "== 8. Old (stolen) owner key + main card: must fail now"
echo 1234 | CARD=sim:9025 cli withdraw "$NEW" 0.1 2>&1 | grep -o "ConstraintHasOne.*violated" || true
echo; cli info "$OWNER"
