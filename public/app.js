"use strict";

/* ============================================================
   CLIENTE — CARTAS CONTRA LA HUMANIDAD: EDICIÓN CRIOLLA SIN FILTRO
   ============================================================ */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const SESSION_KEY = "cch_session_v1";
const NAME_KEY = "cch_name";
const AGE_KEY = "cch_age_ok";
const CUSTOM_DECK_KEY = "cch_custom_deck_v1";
const AVATAR_KEY = "cch_avatar_v1";
const DEFAULT_AVATARS = [
  "🦜", "🦥", "🐆", "🌴", "🧉", "🫓", "🌞", "🦎",
  "🥑", "🌵", "🍍", "⚽", "🎺", "🐊", "🦙", "🌊",
  "🦀", "🦩"
];
const FALLBACK_SCORES = [3, 5, 7, 10];
const AVATAR_TONES = [
  "#f4d58d",
  "#b9d8c9",
  "#f3bfa1",
  "#c8d8f0",
  "#e8c6dd",
  "#d9e0b4",
  "#f3ceb0",
  "#c4e2e4",
  "#ddc9ee",
  "#f4c9c2"
];

const socket = io();

const state = {
  room: null,
  selfId: null,
  session: loadSession(),
  entryMode: "create",
  entryBusy: false,
  inviteCode: "",
  allowResume: false,
  resumeInFlight: false,
  resumeAttempts: 0,
  screen: "landing",
  selection: [],
  submitting: false,
  scoreOptions: FALLBACK_SCORES.slice(),
  avatarOptions: DEFAULT_AVATARS.slice(),
  config: null,
  shareBase: window.location.origin,
  chat: {
    roomCode: null,
    messages: [],
    ids: new Set(),
    unread: 0,
    open: false,
    trigger: null
  },
  modal: {
    open: false,
    dismissible: true,
    actions: {},
    onClose: null,
    kind: null,
    previousFocus: null
  },
  gameOverKey: null,
  roundKey: null,
  gameOverTimer: null,
  confettiRunning: false,
  confettiController: null
};

const elements = {
  landing: $("#landingScreen"),
  lobby: $("#lobbyScreen"),
  game: $("#gameScreen"),
  boot: $("#bootScreen"),
  entryForm: $("#entryForm"),
  nickname: $("#nickname"),
  roomCode: $("#roomCode"),
  ageCheck: $("#ageCheck"),
  entrySubmit: $("#entrySubmit"),
  entrySubmitLabel: $("#entrySubmitLabel"),
  entryHint: $("#entryHint"),
  entryError: $("#entryError"),
  inviteHint: $("#inviteHint"),
  inviteCode: $("#inviteCode"),
  joinCodeField: $("#joinCodeField"),
  localNote: $("#localNote"),
  landingCardCount: $("#landingCardCount"),
  lobbyCodeBig: $("#lobbyCodeBig"),
  lobbySubtitle: $("#lobbySubtitle"),
  lobbyPlayers: $("#lobbyPlayers"),
  lobbyPlayerCount: $("#lobbyPlayerCount"),
  lobbyChatBadge: $("#lobbyChatBadge"),
  scoreOptions: $("#scoreOptions"),
  deckFact: $("#deckFact"),
  customDeckBox: $("#customDeckBox"),
  hostBox: $("#hostBox"),
  gameCode: $("#gameCode"),
  gameRound: $("#gameRound"),
  gameChatBadge: $("#gameChatBadge"),
  resultsHeaderButton: $("#resultsHeaderButton"),
  scoreStrip: $("#scoreStrip"),
  judgeLabel: $("#judgeLabel"),
  targetLabel: $("#targetLabel"),
  tableArea: $("#tableArea"),
  handArea: $("#handArea"),
  mobilePlayAction: $("#mobilePlayAction"),
  chatDrawer: $("#chatDrawer"),
  chatOverlay: $("#chatOverlay"),
  chatMessages: $("#chatMessages"),
  chatForm: $("#chatForm"),
  chatInput: $("#chatInput"),
  chatSend: $("#chatSend"),
  modalRoot: $("#modalRoot"),
  toastRoot: $("#toastRoot"),
  netBanner: $("#netBanner"),
  netBannerText: $("#netBannerText")
};

/* ============================================================
   Utilidades
   ============================================================ */

const ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;"
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ESCAPE_MAP[character]);
}

function normalizeCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 5);
}

function formatNumber(value) {
  try {
    return new Intl.NumberFormat("es-VE").format(value);
  } catch {
    return String(value);
  }
}

function formatTime(timestamp) {
  try {
    return new Date(timestamp).toLocaleTimeString("es-VE", {
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return "";
  }
}

function toneFor(seed) {
  const text = String(seed || "x");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

function isImageAvatar(value) {
  return (
    typeof value === "string" &&
    /^data:image\/(?:png|jpeg|webp);base64,/i.test(value)
  );
}

function avatarBody(value) {
  if (isImageAvatar(value)) {
    return `<img class="avatar-img" src="${esc(value)}" alt="">`;
  }
  return esc(value || "👤");
}

function loadAvatarPreference() {
  try {
    const value = localStorage.getItem(AVATAR_KEY);
    if (!value) return null;
    if (DEFAULT_AVATARS.includes(value)) return value;
    if (isImageAvatar(value) && value.length <= 12000) return value;
    return null;
  } catch {
    return null;
  }
}

function saveAvatarPreference(value) {
  try {
    if (value) localStorage.setItem(AVATAR_KEY, value);
  } catch {
    /* noop */
  }
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const code = normalizeCode(parsed.code);
    if (code.length !== 5 || typeof parsed.token !== "string" || parsed.token.length < 16) {
      return null;
    }
    return {
      code,
      token: parsed.token,
      name: typeof parsed.name === "string" ? parsed.name : ""
    };
  } catch {
    return null;
  }
}

function saveSession(session) {
  try {
    if (session) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  } catch {
    /* El navegador puede bloquear localStorage. No es crítico. */
  }
}

function updateSessionFromAck(response, name) {
  if (!response || !response.code || !response.token) return;
  const currentName =
    name ||
    state.session?.name ||
    elements.nickname.value.trim() ||
    "";
  state.session = {
    code: response.code,
    token: response.token,
    name: currentName
  };
  state.allowResume = true;
  saveSession(state.session);
  if (currentName) {
    try {
      localStorage.setItem(NAME_KEY, currentName);
    } catch {
      /* noop */
    }
  }
}

function clearLocalSession() {
  state.session = null;
  state.allowResume = false;
  saveSession(null);
}

function isHost() {
  return Boolean(state.room?.self?.isHost);
}

function currentRound() {
  return state.room?.round || null;
}

function playerById(playerId) {
  return state.room?.players.find((player) => player.id === playerId) || null;
}

function isTypingTarget(target) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* ============================================================
   Toasts, red y pantallas
   ============================================================ */

function showToast(message, type = "info", duration = 4200) {
  if (!message) return;
  const toast = document.createElement("div");
  toast.className = `toast${type === "error" ? " toast--error" : ""}${
    type === "success" ? " toast--success" : ""
  }`;
  toast.textContent = message;
  elements.toastRoot.appendChild(toast);

  while (elements.toastRoot.children.length > 3) {
    elements.toastRoot.firstElementChild.remove();
  }

  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 200);
  }, duration);
}

function showNetBanner(message) {
  elements.netBannerText.textContent = message;
  elements.netBanner.hidden = false;
}

function hideNetBanner() {
  elements.netBanner.hidden = true;
}

function showBoot() {
  elements.boot.hidden = false;
}

function hideBoot() {
  elements.boot.hidden = true;
}

function otherPlaysHTML(round, { open = true, compact = false } = {}) {
  const plays = Array.isArray(round?.revealedPlays)
    ? round.revealedPlays.filter((play) => !play.isWinner)
    : [];
  if (plays.length === 0) return "";

  return `
    <details class="other-plays${compact ? " other-plays--compact" : ""}" ${open ? "open" : ""}>
      <summary>
        <span>Las otras jugadas de la ronda</span>
        <span class="other-plays__count">${plays.length}</span>
      </summary>
      <div class="other-plays__grid">
        ${plays
          .map(
            (play, index) => `
              <article class="other-play${play.isSelf ? " is-self" : ""}">
                <div class="other-play__head">
                  <span>JUGADA ${String(index + 1).padStart(2, "0")}</span>
                  ${play.isSelf ? '<span class="tag tag--you">Tu jugada</span>' : ""}
                </div>
                <p class="other-play__text">${promptHTML(round.blackCard.text, play.cards)}</p>
              </article>
            `
          )
          .join("")}
      </div>
      <p class="other-plays__note">El resto queda en el anonimato. Si quieren acusarse, háganlo por chat.</p>
    </details>
  `;
}

function showScreen(name, { forceScroll = false } = {}) {
  if (!["landing", "lobby", "game"].includes(name)) return;
  const changed = state.screen !== name;
  state.screen = name;
  elements.landing.hidden = name !== "landing";
  elements.lobby.hidden = name !== "lobby";
  elements.game.hidden = name !== "game";
  document.body.classList.toggle("screen-game", name === "game");
  if ((changed || forceScroll) && name !== "landing") {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }
}

function setDocumentTitle() {
  if (!state.room) {
    document.title = "Cartas Contra la Humanidad: Edición Criolla Sin Filtro";
    return;
  }
  const round = state.room.round;
  const room = state.room;
  let prefix = "";
  if (room.phase === "choosing" && round) {
    if (room.self.isJudge) prefix = "Te toca juzgar · ";
    else if (!room.myPlay) prefix = "¡Te toca jugar! · ";
  } else if (room.phase === "judging" && room.self.isJudge) {
    prefix = "Elige al ganador · ";
  } else if (room.phase === "game_over") {
    prefix = "Fin de la partida · ";
  }
  document.title = `${prefix}Sala ${room.code} · Cartas Contra la Humanidad Sin Filtro`;
}

/* ============================================================
   Landing
   ============================================================ */

function initLanding() {
  const query = new URLSearchParams(window.location.search);
  const invite = normalizeCode(query.get("sala"));
  state.inviteCode = invite;
  state.allowResume = Boolean(
    state.session && (!invite || state.session.code === invite)
  );

  const storedName = (() => {
    try {
      return localStorage.getItem(NAME_KEY) || "";
    } catch {
      return "";
    }
  })();
  if (storedName) {
    elements.nickname.value = storedName.slice(0, 18);
  }

  try {
    if (localStorage.getItem(AGE_KEY) === "1") {
      elements.ageCheck.checked = true;
    }
  } catch {
    /* noop */
  }

  if (invite) {
    elements.roomCode.value = invite;
    elements.inviteCode.textContent = invite;
    setEntryMode("join", { focus: false });
  } else {
    setEntryMode("create", { focus: false });
  }

  if (state.allowResume) {
    showBoot();
  } else {
    hideBoot();
    showScreen("landing");
  }

  elements.entryForm.addEventListener("submit", handleEntrySubmit);
  elements.nickname.addEventListener("input", clearEntryError);
  elements.roomCode.addEventListener("input", () => {
    const cursor = elements.roomCode.selectionStart;
    elements.roomCode.value = normalizeCode(elements.roomCode.value);
    if (cursor !== null) {
      elements.roomCode.setSelectionRange(
        Math.min(cursor, elements.roomCode.value.length),
        Math.min(cursor, elements.roomCode.value.length)
      );
    }
    clearEntryError();
  });

  $$("[data-entry-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      setEntryMode(button.dataset.entryTab);
    });
  });
}

function setEntryMode(mode, { focus = true } = {}) {
  state.entryMode = mode === "join" ? "join" : "create";
  const isJoin = state.entryMode === "join";

  $$("[data-entry-tab]").forEach((button) => {
    const active = button.dataset.entryTab === state.entryMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });

  elements.joinCodeField.hidden = !isJoin;
  elements.entrySubmitLabel.textContent = isJoin ? "Entrar a la sala" : "Crear sala";
  elements.entryHint.textContent = isJoin
    ? "El anfitrión te comparte un código de cinco caracteres."
    : "Tú creas el código. Tus panas entran con él.";
  elements.inviteHint.hidden = !(isJoin && state.inviteCode);
  elements.inviteCode.textContent = state.inviteCode || "—";
  clearEntryError();

  if (isJoin && state.inviteCode) {
    elements.roomCode.value = state.inviteCode;
  }

  if (focus) {
    if (isJoin) elements.roomCode.focus();
    else elements.nickname.focus();
  }
}

function setEntryError(message) {
  elements.entryError.textContent = message || "";
  elements.entryError.hidden = !message;
}

function clearEntryError() {
  if (!elements.entryError.hidden) setEntryError("");
}

