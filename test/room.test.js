"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { RoomManager, GameError } = require("../src/room");
const { BLACK_CARDS, WHITE_CARDS } = require("../src/cards");

function makeRoom(playerCount = 3) {
  const manager = new RoomManager();
  const { room, player: host } = manager.createRoom("socket-host", "Anfitrión");
  const players = [host];
  const names = ["La Suegra", "El Compadre", "La Vecina", "El Primo"];
  for (let index = 1; index < playerCount; index += 1) {
    players.push(room.addPlayer(names[index - 1], `socket-${index}`));
  }
  return { manager, room, host, players };
}

function submitFirstCards(room, player) {
  const pick = room.round.blackCard.pick;
  room.submitCards(
    player.id,
    player.hand.slice(0, pick).map((card) => card.id)
  );
}

test("flujo básico de una ronda y rotación de juez", () => {
  const { room, host } = makeRoom(3);
  room.startGame(host.id);

  assert.equal(room.phase, "choosing");
  assert.equal(room.round.number, 1);
  assert.ok(room.judgeId);

  const judge = room.getJudge();
  assert.ok(judge);
  assert.equal(judge.hand.length, 0, "el juez no debe recibir mano");

  for (const player of room.players) {
    if (player.id === judge.id) continue;
    assert.equal(player.hand.length, 10);
  }

  const nonJudges = room.players.filter((player) => player.id !== judge.id);
  assert.throws(
    () => room.submitCards(judge.id, judge.hand.slice(0, 1).map((card) => card.id)),
    (error) => error instanceof GameError && /juez/i.test(error.message)
  );
  assert.throws(
    () => room.submitCards(nonJudges[0].id, []),
    /exactamente/i
  );

  submitFirstCards(room, nonJudges[0]);
  assert.equal(room.phase, "choosing");
  submitFirstCards(room, nonJudges[1]);

  assert.equal(room.phase, "judging");
  const judgeView = room.viewFor(judge.id);
  assert.equal(judgeView.round.submissions.length, 2);
  for (const submission of judgeView.round.submissions) {
    assert.equal("playerId" in submission, false, "el juez no debe saber quién jugó");
    assert.ok(submission.filledPrompt);
  }

  const playerView = room.viewFor(nonJudges[0].id);
  assert.equal(playerView.round.submissions, undefined);
  assert.ok(playerView.myPlay);
  assert.equal(playerView.hand.length, 0);

  const submission = room.round.submissions[0];
  assert.throws(
    () => room.pickWinner(nonJudges[0].id, submission.id),
    /juez/i
  );

  room.pickWinner(judge.id, submission.id);
  assert.equal(room.phase, "round_end");
  assert.ok(room.round.winner);
  const scorer = room.getPlayer(room.round.winner.playerId);
  assert.equal(scorer.score, 1);
  assert.equal(room.whiteDiscard.length > 0, true);

  const previousJudge = judge.id;
  room.nextRound(host.id);
  assert.equal(room.round.number, 2);
  assert.equal(room.phase, "choosing");
  assert.notEqual(room.judgeId, previousJudge, "el juez debe rotar");
  assert.equal(room.round.judgeId, room.judgeId);

  const newJudge = room.getJudge();
  for (const player of room.players) {
    if (player.id === newJudge.id) continue;
    assert.equal(player.hand.length, 10, "la mano se repone al iniciar ronda");
  }
});

