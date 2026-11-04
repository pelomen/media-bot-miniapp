# 🎬 Media Downloader Bot & Telegram Mini App Player 🎵

> Полнофункциональный Telegram-бот для скачивания медиа из **TikTok** и **YouTube**, а также встроенный автономный веб-плеер (**Telegram Mini App**) на чистом HTML5/CSS3/JavaScript с поддержкой IndexedDB, плейлистов, видеотеки и слайд-шоу.

[![GitHub Pages](https://img.shields.io/badge/Mini_App-Live_Demo-8A2BE2?style=for-the-badge&logo=telegram)](https://pelomen.github.io/media-bot-miniapp/)
[![GitHub Repo](https://img.shields.io/badge/GitHub-Repository-blue?style=for-the-badge&logo=github)](https://github.com/pelomen/media-bot-miniapp)

- 🌐 **Live Telegram Mini App:** [https://pelomen.github.io/media-bot-miniapp/](https://pelomen.github.io/media-bot-miniapp/)
- 📦 **GitHub Репозиторий:** [https://github.com/pelomen/media-bot-miniapp](https://github.com/pelomen/media-bot-miniapp)

---

## ✨ Возможности

### 🤖 Telegram Bot (Backend)
- **TikTok Видео:** Скачивание без водяных знаков в максимальном качестве + автоматическое извлечение оригинального MP3-аудио.
- **TikTok Слайд-шоу:** 
  - Обнаружение фото-каруселей.
  - По нажатию `🎬 Скачать фото + звук`: скачивание всех фотографий альбомом и прикрепление оригинального фонового трека.
  - По нажатию `🎵 Только звук`: моментальная отправка только аудиодорожки.
- **YouTube & Shorts:** Загрузка роликов до 1080p + конвертация звука в MP3 через FFmpeg.
- **Интеграция с Telegram Mini App:** Быстрый запуск плеера кнопкой `📱 Открыть Mini App` под каждым сообщением, а также обработка ссылок, отправленных прямо из интерфейса Mini App!

### 📱 Telegram Mini App (Frontend Web Player)
- **Чистый Web-стек:** HTML5, CSS3, ES6+ JavaScript (без тяжелых фреймворков).
- **Аудиоплеер:**
  - Плейлисты, воспроизведение, пауза, перемотка по клику/свайпу, зацикливание и перемешивание.
  - Динамический визуализатор звуковых волн (аудио-эквалайзер).
  - Анимированная пластинка винила.
  - Регулировка громкости.
- **Постоянное хранилище (IndexedDB):**
  - Все скачанные треки, видео и слайды сохраняются в локальную базу данных браузера устройства.
  - Музыка играет даже без интернета (офлайн).
- **Видеоплеер:** Полноэкранный плеер для роликов YouTube и TikTok.
- **Просмотрщик слайд-шоу:** Интерактивная галерея для фото-слайдов TikTok с одновременным воспроизведением фонового трека.
- **Темная тема Telegram:** Автоматическая адаптация под цвета интерфейса Telegram и тактильная отдача (Haptic Feedback).

---

## 🚀 Быстрый старт

### 1. Требования
- Python 3.9+
- `ffmpeg`
- Telegram Bot Token (получить бесплатно у [@BotFather](https://t.me/BotFather))

### 2. Установка зависимостей
```bash
pip install -r bot/requirements.txt
```

### 3. Запуск бота
```bash
# Передайте токен напрямую:
bash run_bot.sh <ВАШ_ТОКЕН_БОТА> [URL_МИНИ_АППА]

# Либо через переменную окружения:
export BOT_TOKEN="123456789:ABCdefGhIjkLmNoPqRsTuVwXyZ"
export WEBAPP_URL="https://<username>.github.io/<repo>/"
python bot/bot.py
```

---

## 🌐 Хостинг Telegram Mini App на GitHub Pages

Чтобы Telegram Mini App открывался прямо в Telegram, ему нужен бесплатный публичный HTTPS-адрес:

1. Опубликуйте репозиторий на GitHub.
2. Перейдите в **Settings** -> **Pages**.
3. В разделе **Source** выберите ветку `main` и папку `/webapp` (или корень).
4. Получите ссылку вида: `https://<ваш_логин>.github.io/<репозиторий>/`.
5. Привяжите Mini App в [@BotFather](https://t.me/BotFather):
   - Отправьте команду `/newapp` или `/mybots` -> выберите вашего бота -> `Bot Settings` -> `Menu Button` -> `Configure menu button`.
   - Вставьте полученную HTTPS-ссылку на Mini App.

---

## 📂 Структура проекта

```
media-bot-miniapp/
├── bot/
│   ├── bot.py             # Основной скрипт Telegram-бота
│   └── requirements.txt   # Зависимости Python
├── webapp/
│   ├── index.html         # Разметка Telegram Mini App
│   ├── style.css          # Стили и анимации плеера
│   └── app.js             # Движок плеера и база IndexedDB
├── run_bot.sh             # Скрипт быстрого запуска
└── README.md              # Документация проекта
```

---

## 📄 Лицензия
MIT License. Свободно для использования и модификации.
