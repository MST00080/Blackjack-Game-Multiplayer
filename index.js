// Multiplayer Blackjack – Final index.js (1000 satırlık eski client.js yapısına %100 uyumlu, temiz ve profesyonel)

const express = require("express");
const app = express();
const server = require("http").createServer(app);
const PORT = process.env.PORT || 8080;
const WebSocket = require("ws");
const wss = new WebSocket.Server({ server });
const cacheDuration = 1000 * 60 * 60 * 24 * 365;

const WEB_URL = process.env.NODE_ENV === "production"
  ? `https://${process.env.DOMAIN_NAME}/`
  : `http://localhost:${PORT}/`;

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
  clients[clientId] = {
    ws: ws,
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

  ws.send(JSON.stringify({ method: "connect", clientId: clientId, theClient: clients[clientId] }));

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
        if (!game.spectators.some(s => s.clientId === theClient.clientId)) game.spectators.push(theClient);
        broadcast(game, { method: "join", game, players: game.players, spectators: game.spectators, playerSlotHTML: game.playerSlotHTML });
        ws.send(JSON.stringify({ method: "joinClient", theClient, game }));
        break;
      }

      case "joinTable": {
        if (!game) return;
        const theClient = result.theClient;
        const slot = result.theSlot;
        if (!game.players.some(p => p.clientId === theClient.clientId)) game.players.push(theClient);
        game.playerSlotHTML[slot] = theClient.clientId;
        broadcast(game, { method: "joinTable", theSlot: slot, user: theClient, game, players: game.players, spectators: game.spectators, playerSlotHTML: game.playerSlotHTML });
        break;
      }

      case "bet": {
        if (!game) return;
        game.players = result.players;
        broadcast(game, { method: "bet", players: game.players });
        break;
      }

      case "deck": {
        if (!game) return;
        game.gameOn = result.gameOn;
        broadcast(game, { method: "deck", deck: result.deck, gameOn: game.gameOn, clientDeal: result.clientDeal });
        break;
      }

      case "isReady": {
        if (!game) return;
        game.players = result.players;
        broadcast(game, { method: "isReady", players: game.players, theClient: result.theClient });
        break;
      }

      case "updateDealerCards": {
        if (!game) return;
        game.dealer = result.dealer;
        game.players = result.players;
        broadcast(game, { method: "updateDealerCards", dealer: result.dealer, player: result.player, players: game.players });
        break;
      }

      case "updatePlayerCards": {
        if (!game) return;
        game.players = result.players;
        broadcast(game, { method: "updatePlayerCards", players: game.players, player: result.player, resetCards: result.resetCards });
        break;
      }

      case "thePlay": {
        if (!game) return;
        game.players = result.players;
        broadcast(game, { method: "thePlay", player: result.player, currentPlayer: result.currentPlayer, players: game.players });
        break;
      }

      case "currentPlayer": {
        if (!game) return;
        broadcast(game, { method: "currentPlayer", player: result.player, players: game.players });
        break;
      }

      case "showSum": {
        if (!game) return;
        game.players = result.players;
        broadcast(game, { method: "showSum", players: game.players });
        break;
      }

      case "update": {
        if (!game) return;
        game.players = result.players;
        game.dealer = result.dealer;
        broadcast(game, { method: "update", players: game.players, dealer: game.dealer, deck: result.deck, gameOn: result.gameOn });
        break;
      }

      case "terminate": {
        if (!game) return;
        game.spectators = game.spectators.filter(s => s.clientId !== clientId);
        game.players = game.players.filter(p => p.clientId !== clientId);
        game.playerSlotHTML = game.playerSlotHTML.map(s => s === clientId ? {} : s);
        if (game.players.length === 0 && game.spectators.length === 0) delete games[gameId];
        broadcast(game, { method: "leave", players: game.players, playerSlotHTML: game.playerSlotHTML, spectators: game.spectators, game });
        break;
      }
    }
  });

  ws.on("close", () => delete clients[clientId]);
});

function broadcast(game, payload) {
  [...game.players, ...game.spectators].forEach(c => {
    const clientWs = clients[c.clientId]?.ws;
    if (clientWs && clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify(payload));
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

// ✅ Bu final index.js, eski client.js mantığına %100 uyumludur.
// Test sonrası render deploy planına geçebiliriz.
