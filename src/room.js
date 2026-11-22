"use strict";

const crypto = require("node:crypto");
const { BLACK_CARDS, WHITE_CARDS } = require("./cards");

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 12;
const HAND_SIZE = 10;
const MAX_CHAT_MESSAGES = 120;
const CHAT_MAX_LENGTH = 280;
const SCORE_OPTIONS = [3, 5, 7, 10];
const CUSTOM_CARD_MAX_LENGTH = 180;
const CUSTOM_WHITE_LIMIT = 300;
const CUSTOM_BLACK_LIMIT = 200;
const AVATAR_DATA_MAX_LENGTH = 12_000;
const AVATAR_DATA_RE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

const AVATARS = [
  "🦜", "🦥", "🐆", "🌴", "🧉", "🫓", "🌞", "🦎",
  "🥑", "🌵", "🍍", "⚽", "🎺", "🐊", "🦙", "🌊",
  "🦀", "🦩"
];

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

class GameError extends Error {
  constructor(message) {
    super(message);
    this.name = "GameError";
  }
}

function shuffle(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function randomId(prefix, bytes = 6) {
  return `${prefix}${crypto.randomBytes(bytes).toString("hex")}`;
}

function cleanName(raw) {
  if (typeof raw !== "string") return "";
  const stripped = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const characters = Array.from(stripped);
  if (characters.length < 2 || characters.length > 18) return "";
  return characters.join("");
}

function normalizeRoomCode(raw) {
  return String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 5);
}

function cleanChatText(raw) {
  if (typeof raw !== "string") return "";
  const text = raw
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(text).slice(0, CHAT_MAX_LENGTH).join("");
}

function countBlanks(text) {
  return (text.match(/_/g) || []).length;
}

function isImageAvatar(value) {
  return (
    typeof value === "string" &&
    value.length <= AVATAR_DATA_MAX_LENGTH &&
    AVATAR_DATA_RE.test(value)
  );
}

function isValidAvatar(value) {
  return (
    (typeof value === "string" && AVATARS.includes(value)) ||
    isImageAvatar(value)
  );
}

function sanitizeCustomDeck(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const mode = input.mode === "only" ? "only" : "mix";

  const build = (values, type) => {
    if (!Array.isArray(values)) return [];
    if (values.length > (type === "white" ? CUSTOM_WHITE_LIMIT : CUSTOM_BLACK_LIMIT)) {
      throw new GameError(
        `Máximo ${type === "white" ? CUSTOM_WHITE_LIMIT : CUSTOM_BLACK_LIMIT} cartas ${
          type === "white" ? "blancas" : "negras"
        }.`
      );
    }
    const seen = new Set();
    const cards = [];
    for (const value of values) {
      if (typeof value !== "string") continue;
      let text = value
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (type === "white") text = text.replace(/\.+$/u, "").trim();
      if (!text) continue;
      if (Array.from(text).length > CUSTOM_CARD_MAX_LENGTH) {
        throw new GameError(`Una carta supera los ${CUSTOM_CARD_MAX_LENGTH} caracteres.`);
      }
      if (type === "white" && text.includes("_")) {
        throw new GameError("Las cartas blancas no llevan guiones bajos.");
      }
      if (type === "black") {
        const blanks = countBlanks(text);
        if (blanks < 1 || blanks > 2) {
          throw new GameError(
            `La carta negra «${text}» debe tener 1 o 2 huecos (_).`
          );
        }
      }
      const key = text.toLocaleLowerCase("es");
      if (seen.has(key)) continue;
      seen.add(key);
      cards.push(text);
    }
    return cards;
  };

  return {
    whiteTexts: build(input.whiteTexts, "white"),
    blackTexts: build(input.blackTexts, "black"),
    mode
  };
}

function fillPrompt(text, cards) {
  let index = 0;
  return String(text).replace(/_/g, () => {
    const card = cards[index];
    index += 1;
    return card ? card.text : "__________";
  });
}

function publicCard(card) {
  return { id: card.id, text: card.text };
}