test("valida nombres, permisos y cartas", () => {
  const { room, host, players } = makeRoom(3);

  assert.throws(
    () => room.addPlayer("anfitrión", "socket-extra"),
    /nombre ya está/i
  );
  assert.throws(
    () => room.updateSettings(players[1].id, { targetScore: 3 }),
    /anfitrión/i
  );
  room.updateSettings(host.id, { targetScore: 3 });
  assert.equal(room.settings.targetScore, 3);

  room.startGame(host.id);
  room.round.blackCard = BLACK_CARDS.find((card) => card.pick === 1);
  const judge = room.getJudge();
  const player = room.players.find((entry) => entry.id !== judge.id);
  const realCard = player.hand[0].id;
  const fakeCard = "w99999";

  assert.throws(
    () => room.addPlayer("El Tardío", "socket-late"),
    /ya comenzó/i
  );
  assert.throws(
    () => room.submitCards(player.id, [fakeCard]),
    /no está en tu mano/i
  );

  room.submitCards(player.id, [realCard]);
  assert.throws(
    () => room.submitCards(player.id, [player.hand[0].id]),
    /ya (enviaste|mandaste)/i
  );

  const nonHost = room.players.find((entry) => entry.id !== room.hostId);
  assert.throws(() => room.forceVote(nonHost.id), /anfitrión/i);
});