function setEntryBusy(busy) {
  state.entryBusy = busy;
  elements.entrySubmit.disabled = busy;
  const label = state.entryMode === "join" ? "Entrando…" : "Creando…";
  elements.entrySubmitLabel.textContent = busy
    ? label
    : state.entryMode === "join"
      ? "Entrar a la sala"
      : "Crear sala";
  elements.nickname.disabled = busy;
  elements.roomCode.disabled = busy;
  elements.ageCheck.disabled = busy;
}

async function handleEntrySubmit(event) {
  event.preventDefault();
  if (state.entryBusy) return;

  const name = elements.nickname.value.replace(/\s+/g, " ").trim();
  const code = normalizeCode(elements.roomCode.value);
  const isJoin = state.entryMode === "join";

  if (Array.from(name).length < 2) {
    setEntryError("Pon un nombre de al menos 2 caracteres. El anonimato da desconfianza.");
    elements.nickname.focus();
    return;
  }
  if (!elements.ageCheck.checked) {
    setEntryError("Tienes que confirmar que eres mayor de 18. Esto no es Plaza Sésamo.");
    elements.ageCheck.focus();
    return;
  }
  if (isJoin && code.length !== 5) {
    setEntryError("El código tiene que tener exactamente 5 caracteres.");
    elements.roomCode.focus();
    return;
  }

  state.inviteCode = isJoin ? code : state.inviteCode;
  setEntryError("");
  setEntryBusy(true);

  try {
    if (!socket.connected) {
      throw new Error("No hay conexión con el servidor. Espera a que vuelva la señal.");
    }
    const savedAvatar = loadAvatarPreference();
    const response = await emitAck(
      isJoin ? "join_room" : "create_room",
      isJoin
        ? { name, code, avatar: savedAvatar || undefined }
        : { name, avatar: savedAvatar || undefined }
    );
    updateSessionFromAck(response, name);
    try {
      localStorage.setItem(AGE_KEY, "1");
    } catch {
      /* noop */
    }
    hideBoot();
  } catch (error) {
    setEntryError(error.message || "No se pudo entrar. Intenta de nuevo.");
    setEntryBusy(false);
    if (state.screen === "landing") {
      elements.entrySubmit.focus();
    }
    return;
  }

  setEntryBusy(false);
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config", { headers: { Accept: "application/json" } });
    if (!response.ok) return;
    const config = await response.json();
    state.config = config;
    if (config.cardCount) {
      elements.landingCardCount.textContent = formatNumber(config.cardCount);
    }

    const localhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "::1";

    if (localhost && Array.isArray(config.lanUrls) && config.lanUrls.length > 0) {
      state.shareBase = config.lanUrls[0];
      elements.localNote.hidden = false;
      elements.localNote.innerHTML = `<strong>Estás en localhost.</strong> El link para compartir usará <strong>${esc(
        config.lanUrls[0]
      )}</strong>. Para jugar fuera de tu red, mira el README.`;
    }
  } catch {
    /* El juego funciona igual; solo no actualizamos los contadores. */
  }
}

/* ============================================================
   Red y sesión
   ============================================================ */

function initSocket() {
  socket.on("connect", () => {
    hideNetBanner();
    if (state.allowResume && state.session) {
      attemptResume();
    } else {
      hideBoot();
    }
  });

  socket.on("disconnect", (reason) => {
    if (state.allowResume || state.room || state.chat.open || !elements.boot.hidden) {
      showNetBanner("Se cayó la señal. Reconectando…");
    }
    if (reason === "io server disconnect" && state.room) {
      /* El servidor nos cortó; intentamos recuperar con el token. */
      socket.connect();
    }
  });

  socket.on("connect_error", () => {
    if (!elements.boot.hidden) {
      state.resumeAttempts += 1;
      if (state.resumeAttempts >= 2) {
        hideBoot();
        showScreen("landing");
      }
    }
    showNetBanner("No se pudo conectar. Reintentando…");
  });

  socket.on("hello", (payload) => {
    if (payload && Array.isArray(payload.scoreOptions) && payload.scoreOptions.length) {
      state.scoreOptions = payload.scoreOptions;
    }
    if (payload && Array.isArray(payload.avatarOptions) && payload.avatarOptions.length) {
      state.avatarOptions = payload.avatarOptions;
    }
  });

  socket.on("state", handleState);
  socket.on("chat_message", handleChatMessage);
  socket.on("kicked", handleKicked);
  socket.on("toast", (payload) => {
    if (payload && payload.message) showToast(payload.message, payload.type || "error");
  });
}

async function attemptResume() {
  if (!state.session || !state.allowResume || state.resumeInFlight) {
    hideBoot();
    return;
  }
  state.resumeInFlight = true;
  const session = { ...state.session };

  const finish = (response, error) => {
    if (error || !response || !response.ok) {
      const message = error
        ? "No pudimos recuperar tu sala. Revisa la conexión."
        : response?.error || "No pudimos recuperar tu sala.";

      if (error && state.resumeAttempts < 1) {
        state.resumeAttempts += 1;
        window.setTimeout(() => {
          state.resumeInFlight = false;
          attemptResume();
        }, 1500);
        return;
      }

      state.resumeAttempts = 0;
      state.resumeInFlight = false;
      hideBoot();
      if (state.room || state.session) {
        showToast(`${message} Vuelve a entrar con el código.`, "error", 6000);
      }
      clearLocalSession();
      state.room = null;
      state.selfId = null;
      resetRoomUi();
      showScreen("landing");
      setEntryMode(state.inviteCode ? "join" : "create", { focus: false });
      return;
    }

    updateSessionFromAck(response, session.name);
    state.resumeAttempts = 0;
    state.resumeInFlight = false;
    hideBoot();
    hideNetBanner();
  };

  socket.timeout(8000).emit(
    "resume",
    { code: session.code, token: session.token },
    (error, response) => finish(response, error)
  );
}

function emitAck(event, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!socket.connected) {
      reject(new Error("Sin conexión con el servidor."));
      return;
    }
    socket.timeout(9000).emit(event, payload, (error, response) => {
      if (error) {
        reject(new Error("El servidor no respondió a tiempo. Revisa la conexión."));
        return;
      }
      if (!response || !response.ok) {
        reject(new Error((response && response.error) || "No se pudo completar la acción."));
        return;
      }
      resolve(response);
    });
  });
}

/* ============================================================
   Estado del servidor
   ============================================================ */

function handleState(payload) {
  if (!payload || !payload.code || !payload.phase || !payload.self) {
    return;
  }

  const previousRoom = state.room;
  const previousScreen = state.screen;
  const previousRound = previousRoom?.round?.number;
  const changedRoom = !previousRoom || previousRoom.code !== payload.code;

  state.room = payload;
  state.selfId = payload.selfId;
  state.allowResume = true;
  hideBoot();
  hideNetBanner();

  if (changedRoom) {
    state.roundKey = null;
    state.selection = [];
    state.gameOverKey = null;
    closeChat({ restoreFocus: false });
    resetChatForRoom(payload.code);
  }

  const round = payload.round;
  const roundKey = round ? `${payload.code}:${round.number}` : null;
  if (roundKey && roundKey !== state.roundKey) {
    state.roundKey = roundKey;
    state.selection = [];
    state.submitting = false;
  }

  if (
    payload.phase === "choosing" &&
    !payload.self.isJudge &&
    !payload.myPlay &&
    Array.isArray(payload.hand)
  ) {
    const handIds = new Set(payload.hand.map((card) => card.id));
    const pick = round?.blackCard?.pick || 1;
    state.selection = state.selection
      .filter((cardId) => handIds.has(cardId))
      .slice(0, pick);
  } else {
    state.selection = [];
  }

  syncChatFromState(payload.chat, payload.code);
  const gameOverKey =
    payload.phase === "game_over" && round?.winner
      ? `${payload.code}:${round.number}:${round.winner.playerId}:${round.winner.score}`
      : null;
  let openGameOverAfterRender = false;

  if (gameOverKey && gameOverKey !== state.gameOverKey) {
    state.gameOverKey = gameOverKey;
    openGameOverAfterRender = true;
  } else if (!gameOverKey && state.gameOverKey) {
    state.gameOverKey = null;
  }

  if (previousRoom?.phase === "game_over" && payload.phase !== "game_over") {
    stopConfetti();
  }

  if (state.modal.open && state.modal.kind === "gameover" && payload.phase !== "game_over") {
    closeModal({ silent: true });
  }

  const screen = payload.phase === "lobby" ? "lobby" : "game";
  showScreen(screen);
  renderAll();
  updateMobilePlayAction();
  setDocumentTitle();

  if (previousScreen === "landing" && screen !== "landing") {
    window.scrollTo({ top: 0, behavior: "auto" });
  }
  if (
    screen === "game" &&
    round &&
    previousRound !== undefined &&
    previousRound !== round.number
  ) {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  if (openGameOverAfterRender) {
    window.clearTimeout(state.gameOverTimer);
    state.gameOverTimer = window.setTimeout(() => {
      if (
        state.room &&
        state.room.phase === "game_over" &&
        state.room.round?.number === round?.number
      ) {
        if (!state.modal.open) {
          openGameOverModal({ auto: true });
        } else {
          showToast("La partida terminó. Cuando cierres esto, tienes los resultados.", "info");
        }
      }
    }, 550);
  }
}

function renderAll() {
  if (!state.room) {
    showScreen("landing");
    return;
  }
  if (state.room.phase === "lobby") {
    renderLobby();
  } else {
    renderGame();
  }
  updateChatBadges();
}

/* ============================================================
   Lobby
   ============================================================ */

function renderLobby() {
  const room = state.room;
  if (!room) return;

  elements.lobbyCodeBig.textContent = room.code;
  elements.lobbyCodeBig.setAttribute("aria-label", `Código de sala ${room.code}`);
  elements.lobbyPlayerCount.textContent = `${room.players.length}/${room.settings.maxPlayers}`;

  let localShare = false;
  try {
    localShare = isPrivateHostname(new URL(getShareUrl()).hostname);
  } catch {
    localShare = false;
  }
  elements.lobbySubtitle.textContent = localShare
    ? "Comparte el código. El link funciona en tu misma red; para jugar a distancia, despliega el juego o usa un túnel (mira el README)."
    : "Comparte el código. Cuando estén todos, el anfitrión prende la parranda.";

  const connectedCount = room.players.filter((player) => player.connected).length;
  const disconnected = room.players.filter((player) => !player.connected);
  const needed = Math.max(0, room.settings.minPlayers - connectedCount);
  const host = room.players.find((player) => player.isHost);

  if (elements.deckFact) {
    elements.deckFact.textContent = room.deck
      ? `${formatNumber(room.deck.black + room.deck.white)} cartas`
      : "Mazo sorpresa";
  }

  renderCustomDeckBox(room);

  elements.lobbyPlayers.innerHTML = room.players
    .map((player) => {
      const tone = toneFor(player.id);
      const classes = [
        "player-row",
        player.isHost ? "is-host" : "",
        player.isSelf ? "is-self" : "",
        player.connected ? "" : "is-offline"
      ]
        .filter(Boolean)
        .join(" ");

      const tags = [
        player.isHost ? '<span class="tag tag--host">Anfitrión</span>' : "",
        player.isSelf ? '<span class="tag tag--you">Tú</span>' : "",
        !player.connected ? '<span class="tag tag--offline">Sin señal</span>' : ""
      ]
        .filter(Boolean)
        .join("");

      return `
        <li class="${classes}">
          <span class="player-avatar" style="--avatar-bg: ${tone}" aria-hidden="true">${avatarBody(
            player.avatar
          )}</span>
          <div class="player-info">
            <div class="player-name-line">
              <span class="player-name">${esc(player.name)}</span>
              ${tags}
            </div>
            <p class="player-meta">${player.isHost ? "Manda el show y el código." : "Listo para perder la dignidad."}</p>
          </div>
          <div class="player-actions">
            ${
              player.isSelf
                ? `<button type="button" class="avatar-edit-button" data-action="open-avatar-editor" title="Cambiar mi avatar" aria-label="Cambiar mi avatar">✎</button>`
                : room.self.isHost
                  ? `<button type="button" class="kick-button" data-action="kick-player" data-player-id="${esc(
                      player.id
                    )}" title="Expulsar a ${esc(player.name)}" aria-label="Expulsar a ${esc(
                      player.name
                    )}">×</button>`
                  : ""
            }
          </div>
        </li>
      `;
    })
    .join("");

  if (room.players.length < room.settings.minPlayers) {
    const missing = room.settings.minPlayers - room.players.length;
    elements.lobbyPlayers.insertAdjacentHTML(
      "beforeend",
      `<li class="empty-roster">
        <span aria-hidden="true">${room.players.length === 1 ? "🫂" : "🪑"}</span>
        <strong>${missing === 1 ? "Falta un pana para empezar." : `Faltan ${missing} panas para empezar.`}</strong>
        <p>Manda el link al grupo donde todos dicen que sí y después se desaparecen.</p>
      </li>`
    );
  }

  elements.scoreOptions.innerHTML = state.scoreOptions
    .map((score) => {
      const active = Number(room.settings.targetScore) === Number(score);
      return `<button type="button" class="score-option${active ? " is-active" : ""}" data-action="set-score" data-score="${score}" aria-pressed="${
        active ? "true" : "false"
      }" ${room.self.isHost ? "" : "disabled"}>${score}</button>`;
    })
    .join("");

  if (room.self.isHost) {
    const deckIssue = getDeckStartIssue(room);
    let helper;
    if (disconnected.length > 0) {
      helper = `Falta que vuelva ${disconnected.map((player) => esc(player.name)).join(", ")}, naguará. Si no vuelve, expúlsalo con la ×.`;
    } else if (needed > 0) {
      helper = `Faltan ${needed} ${needed === 1 ? "jugador" : "jugadores"} para prender la parranda.`;
    } else if (deckIssue) {
      helper = deckIssue;
    } else {
      helper = "Todo listo. Tú decides cuándo se arruina la amistad.";
    }
    elements.hostBox.className = "host-box";
    elements.hostBox.innerHTML = `
      <button type="button" class="btn btn--primary btn--wide host-start-button" data-action="start-game" ${
        connectedCount >= room.settings.minPlayers &&
        disconnected.length === 0 &&
        !deckIssue
          ? ""
          : "disabled"
      }>
        Comenzar la fiesta
      </button>
      <p class="host-start-note">${helper}</p>
    `;
  } else {
    elements.hostBox.className = "host-box host-box--waiting";
    elements.hostBox.innerHTML = `
      <span class="waiting-dot" aria-hidden="true"></span>
      <div>
        <strong>${host ? esc(host.name) : "El anfitrión"} pone la música.</strong><br>
        En cuanto empiece, te avisamos.
      </div>
    `;
  }

  updateChatBadges();
}