class Room {
  constructor(code) {
    this.code = code;
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.players = [];
    this.hostId = null;
    this.phase = "lobby";
    this.settings = {
      targetScore: 5,
      maxPlayers: MAX_PLAYERS,
      minPlayers: MIN_PLAYERS,
      handSize: HAND_SIZE
    };
    this.roundNumber = 0;
    this.judgeIndex = -1;
    this.judgeId = null;
    this.round = null;
    this.gameWinnerId = null;
    this.chat = [];
    this.chatSeq = 0;
    this.customDeck = {
      whiteTexts: [],
      blackTexts: [],
      mode: "mix"
    };
    this.blackPool = [];
    this.whitePool = [];
    this.blackDeck = [];
    this.whiteDeck = [];
    this.whiteDiscard = [];
  }

  touch() {
    this.lastActivity = Date.now();
  }

  addSystemChat(text) {
    this.chatSeq += 1;
    this.chat.push({
      id: `c${this.chatSeq}`,
      type: "system",
      text,
      at: Date.now()
    });
    if (this.chat.length > MAX_CHAT_MESSAGES) {
      this.chat.splice(0, this.chat.length - MAX_CHAT_MESSAGES);
    }
  }

  addUserChat(player, text) {
    const clean = cleanChatText(text);
    if (!clean) throw new GameError("El mensaje está vacío.");
    this.chatSeq += 1;
    const message = {
      id: `c${this.chatSeq}`,
      type: "user",
      text: clean,
      playerId: player.id,
      name: player.name,
      avatar: isImageAvatar(player.avatar) ? "👤" : player.avatar,
      at: Date.now()
    };
    this.chat.push(message);
    if (this.chat.length > MAX_CHAT_MESSAGES) {
      this.chat.splice(0, this.chat.length - MAX_CHAT_MESSAGES);
    }
    this.touch();
    return message;
  }

  ensureLobby() {
    if (this.phase !== "lobby") {
      throw new GameError("La partida ya comenzó, mi pana. No puedes entrar ahora.");
    }
  }

  addPlayer(rawName, socketId, preferredAvatar = null) {
    this.ensureLobby();
    const name = cleanName(rawName);
    if (!name) {
      throw new GameError("El nombre debe tener entre 2 y 18 caracteres.");
    }
    if (this.players.length >= this.settings.maxPlayers) {
      throw new GameError("La sala está llena.");
    }
    const nameKey = name.toLocaleLowerCase("es");
    if (this.players.some((player) => player.name.toLocaleLowerCase("es") === nameKey)) {
      throw new GameError("Ese nombre ya está en la sala. Ponle un apodo, primo.");
    }

    const usedAvatars = new Set(
      this.players
        .map((player) => player.avatar)
        .filter((avatar) => !isImageAvatar(avatar))
    );
    const avatar = isValidAvatar(preferredAvatar)
      ? preferredAvatar
      : AVATARS.find((candidate) => !usedAvatars.has(candidate)) ||
        AVATARS[crypto.randomInt(AVATARS.length)];

    const player = {
      id: randomId("p", 6),
      token: crypto.randomBytes(24).toString("hex"),
      name,
      avatar,
      score: 0,
      hand: [],
      socketId,
      connected: true,
      submission: null,
      joinedAt: Date.now()
    };

    this.players.push(player);
    if (!this.hostId) {
      this.hostId = player.id;
      this.addSystemChat(`Sala ${this.code} creada, primo. Comparte el código con tus panas.`);
    } else {
      this.addSystemChat(`${player.name} entró a la sala.`);
    }
    this.touch();
    return player;
  }

  resumePlayer(token, socketId) {
    if (typeof token !== "string" || token.length < 16) {
      throw new GameError("La sesión no es válida.");
    }
    const player = this.players.find((candidate) => candidate.token === token);
    if (!player) {
      throw new GameError("No encontramos tu puesto en esta sala.");
    }

    const wasDisconnected = !player.connected;
    player.connected = true;
    player.socketId = socketId;
    player.lastSeen = Date.now();

    if (this.phase === "choosing" && player.id !== this.judgeId && !player.submission) {
      this.drawToHand(player);
    }
    if (wasDisconnected) {
      this.addSystemChat(`${player.name} volvió a la partida.`);
    }
    this.maybeOpenVoting();
    this.touch();
    return player;
  }

