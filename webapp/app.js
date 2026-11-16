/**
 * Media Hub Player - Telegram Mini App
 * Pure Vanilla JavaScript with IndexedDB persistence & Telegram SDK
 */

// Initialize Telegram WebApp
const tg = window.Telegram?.WebApp;
if (tg) {
  try {
    tg.ready();
    tg.expand();
    if (tg.enableClosingConfirmation) tg.enableClosingConfirmation();
  } catch (e) {
    console.warn("Telegram WebApp API init warning:", e);
  }
}

function triggerHaptic(type = "light") {
  try {
    if (tg?.HapticFeedback) {
      if (type === "success" || type === "error" || type === "warning") {
        tg.HapticFeedback.notificationOccurred(type);
      } else {
        tg.HapticFeedback.impactOccurred(type);
      }
    }
  } catch (e) {}
}

/* ==========================================================================
   IndexedDB Storage Layer for Audio, Video and Slides
   ========================================================================== */
class MediaDB {
  constructor() {
    this.dbName = "MediaHubDB";
    this.version = 1;
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains("tracks")) {
          db.createObjectStore("tracks", { keyPath: "id", autoIncrement: true });
        }
        if (!db.objectStoreNames.contains("videos")) {
          db.createObjectStore("videos", { keyPath: "id", autoIncrement: true });
        }
        if (!db.objectStoreNames.contains("slides")) {
          db.createObjectStore("slides", { keyPath: "id", autoIncrement: true });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => reject(event.target.error);
    });
  }

  async getAll(storeName) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], "readonly");
      const store = transaction.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async add(storeName, item) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.add(item);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async delete(storeName, id) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.delete(Number(id));
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  async clearAll() {
    const stores = ["tracks", "videos", "slides"];
    for (const storeName of stores) {
      await new Promise((resolve, reject) => {
        const transaction = this.db.transaction([storeName], "readwrite");
        transaction.objectStore(storeName).clear();
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error("IndexedDB clear aborted"));
      });
    }
  }
}

const db = new MediaDB();

/* ==========================================================================
   State & UI References
   ========================================================================== */
const state = {
  tracks: [],
  videos: [],
  slideshows: [],
  currentTrackIndex: -1,
  isPlaying: false,
  isShuffle: false,
  repeatMode: "off", // 'off', 'one', 'all'
  currentSlideIndex: 0,
  activeSlideshow: null
};

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function restoreStoredMedia(item) {
  if (item.blob instanceof Blob && item.url?.startsWith("blob:")) {
    item.url = URL.createObjectURL(item.blob);
  }
  return item;
}

function restoreStoredSlideshow(slide) {
  if (Array.isArray(slide.imageBlobs)) {
    slide.images = slide.imageBlobs.map((blob) => URL.createObjectURL(blob));
  }
  if (slide.audioBlob instanceof Blob) {
    slide.audioUrl = URL.createObjectURL(slide.audioBlob);
  }
  return slide;
}

function revokeBlobUrl(url) {
  if (typeof url === "string" && url.startsWith("blob:")) URL.revokeObjectURL(url);
}

// DOM Elements
const audio = document.getElementById("globalAudio");
const playPauseBtn = document.getElementById("playPauseBtn");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const shuffleBtn = document.getElementById("shuffleBtn");
const repeatBtn = document.getElementById("repeatBtn");
const progressBar = document.getElementById("progressBar");
const progressFill = document.getElementById("progressFill");
const progressThumb = document.getElementById("progressThumb");
const currentTimeEl = document.getElementById("currentTime");
const totalDurationEl = document.getElementById("totalDuration");
const volumeSlider = document.getElementById("volumeSlider");

const currentTrackTitle = document.getElementById("currentTrackTitle");
const currentTrackAuthor = document.getElementById("currentTrackAuthor");
const currentCover = document.getElementById("currentCover");
const heroCard = document.querySelector(".player-hero-card");
const trackCount = document.getElementById("trackCount");
const trackListEl = document.getElementById("trackList");

const videoGridEl = document.getElementById("videoGrid");
const videoCount = document.getElementById("videoCount");
const videoModal = document.getElementById("videoModal");
const modalVideoPlayer = document.getElementById("modalVideoPlayer");
const modalVideoTitle = document.getElementById("modalVideoTitle");
const closeVideoModal = document.getElementById("closeVideoModal");