function getDeckStartIssue(room) {
  const info = room?.deck;
  if (!info || !info.onlyCustom) return "";
  const neededWhite = room.players.length * 10;
  if (info.black < 1) {
    return "Tu mazo propio necesita al menos una carta negra.";
  }
  if (info.white < neededWhite) {
    return `Tu mazo propio tiene ${info.white} blancas; con ${room.players.length} jugadores necesitas al menos ${neededWhite}.`;
  }
  return "";
}

function renderCustomDeckBox(room) {
  if (!elements.customDeckBox) return;
  const info = room.deck || {};
  const customActive = Boolean(info.hasCustom);
  const modeLabel = customActive
    ? info.onlyCustom
      ? "Solo mazo propio"
      : "Mazo propio + casa"
    : "Mazo de la casa";
  const counts = customActive
    ? `${formatNumber(info.customBlack)} negras · ${formatNumber(info.customWhite)} blancas propias`
    : `${formatNumber(info.white || 0)} blancas · ${formatNumber(info.black || 0)} negras`;

  elements.customDeckBox.innerHTML = `
    <div class="custom-deck-box__head">
      <div>
        <span class="micro-label">MAZO DE LA MESA</span>
        <strong>${modeLabel}</strong>
        <p>${counts}</p>
      </div>
      <button type="button" class="btn btn--ghost btn--small" data-action="open-deck-editor">${
        room.self.isHost
          ? customActive
            ? "Editar mazo"
            : "Crear mi mazo"
          : "Armar mi mazo"
      }</button>
    </div>
    ${
      customActive
        ? `<p class="custom-deck-box__note">${
            room.self.isHost
              ? "Puedes tener un mazo propio guardado en este navegador y reutilizarlo en otra sala."
              : "El anfitrión armó este mazo. Arma el tuyo, descárgalo y pásale el archivo."
          }</p>`
        : room.self.isHost
          ? `<p class="custom-deck-box__note">Mete tus propias cartas negras y blancas, o mezcla unas cuantas con las ${formatNumber(
              Number(room.deck?.baseWhite || 0) + Number(room.deck?.baseBlack || 0) || 608
            )} de la casa.</p>`
          : `<p class="custom-deck-box__note">El anfitrión puede cambiar el mazo; tú también puedes armar uno y pasarle el archivo.</p>`
    }
  `;
}

/* ============================================================
   Render del juego
   ============================================================ */

function renderGame() {
  const room = state.room;
  if (!room) return;

  const round = room.round;
  elements.gameCode.textContent = room.code;
  elements.gameRound.textContent = round ? round.number : "—";
  elements.resultsHeaderButton.hidden = room.phase !== "game_over";

  renderScoreStrip();

  const judge = round ? playerById(round.judgeId) : null;
  elements.judgeLabel.textContent = judge
    ? `${judge.name}${judge.id === room.selfId ? " (tú)" : ""}${judge.connected ? "" : " · sin señal"}`
    : "—";
  elements.targetLabel.textContent = `Primero a ${room.settings.targetScore} puntos`;

  if (!round) {
    elements.tableArea.innerHTML = `
      <div class="waiting-panel">
        <div class="card-backs" aria-hidden="true">
          <span class="card-back"></span><span class="card-back"></span><span class="card-back"></span>
        </div>
        <h2>Repartiendo las cartas<span class="waiting-dots" aria-hidden="true"><span></span><span></span><span></span></span></h2>
        <p>Un segundo. Se está calentando el sancocho.</p>
      </div>
    `;
    elements.handArea.hidden = true;
    elements.handArea.innerHTML = "";
    return;
  }

  let tableHtml = "";
  let canPlay = false;

  if (room.phase === "game_over") {
    tableHtml = gameOverSummaryHTML();
  } else if (room.phase === "round_end") {
    tableHtml = roundResultHTML(round);
  } else if (room.phase === "judging") {
    if (room.self.isJudge) {
      tableHtml = judgeJudgingHTML(round);
    } else {
      tableHtml = waitingForJudgeHTML(round);
    }
  } else if (room.phase === "choosing") {
    if (room.self.isJudge) {
      tableHtml = judgeChoosingHTML(round);
    } else if (room.myPlay) {
      tableHtml = submittedWaitingHTML(round);
    } else {
      canPlay = true;
      tableHtml = `${blackCardHTML(round.blackCard)}
        <div id="playBarMount">${playBarHTML()}</div>
        ${hostAlertsHTML(round)}
        ${hostToolsHTML(round)}`;
    }
  }

  elements.tableArea.innerHTML = tableHtml;

  const shouldShowHand =
    room.phase === "choosing" &&
    canPlay &&
    room.self.connected &&
    !room.self.isJudge &&
    !room.myPlay &&
    Array.isArray(room.hand) &&
    room.hand.length > 0;

  if (shouldShowHand) {
    renderHand();
  } else {
    elements.handArea.hidden = true;
    elements.handArea.innerHTML = "";
  }

  updateMobilePlayAction();
  setDocumentTitle();
  updateChatBadges();
}

function renderScoreStrip() {
  const room = state.room;
  if (!room) return;

  elements.scoreStrip.innerHTML = room.players
    .map((player) => {
      const tone = toneFor(player.id);
      const classes = [
        "score-chip",
        player.isSelf ? "is-self" : "",
        player.isJudge ? "is-judge" : "",
        player.connected ? "" : "is-offline"
      ]
        .filter(Boolean)
        .join(" ");
      const status = [
        `${player.name}`,
        `${player.score} punto${player.score === 1 ? "" : "s"}`,
        player.isJudge ? "juez" : "",
        !player.connected ? "desconectado" : ""
      ]
        .filter(Boolean)
        .join(" · ");
      return `
        <div class="${classes}" title="${esc(status)}" aria-label="${esc(status)}">
          <span class="score-avatar" style="--avatar-bg: ${tone}" aria-hidden="true">${avatarBody(
            player.avatar
          )}</span>
          <span class="score-name">${esc(player.name)}${player.isSelf ? " (tú)" : ""}</span>
          ${
            player.isJudge
              ? '<span class="score-gavel" aria-hidden="true">JUEZ</span>'
              : ""
          }
          <span class="score-value" aria-hidden="true">${player.score}</span>
        </div>
      `;
    })
    .join("");
}