  markDisconnected(playerId, socketId) {
    const player = this.players.find((candidate) => candidate.id === playerId);
    if (!player) return false;
    if (socketId && player.socketId && player.socketId !== socketId) {
      return false;
    }
    if (!player.connected) return false;
    player.connected = false;
    player.socketId = null;
    player.lastSeen = Date.now();
    if (this.phase !== "lobby") {
      this.addSystemChat(`${player.name} se desconectó.`);
    }
    this.maybeOpenVoting();
    this.touch();
    return true;
  }

  updateSettings(hostId, settings) {
    this.requireHost(hostId);
    this.ensureLobby();
    const targetScore = Number(settings && settings.targetScore);
    if (!SCORE_OPTIONS.includes(targetScore)) {
      throw new GameError("Esa cantidad de puntos no está permitida.");
    }
    this.settings.targetScore = targetScore;
    this.touch();
    return this.settings;
  }

  getDeckInfo() {
    const customWhite = this.customDeck.whiteTexts.length;
    const customBlack = this.customDeck.blackTexts.length;
    const hasCustom = customWhite > 0 || customBlack > 0;
    const mode = hasCustom ? this.customDeck.mode : "base";
    const onlyCustom = hasCustom && mode === "only";
    const baseWhite = onlyCustom ? 0 : WHITE_CARDS.length;
    const baseBlack = onlyCustom ? 0 : BLACK_CARDS.length;
    return {
      mode,
      hasCustom,
      onlyCustom,
      baseWhite,
      baseBlack,
      customWhite,
      customBlack,
      white: baseWhite + customWhite,
      black: baseBlack + customBlack
    };
  }

  updateAvatar(playerId, rawAvatar) {
    const player = this.getPlayer(playerId);
    if (!player) {
      throw new GameError("Ese jugador ya no está en la sala.");
    }
    if (!isValidAvatar(rawAvatar)) {
      throw new GameError("Ese avatar no es válido. Usa un emoji o una foto JPG, PNG o WebP.");
    }
    player.avatar = rawAvatar;
    this.touch();
    return player.avatar;
  }

  updateCustomDeck(hostId, rawDeck) {
    this.requireHost(hostId);
    this.ensureLobby();
    const deck = sanitizeCustomDeck(rawDeck);
    this.customDeck = deck;
    const total = deck.whiteTexts.length + deck.blackTexts.length;
    if (total === 0) {
      this.addSystemChat("El anfitrión limpió el mazo personalizado. Vuelve el mazo de la casa.");
    } else {
      this.addSystemChat(
        `El anfitrión guardó un mazo propio: ${deck.blackTexts.length} negras y ${deck.whiteTexts.length} blancas${
          deck.mode === "only" ? " (solo mazo propio)" : " (mezclado con el de la casa)"
        }.`
      );
    }
    this.touch();
    return deck;
  }

  validateDeckForStart() {
    const info = this.getDeckInfo();
    if (!info.onlyCustom) return;
    const neededWhite = this.players.length * HAND_SIZE;
    if (info.black < 1) {
      throw new GameError("Tu mazo propio necesita al menos una carta negra para empezar.");
    }
    if (info.white < neededWhite) {
      throw new GameError(
        `Tu mazo propio tiene ${info.white} cartas blancas. Con ${this.players.length} jugadores necesitas al menos ${neededWhite}.`
      );
    }
  }

  requireHost(playerId) {
    if (this.hostId !== playerId) {
      throw new GameError("Eso solo lo decide el anfitrión, primo.");
    }
  }

  requirePhase(...phases) {
    if (!phases.includes(this.phase)) {
      throw new GameError("Esa acción no se puede hacer ahora.");
    }
  }

  getPlayer(playerId) {
    return this.players.find((player) => player.id === playerId) || null;
  }

  getConnectedPlayers() {
    return this.players.filter((player) => player.connected);
  }

