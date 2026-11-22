"use strict";

const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const express = require("express");
const { Server } = require("socket.io");
const {
  RoomManager,
  GameError,
  AVATARS,
  normalizeRoomCode,
  SCORE_OPTIONS
} = require("./src/room");
const { BLACK_CARDS, WHITE_CARDS } = require("./src/cards");

function createGameServer() {
  const app = express();
  const publicDir = path.join(__dirname, "public");
  const indexFile = path.join(publicDir, "index.html");
  const manager = new RoomManager();

  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    next();
  });

  app.use(
    express.static(publicDir, {
      extensions: ["html"],
      setHeaders(res, filePath) {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache");
        } else {
          res.setHeader("Cache-Control", "public, max-age=3600");
        }
      }
    })
  );

  app.get("/health", (req, res) => {
    res.json({
      ok: true,
      uptime: process.uptime(),
      ...manager.stats
    });
  });

  app.get("/api/config", (req, res) => {
    const port = Number(process.env.PORT) || 3000;
    res.json({
      ok: true,
      lanUrls: getLocalAddresses().map((address) => `http://${address}:${port}`),
      cardCount: WHITE_CARDS.length + BLACK_CARDS.length
    });
  });

  app.get("/sala/:code", (req, res) => {
    const code = normalizeRoomCode(req.params.code);
    res.redirect(302, `/?sala=${encodeURIComponent(code)}`);
  });

  const server = http.createServer(app);
  const io = new Server(server, {
    maxHttpBufferSize: 200_000,
    pingInterval: 10_000,
    pingTimeout: 20_000
  });

  const cleanupTimer = setInterval(() => manager.cleanup(), 15 * 60 * 1000);
  cleanupTimer.unref();

  function ack(callback, payload) {
    if (typeof callback === "function") callback(payload);
  }

  function errorPayload(error) {
    if (error instanceof GameError) return { ok: false, error: error.message };
    console.error("[cartas-criollas]", error);
    return {
      ok: false,
      error: "Algo se rompió por dentro. Intenta otra vez."
    };
  }

  function respond(socket, callback, work) {
    try {
      const extra = work() || {};
      ack(callback, { ok: true, ...extra });
    } catch (error) {
      const payload = errorPayload(error);
      ack(callback, payload);
      if (typeof callback !== "function") {
        socket.emit("toast", { type: "error", message: payload.error });
      }
    }
  }

  function bindSocket(socket, room, player) {
    if (socket.data.roomCode && socket.data.roomCode !== room.code) {
      socket.leave(socket.data.roomCode);
    }
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.playerId = player.id;
    socket.data.playerToken = player.token;
  }

  function clearSocketRoom(socket) {
    if (socket.data.roomCode) socket.leave(socket.data.roomCode);
    delete socket.data.roomCode;
    delete socket.data.playerId;
    delete socket.data.playerToken;
    delete socket.data.chatTimes;
  }

  function broadcastRoom(room) {
    for (const player of room.players) {
      if (!player.connected || !player.socketId) continue;
      const state = room.viewFor(player.id);
      if (state) io.to(player.socketId).emit("state", state);
    }
  }

  function broadcastChat(room, message) {
    const payload = { ...message, roomCode: room.code };
    for (const player of room.players) {
      if (!player.connected || !player.socketId) continue;
      io.to(player.socketId).emit("chat_message", payload);
    }
  }

  function getBound(socket) {
    const code = socket.data.roomCode;
    const playerId = socket.data.playerId;
    if (!code || !playerId) {
      throw new GameError("No estás dentro de una sala.");
    }
    const room = manager.getRoom(code);
    if (!room) {
      clearSocketRoom(socket);
      throw new GameError("Esa sala ya no existe.");
    }
    const player = room.getPlayer(playerId);
    if (!player) {
      clearSocketRoom(socket);
      throw new GameError("Tu puesto en la sala ya no existe.");
    }
    if (!player.connected) {
      throw new GameError("Tu conexión se perdió. Espera a reconectarte.");
    }
    return { room, player };
  }

  function notifyKicked(target, room) {
    if (!target || !target.socketId) return;
    const targetSocket = io.sockets.sockets.get(target.socketId);
    if (!targetSocket) return;
    targetSocket.emit("kicked", {
      message: `Te sacaron de la sala ${room.code}.`
    });
    targetSocket.leave(room.code);
    clearSocketRoom(targetSocket);
  }

  io.on("connection", (socket) => {
    socket.emit("hello", {
      ok: true,
      scoreOptions: SCORE_OPTIONS,
      avatarOptions: AVATARS,
      serverTime: Date.now()
    });

    socket.on("create_room", (payload, callback) => {
      respond(socket, callback, () => {
        if (socket.data.roomCode) {
          throw new GameError("Ya estás en una sala. Sal de esa primero.");
        }
        const name = payload && payload.name;
        const avatar = payload && payload.avatar;
        const { room, player } = manager.createRoom(socket.id, name, avatar);
        bindSocket(socket, room, player);
        broadcastRoom(room);
        return {
          code: room.code,
          token: player.token,
          playerId: player.id
        };
      });
    });

    socket.on("join_room", (payload, callback) => {
      respond(socket, callback, () => {
        if (socket.data.roomCode) {
          throw new GameError("Ya estás en una sala. Sal de esa primero.");
        }
        const code = normalizeRoomCode(payload && payload.code);
        if (code.length !== 5) {
          throw new GameError("El código debe tener 5 caracteres.");
        }
        const { room, player } = manager.joinRoom(
          code,
          payload && payload.name,
          socket.id,
          payload && payload.avatar
        );
        bindSocket(socket, room, player);
        broadcastRoom(room);
        return {
          code: room.code,
          token: player.token,
          playerId: player.id
        };
      });
    });

    socket.on("resume", (payload, callback) => {
      respond(socket, callback, () => {
        const code = normalizeRoomCode(payload && payload.code);
        const token = payload && payload.token;
        if (!code || !token) {
          throw new GameError("La sesión está incompleta.");
        }
        if (socket.data.roomCode && socket.data.roomCode !== code) {
          throw new GameError("Ya estás en otra sala.");
        }
        const { room, player } = manager.resumeRoom(code, token, socket.id);
        bindSocket(socket, room, player);
        broadcastRoom(room);
        return {
          code: room.code,
          token: player.token,
          playerId: player.id
        };
      });
    });

    socket.on("update_settings", (payload, callback) => {
      respond(socket, callback, () => {
        const { room, player } = getBound(socket);
        room.updateSettings(player.id, payload || {});
        broadcastRoom(room);
        return {};
      });
    });

    socket.on("update_avatar", (payload, callback) => {
      respond(socket, callback, () => {
        const { room, player } = getBound(socket);
        room.updateAvatar(player.id, payload && payload.avatar);
        broadcastRoom(room);
        return {};
      });
    });

    socket.on("update_custom_deck", (payload, callback) => {
      respond(socket, callback, () => {
        const { room, player } = getBound(socket);
        room.updateCustomDeck(player.id, payload || {});
        broadcastRoom(room);
        return {};
      });
    });

    socket.on("start_game", (payload, callback) => {
      respond(socket, callback, () => {
        const { room, player } = getBound(socket);
        room.startGame(player.id);
        broadcastRoom(room);
        return {};
      });
    });

    socket.on("submit_cards", (payload, callback) => {
      respond(socket, callback, () => {
        const { room, player } = getBound(socket);
        const cardIds = payload && payload.cardIds;
        room.submitCards(player.id, cardIds);
        broadcastRoom(room);
        return {};
      });
    });

    socket.on("pick_winner", (payload, callback) => {
      respond(socket, callback, () => {
        const { room, player } = getBound(socket);
        room.pickWinner(player.id, payload && payload.submissionId);
        broadcastRoom(room);
        return {};
      });
    });

    socket.on("next_round", (payload, callback) => {
      respond(socket, callback, () => {
        const { room, player } = getBound(socket);
        room.nextRound(player.id);
        broadcastRoom(room);
        return {};
      });
    });

    socket.on("force_vote", (payload, callback) => {
      respond(socket, callback, () => {
        const { room, player } = getBound(socket);
        room.forceVote(player.id);
        broadcastRoom(room);
        return {};
      });
    });

    socket.on("reassign_judge", (payload, callback) => {
      respond(socket, callback, () => {
        const { room, player } = getBound(socket);
        room.reassignJudge(player.id);
        broadcastRoom(room);
        return {};
      });
    });

    socket.on("back_to_lobby", (payload, callback) => {
      respond(socket, callback, () => {
        const { room, player } = getBound(socket);
        room.backToLobby(player.id);
        broadcastRoom(room);
        return {};
      });
    });

    socket.on("rematch", (payload, callback) => {
      respond(socket, callback, () => {
        const { room, player } = getBound(socket);
        room.rematch(player.id);
        broadcastRoom(room);
        return {};
      });
    });

    socket.on("send_chat", (payload, callback) => {
      respond(socket, callback, () => {
        const { room, player } = getBound(socket);
        const now = Date.now();
        const recent = (socket.data.chatTimes || []).filter(
          (timestamp) => now - timestamp < 10_000
        );
        if (recent.length >= 8) {
          throw new GameError("Tranquilo, deja hablar a los demás.");
        }
        socket.data.chatTimes = [...recent, now];
        const message = room.addUserChat(player, payload && payload.text);
        broadcastChat(room, message);
        return {};
      });
    });

    socket.on("leave_room", (payload, callback) => {
      respond(socket, callback, () => {
        if (!socket.data.roomCode || !socket.data.playerId) {
          return {};
        }
        const room = manager.getRoom(socket.data.roomCode);
        const playerId = socket.data.playerId;
        if (!room) {
          clearSocketRoom(socket);
          return {};
        }
        const result = room.leaveRoom(playerId);
        socket.leave(room.code);
        clearSocketRoom(socket);
        broadcastRoom(room);
        if (result.roomEmpty) {
          manager.deleteIfEmpty(room.code);
        }
        return {};
      });
    });

    socket.on("kick_player", (payload, callback) => {
      respond(socket, callback, () => {
        const { room, player } = getBound(socket);
        const result = room.kickPlayer(player.id, payload && payload.playerId);
        notifyKicked(result.target, room);
        broadcastRoom(room);
        if (result.roomEmpty) {
          manager.deleteIfEmpty(room.code);
        }
        return {};
      });
    });

    socket.on("disconnect", () => {
      const code = socket.data.roomCode;
      const playerId = socket.data.playerId;
      if (!code || !playerId) return;
      const room = manager.getRoom(code);
      if (!room) return;
      const changed = room.markDisconnected(playerId, socket.id);
      if (changed) {
        broadcastRoom(room);
        manager.deleteIfEmpty(code);
      }
    });
  });

  return { app, server, io, manager };
}

function getLocalAddresses() {
  const addresses = [];
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      const family = entry.family;
      if ((family === "IPv4" || family === 4) && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }
  const unique = [...new Set(addresses)];
  const rank = (address) => {
    if (address.startsWith("192.168.")) return 0;
    if (address.startsWith("10.")) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
    return 3;
  };
  return unique.sort((a, b) => rank(a) - rank(b));
}

function printBanner(port) {
  const addresses = getLocalAddresses();
  const lines = [
    "",
    "============================================================",
    "   CARTAS CONTRA LA HUMANIDAD: EDICION CRIOLLA",
    "   Que Dios nos ampare.",
    "------------------------------------------------------------",
    `   Local:  http://localhost:${port}`,
    ...addresses.map((address) => `   Red:    http://${address}:${port}`),
    "------------------------------------------------------------",
    "   Comparte el link. La sala se arma desde la pagina.",
    "   Si tus panas estan en otra red, despliega el juego",
    "   o usa un tunel (mira el README).",
    "============================================================",
    ""
  ];
  console.log(lines.join("\n"));
}

function startServer() {
  const { server } = createGameServer();
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, "0.0.0.0", () => {
    printBanner(port);
  });
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  createGameServer,
  startServer
};
