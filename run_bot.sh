#!/usr/bin/env bash
# Runner for Media Downloader Telegram Bot

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOT_SCRIPT="$DIR/bot/bot.py"

if [ -z "$1" ] && [ -z "$BOT_TOKEN" ]; then
    echo "=========================================================="
    echo "  Media Downloader Bot & Mini App"
    echo "=========================================================="
    echo "Использование: bash run_bot.sh <TELEGRAM_BOT_TOKEN> [WEBAPP_URL]"
    echo ""
    echo "Пример:"
    echo "  bash run_bot.sh 123456789:ABCdefGhIjkLmNoPqRsTuVwXyZ"
    echo "  bash run_bot.sh 123456789:ABCdefGhIjkLmNoPqRsTuVwXyZ https://yourname.github.io/media-hub/"
    echo "=========================================================="
    exit 1
fi

if [ -n "$1" ]; then
    export BOT_TOKEN="$1"
fi

if [ -n "$2" ]; then
    export WEBAPP_URL="$2"
fi

echo "[*] Запуск бота с токеном: ${BOT_TOKEN:0:10}..."
if [ -n "$WEBAPP_URL" ]; then
    echo "[*] Mini App URL: $WEBAPP_URL"
fi

python "$BOT_SCRIPT"