  getJudge() {
    return this.getPlayer(this.judgeId);
  }

  anyDisconnected() {
    return this.players.filter((player) => !player.connected);
  }

  startGame(hostId) {
    this.requireHost(hostId);
    this.ensureLobby();
    const disconnected = this.anyDisconnected();
    if (disconnected.length > 0) {
      throw new GameError(
        `Falta esperar a ${disconnected.map((player) => player.name).join(", ")}. Expúlsalos o espera a que vuelvan.`
      );
    }
    if (this.getConnectedPlayers().length < MIN_PLAYERS) {
      throw new GameError(`Hacen falta al menos ${MIN_PLAYERS} jugadores para empezar.`);
    }
    this.beginGame();
  }

  rematch(hostId) {
    this.requireHost(hostId);
    this.requirePhase("game_over");
    if (this.getConnectedPlayers().length < MIN_PLAYERS) {
      throw new GameError(`Hacen falta al menos ${MIN_PLAYERS} jugadores para la revancha.`);
    }
    const disconnectedIds = new Set(
      this.players.filter((player) => !player.connected).map((player) => player.id)
    );
    if (disconnectedIds.size > 0) {
      this.players = this.players.filter((player) => !disconnectedIds.has(player.id));
      this.addSystemChat("Los desconectados se quedaron fuera de la revancha.");
    }
    this.addSystemChat("¡Revancha! Que esta vez gane el menos corrupto.");
    this.beginGame();
  }

  beginGame() {
    this.validateDeckForStart();
    const info = this.getDeckInfo();
    const useOnlyCustom = info.onlyCustom;
    const customBlack = this.customDeck.blackTexts.map((text, index) => ({
      id: `bcustom-${index + 1}`,
      text,
      pick: countBlanks(text)
    }));
    const customWhite = this.customDeck.whiteTexts.map((text, index) => ({
      id: `wcustom-${index + 1}`,
      text
    }));

    this.blackPool = [
      ...(useOnlyCustom ? [] : BLACK_CARDS),
      ...customBlack
    ];
    this.whitePool = [
      ...(useOnlyCustom ? [] : WHITE_CARDS),
      ...customWhite
    ];
    this.phase = "choosing";
    this.roundNumber = 0;
    this.judgeIndex = -1;
    this.judgeId = null;
    this.round = null;
    this.gameWinnerId = null;
    this.blackDeck = shuffle(this.blackPool);
    this.whiteDeck = shuffle(this.whitePool);
    this.whiteDiscard = [];

    for (const player of this.players) {
      player.score = 0;
      player.hand = [];
      player.submission = null;
    }

    this.addSystemChat("La partida comenzó. Que Dios nos ampare.");
    this.startRound();
  }

  startRound() {
    const connected = this.getConnectedPlayers();
    if (connected.length < 2) {
      throw new GameError("No hay suficientes panas conectados para seguir.");
    }

    if (this.judgeIndex < 0 || this.judgeIndex >= this.players.length) {
      const connectedIndexes = this.players
        .map((player, index) => ({ player, index }))
        .filter(({ player }) => player.connected)
        .map(({ index }) => index);
      this.judgeIndex = connectedIndexes[crypto.randomInt(connectedIndexes.length)];
    } else {
      let attempts = 0;
      do {
        this.judgeIndex = (this.judgeIndex + 1) % this.players.length;
        attempts += 1;
      } while (!this.players[this.judgeIndex].connected && attempts < this.players.length);
    }

    const judge = this.players[this.judgeIndex];
    this.judgeId = judge.id;
    this.roundNumber += 1;
    const blackCard = this.drawBlackCard();

    for (const player of this.players) {
      player.submission = null;
      if (player.id !== this.judgeId) {
        this.drawToHand(player);
      }
    }

    this.round = {
      number: this.roundNumber,
      judgeId: this.judgeId,
      blackCard,
      submissions: [],
      revealedPlays: [],
      winnerSubmissionId: null,
      winner: null,
      startedAt: Date.now()
    };
    this.phase = "choosing";
    this.addSystemChat(`Ronda ${this.roundNumber}. Juez: ${judge.name}.`);
    this.touch();
    return this.round;
  }

