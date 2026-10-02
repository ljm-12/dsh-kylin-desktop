#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == remove || "${1:-}" == purge ]]; then
  for link in /usr/bin/deepseek-harness-kylin /usr/bin/dsh-intranet /usr/bin/dsh; do
    if [[ -L "$link" && "$(readlink "$link")" == '/opt/DeepSeek Harness Kylin/'* ]]; then
      rm -- "$link"
    fi
  done
fi
# Application homes and user files belong to upstream and are preserved.
