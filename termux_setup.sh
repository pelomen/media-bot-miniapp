#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v pkg >/dev/null 2>&1; then
  echo "Этот скрипт нужно запускать в Termux."
  exit 1
fi

pkg update
pkg install -y python ffmpeg git clang pkg-config openssl libffi
python -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r bot/requirements.txt

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Создан .env. Впишите BOT_TOKEN, затем запустите: bash termux_start.sh"
  exit 0
fi

echo "Зависимости установлены. Запуск: bash termux_start.sh"