  drawBlackCard() {
    if (this.blackDeck.length === 0) {
      const pool = this.blackPool.length > 0 ? this.blackPool : BLACK_CARDS;
      this.blackDeck = shuffle(pool);
    }
    return this.blackDeck.pop();
  }

  drawWhiteCard() {
    if (this.whiteDeck.length === 0) {
      this.whiteDeck = shuffle(this.whiteDiscard);
      this.whiteDiscard = [];
    }
    if (this.whiteDeck.length === 0) {
      const usedIds = new Set();
      for (const player of this.players) {
        for (const card of player.hand) usedIds.add(card.id);
        if (player.submission) {
          for (const card of player.submission.cards) usedIds.add(card.id);
        }
      }
      const pool = this.whitePool.length > 0 ? this.whitePool : WHITE_CARDS;
      this.whiteDeck = shuffle(pool.filter((card) => !usedIds.has(card.id)));
    }
    return this.whiteDeck.pop();
  }

  drawToHand(player) {
    while (player.hand.length < HAND_SIZE) {
      const card = this.drawWhiteCard();
      if (!card) break;
      player.hand.push(card);
    }
  }

  getEligiblePlayers() {
    return this.players.filter(
      (player) => player.connected && player.id !== this.judgeId
    );
  }

  submitCards(playerId, cardIds) {
    this.requirePhase("choosing");
    if (!this.round) throw new GameError("La ronda no está lista.");
    if (playerId === this.judgeId) {
      throw new GameError("El juez no juega cartas. Solo juzga y sufre, mi pana.");
    }
    const player = this.getPlayer(playerId);
    if (!player || !player.connected) {
      throw new GameError("No estás conectado a la partida.");
    }
    if (player.submission) {
      throw new GameError("Ya mandaste tu jugada. No hay cambios, corrupto.");
    }
    if (!Array.isArray(cardIds)) {
      throw new GameError("La jugada no es válida.");
    }
    const pick = this.round.blackCard.pick;
    if (cardIds.length !== pick) {
      throw new GameError(
        pick === 1 ? "Debes elegir exactamente una carta." : `Debes elegir exactamente ${pick} cartas.`
      );
    }
    if (new Set(cardIds).size !== cardIds.length) {
      throw new GameError("No puedes repetir la misma carta.");
    }

    const handById = new Map(player.hand.map((card) => [card.id, card]));
    const chosen = [];
    for (const cardId of cardIds) {
      const card = handById.get(cardId);
      if (!card) {
        throw new GameError("Esa carta ya no está en tu mano. Refresca o elige otra.");
      }
      chosen.push(card);
    }

    const chosenIds = new Set(chosen.map((card) => card.id));
    player.hand = player.hand.filter((card) => !chosenIds.has(card.id));
    const submission = {
      id: randomId("s", 5),
      playerId: player.id,
      cards: chosen,
      submittedAt: Date.now()
    };
    player.submission = submission;
    this.round.submissions.push(submission);
    this.maybeOpenVoting();
    this.touch();
    return submission;
  }

  maybeOpenVoting() {
    if (this.phase !== "choosing" || !this.round) return false;
    const eligible = this.getEligiblePlayers();
    if (eligible.length > 0 && eligible.every((player) => player.submission)) {
      this.openVoting(false);
      return true;
    }
    return false;
  }

  openVoting(forced = false) {
    this.requirePhase("choosing");
    if (!this.round || this.round.submissions.length === 0) {
      throw new GameError("Todavía no hay ni una jugada para votar.");
    }
    this.round.submissions = shuffle(this.round.submissions);
    this.phase = "judging";
    if (forced) {
      this.addSystemChat("El anfitrión cerró las jugadas. Juez, te toca, primo.");
    }
    this.touch();
  }

  forceVote(hostId) {
    this.requireHost(hostId);
    this.requirePhase("choosing");
    this.openVoting(true);
  }

