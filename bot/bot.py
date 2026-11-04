#!/usr/bin/env python3
"""
Media Downloader Bot & Telegram Mini App Companion
Supports:
- TikTok Videos (No Watermark) -> Video + Audio
- TikTok Slideshows (Photos + Original Sound / Audio only)
- YouTube Videos & Shorts -> Video + MP3 Audio
- Telegram Mini App (TMA) Integration
"""

import os
import sys
import json
import logging
import tempfile
import asyncio
import re
from typing import Optional, List, Dict, Any

try:
    import requests
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "pyTelegramBotAPI"])
    import requests

import telebot
from telebot.types import (
    InlineKeyboardMarkup,
    InlineKeyboardButton,
    InputMediaPhoto,
    WebAppInfo
)

# Configuration
BOT_TOKEN = os.environ.get("BOT_TOKEN", "YOUR_BOT_TOKEN_HERE")
WEBAPP_URL = os.environ.get("WEBAPP_URL", "https://github.com")

logging.basicConfig(
    format="%(asctime)s - [%(levelname)s] - %(name)s - %(message)s",
    level=logging.INFO
)
logger = logging.getLogger("MediaBot")

bot = telebot.TeleBot(BOT_TOKEN, parse_mode="HTML")

# In-memory cache for pending slideshow selections
slideshow_cache: Dict[str, Dict[str, Any]] = {}

def is_tiktok_url(url: str) -> bool:
    return any(domain in url.lower() for domain in ["tiktok.com", "douyin.com", "vt.tiktok.com", "vm.tiktok.com"])

def is_youtube_url(url: str) -> bool:
    return any(domain in url.lower() for domain in ["youtube.com", "youtu.be", "youtube.com/shorts"])

def extract_urls(text: str) -> List[str]:
    url_pattern = r'https?://[^\s<>"]+|www\.[^\s<>"]+'
    return re.findall(url_pattern, text or "")

# ==============================================================================
# TikTok Processing (Video, Slideshow Photos & Music)
# ==============================================================================
def fetch_tiktok_data(url: str) -> Optional[Dict[str, Any]]:
    """Fetches high-quality metadata from TikWM API with zero watermark."""
    try:
        api_url = "https://tikwm.com/api/"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json"
        }
        res = requests.post(api_url, data={"url": url, "count": 12, "cursor": 0, "web": 1, "hd": 1}, headers=headers, timeout=15)
        if res.status_code == 200:
            data = res.json()
            if data.get("code") == 0 and "data" in data:
                return data["data"]
            logger.warning(f"TikWM returned message: {data.get('msg')}")
    except Exception as e:
        logger.error(f"Error querying TikWM API: {e}")
    return None

def download_file(url: str, output_path: str) -> bool:
    """Downloads remote file safely to disk."""
    try:
        headers = {"User-Agent": "Mozilla/5.0"}
        r = requests.get(url, headers=headers, stream=True, timeout=30)
        if r.status_code == 200:
            with open(output_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=65536):
                    f.write(chunk)
            return True
    except Exception as e:
        logger.error(f"Download failed for {url}: {e}")
    return False