function blackCardHTML(card, options = {}) {
  const {
    cards = null,
    mini = false,
    winner = false,
    kicker = "PREGUNTA",
    showFooter = true
  } = options;

  const classes = [
    "black-card",
    mini ? "black-card--mini" : "",
    winner ? "black-card--winner" : "",
    cards ? "black-card--filled" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return `
    <article class="${classes}">
      <div class="black-card__top">
        <span class="card-kicker">${esc(kicker)}</span>
        <span class="pick-badge">${card.pick === 1 ? "1 carta" : "Elige 2"}</span>
      </div>
      <p class="black-card__text">${promptHTML(card.text, cards)}</p>
      ${
        showFooter
          ? `<div class="black-card__footer">
              <span>Cartas Contra la Humanidad</span>
              <span>Edición Sin Filtro</span>
            </div>`
          : ""
      }
    </article>
  `;
}

function promptHTML(text, cards = null) {
  const parts = esc(text).split("_");
  let result = "";
  for (let index = 0; index < parts.length; index += 1) {
    result += parts[index];
    if (index < parts.length - 1) {
      const card = cards && cards[index];
      if (card) {
        result += `<span class="fill">${esc(card.text)}</span>`;
      } else {
        result += '<span class="blank-slot" aria-hidden="true"></span>';
      }
    }
  }
  return result;
}

function playBarHTML() {
  const room = state.room;
  const round = room?.round;
  if (!round) return "";
  const pick = round.blackCard.pick;
  const selectedCards = state.selection
    .map((cardId) => room.hand?.find((card) => card.id === cardId))
    .filter(Boolean);
  const missing = Math.max(0, pick - selectedCards.length);

  const slots = Array.from({ length: pick }, (_, index) => {
    const card = selectedCards[index];
    return `
      <div class="play-slot${card ? " is-filled" : ""}">
        <span class="slot-label">${pick === 1 ? "Tu respuesta" : `Respuesta ${index + 1}`}</span>
        <span class="play-slot__card">${card ? esc(card.text) : "Toca una carta de tu mano"}</span>
      </div>
    `;
  }).join("");

  let title = "Elige tu jugada";
  let description = "Toca una carta de tu mano. El juez no sabrá cuál es tuya.";
  if (selectedCards.length === pick) {
    title = "¿Listo para el escándalo?";
    description = "Tu jugada va directo al juez. Ya no hay marcha atrás.";
  } else if (selectedCards.length > 0) {
    title = pick === 2 ? `Te falta ${missing} carta` : "Elige tu jugada";
    description =
      pick === 2
        ? "Elige la segunda respuesta. El orden importa para el chiste."
        : "Confirma cuando estés listo para arruinar la ronda.";
  }

  return `
    <div class="play-bar" id="playBar">
      <div class="play-slots">${slots}</div>
      <div class="play-bar__body">
        <strong>${title}</strong>
        <p>${description}</p>
      </div>
      <div class="play-bar__actions">
        <button type="button" class="btn btn--primary" data-action="submit-play" ${
          missing > 0 || state.submitting ? "disabled" : ""
        }>${state.submitting ? "Enviando…" : pick === 2 ? "Enviar las 2" : "Enviar jugada"}</button>
        <span class="selection-hint">${selectedCards.length}/${pick} elegidas</span>
      </div>
    </div>
  `;
}

function hostAlertsHTML(round) {
  if (!round) return "";
  const alerts = [];

  if (!round.judgeConnected && isHost()) {
    alerts.push(`
      <div class="host-alert">
        <span class="host-alert__icon" aria-hidden="true">!</span>
        <div class="host-alert__body">
          <h3>El juez se desconectó.</h3>
          <p>El juego no puede seguir sin alguien que juzgue. Nombra otro antes de que esto se convierta en una asamblea.</p>
        </div>
        <button type="button" class="btn btn--danger btn--small" data-action="reassign-judge">Reasignar juez</button>
      </div>
    `);
  }

  return alerts.join("");
}

function hostToolsHTML(round) {
  if (!round || !isHost() || !round.canForceVote) return "";
  return `
    <div class="host-tools">
      <span>Opciones del anfitrión</span>
      <button type="button" class="text-button" data-action="force-vote">Cerrar votación con las jugadas que hay</button>
    </div>
  `;
}

function judgeChoosingHTML(round) {
  const submitted = round.submittedCount || 0;
  const required = round.requiredCount || 0;
  const missing = Math.max(0, required - submitted);
  return `
    ${blackCardHTML(round.blackCard)}
    <div class="waiting-panel">
      <div class="card-backs" aria-hidden="true">
        <span class="card-back"></span><span class="card-back"></span><span class="card-back"></span>
      </div>
      <h2>${missing > 0 ? "Te toca juzgar" : "Ya están todas las jugadas"}<span class="waiting-dots" aria-hidden="true"><span></span><span></span><span></span></span></h2>
      <p>${
        missing > 0
          ? "No juegas en esta ronda. Espera a que los demás manden su barbaridad y después elige la peor."
          : "El juez está a punto de leer las respuestas. Prepárate para perder fe en tus amigos."
      }</p>
      <div class="waiting-progress"><strong>${submitted}</strong> de <strong>${required}</strong> jugadas recibidas</div>
    </div>
    ${hostAlertsHTML(round)}
    ${hostToolsHTML(round)}
  `;
}

function judgeJudgingHTML(round) {
  const submissions = Array.isArray(round.submissions) ? round.submissions : [];
  return `
    ${blackCardHTML(round.blackCard)}
    <div class="judge-brief">
      <div class="judge-brief__top">
        <span class="judge-brief__icon" aria-hidden="true">⚖️</span>
        <div>
          <h2>Elige la que más te arruine la vida.</h2>
          <p>No ves quién mandó qué. Solo ves el daño. Ninguna respuesta es correcta; algunas son inolvidables.</p>
        </div>
      </div>
    </div>
    ${
      submissions.length > 0
        ? `<div class="submission-grid">
            ${submissions
              .map(
                (submission, index) => `
                  <article class="submission-card">
                    <span class="submission-card__number">JUGADA ${String(index + 1).padStart(2, "0")}</span>
                    <div class="submission-card__shell">
                      ${blackCardHTML(round.blackCard, {
                        cards: submission.cards,
                        mini: true,
                        kicker: "RESPUESTA",
                        showFooter: false
                      })}
                    </div>
                    <button type="button" class="submission-card__cta" data-action="pick-winner" data-submission-id="${esc(
                      submission.id
                    )}">Elegir esta</button>
                  </article>
                `
              )
              .join("")}
          </div>`
        : `<div class="waiting-panel"><h2>No quedaron jugadas</h2><p>Alguien tardó demasiado y la ronda quedó vacía. El anfitrión puede reasignar juez o seguir.</p></div>`
    }
    ${hostAlertsHTML(round)}
  `;
}

function waitingForJudgeHTML(round) {
  const submitted = round.submittedCount || 0;
  const required = round.requiredCount || 0;
  return `
    ${blackCardHTML(round.blackCard)}
    <div class="waiting-panel">
      <div class="card-backs" aria-hidden="true">
        <span class="card-back"></span><span class="card-back"></span><span class="card-back"></span>
      </div>
      <h2>El juez está en la suya, primo<span class="waiting-dots" aria-hidden="true"><span></span><span></span><span></span></span></h2>
      <p>Ya no puedes cambiar tu jugada. Reza, amenaza o soborna con empanadas.</p>
      <div class="waiting-progress"><strong>${submitted}</strong> de <strong>${required}</strong> jugadas recibidas</div>
      ${
        state.room.myPlay
          ? `<div class="my-play">
              <p class="micro-label">TU JUGADA</p>
              ${blackCardHTML(round.blackCard, {
                cards: state.room.myPlay.cards,
                mini: true,
                kicker: "EN LA MESA",
                showFooter: false
              })}
            </div>`
          : ""
      }
    </div>
    ${hostAlertsHTML(round)}
  `;
}

function submittedWaitingHTML(round) {
  const submitted = round.submittedCount || 0;
  const required = round.requiredCount || 0;
  const missing = Math.max(0, required - submitted);
  return `
    ${blackCardHTML(round.blackCard)}
    <div class="waiting-panel">
      <div class="card-backs" aria-hidden="true">
        <span class="card-back"></span><span class="card-back"></span><span class="card-back"></span>
      </div>
      <h2>Jugada enviada. Ahora a esperar.<span class="waiting-dots" aria-hidden="true"><span></span><span></span><span></span></span></h2>
      <p>${
        missing > 0
          ? `Faltan ${missing} jugador${missing === 1 ? "" : "es"} por mandar su barbaridad.`
          : "Todos mandaron. El juez está leyendo sus respuestas con una sonrisa peligrosa."
      }</p>
      <div class="my-play">
        <p class="micro-label">TU JUGADA</p>
        ${blackCardHTML(round.blackCard, {
          cards: state.room.myPlay.cards,
          mini: true,
          kicker: "EN LA MESA",
          showFooter: false
        })}
      </div>
      <div class="waiting-progress"><strong>${submitted}</strong> de <strong>${required}</strong> jugadas recibidas</div>
    </div>
    ${hostAlertsHTML(round)}
    ${hostToolsHTML(round)}
  `;
}

function roundResultHTML(round) {
  if (!round.winner) {
    return `
      <div class="deserted-panel">
        <p class="eyebrow" style="justify-content:center">RONDA DESIERTA</p>
        <h2>No quedó ninguna jugada.</h2>
        <p>El juez se quedó sin respuestas y la ronda se fue sin punto. Cosas que pasan hasta en las mejores familias.</p>
        ${
          round.canAdvance
            ? `<button type="button" class="btn btn--primary" data-action="next-round">Siguiente ronda</button>`
            : `<p class="waiting-progress">Esperando que el anfitrión o el juez sigan.</p>`
        }
      </div>
    `;
  }

  const winner = round.winner;
  const winnerIsSelf = winner.playerId === state.room.selfId;
  return `
    <div class="round-result">
      <span class="winner-ribbon">Ganadora</span>
      <div class="winner-banner">
        <span class="winner-avatar" style="--avatar-bg: ${toneFor(winner.playerId)}" aria-hidden="true">${avatarBody(
          winner.avatar
        )}</span>
        <div class="winner-banner__copy">
          <span class="winner-kicker">La ronda es para</span>
          <h2 class="winner-name">${esc(winner.name)}${winnerIsSelf ? " (tú)" : ""}</h2>
          <p>${winnerIsSelf ? "Ganaste. Qué orgullo tan raro." : "Se llevó el punto y la vergüenza ajena."}</p>
        </div>
        <span class="winner-score">+1 · ${winner.score}/${state.room.settings.targetScore}</span>
      </div>
      ${blackCardHTML(round.blackCard, { cards: winner.cards, winner: true })}
      ${otherPlaysHTML(round)}
      <div class="round-actions">
        ${
          round.canAdvance
            ? `<button type="button" class="btn btn--primary" data-action="next-round">Siguiente ronda</button>
               <p>Preparen la próxima vergüenza.</p>`
            : `<p>Esperando que ${esc(round.judgeName)} o el anfitrión pasen a la siguiente ronda.</p>`
        }
      </div>
    </div>
  `;
}

function gameOverSummaryHTML() {
  const room = state.room;
  const round = room?.round;
  const winner = room?.gameWinner;
  if (!winner) {
    return `<div class="waiting-panel"><h2>Partida terminada</h2><p>Alguien ganó. No preguntes cómo.</p></div>`;
  }
  const winnerIsSelf = winner.id === room.selfId;
  return `
    <div class="gameover-summary">
      <div class="gameover-summary__top">
        <span class="winner-avatar" style="--avatar-bg: ${toneFor(winner.id)}" aria-hidden="true">${avatarBody(
          winner.avatar
        )}</span>
        <div>
          <p class="eyebrow" style="margin-bottom:5px">FIN DE LA PARTIDA</p>
          <h2>${esc(winner.name)} ganó.</h2>
          <p>${winnerIsSelf ? "Eres oficialmente la peor persona del grupo. Felicitaciones." : "El grupo nunca volverá a ser el mismo."}</p>
        </div>
      </div>
      ${
        round?.winner
          ? blackCardHTML(round.blackCard, { cards: round.winner.cards, winner: true })
          : ""
      }
      <div class="round-actions">
        <button type="button" class="btn btn--primary" data-action="open-results">Ver resumen final</button>
        ${
          room.self.isHost
            ? `<button type="button" class="btn btn--ghost" data-action="back-to-lobby">Volver al lobby</button>`
            : `<p>El anfitrión decide si hay revancha.</p>`
        }
      </div>
    </div>
  `;
}

/* ============================================================
   Mano y selección
   ============================================================ */

function renderHand() {
  const room = state.room;
  if (!room || !room.round) return;
  const round = room.round;
  const pick = round.blackCard.pick;

  elements.handArea.hidden = false;
  const previousScroller = $("#handScroller");
  const previousScroll = previousScroller ? previousScroller.scrollLeft : 0;

  elements.handArea.innerHTML = `
    <div class="hand-header">
      <span class="hand-title">Tu mano · ${room.hand.length} cartas</span>
      <span class="hand-sub">${pick === 1 ? "Elige 1" : "Elige 2"} · desliza para ver todas</span>
    </div>
    <div class="hand-scroller" id="handScroller">
      <div class="hand">
        ${room.hand.map((card) => whiteCardHTML(card)).join("")}
      </div>
    </div>
    <div class="hand-toolbar">
      <p>Toca una carta para elegirla. Vuelve a tocarla para quitarla.</p>
      <span class="hand-scroll-hint">→ Desliza</span>
    </div>
  `;

  const scroller = $("#handScroller");
  if (scroller && previousScroller) {
    scroller.scrollLeft = previousScroll;
  }
  syncHandSelection();
}

function whiteCardHTML(card) {
  const order = state.selection.indexOf(card.id);
  const selected = order >= 0;
  const pick = state.room?.round?.blackCard?.pick || 1;
  const label = selected
    ? `${card.text}. Elegida ${order + 1} de ${pick}`
    : card.text;
  return `
    <button type="button" class="white-card${selected ? " is-selected" : ""}" data-action="select-card" data-card-id="${esc(
      card.id
    )}" aria-pressed="${selected ? "true" : "false"}" aria-label="${esc(label)}">
      <span class="selection-number" aria-hidden="true">${selected ? order + 1 : ""}</span>
      <span class="white-card__text">${esc(card.text)}</span>
      <span class="white-card__seal" aria-hidden="true">CCH</span>
    </button>
  `;
}

function syncHandSelection() {
  const hand = elements.handArea.querySelectorAll(".white-card");
  hand.forEach((cardButton) => {
    const order = state.selection.indexOf(cardButton.dataset.cardId);
    const selected = order >= 0;
    cardButton.classList.toggle("is-selected", selected);
    cardButton.setAttribute("aria-pressed", selected ? "true" : "false");
    const badge = cardButton.querySelector(".selection-number");
    if (badge) badge.textContent = selected ? String(order + 1) : "";
  });
}

function updatePlayBar() {
  const mount = $("#playBarMount");
  if (mount) {
    mount.innerHTML = playBarHTML();
  }
  syncHandSelection();
  updateMobilePlayAction();
}

function updateMobilePlayAction() {
  const room = state.room;
  const round = room?.round;
  const canShow =
    room &&
    round &&
    room.phase === "choosing" &&
    !room.self.isJudge &&
    !room.myPlay &&
    room.self.connected &&
    state.selection.length > 0 &&
    state.screen === "game";

  if (!canShow) {
    elements.mobilePlayAction.hidden = true;
    elements.mobilePlayAction.innerHTML = "";
    return;
  }

  const pick = round.blackCard.pick;
  const missing = Math.max(0, pick - state.selection.length);
  elements.mobilePlayAction.hidden = false;
  elements.mobilePlayAction.innerHTML = `
    <div class="mobile-play-action__info">
      <strong>${state.selection.length}/${pick}</strong>
      <span>${missing > 0 ? `Falta${missing === 1 ? "" : "n"} ${missing}` : "Lista para enviar"}</span>
    </div>
    <button type="button" class="btn btn--primary" data-action="submit-play" ${
      missing > 0 || state.submitting ? "disabled" : ""
    }>${state.submitting ? "Enviando…" : pick === 2 ? "Enviar las 2" : "Enviar jugada"}</button>
  `;
}

function selectCard(cardId) {
  const room = state.room;
  const round = room?.round;
  if (!room || !round || room.phase !== "choosing" || room.self.isJudge || room.myPlay) {
    return;
  }
  if (!room.hand.some((card) => card.id === cardId)) return;

  const pick = round.blackCard.pick;
  const existingIndex = state.selection.indexOf(cardId);

  if (existingIndex >= 0) {
    state.selection.splice(existingIndex, 1);
  } else if (state.selection.length < pick) {
    state.selection.push(cardId);
  } else if (pick === 1) {
    state.selection = [cardId];
  } else {
    showToast(`Ya elegiste ${pick} cartas. Toca una para quitarla y cambiarla.`, "info");
    return;
  }

  state.submitting = false;
  updatePlayBar();
}

async function submitPlay() {
  const room = state.room;
  const round = room?.round;
  if (!room || !round || state.submitting) return;
  const pick = round.blackCard.pick;
  if (state.selection.length !== pick) {
    showToast(pick === 1 ? "Elige una carta." : `Elige exactamente ${pick} cartas.`, "error");
    return;
  }

  state.submitting = true;
  updatePlayBar();
  try {
    await emitAck("submit_cards", { cardIds: state.selection.slice() });
    state.selection = [];
    state.submitting = false;
    updatePlayBar();
    updateMobilePlayAction();
  } catch (error) {
    state.submitting = false;
    showToast(error.message, "error");
    updatePlayBar();
  }
}

/* ============================================================
   Acciones del juego
   ============================================================ */

async function pickWinner(button) {
  if (!button || button.disabled) return;
  const submissionId = button.dataset.submissionId;
  if (!submissionId) return;
  button.disabled = true;
  button.textContent = "Eligiendo…";
  try {
    await emitAck("pick_winner", { submissionId });
  } catch (error) {
    button.disabled = false;
    button.textContent = "Elegir esta";
    showToast(error.message, "error");
  }
}

async function nextRound(button) {
  if (!button || button.disabled) return;
  button.disabled = true;
  try {
    await emitAck("next_round");
  } catch (error) {
    button.disabled = false;
    showToast(error.message, "error");
  }
}

async function forceVote() {
  const confirmed = await confirmDialog({
    eyebrow: "Cerrar la votación",
    title: "¿Cerrar con lo que hay?",
    message:
      "Las jugadas que faltan no se van a contar. El juez elegirá entre las que ya están en la mesa. Ideal para cuando alguien se quedó dormido en el baño.",
    confirmLabel: "Sí, cerrar",
    cancelLabel: "Dejar esperar"
  });
  if (!confirmed) return;
  try {
    await emitAck("force_vote");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function reassignJudge() {
  const confirmed = await confirmDialog({
    eyebrow: "Cambio de juez",
    title: "¿Nombrar otro juez?",
    message:
      "El juez actual pierde el puesto y el nuevo juez podrá elegir al ganador. Si el nuevo ya había mandado una jugada, se le devuelve a la mano.",
    confirmLabel: "Nombrar otro",
    cancelLabel: "Dejarlo así"
  });
  if (!confirmed) return;
  try {
    await emitAck("reassign_judge");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function backToLobby() {
  const confirmed = await confirmDialog({
    eyebrow: "Volver al lobby",
    title: "¿Terminar la partida?",
    message:
      "Se borran los puntos y las manos. Todos vuelven a la sala de espera para decidir si se odian o juegan otra.",
    confirmLabel: "Volver al lobby",
    cancelLabel: "Seguir jugando",
    danger: true
  });
  if (!confirmed) return;
  try {
    await emitAck("back_to_lobby");
  } catch (error) {
    showToast(error.message, "error");
  }
}

/* ============================================================
   Chat
   ============================================================ */

function resetChatForRoom(code) {
  state.chat.roomCode = code;
  state.chat.messages = [];
  state.chat.ids = new Set();
  state.chat.unread = 0;
  state.chat.open = false;
  syncBodyLock();
  elements.chatDrawer.classList.remove("is-open");
  elements.chatDrawer.setAttribute("aria-hidden", "true");
  elements.chatOverlay.classList.remove("is-open");
  renderChat();
  updateChatBadges();
}

function syncChatFromState(messages, code) {
  if (!Array.isArray(messages)) return;
  if (state.chat.roomCode !== code) {
    resetChatForRoom(code);
  }
  const before = state.chat.messages.length;
  for (const message of messages) {
    if (!message || !message.id || state.chat.ids.has(message.id)) continue;
    state.chat.messages.push(message);
    state.chat.ids.add(message.id);
  }
  if (state.chat.messages.length !== before) {
    state.chat.messages.sort((a, b) => (a.at || 0) - (b.at || 0));
    renderChat();
  }
  updateChatBadges();
}

function handleChatMessage(message) {
  if (!message || !message.id || !state.room) return;
  if (message.roomCode && message.roomCode !== state.room.code) return;
  const before = state.chat.messages.length;
  if (!state.chat.ids.has(message.id)) {
    state.chat.messages.push(message);
    state.chat.ids.add(message.id);
  }
  if (state.chat.messages.length === before) return;
  state.chat.messages.sort((a, b) => (a.at || 0) - (b.at || 0));

  if (!state.chat.open && message.type === "user" && message.playerId !== state.selfId) {
    state.chat.unread += 1;
  }
  renderChat(true);
  updateChatBadges();
}

function renderChat(forceScroll = false) {
  const box = elements.chatMessages;
  if (!box) return;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 90;

  if (!state.room) {
    box.innerHTML = `<div class="chat-empty">El chat aparece cuando estés en una sala.</div>`;
    return;
  }

  if (state.chat.messages.length === 0) {
    box.innerHTML = `<div class="chat-empty">Todavía nadie ha dicho una barbaridad.<br>Sé el primero, mi pana. No te quedes con las ganas.</div>`;
    return;
  }

  box.innerHTML = state.chat.messages
    .map((message) => {
      if (message.type === "system") {
        return `<div class="chat-message chat-message--system"><div class="chat-bubble">${esc(
          message.text
        )}</div></div>`;
      }
      const self = message.playerId === state.selfId;
      const player = playerById(message.playerId);
      const tone = toneFor(message.playerId || message.name || "x");
      return `
        <div class="chat-message${self ? " chat-message--self" : ""}">
          <span class="chat-avatar" style="--avatar-bg: ${tone}" aria-hidden="true">${avatarBody(
            player?.avatar || message.avatar || "👤"
          )}</span>
          <div class="chat-body">
            <div class="chat-meta">
              <span class="chat-author">${esc(self ? "Tú" : message.name || "Alguien")}</span>
              <span class="chat-time">${esc(formatTime(message.at))}</span>
            </div>
            <div class="chat-bubble">${esc(message.text)}</div>
          </div>
        </div>
      `;
    })
    .join("");

  if (state.chat.open && (forceScroll || nearBottom)) {
    box.scrollTop = box.scrollHeight;
  }
}

function updateChatBadges() {
  const unread = state.chat.open ? 0 : state.chat.unread;
  [elements.lobbyChatBadge, elements.gameChatBadge].forEach((badge) => {
    if (!badge) return;
    badge.hidden = unread <= 0;
    badge.textContent = unread > 9 ? "9+" : String(unread);
  });
}

function openChat(trigger) {
  if (!state.room) return;
  state.chat.trigger = trigger || null;
  state.chat.open = true;
  state.chat.unread = 0;
  elements.chatOverlay.classList.add("is-open");
  elements.chatDrawer.classList.add("is-open");
  elements.chatDrawer.setAttribute("aria-hidden", "false");
  syncBodyLock();
  updateChatBadges();
  renderChat(true);

  window.setTimeout(() => {
    elements.chatInput.focus({ preventScroll: true });
  }, prefersReducedMotion() ? 0 : 180);
}

function closeChat({ restoreFocus = true } = {}) {
  if (!state.chat.open && !elements.chatDrawer.classList.contains("is-open")) return;
  const trigger = state.chat.trigger;
  state.chat.open = false;
  elements.chatOverlay.classList.remove("is-open");
  elements.chatDrawer.classList.remove("is-open");
  elements.chatDrawer.setAttribute("aria-hidden", "true");
  syncBodyLock();
  state.chat.trigger = null;
  if (restoreFocus && trigger && document.contains(trigger)) {
    trigger.focus({ preventScroll: true });
  }
}

async function handleChatSubmit(event) {
  event.preventDefault();
  if (!state.chat.open) return;
  const text = elements.chatInput.value.trim();
  if (!text) return;
  if (!state.room) {
    showToast("No estás en una sala.", "error");
    return;
  }

  elements.chatInput.value = "";
  elements.chatSend.disabled = true;
  try {
    await emitAck("send_chat", { text });
  } catch (error) {
    showToast(error.message, "error");
    if (!elements.chatInput.value) elements.chatInput.value = text;
  } finally {
    elements.chatSend.disabled = false;
    elements.chatInput.focus({ preventScroll: true });
  }
}

/* ============================================================
   Compartir
   ============================================================ */

function getShareUrl() {
  const code = state.room?.code;
  if (!code) return state.shareBase || window.location.origin;
  const base = state.shareBase || window.location.origin;
  try {
    return new URL(`/?sala=${encodeURIComponent(code)}`, base).href;
  } catch {
    return `${base.replace(/\/$/, "")}/?sala=${encodeURIComponent(code)}`;
  }
}

function isPrivateHostname(hostname) {
  const host = String(hostname || "").toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local") ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host)
  );
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fallback abajo */
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

async function copyRoomCode() {
  if (!state.room) return;
  const ok = await copyText(state.room.code);
  showToast(ok ? "Código copiado. Ahora pásalo por el grupo." : "No se pudo copiar. Hazlo a mano.", ok ? "success" : "error");
}

async function copyShareLink() {
  if (!state.room) return;
  const link = getShareUrl();
  const ok = await copyText(link);
  showToast(
    ok ? "Link copiado. Mándalo antes de que se arrepientan." : `Copia este link a mano: ${link}`,
    ok ? "success" : "error",
    ok ? 4200 : 7000
  );
}

function openWhatsApp() {
  if (!state.room) return;
  const code = state.room.code;
  const text = `¡Estamos jugando Cartas Contra la Humanidad: Edición Criolla Sin Filtro! Código: ${code}. Entra aquí: ${getShareUrl()}`;
  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    void copyShareLink();
  }
}

/* ============================================================
   Modales
   ============================================================ */

function syncBodyLock() {
  const locked = state.modal.open || state.chat.open;
  document.body.classList.toggle("is-locked", locked);
}

function openModal({
  eyebrow = "Aviso",
  title = "",
  body = "",
  actions = [],
  className = "",
  dismissible = true,
  kind = null,
  onClose = null
}) {
  if (state.chat.open) closeChat({ restoreFocus: false });
  if (state.modal.open) {
    closeModal({ silent: true });
  }

  state.modal.open = true;
  state.modal.dismissible = dismissible;
  state.modal.actions = {};
  state.modal.onClose = typeof onClose === "function" ? onClose : null;
  state.modal.kind = kind;
  state.modal.previousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const actionButtons = actions
    .map((action) => {
      state.modal.actions[action.id] = action.onClick;
      return `<button type="button" class="btn ${esc(action.className || "btn--soft")}" data-modal-action="${esc(
        action.id
      )}">${esc(action.label)}</button>`;
    })
    .join("");

  elements.modalRoot.innerHTML = `
    <section class="modal-card${className ? ` ${esc(className)}` : ""}" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      ${
        dismissible
          ? '<button type="button" class="modal-close" data-modal-close aria-label="Cerrar">×</button>'
          : ""
      }
      <div class="modal-head">
        <p class="modal-eyebrow">${esc(eyebrow)}</p>
        <h2 class="modal-title" id="modalTitle">${esc(title)}</h2>
      </div>
      <div class="modal-body">${body}</div>
      ${
        actionButtons
          ? `<div class="modal-actions">${actionButtons}</div>`
          : ""
      }
    </section>
  `;

  elements.modalRoot.hidden = false;
  elements.modalRoot.classList.add("is-open");
  syncBodyLock();

  const focusTarget = elements.modalRoot.querySelector(
    "[data-modal-action], [data-modal-close], button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
  );
  if (focusTarget) {
    window.setTimeout(() => focusTarget.focus({ preventScroll: true }), 30);
  }
}

function closeModal({ silent = false } = {}) {
  if (!state.modal.open) {
    elements.modalRoot.hidden = true;
    elements.modalRoot.innerHTML = "";
    return;
  }
  const { onClose, previousFocus, kind } = state.modal;
  if (kind === "gameover") stopConfetti();
  state.modal.open = false;
  state.modal.actions = {};
  state.modal.onClose = null;
  state.modal.kind = null;
  elements.modalRoot.hidden = true;
  elements.modalRoot.innerHTML = "";
  elements.modalRoot.classList.remove("is-open");
  syncBodyLock();

  if (previousFocus && document.contains(previousFocus)) {
    previousFocus.focus({ preventScroll: true });
  }
  if (!silent && typeof onClose === "function") {
    onClose();
  }
}

function handleModalClick(event) {
  if (!state.modal.open) return;

  if (event.target === elements.modalRoot) {
    if (state.modal.dismissible) closeModal();
    return;
  }

  const closeButton = event.target.closest("[data-modal-close]");
  if (closeButton) {
    if (state.modal.dismissible) closeModal();
    return;
  }

  const actionButton = event.target.closest("[data-modal-action]");
  if (!actionButton) return;
  const actionId = actionButton.dataset.modalAction;
  const action = state.modal.actions[actionId];
  if (typeof action !== "function") return;

  actionButton.disabled = true;
  Promise.resolve()
    .then(() => action(actionButton, event))
    .catch((error) => {
      showToast(error?.message || "No se pudo completar la acción.", "error");
    })
    .finally(() => {
      if (document.contains(actionButton)) actionButton.disabled = false;
    });
}

function openRules() {
  const body = `
    <p class="modal-intro">
      Es el juego de cartas que ya conoces, pero con el país, el barrio y las malas decisiones
      de por medio. No hay respuestas correctas: hay respuestas que se recuerdan en el próximo cumpleaños.
    </p>
    <div class="rules-grid">
      <article class="rule-card">
        <span class="rule-card__number">1</span>
        <h3>Se arma la mesa</h3>
        <p>Juegan de 3 a 12 personas. En cada ronda, una persona es el juez y el resto recibe 10 cartas blancas.</p>
      </article>
      <article class="rule-card">
        <span class="rule-card__number">2</span>
        <h3>El juez lee la negra</h3>
        <p>La carta negra es una frase con uno o dos huecos. El juez la lee en voz alta, con drama.</p>
      </article>
      <article class="rule-card">
        <span class="rule-card__number">3</span>
        <h3>Todos mandan su peor respuesta</h3>
        <p>Los demás eligen en secreto una carta (o dos, si la negra lo pide) y la mandan. El juez solo ve las jugadas, no quién las mandó.</p>
      </article>
      <article class="rule-card">
        <span class="rule-card__number">4</span>
        <h3>Un punto y una vergüenza</h3>
        <p>El juez elige la respuesta que más le arruinó la vida. Esa persona suma un punto. La primera en llegar a la meta gana.</p>
      </article>
    </div>
    <p class="rules-callout">
      <strong>Regla de oro:</strong> el juez no juega en su ronda. No hay trampa, no hay excusa.
      Si la carta negra pide dos respuestas, el orden en que las eliges cuenta para el chiste.
    </p>
    <p class="rules-callout">
      <strong>Contenido para adultos.</strong> Humor negro, política, religión, sexo, corrupción y
      una que otra denuncia penal. Si algo te ofende, tienes todo el derecho a perder.
    </p>
  `;

  openModal({
    eyebrow: "Manual para gente sin vergüenza",
    title: "Cómo se juega",
    body,
    className: "modal-card--wide",
    actions: [
      {
        id: "ok",
        label: "Entendido",
        className: "btn--primary",
        onClick: () => closeModal()
      }
    ]
  });
}

function loadSavedCustomDeck() {
  try {
    const raw = localStorage.getItem(CUSTOM_DECK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      whiteTexts: Array.isArray(parsed.whiteTexts)
        ? parsed.whiteTexts.filter((value) => typeof value === "string")
        : [],
      blackTexts: Array.isArray(parsed.blackTexts)
        ? parsed.blackTexts.filter((value) => typeof value === "string")
        : [],
      mode: parsed.mode === "only" ? "only" : "mix"
    };
  } catch {
    return null;
  }
}

function saveSavedCustomDeck(deck) {
  try {
    localStorage.setItem(CUSTOM_DECK_KEY, JSON.stringify(deck));
  } catch {
    /* noop */
  }
}

function uniqueDeckLines(raw, type) {
  const seen = new Set();
  const result = [];
  for (const rawLine of String(raw || "").split(/\r?\n/)) {
    let line = rawLine
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (type === "white") line = line.replace(/\.+$/u, "").trim();
    if (!line) continue;
    const key = line.toLocaleLowerCase("es");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(line);
  }
  return result;
}

function deckFromEditor() {
  const whiteTexts = uniqueDeckLines($("#deckWhiteInput").value, "white");
  const blackTexts = uniqueDeckLines($("#deckBlackInput").value, "black");
  const mode =
    elements.modalRoot.querySelector('input[name="deckMode"]:checked')?.value === "only"
      ? "only"
      : "mix";
  return { whiteTexts, blackTexts, mode };
}

function validateDeckDraft(deck) {
  if (deck.whiteTexts.length > 300) {
    return "Máximo 300 cartas blancas.";
  }
  if (deck.blackTexts.length > 200) {
    return "Máximo 200 cartas negras.";
  }
  for (const text of [...deck.whiteTexts, ...deck.blackTexts]) {
    if (Array.from(text).length > 180) {
      return "Cada carta puede tener máximo 180 caracteres.";
    }
  }
  for (const text of deck.whiteTexts) {
    if (text.includes("_")) {
      return "Las cartas blancas no llevan guiones bajos.";
    }
  }
  for (const text of deck.blackTexts) {
    const blanks = (text.match(/_/g) || []).length;
    if (blanks < 1 || blanks > 2) {
      return `La carta negra «${text}» debe tener 1 o 2 huecos (_).`;
    }
  }
  return "";
}

function updateDeckEditorStats() {
  const whiteInput = $("#deckWhiteInput");
  const blackInput = $("#deckBlackInput");
  if (!whiteInput || !blackInput) return;
  const deck = deckFromEditor();
  const whiteCount = $("#deckWhiteCount");
  const blackCount = $("#deckBlackCount");
  const warning = $("#deckModeWarning");
  if (whiteCount) whiteCount.textContent = `${deck.whiteTexts.length}/300`;
  if (blackCount) blackCount.textContent = `${deck.blackTexts.length}/200`;

  elements.modalRoot
    .querySelectorAll(".deck-mode-option")
    .forEach((option) => {
      option.classList.toggle(
        "is-active",
        option.querySelector("input")?.checked
      );
    });

  if (warning) {
    const neededWhite = (state.room?.players.length || 0) * 10;
    if (deck.mode === "only") {
      if (!deck.whiteTexts.length && !deck.blackTexts.length) {
        warning.textContent =
          "Modo solo mío está vacío. Se usará el mazo de la casa hasta que agregues cartas.";
        warning.className = "deck-warning";
      } else if (deck.blackTexts.length < 1) {
        warning.textContent = "Para el modo solo mío necesitas al menos una carta negra.";
        warning.className = "deck-warning is-danger";
      } else if (deck.whiteTexts.length < neededWhite) {
        warning.textContent = `Con ${state.room?.players.length || 0} jugadores necesitas ${neededWhite} cartas blancas. Ahora tienes ${deck.whiteTexts.length}.`;
        warning.className = "deck-warning is-danger";
      } else {
        warning.textContent = `Listo: ${deck.blackTexts.length} negras y ${deck.whiteTexts.length} blancas propias.`;
        warning.className = "deck-warning is-ok";
      }
    } else {
      warning.textContent = "Se mezclará con el mazo de la casa. No hay mínimo.";
      warning.className = "deck-warning";
    }
  }
}

async function imageFileToAvatar(file) {
  if (!file || !/^image\//i.test(file.type || "")) {
    throw new Error("Ese archivo no es una imagen.");
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error("La foto pesa más de 8 MB. Usa una más liviana.");
  }

  let source = null;
  try {
    source = await createImageBitmap(file);
  } catch {
    const objectUrl = URL.createObjectURL(file);
    try {
      source = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("No se pudo leer la foto."));
        image.src = objectUrl;
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  const sourceWidth = source.width || source.naturalWidth;
  const sourceHeight = source.height || source.naturalHeight;
  if (!sourceWidth || !sourceHeight) {
    throw new Error("No se pudo leer la foto.");
  }

  const side = Math.min(sourceWidth, sourceHeight);
  const sourceX = (sourceWidth - side) / 2;
  const sourceY = (sourceHeight - side) / 2;
  const size = 80;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("El navegador no pudo procesar la foto.");

  context.fillStyle = "#f3e8d2";
  context.fillRect(0, 0, size, size);
  context.drawImage(source, sourceX, sourceY, side, side, 0, 0, size, size);
  if (typeof source.close === "function") source.close();

  let dataUrl = canvas.toDataURL("image/jpeg", 0.72);
  if (dataUrl.length > 12000) {
    dataUrl = canvas.toDataURL("image/jpeg", 0.52);
  }
  if (dataUrl.length > 12000) {
    throw new Error("La foto sigue pesando demasiado. Prueba con una más pequeña.");
  }
  return dataUrl;
}

function openAvatarEditor() {
  const room = state.room;
  if (!room) return;
  const selfPlayer = playerById(state.selfId) || room.self;
  const currentAvatar = selfPlayer?.avatar || "👤";
  const options =
    Array.isArray(state.avatarOptions) && state.avatarOptions.length > 0
      ? state.avatarOptions
      : DEFAULT_AVATARS;

  const body = `
    <p class="modal-intro">
      Elige un emoji o sube una foto para que tus panas te reconozcan en la mesa, el chat y el marcador.
      La foto se recorta en círculo y se achica automáticamente.
    </p>
    <div class="avatar-editor">
      <div class="avatar-editor__preview-wrap">
        <div class="avatar-preview" id="avatarPreview" aria-label="Vista previa de tu avatar">${avatarBody(
          currentAvatar
        )}</div>
        <p>Así te ven los demás.</p>
      </div>
      <div class="avatar-editor__content">
        <p class="micro-label">ELIGE UN EMOJI</p>
        <div class="avatar-grid" id="avatarGrid">
          ${options
            .map(
              (emoji) => `
                <button type="button" class="avatar-choice${
                  emoji === currentAvatar ? " is-current" : ""
                }" data-avatar-choice="${esc(emoji)}" aria-label="Usar avatar ${esc(
                  emoji
                )}" aria-pressed="${emoji === currentAvatar}">${esc(emoji)}</button>
              `
            )
            .join("")}
        </div>
        <div class="avatar-upload">
          <div>
            <strong>O sube una foto</strong>
            <p>JPG, PNG o WebP. Se recorta al centro y se achica para que cargue rápido.</p>
          </div>
          <label class="btn btn--ghost btn--small" for="avatarFileInput">Elegir foto</label>
          <input id="avatarFileInput" type="file" accept="image/*" hidden>
        </div>
        <p class="form-error" id="avatarError" role="alert" hidden></p>
      </div>
    </div>
    <p class="deck-editor__note">Tu elección se guarda en este navegador y se aplica la próxima vez que entres a una sala.</p>
  `;

  openModal({
    eyebrow: "Tu identidad en la mesa",
    title: "Cambiar avatar",
    body,
    kind: "avatar",
    dismissible: true,
    actions: [
      {
        id: "cancel",
        label: "Cancelar",
        className: "btn--ghost",
        onClick: () => closeModal()
      }
    ]
  });

  const preview = $("#avatarPreview");
  const errorBox = $("#avatarError");
  const fileInput = $("#avatarFileInput");
  const avatarGrid = $("#avatarGrid");
  let working = false;

  const setError = (message) => {
    if (!errorBox) return;
    errorBox.textContent = message || "";
    errorBox.hidden = !message;
  };

  const chooseAvatar = async (avatar) => {
    if (working) return;
    working = true;
    setError("");
    if (preview) preview.innerHTML = avatarBody(avatar);
    elements.modalRoot
      .querySelectorAll("[data-avatar-choice]")
      .forEach((button) => {
        button.disabled = true;
      });
    try {
      await emitAck("update_avatar", { avatar });
      saveAvatarPreference(avatar);
      closeModal();
      showToast("Avatar actualizado. Ahora sí te van a reconocer.", "success");
    } catch (error) {
      setError(error.message);
      if (preview) preview.innerHTML = avatarBody(currentAvatar);
    } finally {
      working = false;
      if (document.contains(elements.modalRoot)) {
        elements.modalRoot
          .querySelectorAll("[data-avatar-choice]")
          .forEach((button) => {
            button.disabled = false;
          });
      }
    }
  };

  avatarGrid?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-avatar-choice]");
    if (!button) return;
    void chooseAvatar(button.dataset.avatarChoice);
  });

  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    setError("");
    try {
      const avatar = await imageFileToAvatar(file);
      await chooseAvatar(avatar);
    } catch (error) {
      setError(error.message);
    } finally {
      fileInput.value = "";
    }
  });
}