  pickWinner(playerId, submissionId) {
    this.requirePhase("judging");
    if (playerId !== this.judgeId) {
      throw new GameError("Solo el juez de esta ronda puede elegir al ganador.");
    }
    if (!this.round) throw new GameError("La ronda no está lista.");
    const submission = this.round.submissions.find((entry) => entry.id === submissionId);
    if (!submission) {
      throw new GameError("Esa jugada no existe o ya fue elegida.");
    }
    const winner = this.getPlayer(submission.playerId);
    if (!winner) {
      throw new GameError("El jugador de esa jugada ya no está en la sala.");
    }

    winner.score += 1;
    this.round.winner = {
      playerId: winner.id,
      name: winner.name,
      avatar: winner.avatar,
      cards: submission.cards.map(publicCard),
      filledPrompt: fillPrompt(this.round.blackCard.text, submission.cards),
      score: winner.score
    };
    this.round.winnerSubmissionId = submission.id;
    this.round.revealedPlays = this.round.submissions.map((entry) => ({
      id: entry.id,
      playerId: entry.playerId,
      cards: entry.cards.map(publicCard),
      filledPrompt: fillPrompt(this.round.blackCard.text, entry.cards)
    }));

    for (const entry of this.round.submissions) {
      this.whiteDiscard.push(...entry.cards);
    }
    this.round.submissions = [];
    for (const player of this.players) {
      player.submission = null;
    }

    if (winner.score >= this.settings.targetScore) {
      this.phase = "game_over";
      this.gameWinnerId = winner.id;
      this.addSystemChat(
        `🏆 ${winner.name} ganó la partida con ${winner.score} puntos. Que alguien le revise las cuentas.`
      );
    } else {
      this.phase = "round_end";
      this.addSystemChat(
        `${winner.name} ganó la ronda y llegó a ${winner.score} punto${winner.score === 1 ? "" : "s"}.`
      );
    }
    this.touch();
    return winner;
  }

  nextRound(playerId) {
    this.requirePhase("round_end");
    if (playerId !== this.hostId && playerId !== this.judgeId) {
      throw new GameError("Solo el anfitrión o el juez pueden pasar a la siguiente ronda.");
    }
    this.startRound();
  }

  reassignJudge(hostId) {
    this.requireHost(hostId);
    this.requirePhase("choosing", "judging");
    const currentJudge = this.getJudge();
    const candidateIndexes = this.players
      .map((player, index) => ({ player, index }))
      .filter(({ player }) => player.connected && player.id !== this.judgeId);
    if (candidateIndexes.length === 0) {
      throw new GameError("No hay otro jugador conectado para ser juez.");
    }
    const candidate =
      candidateIndexes.find(({ index }) => index > this.judgeIndex) ||
      candidateIndexes[0];

    if (candidate.player.submission) {
      const submissionIndex = this.round.submissions.findIndex(
        (entry) => entry.playerId === candidate.player.id
      );
      if (submissionIndex >= 0) {
        const [removed] = this.round.submissions.splice(submissionIndex, 1);
        candidate.player.hand.push(...removed.cards);
        candidate.player.submission = null;
      }
    }

    this.judgeIndex = candidate.index;
    this.judgeId = candidate.player.id;
    if (this.round) {
      this.round.judgeId = candidate.player.id;
    }
    this.addSystemChat(
      `El anfitrión nombró a ${candidate.player.name} como juez${currentJudge ? `, en lugar de ${currentJudge.name}` : ""}.`
    );

    if (this.phase === "judging" && this.round.submissions.length === 0) {
      this.round.winner = null;
      this.phase = "round_end";
      this.addSystemChat("La ronda quedó desierta, naguará. El anfitrión puede pasar a la siguiente.");
    } else {
      this.maybeOpenVoting();
    }
    this.touch();
  }

  backToLobby(hostId) {
    this.requireHost(hostId);
    if (this.phase === "lobby") return;
    this.phase = "lobby";
    this.roundNumber = 0;
    this.judgeIndex = -1;
    this.judgeId = null;
    this.round = null;
    this.gameWinnerId = null;
    this.blackDeck = [];
    this.whiteDeck = [];
    this.whiteDiscard = [];
    for (const player of this.players) {
      player.score = 0;
      player.hand = [];
      player.submission = null;
    }
    this.addSystemChat("El anfitrión devolvió a todos al lobby.");
    this.touch();
  }