# ==============================================================================
# YouTube Processing via yt-dlp
# ==============================================================================
def download_youtube_media(url: str, download_video: bool = True, download_audio: bool = True) -> Dict[str, Any]:
    """Downloads YouTube video and extracts MP3 audio."""
    import yt_dlp

    temp_dir = tempfile.mkdtemp(prefix="yt_")
    result = {"video_path": None, "audio_path": None, "title": "YouTube Video", "author": "YouTube", "duration": 0}

    # 1. Download Video
    if download_video:
        ydl_opts_video = {
            "format": "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best",
            "outtmpl": os.path.join(temp_dir, "video.%(ext)s"),
            "quiet": True,
            "no_warnings": True,
            "max_filesize": 50 * 1024 * 1024, # 50 MB Telegram limit
        }
        try:
            with yt_dlp.YoutubeDL(ydl_opts_video) as ydl:
                info = ydl.extract_info(url, download=True)
                result["title"] = info.get("title", "YouTube Video")
                result["author"] = info.get("uploader", "YouTube")
                result["duration"] = info.get("duration", 0)
                for f in os.listdir(temp_dir):
                    if f.startswith("video."):
                        result["video_path"] = os.path.join(temp_dir, f)
                        break
        except Exception as e:
            logger.error(f"yt-dlp video error: {e}")

    # 2. Extract Audio
    if download_audio:
        ydl_opts_audio = {
            "format": "bestaudio/best",
            "outtmpl": os.path.join(temp_dir, "audio.%(ext)s"),
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }],
            "quiet": True,
            "no_warnings": True,
        }
        try:
            with yt_dlp.YoutubeDL(ydl_opts_audio) as ydl:
                info = ydl.extract_info(url, download=True)
                result["title"] = info.get("title", result["title"])
                result["author"] = info.get("uploader", result["author"])
                audio_file = os.path.join(temp_dir, "audio.mp3")
                if os.path.exists(audio_file):
                    result["audio_path"] = audio_file
        except Exception as e:
            logger.error(f"yt-dlp audio error: {e}")

    return result

# ==============================================================================
# Telegram Handlers
# ==============================================================================
def get_main_keyboard() -> InlineKeyboardMarkup:
    markup = InlineKeyboardMarkup()
    if WEBAPP_URL and WEBAPP_URL.startswith("https://"):
        markup.add(InlineKeyboardButton("📱 Открыть Mini App (Плеер)", web_app=WebAppInfo(url=WEBAPP_URL)))
    return markup

@bot.message_handler(commands=["start", "help"])
def send_welcome(message):
    user_name = message.from_user.first_name or "друг"
    text = (
        f"👋 <b>Привет, {user_name}!</b>\n\n"
        "Я помогу скачать любое медиа из <b>TikTok</b> и <b>YouTube</b>:\n\n"
        "⚡ <b>TikTok обычные видео:</b> отправляю видео без водяного знака + отдельный MP3 трек.\n"
        "📸 <b>TikTok Слайд-шоу:</b> скачиваю все фото высокого качества + оригинальный звук (или только звук!).\n"
        "▶ <b>YouTube & Shorts:</b> скачиваю видеоролик и аудиодорожку в MP3.\n\n"
        "🎧 Также доступен встроенный <b>Mini App плеер</b>, где сохраняются все песни и видео!\n\n"
        "👉 <i>Просто пришли мне ссылку на видео или фото-слайды!</i>"
    )
    bot.reply_to(message, text, reply_markup=get_main_keyboard())

@bot.message_handler(content_types=["web_app_data"])
def handle_webapp_data(message):
    """Handles link submissions from inside the Telegram Mini App."""
    try:
        data = json.loads(message.web_app_data.data)
        url = data.get("url")
        req_type = data.get("type", "auto")
        if url:
            bot.send_message(message.chat.id, f"📥 <b>Получена ссылка из Mini App:</b>\n{url}\nОбрабатываю...")
            process_media_url(message, url, forced_type=req_type)
    except Exception as e:
        logger.error(f"Error handling WebApp data: {e}")

@bot.message_handler(func=lambda msg: bool(extract_urls(msg.text or "")))
def handle_incoming_link(message):
    urls = extract_urls(message.text)
    if not urls:
        return
    url = urls[0]
    process_media_url(message, url)

def process_media_url(message, url: str, forced_type: str = "auto"):
    chat_id = message.chat.id
    status_msg = bot.send_message(chat_id, "⏳ <i>Получаю информацию о медиа...</i>")

    try:
        if is_tiktok_url(url):
            handle_tiktok(message, status_msg, url, forced_type)
        elif is_youtube_url(url):
            handle_youtube(message, status_msg, url, forced_type)
        else:
            bot.edit_message_text("❌ Поддерживаются только ссылки на TikTok и YouTube.", chat_id, status_msg.message_id)
    except Exception as e:
        logger.error(f"Error in process_media_url: {e}")
        bot.edit_message_text(f"⚠️ Ошибка при обработке ссылки: {e}", chat_id, status_msg.message_id)

