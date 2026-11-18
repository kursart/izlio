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

let currentRoom = null;
let currentUser = "Misafir";
let clientId = Math.random().toString(36).substring(2, 10);
let ignoreLocalEventsUntil = 0;
let lastProcessedUpdateAt = 0;
let stateSource = null;
let chatSource = null;
let mediaSource = null;

let activeMode = "none"; // "youtube" | "html5" | "external"
let ytPlayer = null;
let ytReady = false;
let pendingYoutubeId = null;
let latestRoomState = null;

// Kayıtlı bilgileri geri yükle
if (localStorage.getItem("izlio_user")) usernameInput.value = localStorage.getItem("izlio_user");
if (localStorage.getItem("izlio_room")) roomInput.value = localStorage.getItem("izlio_room");
if (localStorage.getItem("izlio_pass")) passwordInput.value = localStorage.getItem("izlio_pass");

function sanitizeRoomName(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9ğüşıöç_-]/g, "-");
}

// YouTube API hazır olduğunda tetiklenir
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

// Sohbeti Gizle / Göster
toggleChatBtn.addEventListener("click", () => {
  chatDrawer.classList.toggle("hidden");
  toggleChatBtn.textContent = chatDrawer.classList.contains("hidden") ? "Sohbeti Aç" : "Sohbeti Gizle";
});

// Odaya Bağlan
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

// Bağlantıyı Kes
document.getElementById("leaveBtn").addEventListener("click", () => {
  if (stateSource) stateSource.close();
  if (chatSource) chatSource.close();
  if (mediaSource) mediaSource.close();
  if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
  videoElement.pause();
  videoElement.src = "";
  activeMode = "none";
  playerScreen.style.display = "none";
  authScreen.style.display = "flex";
  statusDiv.textContent = "Bağlantı kesildi.";
});

function initMobileEngine() {
  ignoreLocalEventsUntil = Date.now() + 2000;
  listenRoomState();
  listenChatAndMedia();
  attachHtml5VideoEvents();
}

// PC'den Gelen Linki Otomatik Algıla ve Oynat
function handleIncomingMediaUrl(url) {
  if (!url) return;

  sharedBar.style.display = "block";
  sharedLink.textContent = url;
  sharedLink.href = url;
  emptyPlaceholder.style.display = "none";

  const ytId = extractYouTubeId(url);

  if (ytId) {
    // 1. DURUM: YouTube Linki Geldi
    activeMode = "youtube";
    videoElement.style.display = "none";
    videoElement.pause();
    ytContainer.style.display = "block";

    if (ytReady) {
      loadYouTubeVideo(ytId);
    } else {
      pendingYoutubeId = ytId;
    }
  } else if (url.match(/\.(mp4|webm|m3u8|mov)(\?.*)?$/i)) {
    // 2. DURUM: Doğrudan Video Dosyası Linki Geldi
    activeMode = "html5";
    if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
    ytContainer.style.display = "none";
    videoElement.style.display = "block";
    videoElement.src = url;
    videoElement.load();
    if (latestRoomState) applyRemoteState(latestRoomState, true);
  } else {
    // 3. DURUM: Harici Dizi/Film Sitesi Linki Geldi
    activeMode = "external";
    if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
    ytContainer.style.display = "none";
    videoElement.style.display = "none";
    emptyPlaceholder.style.display = "block";
    emptyPlaceholder.innerHTML = `Bu site uygulama içi oynatmayı kısıtlıyor.<br><br>Yukarıdaki mavi <b>Paylaşılan linke</b> dokunarak Safari'de açabilirsiniz.`;
  }
}

function loadYouTubeVideo(videoId) {
  if (ytPlayer) {
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

function listenRoomState() {
  if (stateSource) stateSource.close();
  stateSource = new EventSource(`${FIREBASE_URL}/rooms/${currentRoom}/state.json`);

  stateSource.addEventListener("put", (e) => {
    try {
      const parsed = JSON.parse(e.data);
      if (!parsed || !parsed.data) return;
      const state = parsed.data;
      latestRoomState = state;

      if (state.senderId === clientId) return;
      if (state.updatedAt && state.updatedAt <= lastProcessedUpdateAt) return;
      lastProcessedUpdateAt = state.updatedAt || Date.now();

      applyRemoteState(state, false);
    } catch (err) {}
  });
}

function applyRemoteState(state, isInitialJoin = false) {
  if (!state) return;

  const ageInSeconds = state.updatedAt ? Math.max(0, (Date.now() - state.updatedAt) / 1000) : 0;
  const targetTime = state.status === "playing" ? state.timestamp + ageInSeconds : state.timestamp;

  ignoreLocalEventsUntil = Date.now() + 1400;

  if (activeMode === "youtube" && ytPlayer && ytPlayer.seekTo) {
    const current = ytPlayer.getCurrentTime() || 0;
    if (Math.abs(current - targetTime) > 1.5 || isInitialJoin) {
      ytPlayer.seekTo(targetTime, true);
    }
    if (state.status === "playing") {
      ytPlayer.playVideo();
    } else if (state.status === "paused") {
      ytPlayer.pauseVideo();
    }
  } else if (activeMode === "html5" && videoElement) {
    const timeDiff = Math.abs(videoElement.currentTime - targetTime);
    if (timeDiff > 1.2 || isInitialJoin) videoElement.currentTime = targetTime;

    if (state.status === "playing" && videoElement.paused) {
      videoElement.play().catch(() => {});
    } else if (state.status === "paused" && !videoElement.paused) {
      videoElement.pause();
    }
  }

  addSystemMessage(`${state.updatedBy} videoyu ${state.actionText} (${formatTime(targetTime)})`);
}

function listenChatAndMedia() {
  if (chatSource) chatSource.close();
  if (mediaSource) mediaSource.close();

  mediaSource = new EventSource(`${FIREBASE_URL}/rooms/${currentRoom}/media.json`);
  mediaSource.addEventListener("put", (e) => {
    try {
      const parsed = JSON.parse(e.data);
      if (parsed && parsed.data && parsed.data.url) {
        handleIncomingMediaUrl(parsed.data.url);
      }
    } catch (err) {}
  });

  chatSource = new EventSource(`${FIREBASE_URL}/rooms/${currentRoom}/messages.json`);
  chatSource.addEventListener("put", (e) => {
    try {
      const parsed = JSON.parse(e.data);
      if (!parsed || !parsed.data) return;
      if (parsed.path === "/") {
        messagesArea.innerHTML = "";
        Object.values(parsed.data).forEach((msg) => renderChatMessage(msg));
      } else {
        renderChatMessage(parsed.data);
      }
    } catch (err) {}
  });
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