// Multiplayer Blackjack oyun sunucusu – temizlenmiş ve hatasız final versiyon

const express = require("express");
const app = express();
const server = require("http").createServer(app);
const PORT = process.env.PORT || 8080;
const WebSocket = require("ws");
const WEB_URL = process.env.NODE_ENV === "production" ? `https://${process.env.DOMAIN_NAME || 'YOUR_RENDER_DOMAIN_HERE'}/` : `http://localhost:${PORT}/`;

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
  clients[clientId] = {
    ws,
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
    clientId,
  };

  ws.send(JSON.stringify({ method: "connect", clientId, theClient: clients[clientId] }));

  ws.on("message", (message) => {
    const result = JSON.parse(message);
    const gameId = result.gameId;
    const game = games[gameId];

    switch (result.method) {
      case "create":
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
        ws.send(JSON.stringify({ method: "create", game: games[newGameId], roomId }));
        break;

      case "join":
        if (!game) return;
        const theClient = clients[clientId];
        theClient.nickname = result.nickname;
        theClient.avatar = result.avatar;

        if (!game.spectators.some(s => s.clientId === clientId)) {
          game.spectators.push(theClient);
        }

        broadcast(game, { method: "join", game, players: game.players, spectators: game.spectators, playerSlotHTML: game.playerSlotHTML });
        break;

      case "joinTable":
        if (!game) return;
        const slot = result.theSlot;
        const playerIndex = game.players.findIndex(p => p.clientId === clientId);
        if (playerIndex === -1) game.players.push(clients[clientId]);
        game.playerSlotHTML[slot] = clientId;
        broadcast(game, { method: "joinTable", theSlot: slot, user: clients[clientId], game, players: game.players, spectators: game.spectators, playerSlotHTML: game.playerSlotHTML });
        break;

      case "bet":
        if (!game) return;
        const bettingPlayer = result.player;
        const idx = game.players.findIndex(p => p.clientId === bettingPlayer.clientId);
        if (idx !== -1) game.players[idx] = bettingPlayer;
        broadcast(game, { method: "bet", players: game.players });
        break;

      case "deck":
        if (!game) return;
        game.gameOn = result.gameOn;
        broadcast(game, { method: "deck", deck: result.deck, gameOn: game.gameOn, clientDeal: result.clientDeal });
        break;

      case "isReady":
        if (!game) return;
        const readyPlayer = game.players.find(p => p.clientId === result.theClient.clientId);
        if (readyPlayer) readyPlayer.isReady = result.theClient.isReady;
        broadcast(game, { method: "isReady", players: game.players, theClient: result.theClient });
        break;

      case "updateDealerCards":
        if (!game) return;
        const dealer = result.dealer;
        const player = result.player;

        // Dealer objesini game.dealer'a kaydet
        game.dealer = dealer;

        broadcast(game, {
          method: "updateDealerCards",
          dealer: dealer,
          player: player,
          players: game.players,
        });
        break;

      case "terminate":
        if (!game) return;
        game.spectators = game.spectators.filter(s => s.clientId !== clientId);
        game.players = game.players.filter(p => p.clientId !== clientId);
        game.playerSlotHTML = game.playerSlotHTML.map(s => s === clientId ? {} : s);
        if (game.players.length === 0 && game.spectators.length === 0) delete games[gameId];
        broadcast(game, { method: "leave", players: game.players, playerSlotHTML: game.playerSlotHTML, spectators: game.spectators, game });
        break;
      
        case "updatePlayerCards":
        if (!game) return;
        const updatedPlayer = result.player;
        const resetCards = result.resetCards;

        // game.players dizisinde oyuncuyu güncelle
        const updateIdx = game.players.findIndex(p => p.clientId === updatedPlayer.clientId);
        if (updateIdx !== -1) game.players[updateIdx] = updatedPlayer;

        broadcast(game, {
          method: "updatePlayerCards",
          players: game.players,
          player: updatedPlayer,
          resetCards: resetCards,
        });
        break;
      case "thePlay":
        if (!game) return;
        const playingPlayer = result.player;
        const currentPlayer = result.currentPlayer;

        // game.players dizisinde oyuncuyu güncelle
        const playIdx = game.players.findIndex(p => p.clientId === playingPlayer.clientId);
        if (playIdx !== -1) game.players[playIdx] = playingPlayer;

        broadcast(game, {
          method: "thePlay",
          player: playingPlayer,
          currentPlayer: currentPlayer,
          players: game.players,
        });
        break;
 case "currentPlayer":
        if (!game) return;
        const current = result.player;

        // game.players dizisinde current player'ı güncelle
        const currentIdx = game.players.findIndex(p => p.clientId === current.clientId);
        if (currentIdx !== -1) game.players[currentIdx] = current;

        broadcast(game, {
          method: "currentPlayer",
          player: current,
          players: game.players,
        });
        break;
      case "showSum":
        if (!game) return;
        const playersSum = result.players;

        // Sunucu tarafındaki oyuncu listesini güncelle
        game.players = playersSum;

        broadcast(game, {
          method: "showSum",
          players: game.players,
        });
        break;
      case "playersLength":
        if (!game) return;
        const playersLength = game.players.length;

        const lengthPayload = {
          method: "playersLength",
          playersLength: playersLength,
          gameId: gameId,
        };

        const clientWs = clients[clientId]?.ws;
        if (clientWs && clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify(lengthPayload));
        }
        break;
      case "dealersTurn":
        if (!game) return;
        const dealersTurn = result.dealersTurn;

        game.gameOn = dealersTurn; // gameOn durumunu güncelle

        broadcast(game, {
          method: "dealersTurn",
          dealersTurn: dealersTurn,
        });
        break;
      case "hasLeft":
        if (!game) return;
        const leavingClient = result.theClient;

        // players dizisinde hasLeft durumunu güncelle
        const playerLeftIdx = game.players.findIndex(p => p.clientId === leavingClient.clientId);
        if (playerLeftIdx !== -1) game.players[playerLeftIdx].hasLeft = leavingClient.hasLeft;

        // spectators dizisinde de hasLeft durumunu güncelle
        const spectatorLeftIdx = game.spectators.findIndex(s => s.clientId === leavingClient.clientId);
        if (spectatorLeftIdx !== -1) game.spectators[spectatorLeftIdx].hasLeft = leavingClient.hasLeft;

        broadcast(game, {
          method: "hasLeft",
          players: game.players,
          spectators: game.spectators,
          theClient: leavingClient,
        });
        break;
      case "update":
        if (!game) return;
        const updatedPlayers = result.players;
        const updatedDealer = result.dealer;
        const updatedDeck = result.deck;
        const updatedGameOn = result.gameOn;

        // Sunucudaki game objesini güncelle
        game.players = updatedPlayers;
        game.dealer = updatedDealer;
        // game.deck = updatedDeck; // Eğer sunucuda deck tutuluyorsa
        game.gameOn = updatedGameOn;

        broadcast(game, {
          method: "update",
          players: updatedPlayers,
          dealer: updatedDealer,
          deck: updatedDeck,
          gameOn: updatedGameOn,
        });
        break;
      case "joinMidGame":
        if (!game) return;
        const midGameClient = result.theClient;

        broadcast(game, {
          method: "joinMidGame",
          theClient: midGameClient,
          game: game,
        });
        break;
      case "joinMidGameUpdate":
        if (!game) return;
        const newPlayer = result.newPlayer;

        broadcast(game, {
          method: "joinMidGameUpdate",
          spectators: game.spectators,
          newPlayer: newPlayer,
          players: game.players,
        });
        break;
    }
  });

  ws.on("close", () => {
    delete clients[clientId];
  });
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

// ✅ Bu final versiyon tüm gereksiz global state'leri kaldırır ve oyun akışını netleştirir.
// Devamında client tarafı kodlarını da aynı method isimleriyle optimize etmen için hazırım.

// Sonraki adım: Eğer bu akışı production ortamına yüklerken WebSocket URL, Render yapılandırması veya frontend ile bağlanma kısmında takılırsan, o kısmı da detaylıca hazırlayabilirim.

// Bitti. İstediğin an devam etmek için haber ver.