const slidesCount = document.getElementById("slidesCount");
const slideshowViewer = document.getElementById("slideshowViewer");

const fileInput = document.getElementById("fileInput");
const importBtn = document.getElementById("importBtn");
const clearDataBtn = document.getElementById("clearDataBtn");
const submitLinkBtn = document.getElementById("submitLinkBtn");
const linkInput = document.getElementById("linkInput");
const downloadFeedback = document.getElementById("downloadFeedback");

/* ==========================================================================
   Tab Navigation
   ========================================================================== */
document.querySelectorAll(".nav-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    triggerHaptic("light");
    document.querySelectorAll(".nav-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));

    tab.classList.add("active");
    const target = tab.getAttribute("data-tab");
    document.getElementById(target).classList.add("active");
  });
});

/* ==========================================================================
   Audio Player Logic
   ========================================================================== */
function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m < 10 ? "0" + m : m}:${s < 10 ? "0" + s : s}`;
}

function loadTrack(index) {
  if (index < 0 || index >= state.tracks.length) return;
  state.currentTrackIndex = index;
  const track = state.tracks[index];

  audio.src = track.url;
  currentTrackTitle.textContent = track.title || "Без названия";
  currentTrackAuthor.textContent = track.author || "TikTok / YouTube";

  if (track.cover) {
    currentCover.innerHTML = `<img src="${escapeHTML(track.cover)}" alt="cover">`;
  } else {
    currentCover.innerHTML = `<i class="fa-solid fa-compact-disc disc-spinning" id="discIcon"></i>`;
  }

  // Update track list active state
  document.querySelectorAll(".track-item").forEach((el, idx) => {
    el.classList.toggle("active", idx === index);
  });
}

function playTrack() {
  if (state.currentTrackIndex === -1 && state.tracks.length > 0 && !audio.src) {
    loadTrack(0);
  }
  if (!audio.src) return;

  audio.play().then(() => {
    state.isPlaying = true;
    heroCard.classList.add("playing");
    playPauseBtn.innerHTML = `<i class="fa-solid fa-pause"></i>`;
  }).catch((err) => console.log("Playback error:", err));
}

function pauseTrack() {
  audio.pause();
  state.isPlaying = false;
  heroCard.classList.remove("playing");
  playPauseBtn.innerHTML = `<i class="fa-solid fa-play"></i>`;
}

playPauseBtn.addEventListener("click", () => {
  triggerHaptic("medium");
  if (state.isPlaying) {
    pauseTrack();
  } else {
    playTrack();
  }
});

prevBtn.addEventListener("click", () => {
  triggerHaptic("light");
  if (state.tracks.length === 0) return;
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  let newIdx = state.currentTrackIndex - 1;
  if (newIdx < 0) newIdx = state.tracks.length - 1;
  loadTrack(newIdx);
  playTrack();
});

nextBtn.addEventListener("click", () => {
  triggerHaptic("light");
  handleNextTrack();
});

function handleNextTrack() {
  if (state.tracks.length === 0) return;
  let nextIdx;
  if (state.isShuffle) {
    nextIdx = Math.floor(Math.random() * state.tracks.length);
  } else {
    nextIdx = state.currentTrackIndex + 1;
    if (nextIdx >= state.tracks.length) {
      if (state.repeatMode === "off") {
        pauseTrack();
        return;
      }
      nextIdx = 0;
    }
  }
  loadTrack(nextIdx);
  playTrack();
}

shuffleBtn.addEventListener("click", () => {
  triggerHaptic("light");
  state.isShuffle = !state.isShuffle;
  shuffleBtn.classList.toggle("active", state.isShuffle);
});

repeatBtn.addEventListener("click", () => {
  triggerHaptic("light");
  if (state.repeatMode === "off") {
    state.repeatMode = "all";
    repeatBtn.classList.add("active");
    repeatBtn.innerHTML = `<i class="fa-solid fa-repeat"></i>`;
  } else if (state.repeatMode === "all") {
    state.repeatMode = "one";
    repeatBtn.classList.add("active");
    repeatBtn.innerHTML = `<i class="fa-solid fa-1"></i>`;
  } else {
    state.repeatMode = "off";
    repeatBtn.classList.remove("active");
    repeatBtn.innerHTML = `<i class="fa-solid fa-repeat"></i>`;
  }
});

audio.addEventListener("timeupdate", () => {
  const current = audio.currentTime;
  const duration = audio.duration || 0;
  currentTimeEl.textContent = formatTime(current);
  totalDurationEl.textContent = formatTime(duration);

  if (duration > 0) {
    const percent = (current / duration) * 100;
    progressFill.style.width = `${percent}%`;
    progressThumb.style.left = `${percent}%`;
  }
});

audio.addEventListener("ended", () => {
  if (state.currentTrackIndex === -1) {
    pauseTrack();
    return;
  }
  if (state.repeatMode === "one") {
    audio.currentTime = 0;
    playTrack();
  } else {
    handleNextTrack();
  }
});

progressBar.addEventListener("click", (e) => {
  const rect = progressBar.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const width = rect.width;
  if (audio.duration) {
    audio.currentTime = (clickX / width) * audio.duration;
  }
});

volumeSlider.addEventListener("input", (e) => {
  audio.volume = parseFloat(e.target.value);
});

/* ==========================================================================
   Render & UI Updates
   ========================================================================== */
function renderTracks() {
  trackCount.textContent = state.tracks.length;
  if (state.tracks.length === 0) {
    trackListEl.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-music"></i>
        <p>Пока нет скачанных песен.<br>Отправьте ссылку в бота или загрузите аудиофайл кнопкой вверху.</p>
      </div>`;
    return;
  }

  trackListEl.innerHTML = state.tracks.map((track, idx) => `
      <div class="track-item ${idx === state.currentTrackIndex ? "active" : ""}" data-index="${idx}">
      <div class="track-item-left">
        <div class="track-thumb">
          ${track.cover ? `<img src="${escapeHTML(track.cover)}" alt="">` : `<i class="fa-solid fa-music"></i>`}
        </div>
        <div class="track-info">
          <h4>${escapeHTML(track.title || "Песня #" + (idx + 1))}</h4>
          <p>${escapeHTML(track.author || "TikTok / YouTube")} • ${escapeHTML(track.duration || "Аудио")}</p>
        </div>
      </div>
      <div class="track-actions">
        <button class="track-del-btn" data-id="${track.id}" title="Удалить"><i class="fa-solid fa-trash-can"></i></button>
      </div>
    </div>
  `).join("");

  // Attach click listeners
  trackListEl.querySelectorAll(".track-item").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".track-del-btn")) return;
      const idx = Number(el.getAttribute("data-index"));
      loadTrack(idx);
      playTrack();
    });
  });

  trackListEl.querySelectorAll(".track-del-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      triggerHaptic("warning");
      const id = btn.getAttribute("data-id");
      const deletedIndex = state.tracks.findIndex((track) => track.id === Number(id));
      const deletingCurrent = deletedIndex === state.currentTrackIndex;
      const deletedTrack = state.tracks[deletedIndex];
      await db.delete("tracks", id);
      revokeBlobUrl(deletedTrack?.url);
      state.tracks = state.tracks.filter((t) => t.id !== Number(id));
      if (deletingCurrent) {
        pauseTrack();
        state.currentTrackIndex = -1;
        audio.removeAttribute("src");
        if (state.tracks.length > 0) {
          loadTrack(Math.min(deletedIndex, state.tracks.length - 1));
        } else {
          currentTrackTitle.textContent = "Выберите песню";
          currentTrackAuthor.textContent = "Media Player";
          currentCover.innerHTML = '<i class="fa-solid fa-compact-disc disc-spinning" id="discIcon"></i>';
        }
      } else if (deletedIndex >= 0 && deletedIndex < state.currentTrackIndex) {
        state.currentTrackIndex--;
      }
      renderTracks();
    });
  });
}

