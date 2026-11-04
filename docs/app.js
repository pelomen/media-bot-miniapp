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
      await new Promise((resolve) => {
        const transaction = this.db.transaction([storeName], "readwrite");
        transaction.objectStore(storeName).clear();
        transaction.oncomplete = () => resolve();
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
    currentCover.innerHTML = `<img src="${track.cover}" alt="cover">`;
  } else {
    currentCover.innerHTML = `<i class="fa-solid fa-compact-disc disc-spinning" id="discIcon"></i>`;
  }

  // Update track list active state
  document.querySelectorAll(".track-item").forEach((el, idx) => {
    el.classList.toggle("active", idx === index);
  });
}

function playTrack() {
  if (state.currentTrackIndex === -1 && state.tracks.length > 0) {
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
          ${track.cover ? `<img src="${track.cover}">` : `<i class="fa-solid fa-music"></i>`}
        </div>
        <div class="track-info">
          <h4>${track.title || "Песня #" + (idx + 1)}</h4>
          <p>${track.author || "TikTok / YouTube"} • ${track.duration || "Аудио"}</p>
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
      await db.delete("tracks", id);
      state.tracks = state.tracks.filter((t) => t.id !== Number(id));
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
    <div class="video-card" data-url="${vid.url}" data-title="${vid.title}">
      <div class="video-card-thumb">
        ${vid.thumb ? `<img src="${vid.thumb}">` : `<i class="fa-solid fa-film" style="font-size:32px;color:#818cf8;"></i>`}
        <div class="play-badge"><i class="fa-solid fa-play"></i></div>
      </div>
      <div class="video-card-body">
        <h4>${vid.title || "Видео"}</h4>
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
      <img id="activeSlideImage" src="${slide.images[0]}" alt="Slide">
      <div class="slide-controls">
        <button id="prevSlideBtn" class="slide-btn"><i class="fa-solid fa-chevron-left"></i></button>
        <button id="nextSlideBtn" class="slide-btn"><i class="fa-solid fa-chevron-right"></i></button>
      </div>
      <div class="slide-counter" id="slideCounter">1 / ${slide.images.length}</div>
    </div>
    <div class="slides-music-bar">
      <div>
        <h4 style="font-size:13px;">${slide.title || "TikTok Слайд-шоу"}</h4>
        <p style="font-size:11px;color:var(--text-muted);">Оригинальный звук</p>
      </div>
      ${slide.audioUrl ? `
        <button id="playSlideMusicBtn" class="icon-btn" style="background:#a855f7;color:#fff;">
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
  for (const file of files) {
    const url = URL.createObjectURL(file);
    if (file.type.startsWith("audio/")) {
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
  renderTracks();
  renderVideos();
  triggerHaptic("success");
});

clearDataBtn.addEventListener("click", async () => {
  triggerHaptic("warning");
  if (confirm("Очистить все сохраненные треки и видео из памяти?")) {
    await db.clearAll();
    state.tracks = [];
    state.videos = [];
    state.slideshows = [];
    pauseTrack();
    renderTracks();
    renderVideos();
    renderSlideshows();
    triggerHaptic("success");
  }
});

// Submit link via Mini App
submitLinkBtn.addEventListener("click", () => {
  const url = linkInput.value.trim();
  if (!url) {
    showFeedback("Вставьте ссылку на TikTok или YouTube", "error");
    return;
  }

  const selectedType = document.querySelector('input[name="downloadType"]:checked').value;
  triggerHaptic("success");

  // If inside Telegram WebApp, send data back to bot
  if (tg && tg.sendData) {
    try {
      tg.sendData(JSON.stringify({ action: "download", url: url, type: selectedType }));
      showFeedback("Запрос передан боту! Он уже скачивает...", "success");
      setTimeout(() => tg.close(), 1200);
      return;
    } catch (e) {
      console.warn("Could not send data to Telegram:", e);
    }
  }

  showFeedback(`Заказ принят: ${url} (${selectedType}). Отправьте её в чат с ботом для мгновенного скачивания!`, "success");
  linkInput.value = "";
});

function showFeedback(text, type) {
  downloadFeedback.textContent = text;
  downloadFeedback.className = `feedback-msg ${type}`;
}

/* ==========================================================================
   Default Demo Tracks
   ========================================================================== */
const sampleTracks = [
  {
    title: "Phonk Night (TikTok Viral)",
    author: "TikTok Trending Sound",
    duration: "02:14",
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    cover: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=150"
  },
  {
    title: "Chill Cyber Beat (YouTube Audio)",
    author: "YouTube Creator Audio",
    duration: "03:05",
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    cover: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=150"
  }
];

/* ==========================================================================
   Init Application
   ========================================================================== */
async function initApp() {
  await db.init();

  const savedTracks = await db.getAll("tracks");
  const savedVideos = await db.getAll("videos");
  const savedSlides = await db.getAll("slides");

  if (savedTracks.length > 0) {
    state.tracks = savedTracks;
  } else {
    // Populate demo tracks on first launch
    for (const track of sampleTracks) {
      const id = await db.add("tracks", track);
      track.id = id;
      state.tracks.push(track);
    }
  }

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
