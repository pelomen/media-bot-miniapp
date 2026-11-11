# Media Bot and Mini App

> Telegram-бот для обработки ссылок TikTok и YouTube, а также локальный медиаплеер для Telegram Mini App.

[![GitHub Repo](https://img.shields.io/badge/GitHub-Repository-blue?style=for-the-badge&logo=github)](https://github.com/pelomen/media-bot-miniapp)

- 🌐 **Mini App:** [https://pelomen.github.io/media-bot-miniapp/](https://pelomen.github.io/media-bot-miniapp/)
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
- **Локальная библиотека (IndexedDB):** импортированные аудио и видео остаются на этом устройстве и доступны офлайн.
- **Слайд-шоу:** выберите несколько изображений через импорт файлов; при выборе аудио оно добавится как фоновая дорожка.
- **Видеоплеер:** Полноэкранный плеер для роликов YouTube и TikTok.
- **Просмотрщик слайд-шоу:** Интерактивная галерея для фото-слайдов TikTok с одновременным воспроизведением фонового трека.
- **Монохромная тема:** чёрно-белая палитра с поддержкой Telegram WebApp и тактильной отдачей.

---

## 🚀 Быстрый старт

### Требования
- Python 3.9 или новее
- `ffmpeg` (для извлечения MP3 с YouTube)
- токен Telegram-бота от [@BotFather](https://t.me/BotFather)

### Настройка
```bash
pip install -r bot/requirements.txt
cp .env.example .env
```

Скопируйте `.env.example` в `.env` и впишите токен (в Windows первый запуск `start_bot.bat` создаст этот файл автоматически). В Termux его можно открыть командой `nano .env`. Локальный `.env` исключён из Git.

### Запуск в Windows
Дважды щёлкните `start_bot.bat`. При первом запуске скрипт создаст `.venv`, установит зависимости и использует `.env`. Можно передать параметры вручную:
```bash
start_bot.bat <ТОКЕН> [URL_МИНИ_АППА]
```

### Запуск в Termux
В Termux установите Git и получите репозиторий:
```bash
pkg install git
git clone https://github.com/pelomen/media-bot-miniapp.git
cd media-bot-miniapp
```
Затем выполните:
```bash
bash termux_setup.sh
```
Заполните `.env`, затем запустите `bash termux_start.sh`. Скрипт устанавливает Python, FFmpeg и зависимости в виртуальное окружение. Чтобы Android не усыплял процесс, перед запуском можно выполнить `termux-wake-lock`.

Для Linux/macOS после установки зависимостей и заполнения `.env` используйте:
```bash
bash run_bot.sh
```

---

## 🌐 Хостинг Telegram Mini App на GitHub Pages

Чтобы Telegram Mini App открывался прямо в Telegram, ему нужен бесплатный публичный HTTPS-адрес:

1. Опубликуйте репозиторий на GitHub.
2. Перейдите в **Settings** -> **Pages**.
3. В разделе **Source** выберите ветку `main` и папку `/docs`.
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
├── start_bot.bat          # Запуск Windows с русскими сообщениями
├── termux_setup.sh        # Подготовка Termux
├── termux_start.sh        # Запуск бота в Termux
├── .env.example          # Образец локальной конфигурации
└── README.md              # Документация проекта
```

---

## 📄 Лицензия
MIT License. Свободно для использования и модификации.