function renderVideos() {
  videoCount.textContent = state.videos.length;
  if (state.videos.length === 0) {
    videoGridEl.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-clapperboard"></i>
        <p>Нет сохраненных видео.<br>Скачивайте клипы TikTok и ролики YouTube через бота.</p>
      </div>`;
    return;
  }

  videoGridEl.innerHTML = state.videos.map((vid) => `
    <div class="video-card" data-url="${escapeHTML(vid.url)}" data-title="${escapeHTML(vid.title)}">
      <div class="video-card-thumb">
        ${vid.thumb ? `<img src="${escapeHTML(vid.thumb)}" alt="">` : `<i class="fa-solid fa-film" style="font-size:32px;color:#f5f5f5;"></i>`}
        <div class="play-badge"><i class="fa-solid fa-play"></i></div>
      </div>
      <div class="video-card-body">
        <h4>${escapeHTML(vid.title || "Видео")}</h4>
      </div>
    </div>
  `).join("");

  videoGridEl.querySelectorAll(".video-card").forEach((card) => {
    card.addEventListener("click", () => {
      triggerHaptic("medium");
      pauseTrack();
      const url = card.getAttribute("data-url");
      const title = card.getAttribute("data-title");
      modalVideoPlayer.src = url;
      modalVideoTitle.textContent = title;
      videoModal.classList.add("open");
      modalVideoPlayer.play();
    });
  });
}

closeVideoModal.addEventListener("click", () => {
  modalVideoPlayer.pause();
  modalVideoPlayer.src = "";
  videoModal.classList.remove("open");
});

function renderSlideshows() {
  slidesCount.textContent = state.slideshows.length;
  if (state.slideshows.length === 0) {
    slideshowViewer.className = "slideshow-container empty";
    slideshowViewer.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-camera-retro"></i>
        <p>Слайд-шоу пока не загружены.<br>Пришлите ссылку на фото-карусель TikTok в бота.</p>
      </div>`;
    return;
  }

  const slide = state.slideshows[0]; // Active slideshow
  state.activeSlideshow = slide;
  state.currentSlideIndex = 0;

  slideshowViewer.className = "slideshow-container";
  slideshowViewer.innerHTML = `
    <div class="slides-carousel">
      <img id="activeSlideImage" src="${escapeHTML(slide.images[0])}" alt="Slide">
      <div class="slide-controls">
        <button id="prevSlideBtn" class="slide-btn"><i class="fa-solid fa-chevron-left"></i></button>
        <button id="nextSlideBtn" class="slide-btn"><i class="fa-solid fa-chevron-right"></i></button>
      </div>
      <div class="slide-counter" id="slideCounter">1 / ${slide.images.length}</div>
    </div>
    <div class="slides-music-bar">
      <div>
        <h4 style="font-size:13px;">${escapeHTML(slide.title || "TikTok Слайд-шоу")}</h4>
        <p style="font-size:11px;color:var(--text-muted);">Оригинальный звук</p>
      </div>
      ${slide.audioUrl ? `
        <button id="playSlideMusicBtn" class="icon-btn" style="background:#f5f5f5;color:#080808;">
          <i class="fa-solid fa-play"></i>
        </button>` : ""}
    </div>
  `;

  const prevSlideBtn = document.getElementById("prevSlideBtn");
  const nextSlideBtn = document.getElementById("nextSlideBtn");
  const activeSlideImage = document.getElementById("activeSlideImage");
  const slideCounter = document.getElementById("slideCounter");
  const playSlideMusicBtn = document.getElementById("playSlideMusicBtn");

  if (prevSlideBtn && nextSlideBtn) {
    prevSlideBtn.addEventListener("click", () => {
      triggerHaptic("light");
      if (state.currentSlideIndex > 0) {
        state.currentSlideIndex--;
        activeSlideImage.src = slide.images[state.currentSlideIndex];
        slideCounter.textContent = `${state.currentSlideIndex + 1} / ${slide.images.length}`;
      }
    });

    nextSlideBtn.addEventListener("click", () => {
      triggerHaptic("light");
      if (state.currentSlideIndex < slide.images.length - 1) {
        state.currentSlideIndex++;
        activeSlideImage.src = slide.images[state.currentSlideIndex];
        slideCounter.textContent = `${state.currentSlideIndex + 1} / ${slide.images.length}`;
      }
    });
  }

  if (playSlideMusicBtn && slide.audioUrl) {
    playSlideMusicBtn.addEventListener("click", () => {
      triggerHaptic("medium");
      audio.src = slide.audioUrl;
      state.currentTrackIndex = -1;
      currentTrackTitle.textContent = slide.title || "Звук из слайд-шоу";
      currentTrackAuthor.textContent = "TikTok Audio";
      playTrack();
    });
  }
}

