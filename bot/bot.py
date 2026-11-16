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
import html
import logging
import secrets
import shutil
import tempfile
import asyncio
import re
from typing import Optional, List, Dict, Any
from pathlib import Path
from urllib.parse import urlsplit

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
def load_project_env() -> None:
    env_file = Path(__file__).resolve().parent.parent / ".env"
    if not env_file.is_file():
        return
    try:
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if key in {"BOT_TOKEN", "WEBAPP_URL"} and not os.environ.get(key):
                os.environ[key] = value.strip().strip("\"'")
    except OSError as exc:
        logging.getLogger("MediaBot").warning("Could not read local .env file: %s", exc)

load_project_env()
BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
if len(sys.argv) > 1 and not sys.argv[1].startswith("-"):
    BOT_TOKEN = sys.argv[1]
if len(sys.argv) > 2:
    os.environ["WEBAPP_URL"] = sys.argv[2]

WEBAPP_URL = os.environ.get("WEBAPP_URL", "https://pelomen.github.io/media-bot-miniapp/")

logging.basicConfig(
    format="%(asctime)s - [%(levelname)s] - %(name)s - %(message)s",
    level=logging.INFO
)
logger = logging.getLogger("MediaBot")

# TeleBot requires token with a colon on initialization
_init_token = BOT_TOKEN if (BOT_TOKEN and ":" in BOT_TOKEN) else "123456789:AAPlaceholderTokenForInitializingHandlers"
bot = telebot.TeleBot(_init_token, parse_mode="HTML")

# In-memory cache for pending slideshow selections
slideshow_cache: Dict[str, Dict[str, Any]] = {}

def is_tiktok_url(url: str) -> bool:
    host = _url_host(url)
    return host == "douyin.com" or host.endswith(".douyin.com") or host == "tiktok.com" or host.endswith(".tiktok.com")

def is_youtube_url(url: str) -> bool:
    host = _url_host(url)
    return host == "youtu.be" or host.endswith(".youtu.be") or host == "youtube.com" or host.endswith(".youtube.com")

def _url_host(url: str) -> str:
    candidate = url if "://" in url else f"https://{url}"
    try:
        return (urlsplit(candidate).hostname or "").lower().rstrip(".")
    except ValueError:
        return ""

def extract_urls(text: str) -> List[str]:
    url_pattern = r'https?://[^\s<>"]+|www\.[^\s<>"]+'
    urls = re.findall(url_pattern, text or "", flags=re.IGNORECASE)
    cleaned = [url.rstrip(".,!?;:)]}") for url in urls]
    return [f"https://{url}" if url.lower().startswith("www.") else url for url in cleaned]

# ==============================================================================
# TikTok Processing (Video, Slideshow Photos & Music)
# ==============================================================================
def _normalize_tikwm_data(data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Normalizes a tikwm-style payload into the shape the bot expects."""
    if not isinstance(data, dict):
        return None
    if data.get("code") not in (0, 200) or "data" not in data:
        return None
    payload = data.get("data")
    if not isinstance(payload, dict) or not payload:
        return None
    # tikwm returns relative media paths like "/video/media/play/..." — make them absolute
    for key in ("play", "wmplay", "hdplay", "music"):
        value = payload.get(key)
        if isinstance(value, str) and value.startswith("/"):
            payload[key] = f"https://tikwm.com{value}"
    return payload


def _fetch_tiklydown_data(url: str) -> Optional[Dict[str, Any]]:
    """Fallback provider: tiklydown returns a compatible json structure."""
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json"
        }
        res = requests.get(f"https://api.tiklydown.eu.org/api/download?url={url}", headers=headers, timeout=15)
        if res.status_code != 200:
            logger.warning(f"tiklydown status: {res.status_code}")
            return None
        raw = res.json()
        if not isinstance(raw, dict) or raw.get("error"):
            return None
        video = raw.get("video") or {}
        music = raw.get("music") or {}
        images = raw.get("images")
        return {
            "play": video.get("noWatermark") or video.get("playAddr") or video.get("downloadAddr"),
            "wmplay": video.get("watermarked") or None,
            "images": images if isinstance(images, list) else None,
            "music": music.get("play_url") or music.get("original_sound_url"),
            "title": raw.get("title") or "TikTok Media",
            "author": {"nickname": (raw.get("author") or {}).get("nickname", "TikTok User")},
            "music_info": {"title": music.get("title", "TikTok Sound"), "author": music.get("author", "")},
        }
    except Exception as e:
        logger.error(f"Error querying tiklydown API: {e}")
    return None


def fetch_tiktok_data(url: str) -> Optional[Dict[str, Any]]:
    """Fetches metadata with zero watermark. Tries TikWM first, falls back to tiklydown."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json"
    }
    for attempt, api_url in enumerate(("https://tikwm.com/api/", "https://tikwm.us/api/", "https://www.tikwm.com/api/")):
        try:
            res = requests.post(api_url, data={"url": url, "count": 12, "cursor": 0, "web": 1, "hd": 1}, headers=headers, timeout=15)
            if res.status_code == 200:
                data = _normalize_tikwm_data(res.json())
                if data:
                    return data
                logger.warning(f"TikWM ({api_url}) returned an unusable response")
            else:
                logger.warning(f"TikWM ({api_url}) status: {res.status_code}")
        except Exception as e:
            logger.error(f"Error querying TikWM ({api_url}): {e}")

    fallback = _fetch_tiklydown_data(url)
    if fallback:
        logger.info("TikWM unavailable, using tiklydown fallback data")
        return fallback
    return None