function openDeckEditor() {
  const room = state.room;
  if (!room || room.phase !== "lobby") return;

  const canApply = isHost();
  const saved = loadSavedCustomDeck();
  const serverDeck =
    canApply &&
    room.customDeck &&
    (room.customDeck.whiteTexts.length > 0 || room.customDeck.blackTexts.length > 0)
      ? room.customDeck
      : null;
  const source = serverDeck || saved || { whiteTexts: [], blackTexts: [], mode: "mix" };
  const mode = source.mode === "only" ? "only" : "mix";
  const usingLocal = !serverDeck && saved;
  const neededWhite = room.players.length * 10;
  const baseTotal = room.deck
    ? Number(room.deck.baseWhite || 0) + Number(room.deck.baseBlack || 0)
    : 608;

  const body = `
    <p class="modal-intro">
      ${
        canApply
          ? "Arma tu propio mazo para esta mesa. Una carta por línea. En las negras, cada <strong>_</strong> es un hueco: usa uno o dos. Puedes descargar el mazo y compartir el archivo."
          : "Arma tu mazo, descárgalo y pásaselo al anfitrión para que lo active. Solo el anfitrión puede poner un mazo en la mesa. Una carta por línea; en las negras, cada <strong>_</strong> es un hueco."
      }
    </p>
    <div class="deck-editor">
      <div class="deck-modes" role="radiogroup" aria-label="Modo del mazo">
        <label class="deck-mode-option${mode === "mix" ? " is-active" : ""}">
          <input type="radio" name="deckMode" value="mix" ${mode === "mix" ? "checked" : ""}>
          <span><strong>Mezclar con la casa</strong><small>Tu mazo se suma a las ${formatNumber(
            baseTotal
          )} cartas criollas.</small></span>
        </label>
        <label class="deck-mode-option${mode === "only" ? " is-active" : ""}">
          <input type="radio" name="deckMode" value="only" ${mode === "only" ? "checked" : ""}>
          <span><strong>Solo mi mazo</strong><small>Se juega únicamente con tus cartas. Necesitas al menos ${neededWhite} blancas para ${room.players.length} jugadores y una negra.</small></span>
        </label>
      </div>

      ${usingLocal ? '<p class="deck-recovered">Recuperamos tu último mazo guardado en este navegador. Guárdalo para activarlo en esta sala.</p>' : ""}

      <div class="deck-fields">
        <div class="deck-field">
          <div class="deck-field__head">
            <label for="deckBlackInput">Cartas negras</label>
            <span id="deckBlackCount">0/200</span>
          </div>
          <textarea id="deckBlackInput" rows="9" spellcheck="true" placeholder="El nuevo ministro juró que _ era un accidente.&#10;La fiesta terminó cuando la abuela confesó _.&#10;En Maracaibo, _ es una forma de saludar.">${esc(
            source.blackTexts.join("\n")
          )}</textarea>
          <p>Preguntas con 1 o 2 huecos. Máximo 180 caracteres.</p>
        </div>
        <div class="deck-field">
          <div class="deck-field__head">
            <label for="deckWhiteInput">Cartas blancas</label>
            <span id="deckWhiteCount">0/300</span>
          </div>
          <textarea id="deckWhiteInput" rows="9" spellcheck="true" placeholder="Un fiscal que cobra por transferencia.&#10;Un velorio con barra libre y DJ.&#10;Un «¡qué molleja!» en plena reunión familiar.">${esc(
            source.whiteTexts.join("\n")
          )}</textarea>
          <p>Respuestas. Una por línea. Máximo 180 caracteres.</p>
        </div>
      </div>

      <div class="deck-editor__bottom">
        <div class="deck-editor__tools">
          <button type="button" class="text-button" id="deckExampleButton">Cargar un ejemplo</button>
          <button type="button" class="text-button" id="deckExportButton">Descargar mazo (.json)</button>
          <button type="button" class="text-button" id="deckImportButton">Cargar mazo (.json)</button>
          <input id="deckImportInput" type="file" accept=".json,application/json" hidden>
        </div>
        <span id="deckModeWarning" class="deck-warning"></span>
      </div>
      <p class="deck-editor__note">${
        canApply
          ? "El mazo activo queda en esta sala y también en este navegador para reutilizarlo. Si el servidor se reinicia, la sala se pierde, pero tu archivo o borrador local queda."
          : "Tu borrador queda en este navegador. Descarga el archivo y mándaselo al anfitrión; él decide si lo mezcla o juega solo con tus cartas."
      }</p>
      <p class="deck-status" id="deckStatus" hidden></p>
      <p class="form-error" id="deckError" role="alert" hidden></p>
    </div>
  `;

  const actions = [
    {
      id: "cancel",
      label: "Cancelar",
      className: "btn--ghost",
      onClick: () => closeModal()
    }
  ];

  if (canApply) {
    actions.push({
      id: "save-deck",
      label: "Guardar mazo",
      className: "btn--primary",
      onClick: async () => {
        const deck = deckFromEditor();
        const error = validateDeckDraft(deck);
        const errorBox = $("#deckError");
        if (error) {
          if (errorBox) {
            errorBox.textContent = error;
            errorBox.hidden = false;
          }
          return;
        }

        try {
          const response = await emitAck("update_custom_deck", deck);
          saveSavedCustomDeck(deck);
          closeModal();
          showToast(
            deck.whiteTexts.length + deck.blackTexts.length > 0
              ? `Mazo guardado: ${deck.blackTexts.length} negras y ${deck.whiteTexts.length} blancas.`
              : "Mazo personalizado borrado. Vuelve el mazo de la casa.",
            "success"
          );
          return response;
        } catch (saveError) {
          if (errorBox) {
            errorBox.textContent = saveError.message;
            errorBox.hidden = false;
          }
        }
      }
    });
  } else {
    actions.push({
      id: "save-draft",
      label: "Guardar borrador",
      className: "btn--primary",
      onClick: () => {
        const deck = deckFromEditor();
        const error = validateDeckDraft(deck);
        const errorBox = $("#deckError");
        if (error) {
          if (errorBox) {
            errorBox.textContent = error;
            errorBox.hidden = false;
          }
          return;
        }
        saveSavedCustomDeck(deck);
        closeModal();
        showToast("Borrador guardado. Descarga el .json y pásaselo al anfitrión.", "success");
      }
    });
  }

  openModal({
    eyebrow: "Mazo personalizado",
    title: canApply ? "Tus cartas, tus reglas" : "Arma tu mazo",
    body,
    className: "modal-card--wide modal-card--deck",
    kind: "deck",
    dismissible: true,
    actions
  });

  const blackInput = $("#deckBlackInput");
  const whiteInput = $("#deckWhiteInput");
  const exampleButton = $("#deckExampleButton");
  const exportButton = $("#deckExportButton");
  const importButton = $("#deckImportButton");
  const importInput = $("#deckImportInput");
  const errorBox = $("#deckError");
  const statusBox = $("#deckStatus");

  const setError = (message) => {
    if (!errorBox) return;
    errorBox.textContent = message || "";
    errorBox.hidden = !message;
  };
  const setStatus = (message, isError = false) => {
    if (!statusBox) return;
    statusBox.textContent = message || "";
    statusBox.hidden = !message;
    statusBox.classList.toggle("is-error", isError);
  };

  const onInput = () => {
    setError("");
    updateDeckEditorStats();
  };
  blackInput?.addEventListener("input", onInput);
  whiteInput?.addEventListener("input", onInput);
  elements.modalRoot
    .querySelectorAll('input[name="deckMode"]')
    .forEach((input) => input.addEventListener("change", onInput));

  const fillExample = () => {
    if (blackInput && !blackInput.value.trim()) {
      blackInput.value = [
        "El escándalo estalló cuando el ministro confesó _.",
        "La cena de Navidad terminó cuando la abuela sacó _.",
        "En el velorio, todos fingieron no ver _."
      ].join("\n");
    }
    if (whiteInput && !whiteInput.value.trim()) {
      whiteInput.value = [
        "Un fiscal que cobra por transferencia",
        "Un velorio con barra libre y DJ",
        "Un «¡qué molleja!» en plena reunión familiar",
        "Un sobre con harina que no era PAN",
        "Una prima con cargo en el consulado",
        "Un cura con OnlyFans",
        "La herencia gastada en un yate",
        "Un «vai» que se convirtió en amenaza",
        "Un tambor de la costa en el patio de la funeraria",
        "Un testamento firmado con la huella del perro"
      ].join("\n");
    }
    onInput();
  };
  exampleButton?.addEventListener("click", fillExample);

  exportButton?.addEventListener("click", () => {
    const deck = deckFromEditor();
    const payload = {
      app: "cartas-criollas",
      version: 1,
      ...deck,
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mazo-cartas-criollas.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("Mazo descargado. Compártelo para que otro lo cargue.");
  });

  importButton?.addEventListener("click", () => {
    importInput?.click();
  });

  importInput?.addEventListener("change", async () => {
    const file = importInput.files && importInput.files[0];
    if (!file) return;
    setError("");
    setStatus("");
    try {
      if (file.size > 800_000) {
        throw new Error("El archivo es demasiado grande para ser un mazo.");
      }
      const parsed = JSON.parse(await file.text());
      const whiteTexts = parsed.whiteTexts ?? parsed.white ?? parsed.whites;
      const blackTexts = parsed.blackTexts ?? parsed.black ?? parsed.blacks;
      if (!Array.isArray(whiteTexts) || !Array.isArray(blackTexts)) {
        throw new Error("El archivo no tiene listas válidas de cartas blancas y negras.");
      }
      if (!whiteTexts.every((value) => typeof value === "string") || !blackTexts.every((value) => typeof value === "string")) {
        throw new Error("Todas las cartas del archivo deben ser texto.");
      }
      blackInput.value = blackTexts.join("\n");
      whiteInput.value = whiteTexts.join("\n");
      const importedMode = parsed.mode === "only" ? "only" : "mix";
      elements.modalRoot
        .querySelectorAll('input[name="deckMode"]')
        .forEach((input) => {
          input.checked = input.value === importedMode;
        });
      onInput();
      setStatus(
        `Mazo cargado: ${blackTexts.length} negras y ${whiteTexts.length} blancas. Revisa y ${canApply ? "guarda" : "guarda el borrador"}.`
      );
    } catch (error) {
      setError(error.message);
    } finally {
      importInput.value = "";
    }
  });

  updateDeckEditorStats();
}

function menuItemHTML(action, icon, title, description, danger = false) {
  return `
    <button type="button" class="menu-item${danger ? " menu-item--danger" : ""}" data-modal-action="${esc(
      action
    )}">
      <span class="menu-item__icon" aria-hidden="true">${esc(icon)}</span>
      <span class="menu-item__copy">
        <strong>${esc(title)}</strong>
        <span>${esc(description)}</span>
      </span>
    </button>
  `;
}

function openGameMenu() {
  const room = state.room;
  if (!room) return;
  const round = room.round;
  const isLobby = room.phase === "lobby";

  const actions = {
    "copy-link": async () => {
      await copyShareLink();
    },
    whatsapp: () => {
      openWhatsApp();
    },
    rules: () => {
      openRules();
    },
    "force-vote": async () => {
      closeModal({ silent: true });
      await forceVote();
    },
    "reassign-judge": async () => {
      closeModal({ silent: true });
      await reassignJudge();
    },
    "back-lobby": async () => {
      closeModal({ silent: true });
      await backToLobby();
    },
    leave: async () => {
      closeModal({ silent: true });
      await leaveRoomFlow();
    },
    avatar: () => {
      closeModal({ silent: true });
      openAvatarEditor();
    },
    close: () => closeModal()
  };

  let items = [
    menuItemHTML("avatar", "📷", "Cambiar mi avatar", "Sube una foto o elige un emoji para que te reconozcan."),
    menuItemHTML("copy-link", "🔗", "Copiar link de invitación", "Para los que todavía no entraron."),
    menuItemHTML("whatsapp", "💬", "Compartir por WhatsApp", "Al grupo donde nadie lee, pero todos responden."),
    menuItemHTML("rules", "📖", "Cómo se juega", "Un repaso rápido a las reglas.")
  ];

  if (!isLobby && isHost() && round?.canForceVote) {
    items.push(
      menuItemHTML(
        "force-vote",
        "⚖️",
        "Cerrar la votación",
        "Manda a votación con las jugadas que ya hay."
      )
    );
  }

  if (!isLobby && isHost() && round?.canReassignJudge) {
    items.push(
      menuItemHTML(
        "reassign-judge",
        "👑",
        "Reasignar juez",
        "Para cuando el juez desapareció o está muy perdido."
      )
    );
  }

  if (!isLobby && isHost()) {
    items.push(
      menuItemHTML(
        "back-lobby",
        "🚪",
        "Volver al lobby",
        "Termina la partida y borra los puntos.",
        true
      )
    );
  }

  items.push(
    menuItemHTML(
      "leave",
      "👋",
      isLobby ? "Salir de la sala" : "Salir de la partida",
      isLobby ? "Liberas tu puesto en la sala." : "El juego sigue sin ti. Doloroso, pero sigue.",
      true
    )
  );

  openModal({
    eyebrow: `Sala ${room.code}`,
    title: "Menú de la sala",
    body: `<div class="menu-list">${items.join("")}</div>`,
    actions: [
      {
        id: "close",
        label: "Cerrar",
        className: "btn--ghost",
        onClick: () => closeModal()
      }
    ],
    dismissible: true,
    kind: "menu"
  });

  state.modal.actions = { ...actions };
}

function sortedPlayers() {
  return (state.room?.players || [])
    .slice()
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "es"));
}