/* ==========================================================================
   File Import & Downloader Tab
   ========================================================================== */
importBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files);
  const imageFiles = files.filter((file) => file.type.startsWith("image/"));
  const slideshowAudio = files.find((file) => file.type.startsWith("audio/"));
  for (const file of files) {
    if (file.type.startsWith("audio/")) {
      const url = URL.createObjectURL(file);
      const newTrack = {
        title: file.name.replace(/\.[^/.]+$/, ""),
        author: "Локальный файл",
        duration: "Аудио",
        url: url,
        cover: null,
        blob: file
      };
      const id = await db.add("tracks", newTrack);
      newTrack.id = id;
      state.tracks.push(newTrack);
    } else if (file.type.startsWith("video/")) {
      const url = URL.createObjectURL(file);
      const newVideo = {
        title: file.name.replace(/\.[^/.]+$/, ""),
        url: url,
        thumb: null,
        blob: file
      };
      const id = await db.add("videos", newVideo);
      newVideo.id = id;
      state.videos.push(newVideo);
    }
  }
  if (imageFiles.length > 0) {
    const slide = {
      title: imageFiles[0].name.replace(/\.[^/.]+$/, "") || "Импортированное слайд-шоу",
      images: imageFiles.map((file) => URL.createObjectURL(file)),
      imageBlobs: imageFiles,
      audioUrl: slideshowAudio ? URL.createObjectURL(slideshowAudio) : null,
      audioBlob: slideshowAudio || null
    };
    slide.id = await db.add("slides", slide);
    state.slideshows.unshift(slide);
  }
  e.target.value = "";
  renderTracks();
  renderVideos();
  renderSlideshows();
  triggerHaptic("success");
});

