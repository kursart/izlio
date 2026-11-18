// KENDİ FIREBASE ADRESİNİ BURAYA YAPIŞTIR (Sonda / olmasın)
const FIREBASE_URL = "https://izlio-5f586-default-rtdb.europe-west1.firebasedatabase.app";

const authScreen = document.getElementById("auth-screen");
const playerScreen = document.getElementById("player-screen");
const usernameInput = document.getElementById("usernameInput");
const roomInput = document.getElementById("roomInput");
const passwordInput = document.getElementById("passwordInput");
const statusDiv = document.getElementById("status");
const displayRoomName = document.getElementById("displayRoomName");
const videoElement = document.getElementById("mainVideo");
const ytContainer = document.getElementById("yt-player");
const emptyPlaceholder = document.getElementById("empty-placeholder");
const messagesArea = document.getElementById("messagesArea");
const chatInput = document.getElementById("chatInput");
const sharedBar = document.getElementById("sharedBar");
const sharedLink = document.getElementById("sharedLink");
const chatDrawer = document.getElementById("chatDrawer");
const toggleChatBtn = document.getElementById("toggleChatBtn");
const iosUnlockOverlay = document.getElementById("ios-unlock-overlay");
const iosUnlockBtn = document.getElementById("ios-unlock-btn");

let currentRoom = null;
let currentUser = "Misafir";
let clientId = "mob_" + Math.random().toString(36).substring(2, 10);
let ignoreLocalEventsUntil = 0;
let lastProcessedUpdateAt = 0;
let lastMediaUrl = "";
let renderedMessageKeys = new Set();
let pollInterval = null;

let activeMode = "none";
let ytPlayer = null;
let ytReady = false;
let pendingYoutubeId = null;
let latestRoomState = null;
let currentMediaData = null;

if (localStorage.getItem("izlio_user")) usernameInput.value = localStorage.getItem("izlio_user");
if (localStorage.getItem("izlio_room")) roomInput.value = localStorage.getItem("izlio_room");
if (localStorage.getItem("izlio_pass")) passwordInput.value = localStorage.getItem("izlio_pass");

function sanitizeRoomName(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9ğüşıöç_-]/g, "-");
}

window.onYouTubeIframeAPIReady = function () {
  ytReady = true;
  if (pendingYoutubeId) {
    loadYouTubeVideo(pendingYoutubeId);
  }
};

function extractYouTubeId(url) {
  const regExp = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
  const match = url.match(regExp);
  return match ? match[1] : null;
}

toggleChatBtn.addEventListener("click", () => {
  chatDrawer.classList.toggle("hidden");
  toggleChatBtn.textContent = chatDrawer.classList.contains("hidden") ? "Sohbeti Aç" : "Sohbeti Gizle";
});

// iOS Safari Dokunma Kilidi Aşma Butonu
iosUnlockBtn.addEventListener("click", () => {
  iosUnlockOverlay.style.display = "none";
  if (activeMode === "youtube" && ytPlayer && ytPlayer.playVideo) {
    ytPlayer.playVideo();
    if (latestRoomState) {
      setTimeout(() => applyRemoteState(latestRoomState, true), 400);
    }
  } else if (activeMode === "html5" && videoElement) {
    videoElement.play().catch(() => {});
    if (latestRoomState) applyRemoteState(latestRoomState, true);
  }
});

document.getElementById("joinBtn").addEventListener("click", async () => {
  const username = usernameInput.value.trim();
  const roomDisplay = roomInput.value.trim();
  const roomKey = sanitizeRoomName(roomDisplay);
  const password = passwordInput.value.trim();

  if (!username || !roomKey || !password) {
    statusDiv.textContent = "Lütfen tüm alanları doldurun!";
    return;
  }

  statusDiv.textContent = "Bağlanılıyor...";

  try {
    const res = await fetch(`${FIREBASE_URL}/rooms/${roomKey}/auth.json`);
    const auth = await res.json();

    if (!auth || auth.password !== password) {
      statusDiv.textContent = "Hatalı oda adı veya parola!";
      return;
    }

    localStorage.setItem("izlio_user", username);
    localStorage.setItem("izlio_room", roomDisplay);
    localStorage.setItem("izlio_pass", password);

    currentRoom = roomKey;
    currentUser = username;
    displayRoomName.textContent = auth.roomName || roomDisplay;

    authScreen.style.display = "none";
    playerScreen.style.display = "flex";

    initMobileEngine();
  } catch (e) {
    statusDiv.textContent = "Bağlantı hatası oluştu.";
  }
});

document.getElementById("leaveBtn").addEventListener("click", () => {
  currentRoom = null;
  if (pollInterval) clearInterval(pollInterval);
  if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();

  videoElement.pause();
  videoElement.src = "";
  activeMode = "none";
  lastMediaUrl = "";
  currentMediaData = null;
  renderedMessageKeys.clear();
  messagesArea.innerHTML = "";
  iosUnlockOverlay.style.display = "none";

  playerScreen.style.display = "none";
  authScreen.style.display = "flex";
  statusDiv.textContent = "Bağlantı kesildi.";
});