function gameOverBodyHTML() {
  const room = state.room;
  const winner = room.gameWinner;
  const round = room.round;
  const ranked = sortedPlayers();
  const winnerIsSelf = winner && winner.id === room.selfId;

  if (!winner) {
    return `<p class="modal-intro">La partida terminó. No hubo un ganador claro, como en muchas elecciones.</p>`;
  }

  return `
    <div class="gameover-hero">
      <div class="trophy" aria-hidden="true">🏆</div>
      <p class="modal-eyebrow">Tenemos un ganador</p>
      <h2 class="winner-name">¡${esc(winner.name)} es la peor persona del grupo!</h2>
      <p>${
        winnerIsSelf
          ? "Ganaste tú. Qué orgullo tan específico. Espero que puedas dormir."
          : `Ganó con ${winner.score} puntos y una colección de decisiones cuestionables.`
      }</p>
    </div>
    ${
      round?.winner
        ? `<div class="winner-play-wrap">
            <p class="winner-play-label">La jugada que selló el destino</p>
            ${blackCardHTML(round.blackCard, { cards: round.winner.cards, winner: true })}
          </div>`
        : ""
    }
    ${otherPlaysHTML(round, { open: false, compact: true })}
    <div class="final-ranking">
      <h3>Tabla final</h3>
      <ol>
        ${ranked
          .map(
            (player, index) => `
              <li class="final-row">
                <span class="final-rank">${index + 1}</span>
                <span class="final-avatar" aria-hidden="true">${avatarBody(player.avatar)}</span>
                <span class="final-name">${esc(player.name)}${player.isSelf ? " (tú)" : ""}</span>
                <span class="final-score">${player.score} pts</span>
              </li>
            `
          )
          .join("")}
      </ol>
    </div>
    ${
      isHost()
        ? `<p class="confirm-copy">Como anfitrión, puedes armarla de nuevo o devolver a todos al lobby para presumir.</p>`
        : `<p class="confirm-copy">El anfitrión decide si hay revancha. Tú puedes cerrar y ver la mesa.</p>`
    }
  `;
}

