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
const messagesArea = document.getElementById("messagesArea");
const chatInput = document.getElementById("chatInput");

let currentRoom = null;
let currentUser = "Misafir";
let clientId = Math.random().toString(36).substring(2, 10);
let ignoreLocalEventsUntil = 0;
let lastProcessedUpdateAt = 0;
let stateSource = null;
let chatSource = null;

function sanitizeRoomName(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9ğüşıöç_-]/g, "-");
}

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
  if (stateSource) stateSource.close();
  if (chatSource) chatSource.close();
  playerScreen.style.display = "none";
  authScreen.style.display = "flex";
  statusDiv.textContent = "Bağlantı kesildi.";
});

function initMobileEngine() {
  ignoreLocalEventsUntil = Date.now() + 2000;
  listenRoomState();
  listenChat();
  fetchAndApplyCurrentState();
  attachVideoEvents();
}

async function fetchAndApplyCurrentState() {
  try {
    const res = await fetch(`${FIREBASE_URL}/rooms/${currentRoom}/state.json`);
    const state = await res.json();
    if (state && videoElement) {
      applyRemoteState(state, true);
    }
  } catch (e) {}
}

function attachVideoEvents() {
  videoElement.addEventListener("play", () => {
    if (Date.now() < ignoreLocalEventsUntil) return;
    pushStateToFirebase("playing", videoElement.currentTime, "başlattı");
  });

  videoElement.addEventListener("pause", () => {
    if (Date.now() < ignoreLocalEventsUntil || videoElement.ended || videoElement.seeking) return;
    pushStateToFirebase("paused", videoElement.currentTime, "durdurdu");
  });

  videoElement.addEventListener("seeked", () => {
    if (Date.now() < ignoreLocalEventsUntil) return;
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

      if (state.senderId === clientId) return;
      if (state.updatedAt && state.updatedAt <= lastProcessedUpdateAt) return;
      lastProcessedUpdateAt = state.updatedAt || Date.now();

      applyRemoteState(state, false);
    } catch (err) {}
  });
}

function applyRemoteState(state, isInitialJoin = false) {
  if (!state || !videoElement) return;

  const ageInSeconds = state.updatedAt ? Math.max(0, (Date.now() - state.updatedAt) / 1000) : 0;
  const targetTime = state.status === "playing" ? state.timestamp + ageInSeconds : state.timestamp;
  const timeDiff = Math.abs(videoElement.currentTime - targetTime);

  ignoreLocalEventsUntil = Date.now() + 1200;

  if (timeDiff > 1.2 || isInitialJoin) {
    videoElement.currentTime = targetTime;
  }

  if (state.status === "playing" && videoElement.paused) {
    videoElement.play().catch(() => {});
  } else if (state.status === "paused" && !videoElement.paused) {
    videoElement.pause();
  }

  addSystemMessage(`${state.updatedBy} videoyu ${state.actionText}`);
}

function listenChat() {
  if (chatSource) chatSource.close();
  chatSource = new EventSource(`${FIREBASE_URL}/rooms/${currentRoom}/messages.json`);

  chatSource.addEventListener("put", (e) => {
    try {
      const parsed = JSON.parse(e.data);
      if (!parsed || !parsed.data) return;
      if (parsed.path !== "/") renderChatMessage(parsed.data);
    } catch (err) {}
  });
}

document.getElementById("sendBtn").addEventListener("click", sendChatMessage);
chatInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendChatMessage();
}

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