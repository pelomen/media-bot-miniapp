#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -x .venv/bin/python ]; then
  echo "Сначала выполните: bash termux_setup.sh"
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "Не найден ffmpeg. Выполните: pkg install ffmpeg"
  exit 1
fi

. .venv/bin/activate
exec python bot/bot.py