test("maneja cartas negras de dos huecos", () => {
  const { room, host } = makeRoom(3);
  room.startGame(host.id);

  const pickTwo = BLACK_CARDS.find((card) => card.pick === 2);
  assert.ok(pickTwo, "debe existir al menos una carta de dos huecos");
  room.round.blackCard = pickTwo;

  const judge = room.getJudge();
  const players = room.players.filter((player) => player.id !== judge.id);

  assert.throws(
    () => room.submitCards(players[0].id, [players[0].hand[0].id]),
    /exactamente 2/i
  );
  assert.throws(
    () => room.submitCards(players[0].id, [players[0].hand[0].id, players[0].hand[0].id]),
    /repetir/i
  );

  for (const player of players) {
    const ids = player.hand.slice(0, 2).map((card) => card.id);
    room.submitCards(player.id, ids);
  }
  assert.equal(room.phase, "judging");

  const submission = room.round.submissions[0];
  const texts = submission.cards.map((card) => card.text);
  assert.equal(submission.cards.length, 2);
  room.pickWinner(judge.id, submission.id);
  assert.equal(room.phase, "round_end");
  for (const text of texts) {
    assert.match(room.round.winner.filledPrompt, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("reconexión conserva la mano y acepta chat", () => {
  const { room, host } = makeRoom(3);
  room.startGame(host.id);

  const judge = room.getJudge();
  const player = room.players.find((entry) => entry.id !== judge.id);
  const handIds = player.hand.map((card) => card.id).join(",");

  const disconnected = room.markDisconnected(player.id, player.socketId);
  assert.equal(disconnected, true);
  assert.equal(player.connected, false);
  assert.equal(room.markDisconnected(player.id, "socket-viejo"), false);
  assert.equal(room.viewFor(judge.id).players.find((entry) => entry.id === player.id).connected, false);

  const resumed = room.resumePlayer(player.token, "socket-nuevo");
  assert.equal(resumed.id, player.id);
  assert.equal(resumed.connected, true);
  assert.equal(resumed.socketId, "socket-nuevo");
  assert.equal(resumed.hand.map((card) => card.id).join(","), handIds);

  const message = room.addUserChat(resumed, "  Hola   a  todos  ");
  assert.equal(message.text, "Hola a todos");
  assert.equal(room.chat.at(-1).name, player.name);
});

test("reasignar juez actualiza la ronda y devuelve la jugada", () => {
  const { room, host } = makeRoom(4);
  room.startGame(host.id);

  const oldJudge = room.getJudge();
  const oldJudgeIndex = room.players.findIndex((player) => player.id === oldJudge.id);
  const candidate = room.players.find(
    (player, index) => player.connected && player.id !== oldJudge.id && index > oldJudgeIndex
  ) || room.players.find((player) => player.connected && player.id !== oldJudge.id);
  submitFirstCards(room, candidate);
  const candidateCardId = candidate.submission.cards[0].id;

  room.reassignJudge(host.id);

  assert.notEqual(room.judgeId, oldJudge.id);
  assert.equal(room.round.judgeId, room.judgeId);
  assert.equal(room.round.submissions.some((entry) => entry.playerId === candidate.id), false);
  assert.equal(candidate.hand.some((card) => card.id === candidateCardId), true);
  assert.equal(room.viewFor(room.judgeId).self.isJudge, true);
});

test("fuerza la votación y archiva una ronda sin jugadas", () => {
  const { room, host } = makeRoom(4);
  room.startGame(host.id);

  assert.throws(() => room.forceVote(host.id), /no hay ni una/i);

  const judge = room.getJudge();
  const player = room.players.find((entry) => entry.id !== judge.id);
  submitFirstCards(room, player);
  room.forceVote(host.id);
  assert.equal(room.phase, "judging");
  assert.equal(room.round.submissions.length, 1);

  const submission = room.round.submissions[0];
  room.pickWinner(judge.id, submission.id);
  assert.equal(room.phase, "round_end");
});

test("se corona un ganador, se puede jugar revancha y volver al lobby", () => {
  const { room, host, players } = makeRoom(3);
  room.updateSettings(host.id, { targetScore: 3 });
  room.startGame(host.id);

  const target = players[1];
  let guard = 0;

  while (room.phase !== "game_over" && guard < 25) {
    guard += 1;
    if (room.phase === "round_end") {
      room.nextRound(host.id);
      continue;
    }
    if (room.phase === "choosing") {
      for (const player of room.players) {
        if (player.id === room.judgeId) continue;
        submitFirstCards(room, player);
      }
      continue;
    }
    if (room.phase === "judging") {
      const targetSubmission = room.round.submissions.find(
        (entry) => entry.playerId === target.id
      );
      const submission = targetSubmission || room.round.submissions[0];
      room.pickWinner(room.judgeId, submission.id);
      continue;
    }
  }

  assert.equal(room.phase, "game_over");
  assert.equal(room.gameWinnerId, target.id);
  assert.equal(room.getPlayer(target.id).score, 3);
  assert.ok(room.round.winner);
  assert.ok(room.viewFor(host.id).gameWinner);
  assert.ok(room.chat.some((message) => /ganó la partida/i.test(message.text)));

  room.rematch(host.id);
  assert.equal(room.phase, "choosing");
  assert.equal(room.round.number, 1);
  for (const player of room.players) {
    assert.equal(player.score, 0);
    assert.equal(player.hand.length >= 10 || player.id === room.judgeId, true);
  }

  room.backToLobby(host.id);
  assert.equal(room.phase, "lobby");
  assert.equal(room.round, null);
  for (const player of room.players) {
    assert.equal(player.score, 0);
    assert.equal(player.hand.length, 0);
  }
});

test("revela todas las jugadas anónimas al terminar la ronda", () => {
  const { room, host } = makeRoom(4);
  room.startGame(host.id);

  const judge = room.getJudge();
  const players = room.players.filter((player) => player.id !== judge.id);
  for (const player of players) submitFirstCards(room, player);
  assert.equal(room.phase, "judging");

  const chosen = room.round.submissions[1];
  room.pickWinner(judge.id, chosen.id);
  assert.equal(room.phase, "round_end");

  const view = room.viewFor(host.id);
  assert.equal(view.round.revealedPlays.length, players.length);
  assert.equal(view.round.revealedPlays.filter((play) => play.isWinner).length, 1);
  for (const play of view.round.revealedPlays) {
    assert.equal("playerId" in play, false);
    assert.equal("name" in play, false);
    assert.ok(play.cards.length >= 1);
    assert.ok(play.filledPrompt);
  }

  const judgeView = room.viewFor(judge.id);
  assert.equal(judgeView.round.revealedPlays.length, players.length);

  const selfPlay = view.round.revealedPlays.find((play) => play.isSelf);
  if (host.id !== judge.id) {
    assert.ok(selfPlay, "la vista del jugador debe marcar su propia jugada");
  }
});

test("valida y usa un mazo personalizado en modo solo mío y mezclado", () => {
  const { room, host } = makeRoom(3);
  const customWhites = Array.from({ length: 30 }, (_, index) => `Archivo secreto ${index + 1}`);
  const customBlack = "El expediente secreto menciona _.";

  assert.throws(
    () =>
      room.updateCustomDeck(room.players[1].id, {
        whiteTexts: customWhites,
        blackTexts: [customBlack],
        mode: "only"
      }),
    /anfitrión/i
  );

  assert.throws(
    () =>
      room.updateCustomDeck(host.id, {
        whiteTexts: customWhites,
        blackTexts: ["Pregunta sin huecos."],
        mode: "only"
      }),
    /huecos/i
  );

  const saved = room.updateCustomDeck(host.id, {
    whiteTexts: customWhites,
    blackTexts: [customBlack],
    mode: "only"
  });
  assert.equal(saved.whiteTexts.length, 30);
  assert.equal(saved.blackTexts.length, 1);
  assert.equal(room.getDeckInfo().onlyCustom, true);
  assert.equal(room.getDeckInfo().customWhite, 30);
  assert.equal(room.getDeckInfo().customBlack, 1);

  room.startGame(host.id);
  assert.equal(room.phase, "choosing");
  assert.equal(room.round.blackCard.text, customBlack);
  assert.equal(room.whitePool.length, 30);
  assert.equal(room.blackPool.length, 1);
  assert.ok(
    room.players.some((player) =>
      player.hand.some((card) => card.id.startsWith("wcustom-"))
    )
  );

  const mixRoom = makeRoom(3);
  mixRoom.room.updateCustomDeck(mixRoom.host.id, {
    whiteTexts: ["Un archivo con olor a podrido"],
    blackTexts: ["La auditoría encontró _."],
    mode: "mix"
  });
  mixRoom.room.startGame(mixRoom.host.id);
  assert.equal(mixRoom.room.getDeckInfo().onlyCustom, false);
  assert.equal(mixRoom.room.whitePool.length, WHITE_CARDS.length + 1);
  assert.equal(mixRoom.room.blackPool.length, BLACK_CARDS.length + 1);
  assert.equal(mixRoom.room.phase, "choosing");
});

test("permite cambiar avatar por emoji o foto y lo refleja en la sala", () => {
  const { room, host, players } = makeRoom(3);
  const photo = `data:image/jpeg;base64,${"A".repeat(900)}`;

  room.updateAvatar(host.id, "🦜");
  assert.equal(room.getPlayer(host.id).avatar, "🦜");
  room.updateAvatar(host.id, photo);
  assert.equal(room.getPlayer(host.id).avatar, photo);
  assert.equal(room.viewFor(host.id).self.avatar, photo);
  assert.equal(room.viewFor(players[1].id).players.find((player) => player.id === host.id).avatar, photo);

  const message = room.addUserChat(host, "Miradme la cara");
  assert.equal(message.avatar, "👤", "el chat no debe cargar la foto completa");

  const preferred = room.addPlayer("El Nuevo", "socket-new", "🦥");
  assert.equal(preferred.avatar, "🦥");

  assert.throws(
    () => room.updateAvatar(host.id, "data:image/svg+xml;base64,PHN2Zz4="),
    /avatar no es válido/i
  );
});

test("bloquea un mazo propio con muy pocas cartas", () => {
  const { room, host } = makeRoom(3);
  room.updateCustomDeck(host.id, {
    whiteTexts: Array.from({ length: 10 }, (_, index) => `Carta ${index}`),
    blackTexts: ["La verdad aparece en _."],
    mode: "only"
  });
  assert.throws(() => room.startGame(host.id), /al menos 30/i);
});

test("transferencia de anfitrión y expulsión en el lobby", () => {
  const { room, host, players } = makeRoom(3);

  const result = room.leaveRoom(host.id);
  assert.equal(result.removed, true);
  assert.equal(room.players.length, 2);
  assert.equal(room.hostId, players[1].id);

  const kicked = room.kickPlayer(room.hostId, players[2].id);
  assert.equal(kicked.target.id, players[2].id);
  assert.equal(room.players.length, 1);
  assert.throws(
    () => room.kickPlayer(room.hostId, room.hostId),
    /ti mismo/i
  );
});