function initMobileEngine() {
  ignoreLocalEventsUntil = Date.now() + 2000;
  attachHtml5VideoEvents();

  // iOS Safari'nin bağlantıyı uyutmaması için her 1.2 saniyede bir odayı doğrudan kontrol et
  syncLoop();
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(syncLoop, 1200);
}

async function syncLoop() {
  if (!currentRoom) return;
  try {
    const res = await fetch(`${FIREBASE_URL}/rooms/${currentRoom}.json`);
    const roomData = await res.json();
    if (!roomData) return;

    // 1. Paylaşılan Link Değiştiyse Güncelle
    if (roomData.media && roomData.media.url && roomData.media.url !== lastMediaUrl) {
      lastMediaUrl = roomData.media.url;
      handleIncomingMedia(roomData.media);
    }

    // 2. Video Durumu Değiştiyse veya Saniye Kaydıysa Eşitle
    if (roomData.state) {
      latestRoomState = roomData.state;
      const isNewCommand = roomData.state.senderId !== clientId && roomData.state.updatedAt > lastProcessedUpdateAt;

      if (isNewCommand) {
        lastProcessedUpdateAt = roomData.state.updatedAt;
        applyRemoteState(roomData.state, false);
      } else if (roomData.state.senderId !== clientId) {
        // Sürekli arka plan kayma kontrolü (2.5 saniyeden fazla fark varsa sessizce düzelt)
        applyRemoteState(roomData.state, false, true);
      }
    }

    // 3. Yeni Sohbet Mesajlarını Ekrana Bas
    if (roomData.messages) {
      Object.entries(roomData.messages).forEach(([key, msg]) => {
        if (!renderedMessageKeys.has(key)) {
          renderedMessageKeys.add(key);
          renderChatMessage(msg);
        }
      });
    }
  } catch (e) {}
}

function handleIncomingMedia(media) {
  currentMediaData = media;
  sharedBar.style.display = "block";
  sharedLink.textContent = media.url;
  sharedLink.href = media.url;
  emptyPlaceholder.style.display = "none";

  const ytId = extractYouTubeId(media.url);

  if (ytId) {
    activeMode = "youtube";
    videoElement.style.display = "none";
    videoElement.pause();
    ytContainer.style.display = "block";
    iosUnlockOverlay.style.display = "flex"; // iOS dokunma izni için butonu göster

    if (ytReady) {
      loadYouTubeVideo(ytId);
    } else {
      pendingYoutubeId = ytId;
    }
  } else if (media.url.match(/\.(mp4|webm|m3u8|mov)(\?.*)?$/i)) {
    activeMode = "html5";
    if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
    ytContainer.style.display = "none";
    videoElement.style.display = "block";
    iosUnlockOverlay.style.display = "flex";

    videoElement.src = media.url;
    videoElement.load();
  } else {
    activeMode = "external";
    if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
    ytContainer.style.display = "none";
    videoElement.style.display = "none";
    iosUnlockOverlay.style.display = "none";
    emptyPlaceholder.style.display = "block";
    renderExternalSyncCard();
  }
}

function renderExternalSyncCard() {
  if (activeMode !== "external") return;
  let liveSec = 0;
  let statusText = "Duraklatıldı";

  if (latestRoomState) {
    const age = latestRoomState.status === "playing" ? Math.max(0, (Date.now() - latestRoomState.updatedAt) / 1000) : 0;
    liveSec = latestRoomState.timestamp + age;
    statusText = latestRoomState.status === "playing" ? "▶️ Oynatılıyor" : "⏸️ Duraklatıldı";
  }

  emptyPlaceholder.innerHTML = `
    <div style="background:#181822; border:1px solid #282834; padding:18px; border-radius:12px; max-width:300px; margin:auto;">
      <div style="color:#ff3366; font-weight:700; font-size:12px; margin-bottom:6px;">CANLI ODA SÜRESİ</div>
      <div style="color:#fff; font-size:32px; font-weight:800; margin-bottom:4px;">${formatTime(liveSec)}</div>
      <div style="color:#aaa; font-size:12px; margin-bottom:14px;">${statusText}</div>
      <a href="${currentMediaData ? currentMediaData.url : '#'}" target="_blank" style="display:block; background:#ff3366; color:#fff; text-decoration:none; padding:11px; border-radius:8px; font-weight:700; font-size:13px; margin-bottom:10px;">Safari'de Siteyi Aç</a>
      <div style="color:#777; font-size:11px; line-height:1.4;">iOS Safari kısıtlaması nedeniyle bu site uygulama içinde açılamaz. Yukarıdaki butondan Safari'de açıp bu saniyeye göre izleyebilirsiniz.</div>
    </div>
  `;
}