def _guess_audio_ext(content_type: str) -> str:
    """Picks a truthful file extension so Telegram parses audio correctly."""
    ct = (content_type or "").lower()
    if "mp4" in ct or "m4a" in ct or "aac" in ct:
        return "m4a"
    if "mpeg" in ct or "mp3" in ct:
        return "mp3"
    return "mp3"


def download_audio_via_ytdlp(url: str, output_dir: str) -> Optional[str]:
    """Last-resort audio extraction via yt-dlp (works even when 3rd-party APIs are down)."""
    import yt_dlp

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": os.path.join(output_dir, "fallback_audio.%(ext)s"),
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }],
        "quiet": True,
        "no_warnings": True,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.extract_info(url, download=True)
        audio_file = os.path.join(output_dir, "fallback_audio.mp3")
        if os.path.exists(audio_file) and os.path.getsize(audio_file) > 0:
            return audio_file
    except Exception as e:
        logger.error(f"yt-dlp audio fallback error: {e}")
    return None

def download_file(url: str, output_path: str) -> Optional[str]:
    """Downloads a remote file to disk. Returns the actual path (with a truthful
    extension based on the server's content type) or None on failure."""
    if not isinstance(url, str) or not url:
        return None
    try:
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Referer": "https://www.tiktok.com/"}
        with requests.get(url, headers=headers, stream=True, timeout=30) as r:
            r.raise_for_status()
            # Some CDNs serve m4a/aac for "music" links — keep the real extension
            ext = _guess_audio_ext(r.headers.get("Content-Type", ""))
            stem, current_ext = os.path.splitext(output_path)
            if current_ext.lower() in (".mp3", ".m4a") and current_ext.lower() != f".{ext}":
                output_path = f"{stem}.{ext}"
            with open(output_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=65536):
                    if chunk:
                        f.write(chunk)
        if os.path.getsize(output_path) > 0:
            return output_path
        os.remove(output_path)
    except Exception as e:
        logger.error(f"Download failed for {url}: {e}")
        try:
            os.remove(output_path)
        except OSError:
            pass
    return None

# ==============================================================================
# YouTube Processing via yt-dlp
# ==============================================================================
def download_youtube_media(url: str, download_video: bool = True, download_audio: bool = True) -> Dict[str, Any]:
    """Downloads YouTube video and extracts MP3 audio."""
    import yt_dlp

    temp_dir = tempfile.mkdtemp(prefix="yt_")
    result = {"video_path": None, "audio_path": None, "title": "YouTube Video", "author": "YouTube", "duration": 0, "temp_dir": temp_dir}

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
    user_name = html.escape(message.from_user.first_name or "друг")
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
        if not isinstance(req_type, str) or req_type not in {"auto", "audio", "slides", "video"}:
            req_type = "auto"
        if isinstance(url, str) and url:
            bot.send_message(message.chat.id, f"📥 <b>Получена ссылка из Mini App:</b>\n{html.escape(url)}\nОбрабатываю...")
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
        bot.edit_message_text(f"⚠️ Ошибка при обработке ссылки: {html.escape(str(e))}", chat_id, status_msg.message_id)