  leaveRoom(playerId) {
    const player = this.getPlayer(playerId);
    if (!player) return { roomEmpty: this.players.length === 0 };
    if (this.phase === "lobby") {
      this.players = this.players.filter((entry) => entry.id !== playerId);
      this.addSystemChat(`${player.name} salió de la sala.`);
      this.transferHostIfNeeded(playerId);
      this.touch();
      return {
        roomEmpty: this.players.length === 0,
        removed: true,
        player
      };
    }

    player.connected = false;
    player.socketId = null;
    player.lastSeen = Date.now();
    this.addSystemChat(`${player.name} abandonó la partida.`);
    this.transferHostIfNeeded(playerId);
    this.maybeOpenVoting();
    this.touch();
    return {
      roomEmpty: false,
      removed: false,
      player
    };
  }

  kickPlayer(hostId, targetId) {
    this.requireHost(hostId);
    this.ensureLobby();
    if (targetId === hostId) {
      throw new GameError("No puedes expulsarte a ti mismo.");
    }
    const target = this.getPlayer(targetId);
    if (!target) throw new GameError("Ese jugador ya no está en la sala.");
    this.players = this.players.filter((player) => player.id !== targetId);
    this.addSystemChat(`${target.name} fue expulsado de la sala.`);
    this.touch();
    return {
      target,
      roomEmpty: this.players.length === 0
    };
  }

  transferHostIfNeeded(leavingPlayerId) {
    if (this.hostId !== leavingPlayerId) return;
    const next =
      this.players.find((player) => player.connected) ||
      this.players[0] ||
      null;
    this.hostId = next ? next.id : null;
    if (next) {
      this.addSystemChat(`${next.name} es el nuevo anfitrión.`);
    }
  }

