#!/bin/bash
# Live innlogginger - oppdateres hvert 5. sekund

cd "/Users/sandermartinsen/Utvilkling : VISUAL CODE/Utvilkling/el-kontroll-kart"

while true; do
  clear
  echo "=== LIVE INNLOGGINGER ==="
  echo "Oppdateres hvert 5. sekund (Ctrl+C for å stoppe)"
  echo ""
  ./check-logins.sh
  sleep 5
done