def handle_tiktok(message, status_msg, url: str, forced_type: str = "auto"):
    chat_id = message.chat.id
    data = fetch_tiktok_data(url)

    if not data:
        # All provider APIs failed — fall back to direct yt-dlp extraction
        logger.info("Provider APIs failed, using yt-dlp fallback for TikTok")
        yt_res = download_youtube_media(url, download_video=(forced_type != "audio"), download_audio=True)
        sent_any = False
        caption = f"🎬 <b>{html.escape(str(yt_res['title'])[:120])}</b>\n👤 {html.escape(str(yt_res['author']))}"
        if yt_res.get("video_path") and os.path.exists(yt_res["video_path"]):
            with open(yt_res["video_path"], "rb") as vf:
                bot.send_video(chat_id, vf, caption=caption, reply_markup=get_main_keyboard(), supports_streaming=True)
            sent_any = True
        if yt_res.get("audio_path") and os.path.exists(yt_res["audio_path"]):
            with open(yt_res["audio_path"], "rb") as af:
                bot.send_audio(chat_id, af, title=yt_res["title"], performer=yt_res["author"])
            sent_any = True
        shutil.rmtree(yt_res["temp_dir"], ignore_errors=True)
        if sent_any:
            bot.delete_message(chat_id, status_msg.message_id)
        else:
            bot.edit_message_text(
                "❌ Не удалось скачать медиа. Источники TikTok недоступны — попробуйте позже.",
                chat_id, status_msg.message_id)
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
        token_id = secrets.token_urlsafe(9)
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
            f"📝 <b>Описание:</b> {html.escape(str(title)[:150])}\n"
            f"👤 <b>Автор:</b> {html.escape(str(author))}\n"
            f"🖼 <b>Количество фото:</b> {len(images)}\n"
            f"🎶 <b>Трек:</b> {html.escape(str(music_title))} - {html.escape(str(music_author))}\n\n"
            "Выберите нужный вариант:"
        )
        bot.edit_message_text(text, chat_id, status_msg.message_id, reply_markup=markup)
        return

    # It's a regular TikTok Video
    if forced_type == "slides":
        bot.edit_message_text("❌ В этой ссылке фото-слайд-шоу не найдено.", chat_id, status_msg.message_id)
        return
    bot.edit_message_text("🚀 Скачиваю видео без водяного знака и извлекаю звук...", chat_id, status_msg.message_id)

    video_url = data.get("play") or data.get("wmplay")
    with tempfile.TemporaryDirectory() as tmp_dir:
        video_path = os.path.join(tmp_dir, "tiktok_video.mp4")
        audio_path = os.path.join(tmp_dir, "tiktok_audio.mp3")

        # 1. Download video
        has_video = forced_type != "audio" and bool(video_url) and download_file(video_url, video_path)
        # 2. Download audio
        has_audio = download_file(music_url, audio_path) if music_url else None

        # 3. yt-dlp fallback: provider APIs are flaky, so fall back to direct extraction
        if not has_audio:
            fallback_audio = download_audio_via_ytdlp(url, tmp_dir)
            if fallback_audio:
                has_audio = fallback_audio
            elif not has_video and forced_type != "audio":
                # Nothing came from the API at all — try full yt-dlp video download
                yt_res = download_youtube_media(url, download_video=True, download_audio=False)
                # yt-dlp handles TikTok links too; reuse its video output if present
                if yt_res.get("video_path"):
                    has_video = yt_res["video_path"]
                    title = yt_res["title"]
                    author = yt_res["author"]

        caption = f"🎬 <b>{html.escape(str(title)[:120])}</b>\n👤 {html.escape(str(author))}\n🎶 {html.escape(str(music_title))}"
        markup = get_main_keyboard()

        if has_video:
            with open(has_video, "rb") as vf:
                bot.send_video(chat_id, vf, caption=caption, reply_markup=markup, supports_streaming=True)

        if has_audio:
            with open(has_audio, "rb") as af:
                bot.send_audio(chat_id, af, title=music_title, performer=music_author)

        if not has_video and not has_audio:
            bot.edit_message_text(
                "❌ Не удалось скачать видео или аудиодорожку.\n"
                "Источники TikTok сейчас недоступны — попробуйте ещё раз через пару минут.",
                chat_id, status_msg.message_id)
            return

    bot.delete_message(chat_id, status_msg.message_id)

@bot.callback_query_handler(func=lambda call: call.data.startswith("slide_"))
def handle_slideshow_callback(call):
    chat_id = call.message.chat.id
    action, separator, token_id = call.data.partition(":")
    if not separator or action not in {"slide_full", "slide_audio"} or not token_id:
        bot.answer_callback_query(call.id, "Не удалось обработать выбор.", show_alert=True)
        return

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
                caption = f"📸 Слайд {idx+1}/{len(images)}\n{html.escape(str(data['title'])[:100])}" if not media_group else ""
                media_group.append((img_path, caption))

            if len(media_group) == 10:
                _send_photo_batch(chat_id, media_group)
                media_group = []

        if media_group:
            _send_photo_batch(chat_id, media_group)

        # Download and send sound
        if music_url:
            audio_path = os.path.join(tmp_dir, "slide_audio.mp3")
            saved_audio = download_file(music_url, audio_path)
            if saved_audio:
                with open(saved_audio, "rb") as af:
                    bot.send_audio(
                        chat_id,
                        af,
                        title=data["music_title"],
                        performer=data["music_author"],
                        caption="🎶 Оригинальная музыка из слайд-шоу",
                        reply_markup=get_main_keyboard()
                    )

    bot.delete_message(chat_id, message_id)
    slideshow_cache.pop(token_id, None)