  viewFor(playerId) {
    const self = this.getPlayer(playerId);
    if (!self) return null;
    const isHost = this.hostId === playerId;
    const isJudge = this.judgeId === playerId;
    const judge = this.getJudge();
    const connected = this.getConnectedPlayers();
    const eligible = this.getEligiblePlayers();
    const submittedCount = eligible.filter((player) => player.submission).length;
    const requiredCount = eligible.length;

    const players = this.players.map((player) => ({
      id: player.id,
      name: player.name,
      avatar: player.avatar,
      score: player.score,
      connected: player.connected,
      isHost: player.id === this.hostId,
      isJudge: player.id === this.judgeId,
      isSelf: player.id === playerId,
      hasSubmitted: Boolean(player.submission)
    }));

    let roundView = null;
    if (this.round) {
      const round = this.round;
      let submissions;
      if (this.phase === "judging" && isJudge) {
        submissions = round.submissions.map((submission) => ({
          id: submission.id,
          cards: submission.cards.map(publicCard),
          filledPrompt: fillPrompt(round.blackCard.text, submission.cards)
        }));
      }

      const canReassignJudge =
        isHost &&
        (this.phase === "choosing" || this.phase === "judging") &&
        connected.some((player) => player.id !== this.judgeId);

      let revealedPlays;
      if (
        (this.phase === "round_end" || this.phase === "game_over") &&
        Array.isArray(round.revealedPlays) &&
        round.revealedPlays.length > 0
      ) {
        revealedPlays = round.revealedPlays.map((play) => ({
          id: play.id,
          cards: play.cards,
          filledPrompt: play.filledPrompt,
          isWinner: play.id === round.winnerSubmissionId,
          isSelf: play.playerId === playerId
        }));
      }

      roundView = {
        number: round.number,
        judgeId: round.judgeId,
        judgeName: judge ? judge.name : "—",
        judgeConnected: Boolean(judge && judge.connected),
        blackCard: {
          id: round.blackCard.id,
          text: round.blackCard.text,
          pick: round.blackCard.pick
        },
        submittedCount,
        requiredCount,
        submissions,
        revealedPlays,
        winner: round.winner || null,
        canAdvance:
          this.phase === "round_end" && (isHost || isJudge),
        canForceVote:
          isHost && this.phase === "choosing" && round.submissions.length > 0,
        canReassignJudge
      };
    }

    let hand = [];
    if (
      this.phase === "choosing" &&
      self.connected &&
      !isJudge &&
      !self.submission
    ) {
      hand = self.hand.map(publicCard);
    }

    const myPlay = self.submission
      ? {
          cards: self.submission.cards.map(publicCard),
          filledPrompt: fillPrompt(this.round.blackCard.text, self.submission.cards)
        }
      : null;

    const gameWinner =
      this.phase === "game_over" ? this.getPlayer(this.gameWinnerId) : null;

    return {
      code: this.code,
      phase: this.phase,
      selfId: self.id,
      self: {
        id: self.id,
        name: self.name,
        avatar: self.avatar,
        isHost,
        isJudge,
        connected: self.connected
      },
      hostId: this.hostId,
      settings: { ...this.settings },
      players,
      round: roundView,
      hand,
      myPlay,
      deck: this.getDeckInfo(),
      customDeck:
        isHost && this.phase === "lobby"
          ? {
              whiteTexts: [...this.customDeck.whiteTexts],
              blackTexts: [...this.customDeck.blackTexts],
              mode: this.customDeck.mode
            }
          : undefined,
      chat: this.chat.slice(-MAX_CHAT_MESSAGES),
      gameWinner: gameWinner
        ? {
            id: gameWinner.id,
            name: gameWinner.name,
            avatar: gameWinner.avatar,
            score: gameWinner.score
          }
        : null,
      serverTime: Date.now()
    };
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  generateCode() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let code = "";
      for (let i = 0; i < 5; i += 1) {
        code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new GameError("No se pudo crear la sala. Intenta de nuevo.");
  }

  createRoom(socketId, name, avatar = null) {
    const code = this.generateCode();
    const room = new Room(code);
    const player = room.addPlayer(name, socketId, avatar);
    this.rooms.set(code, room);
    return { room, player };
  }

  getRoom(rawCode) {
    const code = normalizeRoomCode(rawCode);
    return this.rooms.get(code) || null;
  }

  requireRoom(rawCode) {
    const room = this.getRoom(rawCode);
    if (!room) {
      throw new GameError("No encontramos esa sala. Revisa el código.");
    }
    return room;
  }

  joinRoom(rawCode, name, socketId, avatar = null) {
    const room = this.requireRoom(rawCode);
    const player = room.addPlayer(name, socketId, avatar);
    return { room, player };
  }

  resumeRoom(rawCode, token, socketId) {
    const room = this.requireRoom(rawCode);
    const player = room.resumePlayer(token, socketId);
    return { room, player };
  }

  deleteIfEmpty(rawCode) {
    const room = this.getRoom(rawCode);
    if (room && room.players.length === 0) {
      this.rooms.delete(room.code);
      return true;
    }
    return false;
  }

  cleanup() {
    const now = Date.now();
    for (const [code, room] of this.rooms.entries()) {
      const hasConnected = room.players.some((player) => player.connected);
      const stale = now - room.lastActivity > 6 * 60 * 60 * 1000;
      const ancient = now - room.createdAt > 24 * 60 * 60 * 1000;
      if (!hasConnected && (stale || ancient)) {
        this.rooms.delete(code);
      }
    }
  }

  get stats() {
    return {
      rooms: this.rooms.size,
      players: [...this.rooms.values()].reduce(
        (total, room) => total + room.players.length,
        0
      )
    };
  }
}

function isScoreOption(value) {
  return SCORE_OPTIONS.includes(Number(value));
}

module.exports = {
  Room,
  RoomManager,
  GameError,
  AVATARS,
  normalizeRoomCode,
  cleanName,
  isScoreOption,
  MIN_PLAYERS,
  MAX_PLAYERS,
  HAND_SIZE,
  SCORE_OPTIONS
};
