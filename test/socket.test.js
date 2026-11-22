"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { io } = require("socket.io-client");
const { createGameServer } = require("../server");

let server;
let ioServer;
let baseUrl;
const openClients = new Set();

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, message = "condición", timeout = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = predicate();
    if (value) return value;
    await wait(25);
  }
  throw new Error(`Tiempo de espera agotado: ${message}`);
}

function connectNew() {
  return new Promise((resolve, reject) => {
    const socket = io(baseUrl, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
      timeout: 5000
    });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("No se pudo conectar al servidor de prueba."));
    }, 6000);

    socket.once("connect", () => {
      clearTimeout(timer);
      socket.latestState = null;
      socket.on("state", (payload) => {
        socket.latestState = payload;
      });
      openClients.add(socket);
      resolve(socket);
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
  });
}

function emitAck(socket, event, payload = {}) {
  return new Promise((resolve) => {
    socket.timeout(6000).emit(event, payload, (error, response) => {
      if (error) {
        resolve({ ok: false, error: "timeout" });
        return;
      }
      resolve(response);
    });
  });
}

function closeClient(socket) {
  if (!socket) return;
  openClients.delete(socket);
  if (socket.connected) socket.close();
}

async function createAndJoin(count = 3) {
  const sockets = [];
  const sessionData = [];

  const host = await connectNew();
  sockets.push(host);
  const created = await emitAck(host, "create_room", { name: "Anfitrión" });
  assert.equal(created.ok, true);
  const code = created.code;
  assert.equal(typeof created.token, "string");
  sessionData.push({ socket: host, token: created.token, playerId: created.playerId, name: "Anfitrión" });

  await waitFor(() => host.latestState?.phase === "lobby", "lobby del host");

  const names = ["La Suegra", "El Compadre", "La Vecina", "El Primo"];
  for (let index = 1; index < count; index += 1) {
    const socket = await connectNew();
    sockets.push(socket);
    const response = await emitAck(socket, "join_room", {
      name: names[index - 1],
      code
    });
    assert.equal(response.ok, true, response.error);
    sessionData.push({
      socket,
      token: response.token,
      playerId: response.playerId,
      name: names[index - 1]
    });
    await waitFor(
      () => host.latestState?.players.length === index + 1,
      "actualización de jugadores"
    );
  }

  return { sockets, sessionData, code, host };
}

before(async () => {
  const game = createGameServer();
  server = game.server;
  ioServer = game.io;
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  for (const socket of [...openClients]) closeClient(socket);
  if (ioServer) await new Promise((resolve) => ioServer.close(resolve));
  if (server && server.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("crea sala, une jugadores y completa una ronda por sockets", async (t) => {
  const { sockets, code, host } = await createAndJoin(3);
  t.after(() => sockets.forEach(closeClient));

  const [p2, p3] = sockets.slice(1);

  const duplicateSocket = await connectNew();
  t.after(() => closeClient(duplicateSocket));
  const duplicate = await emitAck(duplicateSocket, "join_room", { name: "La Suegra", code });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.error, /nombre ya está/i);

  await waitFor(() => sockets.every((socket) => socket.latestState?.phase === "lobby"), "todos en lobby");
  const settings = await emitAck(host, "update_settings", { targetScore: 3 });
  assert.equal(settings.ok, true);
  await waitFor(
    () => sockets.every((socket) => socket.latestState?.settings.targetScore === 3),
    "puntaje objetivo actualizado"
  );

  const notHost = sessionsNonHost(sockets);
  const forbiddenSettings = await emitAck(notHost, "update_settings", { targetScore: 5 });
  assert.equal(forbiddenSettings.ok, false);
  assert.match(forbiddenSettings.error, /anfitrión/i);

  const start = await emitAck(host, "start_game");
  assert.equal(start.ok, true, start.error);
  await waitFor(
    () => sockets.every((socket) => socket.latestState?.phase === "choosing"),
    "ronda iniciada"
  );

  const judgeSocket = sockets.find((socket) => socket.latestState?.self?.isJudge);
  assert.ok(judgeSocket, "debe haber un juez");
  const playerSockets = sockets.filter((socket) => socket !== judgeSocket);
  assert.equal(playerSockets.length, 2);

  for (const socket of playerSockets) {
    const state = socket.latestState;
    assert.equal(state.hand.length, 10);
    const cardIds = state.hand.slice(0, state.round.blackCard.pick).map((card) => card.id);
    const response = await emitAck(socket, "submit_cards", { cardIds });
    assert.equal(response.ok, true, response.error);
  }

  const judgeState = await waitFor(
    () => {
      const state = judgeSocket.latestState;
      return state.phase === "judging" && state.round.submissions?.length === 2 ? state : null;
    },
    "jugadas del juez"
  );

  const otherView = playerSockets[0].latestState;
  assert.equal(otherView.round.submissions, undefined);
  assert.ok(otherView.myPlay);

  const chatPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("No llegó el chat")), 5000);
    p3.once("chat_message", (message) => {
      clearTimeout(timer);
      resolve(message);
    });
  });
  const chatResponse = await emitAck(p2, "send_chat", { text: "Hola desde el más allá" });
  assert.equal(chatResponse.ok, true, chatResponse.error);
  const chatMessage = await chatPromise;
  assert.equal(chatMessage.text, "Hola desde el más allá");
  assert.equal(chatMessage.roomCode, code);

  const submissionId = judgeState.round.submissions[0].id;
  const pickResponse = await emitAck(judgeSocket, "pick_winner", { submissionId });
  assert.equal(pickResponse.ok, true, pickResponse.error);

  await waitFor(
    () => sockets.every((socket) => socket.latestState?.phase === "round_end"),
    "fin de ronda"
  );
  const winnerState = host.latestState;
  assert.ok(winnerState.round.winner);
  assert.equal(
    winnerState.players.find((player) => player.id === winnerState.round.winner.playerId).score,
    1
  );

  const nextResponse = await emitAck(host, "next_round");
  assert.equal(nextResponse.ok, true, nextResponse.error);
  await waitFor(
    () => sockets.every((socket) => socket.latestState?.round?.number === 2),
    "ronda 2"
  );
});