function openGameOverModal({ auto = false } = {}) {
  const room = state.room;
  if (!room || room.phase !== "game_over") return;

  const winner = room.gameWinner;
  const actions = [];
  if (isHost()) {
    actions.push({
      id: "rematch",
      label: "Revancha",
      className: "btn--primary",
      onClick: async () => {
        try {
          await emitAck("rematch");
          closeModal();
        } catch (error) {
          showToast(error.message, "error");
        }
      }
    });
    actions.push({
      id: "lobby",
      label: "Volver al lobby",
      className: "btn--ghost",
      onClick: async () => {
        try {
          await emitAck("back_to_lobby");
          closeModal();
        } catch (error) {
          showToast(error.message, "error");
        }
      }
    });
  }
  actions.push({
    id: "close",
    label: "Cerrar",
    className: "btn--ghost",
    onClick: () => closeModal()
  });
  actions.push({
    id: "leave",
    label: "Salir",
    className: "btn--danger",
    onClick: async () => {
      closeModal({ silent: true });
      await leaveRoomFlow();
    }
  });

  openModal({
    eyebrow: "Resultados finales",
    title: "Se acabó el bochinche",
    body: gameOverBodyHTML(),
    className: "modal-card--wide modal-card--gameover",
    dismissible: true,
    kind: "gameover",
    actions
  });

  if (auto) {
    window.setTimeout(() => {
      if (state.modal.open && state.modal.kind === "gameover") {
        launchConfetti();
      }
    }, 180);
  }
}