clearDataBtn.addEventListener("click", async () => {
  triggerHaptic("warning");
  if (confirm("Очистить все сохраненные треки, видео и слайд-шоу из памяти?")) {
    state.tracks.forEach((track) => revokeBlobUrl(track.url));
    state.videos.forEach((video) => revokeBlobUrl(video.url));
    state.slideshows.forEach((slide) => {
      (slide.images || []).forEach(revokeBlobUrl);
      revokeBlobUrl(slide.audioUrl);
    });
    await db.clearAll();
    state.tracks = [];
    state.videos = [];
    state.slideshows = [];
    pauseTrack();
    state.currentTrackIndex = -1;
    audio.removeAttribute("src");
    currentTrackTitle.textContent = "Выберите песню";
    currentTrackAuthor.textContent = "Media Player";
    currentCover.innerHTML = '<i class="fa-solid fa-compact-disc disc-spinning" id="discIcon"></i>';
    renderTracks();
    renderVideos();
    renderSlideshows();
    triggerHaptic("success");
  }
});

// Submit link via Mini App
// ---- Direct in-app download: fetch media from TikWM right into the player ----
const TIKWM_APIS = ["https://tikwm.com/api/", "https://tikwm.us/api/", "https://www.tikwm.com/api/"];

function absolutizeMediaUrl(value) {
  if (typeof value !== "string" || !value) return null;
  if (value.startsWith("/")) return "https://tikwm.com" + value;
  if (value.startsWith("http")) return value;
  return null;
}

async function fetchMediaInfo(url) {
  for (const api of TIKWM_APIS) {
    try {
      const res = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ url: url, count: 12, cursor: 0, web: 1, hd: 1 }).toString()
      });
      if (!res.ok) continue;
      const json = await res.json();
      const data = json && json.code === 0 ? json.data : null;
      if (!data) continue;
      const images = Array.isArray(data.images) ? data.images.map(absolutizeMediaUrl).filter(Boolean) : null;
      return {
        isSlideshow: !!(images && images.length),
        images: images,
        musicUrl: absolutizeMediaUrl(data.music),
        videoUrl: absolutizeMediaUrl(data.play) || absolutizeMediaUrl(data.hdplay),
        title: data.title || "TikTok Media",
        author: (data.author && data.author.nickname) || "TikTok User",
        musicTitle: (data.music_info && data.music_info.title) || "TikTok Sound"
      };
    } catch (e) {
      console.warn("fetchMediaInfo failed for", api, e);
    }
  }
  return null;
}

