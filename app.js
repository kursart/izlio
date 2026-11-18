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
let clientId = "mob_" + Math.random().toString(36).substring(2, 10);
let ignoreLocalEventsUntil = 0;
let lastProcessedUpdateAt = 0;
let stateSource = null;
let chatSource = null;
let mediaSource = null;

let activeMode = "none";
let ytPlayer = null;
let ytReady = false;
let pendingYoutubeId = null;
let latestRoomState = null;
let currentMediaData = null;
let externalClockTimer = null;

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
  if (stateSource) stateSource.close();
  if (chatSource) chatSource.close();
  if (mediaSource) mediaSource.close();
  if (externalClockTimer) clearInterval(externalClockTimer);
  if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();

  videoElement.pause();
  videoElement.src = "";
  activeMode = "none";
  currentMediaData = null;

  playerScreen.style.display = "none";
  authScreen.style.display = "flex";
  statusDiv.textContent = "Bağlantı kesildi.";
});

function initMobileEngine() {
  ignoreLocalEventsUntil = Date.now() + 2000;
  listenRoomState();
  listenChatAndMedia();
  attachHtml5VideoEvents();
  fetchInitialRoomData();
}

async function fetchInitialRoomData() {
  if (!currentRoom) return;
  try {
    const res = await fetch(`${FIREBASE_URL}/rooms/${currentRoom}.json`);
    const roomData = await res.json();
    if (!roomData) return;
    if (roomData.state) {
      latestRoomState = roomData.state;
    }
    if (roomData.media) {
      handleIncomingMedia(roomData.media);
    }
  } catch (e) {}
}

function handleIncomingMedia(media) {
  if (!media || !media.url) return;
  currentMediaData = media;

  sharedBar.style.display = "block";
  sharedLink.textContent = media.url;
  sharedLink.href = media.url;
  emptyPlaceholder.style.display = "none";
  if (externalClockTimer) clearInterval(externalClockTimer);

  const ytId = extractYouTubeId(media.url);

  if (ytId) {
    activeMode = "youtube";
    videoElement.style.display = "none";
    videoElement.pause();
    ytContainer.style.display = "block";

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

    if (videoElement.src !== media.url) {
      videoElement.src = media.url;
      videoElement.load();
    }
    if (latestRoomState) applyRemoteState(latestRoomState, true);
  } else {
    // Harici dizi/film siteleri için Canlı Oda Zamanı ve Eşlik Ekranı
    activeMode = "external";
    if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
    ytContainer.style.display = "none";
    videoElement.style.display = "none";
    emptyPlaceholder.style.display = "block";
    renderExternalSyncCard();
    externalClockTimer = setInterval(renderExternalSyncCard, 1000);
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
      <div style="color:#ff3366; font-weight:700; font-size:12px; margin-bottom:6px; letter-spacing:0.5px;">CANLI ODA SÜRESİ</div>
      <div style="color:#fff; font-size:32px; font-weight:800; margin-bottom:4px;">${formatTime(liveSec)}</div>
      <div style="color:#aaa; font-size:12px; margin-bottom:14px;">${statusText}</div>
      <a href="${currentMediaData ? currentMediaData.url : '#'}" target="_blank" style="display:block; background:#ff3366; color:#fff; text-decoration:none; padding:11px; border-radius:8px; font-weight:700; font-size:13px; margin-bottom:10px;">Safari'de Siteyi Aç</a>
      <div style="color:#777; font-size:11px; line-height:1.4;">Bu site harici oynatmayı kısıtladığı için videoyu Safari'de açıp buradaki canlı saniyeye göre izleyebilirsiniz.</div>
    </div>
  `;
}

function loadYouTubeVideo(videoId) {
  if (ytPlayer) {
    ytPlayer.loadVideoById(videoId);
    setTimeout(() => {
      if (latestRoomState) applyRemoteState(latestRoomState, true);
    }, 1200);
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
  } else if (activeMode === "external") {
    renderExternalSyncCard();
  }

  if (!state.isHeartbeat) {
    addSystemMessage(`${state.updatedBy} videoyu ${state.actionText} (${formatTime(targetTime)})`);
  }
}

function listenChatAndMedia() {
  if (chatSource) chatSource.close();
  if (mediaSource) mediaSource.close();

  mediaSource = new EventSource(`${FIREBASE_URL}/rooms/${currentRoom}/media.json`);
  mediaSource.addEventListener("put", (e) => {
    try {
      const parsed = JSON.parse(e.data);
      if (parsed && parsed.data && parsed.data.url) {
        handleIncomingMedia(parsed.data);
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