def handle_tiktok(message, status_msg, url: str, forced_type: str = "auto"):
    chat_id = message.chat.id
    data = fetch_tiktok_data(url)

    if not data:
        bot.edit_message_text("⚠️ Не удалось получить данные из TikTok. Попробуйте еще раз.", chat_id, status_msg.message_id)
        return

    # Check if it is a Slideshow (Images list)
    images = data.get("images")
    title = data.get("title", "TikTok Media")
    author = data.get("author", {}).get("nickname", "TikTok User")
    music_url = data.get("music")
    music_title = data.get("music_info", {}).get("title", "TikTok Sound")
    music_author = data.get("music_info", {}).get("author", author)

    if images and isinstance(images, list) and len(images) > 0:
        # It's a slideshow!
        token_id = str(abs(hash(url)))
        slideshow_cache[token_id] = {
            "images": images,
            "music_url": music_url,
            "title": title,
            "author": author,
            "music_title": music_title,
            "music_author": music_author
        }

        if forced_type == "audio":
            send_slideshow_audio(chat_id, status_msg.message_id, token_id)
            return
        elif forced_type == "slides":
            send_slideshow_full(chat_id, status_msg.message_id, token_id)
            return

        # Ask user with Inline Buttons according to their choice:
        markup = InlineKeyboardMarkup()
        markup.add(
            InlineKeyboardButton(f"🎬 Скачать фото ({len(images)} шт) + звук", callback_data=f"slide_full:{token_id}")
        )
        markup.add(
            InlineKeyboardButton("🎵 Только звук (без фоток)", callback_data=f"slide_audio:{token_id}")
        )
        if WEBAPP_URL and WEBAPP_URL.startswith("https://"):
            markup.add(InlineKeyboardButton("📱 Открыть в Mini App", web_app=WebAppInfo(url=WEBAPP_URL)))

        text = (
            f"📸 <b>TikTok Слайд-шоу обнаружено!</b>\n\n"
            f"📝 <b>Описание:</b> {title[:150]}\n"
            f"👤 <b>Автор:</b> {author}\n"
            f"🖼 <b>Количество фото:</b> {len(images)}\n"
            f"🎶 <b>Трек:</b> {music_title} - {music_author}\n\n"
            "Выберите нужный вариант:"
        )
        bot.edit_message_text(text, chat_id, status_msg.message_id, reply_markup=markup)
        return

    # It's a regular TikTok Video
    bot.edit_message_text("🚀 Скачиваю видео без водяного знака и извлекаю звук...", chat_id, status_msg.message_id)

    video_url = data.get("play") or data.get("wmplay")
    with tempfile.TemporaryDirectory() as tmp_dir:
        video_path = os.path.join(tmp_dir, "tiktok_video.mp4")
        audio_path = os.path.join(tmp_dir, "tiktok_audio.mp3")

        # 1. Download video
        has_video = download_file(video_url, video_path)
        # 2. Download audio
        has_audio = download_file(music_url, audio_path) if music_url else False

        caption = f"🎬 <b>{title[:120]}</b>\n👤 {author}\n🎶 {music_title}"
        markup = get_main_keyboard()

        if has_video:
            with open(video_path, "rb") as vf:
                bot.send_video(chat_id, vf, caption=caption, reply_markup=markup, supports_streaming=True)

        if has_audio:
            with open(audio_path, "rb") as af:
                bot.send_audio(chat_id, af, title=music_title, performer=music_author)

    bot.delete_message(chat_id, status_msg.message_id)

@bot.callback_query_handler(func=lambda call: call.data.startswith("slide_"))
def handle_slideshow_callback(call):
    chat_id = call.message.chat.id
    action, token_id = call.data.split(":")

    if token_id not in slideshow_cache:
        bot.answer_callback_query(call.id, "Данные устарели. Отправьте ссылку заново.", show_alert=True)
        return

    bot.answer_callback_query(call.id)
    if action == "slide_full":
        send_slideshow_full(chat_id, call.message.message_id, token_id)
    elif action == "slide_audio":
        send_slideshow_audio(chat_id, call.message.message_id, token_id)