async function fetchAsBlob(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  if (blob.size === 0) throw new Error("empty blob");
  return blob;
}

async function addAudioTrack(blob, title, author) {
  const newTrack = {
    title: title,
    author: author || "TikTok",
    duration: "Аудио",
    url: URL.createObjectURL(blob),
    cover: null,
    blob: blob
  };
  const id = await db.add("tracks", newTrack);
  newTrack.id = id;
  state.tracks.push(newTrack);
  renderTracks();
  triggerHaptic("success");
  return newTrack;
}

async function tryDirectDownload(url) {
  showFeedback("Ищу трек в TikTok...", "info");
  const info = await fetchMediaInfo(url);
  if (!info) return false;

  // Slideshow: grab the sound track
  const audioSource = info.isSlideshow ? info.musicUrl : (info.musicUrl || null);
  if (!audioSource && !info.videoUrl) return false;

  if (audioSource) {
    showFeedback("Качаю звук прямо в плеер...", "info");
    try {
      const blob = await fetchAsBlob(audioSource);
      await addAudioTrack(blob, info.musicTitle, info.author);
      showFeedback(`✓ Песня сохранена в плеер: ${info.musicTitle}`, "success");
      return true;
    } catch (e) {
      console.warn("Audio fetch blocked:", e);
    }
  }

  if (!info.isSlideshow && info.videoUrl) {
    showFeedback("Звук недоступен, качаю видео...", "info");
    try {
      const blob = await fetchAsBlob(info.videoUrl);
      const newVideo = {
        title: info.title,
        url: URL.createObjectURL(blob),
        thumb: null,
        blob: blob
      };
      const id = await db.add("videos", newVideo);
      newVideo.id = id;
      state.videos.push(newVideo);
      renderVideos();
      triggerHaptic("success");
      showFeedback(`✓ Видео сохранено в плеер: ${info.title}`, "success");
      return true;
    } catch (e) {
      console.warn("Video fetch blocked:", e);
    }
  }
  return false;
}

submitLinkBtn.addEventListener("click", async () => {
  const url = linkInput.value.trim();
  if (!url) {
    showFeedback("Вставьте ссылку на TikTok или YouTube", "error");
    return;
  }

  const selectedType = document.querySelector('input[name="downloadType"]:checked')?.value || "auto";
  submitLinkBtn.disabled = true;
  try {
    // 1. Try downloading straight into the player
    const directOk = await tryDirectDownload(url);
    if (directOk) {
      linkInput.value = "";
      return;
    }

    // 2. Direct download failed — do NOT close the app, tell the user what to do
    showFeedback("Прямое скачивание сейчас недоступно. Скопирую ссылку — отправь её боту в чат для скачивания.", "info");
    linkInput.value = "";
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        showFeedback("Ссылка скопирована! Отправь её в чат с ботом — он скачает и пришлёт файл.", "info");
      }
    } catch (e) {
      console.warn("Clipboard unavailable:", e);
    }
  } finally {
    submitLinkBtn.disabled = false;
  }
});

function showFeedback(text, type) {
  downloadFeedback.textContent = text;
  downloadFeedback.className = `feedback-msg ${type}`;
}

/* ==========================================================================
   Default Demo Tracks
   ========================================================================== */
/* ==========================================================================
   Init Application
   ========================================================================== */
async function initApp() {
  await db.init();

  const savedTracks = (await db.getAll("tracks")).map(restoreStoredMedia);
  const libraryTracks = [];
  for (const track of savedTracks) {
    if (track.url?.startsWith("https://www.soundhelix.com/examples/mp3/SoundHelix-Song-")) {
      await db.delete("tracks", track.id);
      continue;
    }
    libraryTracks.push(track);
  }
  const savedVideos = (await db.getAll("videos")).map(restoreStoredMedia);
  const savedSlides = (await db.getAll("slides")).map(restoreStoredSlideshow);

  state.tracks = libraryTracks;

  state.videos = savedVideos;
  state.slideshows = savedSlides;

  renderTracks();
  renderVideos();
  renderSlideshows();

  if (state.tracks.length > 0) {
    loadTrack(0);
  }
}

initApp();
