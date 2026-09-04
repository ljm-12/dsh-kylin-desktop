#!/usr/bin/env bash
set -e

# Stop legacy running process if active
killall -q dsh-desktop || true
killall -q dsh-intranet || true
killall -q deepseek-harness-kylin || true

exit 0
