#!/usr/bin/env bash
set -e

# Gracefully stop running processes if active to release file locks
for proc in dsh-desktop dsh-intranet deepseek-harness-kylin deepseek-harness-kylin.bin; do
  if pidof "$proc" >/dev/null 2>&1; then
    killall -TERM -q "$proc" || true
  fi
done

# Brief grace period for quiescent exit
for _ in 1 2; do
  if pidof dsh-desktop dsh-intranet deepseek-harness-kylin deepseek-harness-kylin.bin >/dev/null 2>&1; then
    sleep 1
  fi
done

# Ensure files are released before unpack
killall -9 -q dsh-desktop || true
killall -9 -q dsh-intranet || true
killall -9 -q deepseek-harness-kylin || true
killall -9 -q deepseek-harness-kylin.bin || true

exit 0