function sessionsNonHost(sockets) {
  return sockets.find((socket) => !socket.latestState?.self?.isHost);
}

test("reconecta con token y rechaza tokens inválidos", async (t) => {
  const { sockets, sessionData, code, host } = await createAndJoin(3);
  t.after(() => sockets.forEach(closeClient));

  const start = await emitAck(host, "start_game");
  assert.equal(start.ok, true, start.error);
  await waitFor(
    () => sockets.every((socket) => socket.latestState?.phase === "choosing"),
    "ronda iniciada"
  );

  const targetSession = sessionData.find((entry) => entry.socket !== host);
  const oldSocket = targetSession.socket;
  const previousState = oldSocket.latestState;
  const handBefore = previousState.hand.map((card) => card.id).join(",");
  closeClient(oldSocket);

  await waitFor(
    () => host.latestState?.players.some(
      (player) => player.id === targetSession.playerId && player.connected === false
    ),
    "jugador marcado como desconectado"
  );

  const replacement = await connectNew();
  t.after(() => closeClient(replacement));
  const resumed = await emitAck(replacement, "resume", {
    code,
    token: targetSession.token
  });
  assert.equal(resumed.ok, true, resumed.error);
  await waitFor(() => replacement.latestState?.selfId === targetSession.playerId, "estado reanudado");
  assert.equal(replacement.latestState.phase, "choosing");
  assert.equal(
    replacement.latestState.hand.map((card) => card.id).join(","),
    handBefore,
    "la mano debe conservarse"
  );

  const intruder = await connectNew();
  t.after(() => closeClient(intruder));
  const invalid = await emitAck(intruder, "resume", { code, token: "x".repeat(48) });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /no encontramos|sesión|puesto/i);
});

test("permite expulsar en lobby y bloquea unirse a partida iniciada", async (t) => {
  const { sockets, host } = await createAndJoin(4);
  t.after(() => sockets.forEach(closeClient));

  const [p2] = sockets.slice(1);
  const kickPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("No llegó el aviso de expulsión")), 5000);
    p2.once("kicked", (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
  const kicked = await emitAck(host, "kick_player", {
    playerId: p2.latestState.selfId
  });
  assert.equal(kicked.ok, true, kicked.error);
  const kickNotice = await kickPromise;
  assert.match(kickNotice.message, /sala/i);

  await waitFor(() => host.latestState?.players.length === 3, "jugador expulsado");

  const customDeck = await emitAck(host, "update_custom_deck", {
    whiteTexts: ["Un archivo con olor a podrido"],
    blackTexts: ["La auditoría encontró _."],
    mode: "mix"
  });
  assert.equal(customDeck.ok, true, customDeck.error);
  await waitFor(
    () => sockets[0].latestState?.deck?.hasCustom === true,
    "mazo personalizado activo"
  );
  assert.equal(sockets[0].latestState.deck.onlyCustom, false);
  assert.equal(sockets[0].latestState.deck.customWhite, 1);

  const start = await emitAck(host, "start_game");
  assert.equal(start.ok, true, start.error);
  await waitFor(
    () => sockets[0].latestState?.phase === "choosing",
    "partida iniciada"
  );

  const late = await connectNew();
  t.after(() => closeClient(late));
  const joinLate = await emitAck(late, "join_room", {
    name: "El Tardío",
    code: host.latestState.code
  });
  assert.equal(joinLate.ok, false);
  assert.match(joinLate.error, /ya comenzó/i);
});