function loadYouTubeVideo(videoId) {
  if (ytPlayer && ytPlayer.loadVideoById) {
    ytPlayer.loadVideoById(videoId);
    return;
  }

  ytPlayer = new YT.Player("yt-player", {
    videoId: videoId,
    playerVars: {
      playsinline: 1,
      rel: 0,
      modestbranding: 1
    },
    events: {
      onReady: () => {
        if (latestRoomState) applyRemoteState(latestRoomState, true);
      },
      onStateChange: (event) => {
        if (Date.now() < ignoreLocalEventsUntil || activeMode !== "youtube") return;
        const currentTime = ytPlayer.getCurrentTime();
        if (event.data === YT.PlayerState.PLAYING) {
          iosUnlockOverlay.style.display = "none";
          pushStateToFirebase("playing", currentTime, "başlattı");
        } else if (event.data === YT.PlayerState.PAUSED) {
          pushStateToFirebase("paused", currentTime, "durdurdu");
        }
      }
    }
  });
}

function attachHtml5VideoEvents() {
  videoElement.addEventListener("play", () => {
    iosUnlockOverlay.style.display = "none";
    if (Date.now() < ignoreLocalEventsUntil || activeMode !== "html5") return;
    pushStateToFirebase("playing", videoElement.currentTime, "başlattı");
  });

  videoElement.addEventListener("pause", () => {
    if (Date.now() < ignoreLocalEventsUntil || activeMode !== "html5" || videoElement.ended || videoElement.seeking) return;
    pushStateToFirebase("paused", videoElement.currentTime, "durdurdu");
  });

  videoElement.addEventListener("seeked", () => {
    if (Date.now() < ignoreLocalEventsUntil || activeMode !== "html5") return;
    pushStateToFirebase(videoElement.paused ? "paused" : "playing", videoElement.currentTime, "sardı");
  });
}

function pushStateToFirebase(status, timestamp, actionText) {
  if (!currentRoom) return;
  const now = Date.now();
  const payload = {
    status,
    timestamp: Number(timestamp.toFixed(2)),
    updatedBy: currentUser,
    senderId: clientId,
    actionText,
    updatedAt: now
  };
  lastProcessedUpdateAt = now;

  fetch(`${FIREBASE_URL}/rooms/${currentRoom}/state.json`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

function applyRemoteState(state, isInitialJoin = false, isDriftCheck = false) {
  if (!state) return;

  const ageInSeconds = state.updatedAt ? Math.max(0, (Date.now() - state.updatedAt) / 1000) : 0;
  const targetTime = state.status === "playing" ? state.timestamp + (ageInSeconds < 60 ? ageInSeconds : 0) : state.timestamp;

  if (activeMode === "youtube" && ytPlayer && ytPlayer.seekTo) {
    const current = ytPlayer.getCurrentTime() || 0;
    const ytState = ytPlayer.getPlayerState ? ytPlayer.getPlayerState() : -1;
    const statusMismatch = (state.status === "playing" && ytState !== 1) || (state.status === "paused" && ytState === 1);

    if (isDriftCheck && Math.abs(current - targetTime) < 2.5 && !statusMismatch) return;

    ignoreLocalEventsUntil = Date.now() + 1500;
    if (Math.abs(current - targetTime) > 1.5 || isInitialJoin) {
      ytPlayer.seekTo(targetTime, true);
    }
    if (state.status === "playing" && ytState !== 1) {
      ytPlayer.playVideo();
    } else if (state.status === "paused" && ytState === 1) {
      ytPlayer.pauseVideo();
    }
  } else if (activeMode === "html5" && videoElement) {
    const timeDiff = Math.abs(videoElement.currentTime - targetTime);
    const statusMismatch = (state.status === "playing" && videoElement.paused) || (state.status === "paused" && !videoElement.paused);

    if (isDriftCheck && timeDiff < 2.5 && !statusMismatch) return;

    ignoreLocalEventsUntil = Date.now() + 1500;
    if (timeDiff > 1.5 || isInitialJoin) videoElement.currentTime = targetTime;

    if (state.status === "playing" && videoElement.paused) {
      videoElement.play().catch(() => {});
    } else if (state.status === "paused" && !videoElement.paused) {
      videoElement.pause();
    }
  } else if (activeMode === "external") {
    renderExternalSyncCard();
  }

  if (!isDriftCheck && !state.isHeartbeat) {
    addSystemMessage(`${state.updatedBy} videoyu ${state.actionText} (${formatTime(targetTime)})`);
  }
}

document.getElementById("sendBtn").addEventListener("click", sendChatMessage);
chatInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendChatMessage();
});

function sendChatMessage() {
  const text = chatInput.value.trim();
  if (!text || !currentRoom) return;
  chatInput.value = "";
  fetch(`${FIREBASE_URL}/rooms/${currentRoom}/messages.json`, {
    method: "POST",
    body: JSON.stringify({ user: currentUser, text, time: Date.now() })
  });
}

function renderChatMessage(msg) {
  if (!msg || !msg.text) return;
  const div = document.createElement("div");
  div.className = "msg";
  div.innerHTML = `<strong>${msg.user}:</strong> ${msg.text}`;
  messagesArea.appendChild(div);
  messagesArea.scrollTop = messagesArea.scrollHeight;
}

function addSystemMessage(text) {
  const div = document.createElement("div");
  div.className = "msg system";
  div.textContent = text;
  messagesArea.appendChild(div);
  messagesArea.scrollTop = messagesArea.scrollHeight;
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}