/* ============================================================
   Salir / kick / reset
   ============================================================ */

async function leaveRoomFlow() {
  if (!state.room) {
    resetToLanding();
    return;
  }
  const isLobby = state.room.phase === "lobby";
  const message = isLobby
    ? "Vas a salir de la sala. Tu puesto queda libre para el próximo valiente."
    : isHost()
      ? "Vas a salir de la partida. Se pasará el mando a otra persona y el juego seguirá sin ti."
      : "Vas a salir de la partida. No podrás reclamar tu punto después.";

  const confirmed = await confirmDialog({
    eyebrow: "Salir",
    title: isLobby ? "¿Abandonar la sala?" : "¿Abandonar la partida?",
    message,
    confirmLabel: "Salir",
    cancelLabel: "Quedarme",
    danger: true
  });
  if (!confirmed) return;

  if (!socket.connected) {
    resetToLanding();
    showToast("Saliste localmente. El servidor te soltará cuando vuelva la señal.", "info");
    return;
  }

  try {
    await emitAck("leave_room");
    resetToLanding();
    showToast("Saliste de la sala. Que Dios te acompañe.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function kickPlayer(playerId) {
  const player = playerById(playerId);
  if (!player || !state.room || !isHost()) return;
  void confirmDialog({
    eyebrow: "Expulsar",
    title: `¿Sacar a ${player.name}?`,
    message:
      "Le vas a quitar el puesto en la sala. Si no estás seguro, respira y recuerda que probablemente se lo merece.",
    confirmLabel: "Expulsar",
    cancelLabel: "Dejarlo",
    danger: true
  }).then(async (confirmed) => {
    if (!confirmed) return;
    try {
      await emitAck("kick_player", { playerId });
      showToast(`${player.name} ya no está en la sala.`, "success");
    } catch (error) {
      showToast(error.message, "error");
    }
  });
}

function resetRoomUi() {
  window.clearTimeout(state.gameOverTimer);
  state.gameOverTimer = null;
  stopConfetti();
  state.selection = [];
  state.submitting = false;
  state.gameOverKey = null;
  state.roundKey = null;
  state.chat.messages = [];
  state.chat.ids = new Set();
  state.chat.unread = 0;
  state.chat.roomCode = null;
  state.chat.open = false;
  state.chat.trigger = null;
  closeModal({ silent: true });
  closeChat({ restoreFocus: false });
  elements.chatMessages.innerHTML = "";
  elements.tableArea.innerHTML = "";
  elements.handArea.innerHTML = "";
  elements.handArea.hidden = true;
  elements.mobilePlayAction.hidden = true;
  elements.mobilePlayAction.innerHTML = "";
  elements.scoreStrip.innerHTML = "";
  elements.resultsHeaderButton.hidden = true;
  updateChatBadges();
}

function resetToLanding({ keepSession = false } = {}) {
  if (!keepSession) clearLocalSession();
  state.room = null;
  state.selfId = null;
  resetRoomUi();
  setEntryBusy(false);
  showScreen("landing");
  setDocumentTitle();
  hideBoot();
  hideNetBanner();
  setEntryMode(state.inviteCode ? "join" : "create", { focus: false });
  try {
    history.replaceState(null, "", state.inviteCode ? `/?sala=${state.inviteCode}` : "/");
  } catch {
    /* noop */
  }
  elements.nickname.focus({ preventScroll: true });
}

async function handleKicked(payload) {
  const message =
    (payload && payload.message) || "Te sacaron de la sala. Cosas de la vida.";
  resetToLanding();
  showToast(message, "error", 7000);
}

/* ============================================================
   Confeti
   ============================================================ */

function stopConfetti() {
  const controller = state.confettiController;
  if (!controller) {
    state.confettiRunning = false;
    return;
  }
  if (controller.frameId) window.cancelAnimationFrame(controller.frameId);
  controller.canvas.remove();
  state.confettiController = null;
  state.confettiRunning = false;
}

function launchConfetti() {
  if (prefersReducedMotion() || state.confettiRunning) return;
  state.confettiRunning = true;

  const canvas = document.createElement("canvas");
  canvas.className = "confetti-canvas";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  const controller = { canvas, frameId: null };
  state.confettiController = controller;
  const context = canvas.getContext("2d");
  if (!context) {
    canvas.remove();
    state.confettiController = null;
    state.confettiRunning = false;
    return;
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  context.scale(dpr, dpr);

  const colors = ["#f4b942", "#e45b35", "#1f6d5a", "#3b80b7", "#f3e8d2", "#c94f7c"];
  const pieces = Array.from({ length: 130 }, () => ({
    x: width * 0.5 + (Math.random() - 0.5) * width * 0.35,
    y: height * 0.28 + (Math.random() - 0.5) * 80,
    vx: (Math.random() - 0.5) * 9,
    vy: Math.random() * -10 - 2,
    gravity: 0.18 + Math.random() * 0.12,
    size: 5 + Math.random() * 7,
    rotation: Math.random() * Math.PI,
    spin: (Math.random() - 0.5) * 0.28,
    color: colors[Math.floor(Math.random() * colors.length)],
    life: 1
  }));

  const start = performance.now();
  const duration = 3600;

  function frame(now) {
    const elapsed = now - start;
    context.clearRect(0, 0, width, height);
    for (const piece of pieces) {
      piece.vy += piece.gravity;
      piece.vx *= 0.996;
      piece.x += piece.vx;
      piece.y += piece.vy;
      piece.rotation += piece.spin;
      piece.life = Math.max(0, 1 - elapsed / duration);
      context.save();
      context.translate(piece.x, piece.y);
      context.rotate(piece.rotation);
      context.globalAlpha = piece.life;
      context.fillStyle = piece.color;
      context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
      context.restore();
    }
    if (elapsed < duration) {
      controller.frameId = window.requestAnimationFrame(frame);
    } else {
      canvas.remove();
      state.confettiController = null;
      state.confettiRunning = false;
    }
  }

  controller.frameId = window.requestAnimationFrame(frame);
}

/* ============================================================
   Modal de confirmación y listeners
   ============================================================ */

function confirmDialog(options) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    openModal({
      eyebrow: options.eyebrow || "Confirmación",
      title: options.title || "¿Seguro?",
      body: `<p class="confirm-copy">${options.message || ""}</p>`,
      className: "",
      dismissible: true,
      kind: "confirm",
      onClose: () => finish(false),
      actions: [
        {
          id: "cancel",
          label: options.cancelLabel || "Cancelar",
          className: "btn--ghost",
          onClick: () => {
            finish(false);
            closeModal();
          }
        },
        {
          id: "confirm",
          label: options.confirmLabel || "Confirmar",
          className: options.danger ? "btn--danger" : "btn--primary",
          onClick: () => {
            finish(true);
            closeModal();
          }
        }
      ]
    });
  });
}

async function handleAction(action, trigger) {
  switch (action) {
    case "open-rules":
      openRules();
      break;
    case "open-chat":
      openChat(trigger);
      break;
    case "close-chat":
      closeChat();
      break;
    case "copy-code":
      await copyRoomCode();
      break;
    case "copy-link":
      await copyShareLink();
      break;
    case "share-whatsapp":
      openWhatsApp();
      break;
    case "set-score": {
      if (!state.room || !isHost() || state.room.phase !== "lobby") return;
      const score = Number(trigger.dataset.score);
      if (!state.scoreOptions.includes(score)) return;
      trigger.disabled = true;
      try {
        await emitAck("update_settings", { targetScore: score });
      } catch (error) {
        trigger.disabled = false;
        showToast(error.message, "error");
      }
      break;
    }
    case "start-game": {
      if (!state.room || !isHost()) return;
      trigger.disabled = true;
      try {
        await emitAck("start_game");
      } catch (error) {
        trigger.disabled = false;
        showToast(error.message, "error");
      }
      break;
    }
    case "leave-room":
      await leaveRoomFlow();
      break;
    case "kick-player":
      kickPlayer(trigger.dataset.playerId);
      break;
    case "open-menu":
      openGameMenu();
      break;
    case "open-deck-editor":
      openDeckEditor();
      break;
    case "open-avatar-editor":
      openAvatarEditor();
      break;
    case "open-results":
      openGameOverModal({ auto: false });
      break;
    case "select-card":
      selectCard(trigger.dataset.cardId);
      break;
    case "submit-play":
      await submitPlay();
      break;
    case "pick-winner":
      await pickWinner(trigger);
      break;
    case "next-round":
      await nextRound(trigger);
      break;
    case "force-vote":
      await forceVote();
      break;
    case "reassign-judge":
      await reassignJudge();
      break;
    case "back-to-lobby":
      await backToLobby();
      break;
    default:
      break;
  }
}

function onGlobalClick(event) {
  const trigger = event.target.closest("[data-action]");
  if (!trigger) return;
  if (trigger.closest("#modalRoot")) return;
  if (trigger.matches(":disabled")) return;
  const action = trigger.dataset.action;
  if (!action) return;
  event.preventDefault();
  void handleAction(action, trigger);
}

function onKeyDown(event) {
  if (event.key === "Escape") {
    if (state.modal.open && state.modal.dismissible) {
      event.preventDefault();
      closeModal();
      return;
    }
    if (state.chat.open) {
      event.preventDefault();
      closeChat();
      return;
    }
  }

  if (event.key !== "Tab" || !state.modal.open) return;
  const focusable = $$(
    "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
    elements.modalRoot
  ).filter((element) => !element.hidden && element.offsetParent !== null);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/* ============================================================
   Inicio
   ============================================================ */

function boot() {
  initLanding();
  initSocket();
  loadConfig();

  document.addEventListener("click", onGlobalClick);
  document.addEventListener("keydown", onKeyDown);
  elements.chatForm.addEventListener("submit", handleChatSubmit);
  elements.modalRoot.addEventListener("click", handleModalClick);
  elements.chatOverlay.addEventListener("click", (event) => {
    if (event.target === elements.chatOverlay) closeChat();
  });

  if (!state.allowResume) {
    hideBoot();
    showScreen("landing");
  }

  renderChat();
  setDocumentTitle();
}

boot();
