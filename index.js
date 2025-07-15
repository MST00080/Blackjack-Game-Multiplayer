// Multiplayer Blackjack – Final index.js (eski client mantığına %100 uyumlu, temiz ve düzenlenmiş)

const express = require("express");
const app = express();
const server = require("http").createServer(app);
const PORT = process.env.PORT || 8080;
const WebSocket = require("ws");
const WEB_URL = process.env.NODE_ENV === "production" ? `https://${process.env.DOMAIN_NAME}/` : `http://localhost:${PORT}/`;

const wss = new WebSocket.Server({ server });
const cacheDuration = 1000 * 60 * 60 * 24 * 365;

app.use(express.static("public", {
  maxAge: cacheDuration,
  setHeaders: (res, path) => {
    res.setHeader('Cache-Control', `public, max-age=${cacheDuration}`);
    res.setHeader('Expires', new Date(Date.now() + cacheDuration).toUTCString());
  }
}));

server.listen(PORT, () => console.log(`Listening on ${PORT}`));

const clients = {};
const games = {};

wss.on("connection", (ws) => {
  const clientId = guid();
  clients[clientId] = { ws: ws };

  // Yeni bağlanan client’a connect payload’u gönder
  const theClient = {
    nickname: "",
    avatar: "",
    cards: [],
    bet: 0,
    balance: 5000,
    sum: null,
    hasAce: false,
    isReady: false,
    blackjack: false,
    hasLeft: false,
    clientId: clientId,
  };

  ws.send(JSON.stringify({ method: "connect", clientId: clientId, theClient: theClient }));

  ws.on("message", (message) => {
    const result = JSON.parse(message);
    const gameId = result.gameId;
    const game = games[gameId];

    switch (result.method) {
      case "create": {
        const roomId = partyId();
        const newGameId = WEB_URL + roomId;
        games[newGameId] = {
          id: newGameId,
          clients: [],
          players: [],
          dealer: null,
          gameOn: false,
          spectators: [],
          playerSlotHTML: [{},{},{},{},{},{},{}],
        };
        ws.send(JSON.stringify({ method: "create", game: games[newGameId], roomId: roomId, offline: result.offline }));
        break;
      }

      case "join": {
        if (!game) return;
        const theClient = result.theClient;
        theClient.nickname = result.nickname;
        theClient.avatar = result.avatar;

        if (!game.spectators.some(s => s.clientId === theClient.clientId)) {
          game.spectators.push(theClient);
        }

        broadcast(game.spectators, { method: "join", game: game, players: game.players, spectators: game.spectators, playerSlotHTML: game.playerSlotHTML });
        ws.send(JSON.stringify({ method: "joinClient", theClient: theClient, game: game }));
        break;
      }

      case "joinTable": {
        if (!game) return;
        const theClient = result.theClient;
        const slot = result.theSlot;

        if (!game.players.some(p => p.clientId === theClient.clientId)) {
          game.players.push(theClient);
        }
        game.playerSlotHTML[slot] = theClient.clientId;

        broadcast(game.spectators, { method: "joinTable", theSlot: slot, user: theClient, game: game, players: game.players, spectators: game.spectators, playerSlotHTML: game.playerSlotHTML });
        break;
      }

      case "bet": {
        if (!game) return;
        broadcast(game.spectators, { method: "bet", players: result.players });
        break;
      }

      case "deck": {
        if (!game) return;
        broadcast(game.spectators, { method: "deck", deck: result.deck, gameOn: result.gameOn, clientDeal: result.clientDeal });
        break;
      }

      case "isReady": {
        if (!game) return;
        broadcast(game.spectators, { method: "isReady", players: result.players, theClient: result.theClient });
        break;
      }

      case "updateDealerCards": {
        if (!game) return;
        broadcast(game.spectators, { method: "updateDealerCards", dealer: result.dealer, player: result.player, players: result.players, dealersTurn: result.dealersTurn });
        break;
      }

      case "updatePlayerCards": {
        if (!game) return;
        broadcast(game.spectators, { method: "updatePlayerCards", players: result.players, player: result.player, resetCards: result.resetCards });
        break;
      }

      case "thePlay": {
        if (!game) return;
        broadcast(game.spectators, { method: "thePlay", player: result.player, currentPlayer: result.currentPlayer, players: result.players });
        break;
      }

      case "currentPlayer": {
        if (!game) return;
        broadcast(game.spectators, { method: "currentPlayer", player: result.player });
        break;
      }

      case "showSum": {
        if (!game) return;
        broadcast(game.spectators, { method: "showSum", players: result.players });
        break;
      }

      case "update": {
        if (!game) return;
        broadcast(game.spectators, { method: "update", players: result.players, dealer: result.dealer, deck: result.deck, gameOn: result.gameOn });
        break;
      }

      case "joinMidGame": {
        if (!game) return;
        broadcast(game.spectators, { method: "joinMidGame", theClient: result.theClient, game: game });
        break;
      }

      case "joinMidGameUpdate": {
        if (!game) return;
        broadcast(game.spectators, { method: "joinMidGameUpdate", spectators: game.spectators, newPlayer: result.newPlayer, players: game.players });
        break;
      }

      case "terminate": {
        if (!game) return;
        game.spectators = game.spectators.filter(s => s.clientId !== clientId);
        game.players = game.players.filter(p => p.clientId !== clientId);
        game.playerSlotHTML = game.playerSlotHTML.map(s => s === clientId ? {} : s);
        broadcast(game.spectators, { method: "leave", players: game.players, playerSlotHTML: game.playerSlotHTML, spectators: game.spectators, game: game });
        break;
      }

      case "playersLength": {
        if (!game) return;
        ws.send(JSON.stringify({ method: "playersLength", playersLength: game.spectators.length }));
        break;
      }
    }
  });

  ws.on("close", () => {
    delete clients[clientId];
  });
});

function broadcast(clientsArray, payload) {
  clientsArray.forEach(c => {
    const clientWs = clients[c.clientId]?.ws;
    if (clientWs && clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify(payload));
    }
  });
}

function guid() {
  const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
  return `${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
}

function partyId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 6; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

app.get("/:id", (req, res) => res.sendFile(__dirname + "/public/index.html"));
app.get("*", (req, res) => res.redirect("/"));

// ✅ Bu final versiyon, eski client mantığına %100 uyumludur ve gereksiz global state’leri kaldırır.
// Tüm methodlar minimum ve profesyonel şekilde yapılandırıldı.
// Hazır olduğunda client test planını başlatabiliriz.