def _send_photo_batch(chat_id: int, photos: List[tuple]) -> None:
    if len(photos) == 1:
        path, caption = photos[0]
        with open(path, "rb") as photo:
            bot.send_photo(chat_id, photo, caption=caption, reply_markup=get_main_keyboard())
        return

    media = []
    files = []
    try:
        for path, caption in photos:
            photo = open(path, "rb")
            files.append(photo)
            media.append(InputMediaPhoto(photo, caption=caption))
        bot.send_media_group(chat_id, media)
    finally:
        for photo in files:
            photo.close()

def send_slideshow_audio(chat_id: int, message_id: int, token_id: str):
    data = slideshow_cache.get(token_id)
    if not data:
        return

    bot.edit_message_text("⏳ <i>Скачиваю только аудиодорожку...</i>", chat_id, message_id)
    music_url = data.get("music_url")

    if not music_url:
        bot.edit_message_text("❌ Аудиодорожка не найдена для этого слайд-шоу.", chat_id, message_id)
        slideshow_cache.pop(token_id, None)
        return

    with tempfile.TemporaryDirectory() as tmp_dir:
        audio_path = os.path.join(tmp_dir, "slide_audio.mp3")
        saved_audio = download_file(music_url, audio_path)
        if saved_audio:
            with open(saved_audio, "rb") as af:
                bot.send_audio(
                    chat_id,
                    af,
                    title=data["music_title"],
                    performer=data["music_author"],
                    caption="🎶 Музыка из TikTok слайд-шоу",
                    reply_markup=get_main_keyboard()
                )
        else:
            bot.edit_message_text("❌ Не удалось скачать аудиодорожку. Попробуйте ещё раз.", chat_id, message_id)
            slideshow_cache.pop(token_id, None)
            return

    bot.delete_message(chat_id, message_id)
    slideshow_cache.pop(token_id, None)

def handle_youtube(message, status_msg, url: str, forced_type: str = "auto"):
    chat_id = message.chat.id
    if forced_type == "slides":
        bot.edit_message_text("❌ Фото-слайд-шоу доступны только для ссылок TikTok.", chat_id, status_msg.message_id)
        return
    bot.edit_message_text("🚀 Скачиваю видео и аудио с YouTube (yt-dlp)...", chat_id, status_msg.message_id)
    res = None
    try:
        download_video = (forced_type != "audio")
        download_audio = (forced_type != "video")
        res = download_youtube_media(url, download_video=download_video, download_audio=download_audio)

        caption = f"▶ <b>{html.escape(str(res['title'])[:120])}</b>\n👤 {html.escape(str(res['author']))}"
        markup = get_main_keyboard()
        sent_any = False

        if res.get("video_path") and os.path.exists(res["video_path"]):
            with open(res["video_path"], "rb") as vf:
                bot.send_video(chat_id, vf, caption=caption, reply_markup=markup, supports_streaming=True)
                sent_any = True

        if res.get("audio_path") and os.path.exists(res["audio_path"]):
            with open(res["audio_path"], "rb") as af:
                bot.send_audio(chat_id, af, title=res["title"], performer=res["author"])
                sent_any = True

        if sent_any:
            bot.delete_message(chat_id, status_msg.message_id)
        else:
            bot.edit_message_text("❌ Не удалось скачать видео или аудиодорожку. Проверьте ссылку и попробуйте снова.", chat_id, status_msg.message_id)
    finally:
        if res and res.get("temp_dir"):
            shutil.rmtree(res["temp_dir"], ignore_errors=True)

if __name__ == "__main__":
    if len(sys.argv) > 1 and not sys.argv[1].startswith("-"):
        BOT_TOKEN = sys.argv[1]
        bot.token = BOT_TOKEN

    if len(sys.argv) > 2:
        WEBAPP_URL = sys.argv[2]

    if not BOT_TOKEN or ":" not in BOT_TOKEN or "Placeholder" in BOT_TOKEN:
        print("\n" + "=" * 50)
        print(" [!] ВНИМАНИЕ: Не указан Telegram BOT_TOKEN!")
        print("=" * 50)
        print(" Запуск:")
        print("   python bot.py <ВАШ_ТОКЕН> [URL_МИНИ_АППА]")
        print(" Или:")
        print("   export BOT_TOKEN='123456:ABC...' && python bot.py")
        print("   Укажите BOT_TOKEN в локальном файле .env")
        print("=" * 50 + "\n")
        sys.exit(1)

    logger.info("Starting Media Downloader Telegram Bot...")
    try:
        bot.infinity_polling(timeout=20, long_polling_timeout=10)
    except Exception as e:
        logger.error(f"Polling error: {e}")
