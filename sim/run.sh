#!/usr/bin/env bash
# Starts one simulated card. Usage: ./run.sh [port]   (default 9025)
# Main card:     ./run.sh 9025
# Recovery card: ./run.sh 9026
set -e
cd "$(dirname "$0")"
[ -f lib/jcardsim.jar ] || { echo "jCardSim not found - run ./setup.sh first"; exit 1; }
CP="lib/*${EXTRA_CP:+:$EXTRA_CP}"
mkdir -p out
javac -nowarn -cp "$CP" -d out ../applet/src/cardvault/CardVaultApplet.java src/SimServer.java src/SimTest.java
if [ "$1" = "test" ]; then
  exec java -cp "out:$CP" SimTest
fi
exec java -cp "out:$CP" SimServer "${1:-9025}"