def send_slideshow_full(chat_id: int, message_id: int, token_id: str):
    data = slideshow_cache.get(token_id)
    if not data:
        return

    bot.edit_message_text("⏳ <i>Скачиваю фотографии и музыку из слайд-шоу...</i>", chat_id, message_id)
    images = data["images"]
    music_url = data.get("music_url")

    with tempfile.TemporaryDirectory() as tmp_dir:
        # Download images and prepare media groups (max 10 photos per group)
        media_group = []
        for idx, img_url in enumerate(images):
            img_path = os.path.join(tmp_dir, f"slide_{idx}.jpg")
            if download_file(img_url, img_path):
                caption = f"📸 Слайд {idx+1}/{len(images)}\n{data['title'][:100]}" if idx == 0 else ""
                media_group.append(InputMediaPhoto(open(img_path, "rb"), caption=caption))

            if len(media_group) == 10:
                bot.send_media_group(chat_id, media_group)
                media_group = []

        if media_group:
            bot.send_media_group(chat_id, media_group)

        # Download and send sound
        if music_url:
            audio_path = os.path.join(tmp_dir, "slide_audio.mp3")
            if download_file(music_url, audio_path):
                with open(audio_path, "rb") as af:
                    bot.send_audio(
                        chat_id,
                        af,
                        title=data["music_title"],
                        performer=data["music_author"],
                        caption="🎶 Оригинальная музыка из слайд-шоу",
                        reply_markup=get_main_keyboard()
                    )

    bot.delete_message(chat_id, message_id)

def send_slideshow_audio(chat_id: int, message_id: int, token_id: str):
    data = slideshow_cache.get(token_id)
    if not data:
        return

    bot.edit_message_text("⏳ <i>Скачиваю только аудиодорожку...</i>", chat_id, message_id)
    music_url = data.get("music_url")

    if not music_url:
        bot.edit_message_text("❌ Аудиодорожка не найдена для этого слайд-шоу.", chat_id, message_id)
        return

    with tempfile.TemporaryDirectory() as tmp_dir:
        audio_path = os.path.join(tmp_dir, "slide_audio.mp3")
        if download_file(music_url, audio_path):
            with open(audio_path, "rb") as af:
                bot.send_audio(
                    chat_id,
                    af,
                    title=data["music_title"],
                    performer=data["music_author"],
                    caption="🎶 Музыка из TikTok слайд-шоу",
                    reply_markup=get_main_keyboard()
                )

    bot.delete_message(chat_id, message_id)

def handle_youtube(message, status_msg, url: str, forced_type: str = "auto"):
    chat_id = message.chat.id
    bot.edit_message_text("🚀 Скачиваю видео и аудио с YouTube (yt-dlp)...", chat_id, status_msg.message_id)

    download_video = (forced_type != "audio")
    download_audio = (forced_type != "video")

    res = download_youtube_media(url, download_video=download_video, download_audio=download_audio)

    caption = f"▶ <b>{res['title'][:120]}</b>\n👤 {res['author']}"
    markup = get_main_keyboard()

    if res.get("video_path") and os.path.exists(res["video_path"]):
        with open(res["video_path"], "rb") as vf:
            bot.send_video(chat_id, vf, caption=caption, reply_markup=markup, supports_streaming=True)

    if res.get("audio_path") and os.path.exists(res["audio_path"]):
        with open(res["audio_path"], "rb") as af:
            bot.send_audio(chat_id, af, title=res["title"], performer=res["author"])

    bot.delete_message(chat_id, status_msg.message_id)

if __name__ == "__main__":
    logger.info("Starting Media Downloader Telegram Bot...")
    if BOT_TOKEN == "YOUR_BOT_TOKEN_HERE" or not BOT_TOKEN:
        print("\n[!] ВНИМАНИЕ: BOT_TOKEN не установлен!")
        print("Запустите бота командой: python bot.py --token <ВАШ_ТОКЕН> или укажите BOT_TOKEN в начале файла.\n")
    try:
        bot.infinity_polling(timeout=20, long_polling_timeout=10)
    except Exception as e:
        logger.error(f"Polling error: {e}")
