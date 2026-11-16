# Media Downloader Bot

> Telegram-бот для скачивания медиа из TikTok и YouTube: видео без водяного знака, фото-слайд-шоу, MP3-аудио.

[![GitHub Repo](https://img.shields.io/badge/GitHub-Repository-blue?style=for-the-badge&logo=github)](https://github.com/pelomen/media-bot-miniapp)

---

## ✨ Возможности

### 🤖 TikTok
- **Видео:** скачивание без водяных знаков в максимальном качестве + автоматическое извлечение MP3-аудио.
- **Слайд-шоу:** обнаружение фото-каруселей; по кнопке `🎬 Скачать фото + звук` — все фото альбомом и оригинальный трек, по кнопке `🎵 Только звук` — только аудиодорожка.

### ▶ YouTube & Shorts
- Загрузка роликов до 1080p + конвертация звука в MP3 через FFmpeg.

### 🛡 Надёжная схема скачивания
1. TikWM API (основной источник, два зеркала)
2. Tiklydown API (резерв)
3. **yt-dlp напрямую из TikTok/YouTube** (последний рубеж — работает, даже когда все API лежат; использует `curl-cffi` для обхода блокировок)

Корректные расширения аудио (mp3/m4a) определяются по Content-Type — треки всегда играют в Telegram.

---

## 🚀 Быстрый старт

### Требования
- Python 3.9+
- `ffmpeg` (для конвертации в MP3)
- токен бота от [@BotFather](https://t.me/BotFather)
- (желательно) `curl-cffi`: `pip install "yt-dlp[default,curl-cffi]"` — без него yt-dlp может не проходить в TikTok

### Настройка
```bash
pip install -r bot/requirements.txt
cp .env.example .env   # и впишите токен в .env
```

### Запуск в Windows
Дважды щёлкните `start_bot.bat`, либо:
```bash
python bot/bot.py <ТОКЕН>
```

### Запуск в Termux (Android)
```bash
pkg install git
git clone https://github.com/pelomen/media-bot-miniapp.git
cd media-bot-miniapp
bash termux_setup.sh
# заполните .env
bash termux_start.sh
```
Чтобы Android не усыпил процесс: `termux-wake-lock`.

---

## 📂 Структура проекта
```
media-bot-miniapp/
├── bot/
│   ├── bot.py             # Основной скрипт Telegram-бота
│   └── requirements.txt   # Зависимости Python
├── run_bot.sh             # Запуск в Linux/macOS
├── start_bot.bat          # Запуск в Windows
├── termux_setup.sh        # Подготовка Termux
├── termux_start.sh        # Запуск бота в Termux
├── .env.example           # Образец локальной конфигурации
└── README.md
```

---

## 📄 Лицензия
MIT License. Свободно для использования и модификации.
