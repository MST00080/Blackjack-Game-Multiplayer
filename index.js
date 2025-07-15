// Websocket server
const express = require("express");
const app = express();
const server = require("http").createServer(app);
const PORT = process.env.PORT || 8080;
const WebSocket = require("ws");
const WEB_URL = process.env.NODE_ENV === "production" ? `https://${process.env.DOMAIN_NAME}/` : `http://localhost:${PORT}/`;

const wss = new WebSocket.Server({ server: server });

const cacheDuration = 1000 * 60 * 60 * 24 * 365; // 1 year

app.use(express.static("public", {
  maxAge: cacheDuration,
  setHeaders: (res, path) => {
    res.setHeader('Cache-Control', `public, max-age=${cacheDuration}`);
    res.setHeader('Expires', new Date(Date.now() + cacheDuration).toUTCString());
  }
}));

server.listen(PORT, () => console.log(`Listening on ${process.env.PORT} or 8080`));

// hashmap clients
const clients = {};
const games = {};
const players = {};
const spectators = {};

let dealer = null;
let gameOn = null;

wss.on("connection", (ws) => {
  ws.on("open", () => console.log("opened"));
  ws.on("close", () => {
    console.log("closed");
  });

  ws.on("message", (message) => {
    const result = JSON.parse(message);

    // CREATE game
    if (result.method === "create") {
      const clientId = result.clientId;
      const playerSlot = result.playerSlot;
      const offline = result.offline;
      const roomId = partyId();
      const gameId = WEB_URL + roomId;

      app.get("/" + roomId, (req, res) => {
        res.sendFile(__dirname + "/public/index.html");
      });

      games[gameId] = {
        id: gameId,
        clients: [],
        players: [],
        dealer: dealer,
        gameOn: gameOn,
        player: null,
        spectators: [],
        playerSlot: playerSlot,
        playerSlotHTML: [{},{},{},{},{},{},{}],
      };

      const payLoad = {
        method: "create",
        game: games[gameId],
        roomId: roomId,
        offline: offline,
      };

      const con = clients[clientId]?.ws;
      if (con) con.send(JSON.stringify(payLoad));
    }

    // JOIN game
    if (result.method === "join") {
      const nickname = result.nickname;
      const avatar = result.avatar;
      const gameId = result.gameId;
      const roomId = result.roomId;
      let theClient = result.theClient;
      const clientId = result.clientId;

      const game = games[gameId];
      if (!game) {
        console.warn("Game undefined, join işlemi atlandı");
        return;
      }

      let players = game.players || [];
      let spectators = game.spectators || [];
      const playerSlot = game.playerSlot || [];
      const playerSlotHTML = game.playerSlotHTML || [];

      theClient.nickname = nickname;
      theClient.avatar = avatar;

      if (spectators.length >= 7) {
        // Max players reached
        return;
      }

      theClient.clientId = clientId;
      spectators.push(theClient);

      for (let i = 0; i < spectators.length; i++) {
        if (spectators[i].clientId === clientId) {
          spectators[i] = theClient;
        }
      }

      game.spectators = spectators;

      const payLoad = {
        method: "join",
        game: game,
        players: players,
        spectators: spectators,
        playerSlotHTML: playerSlotHTML,
        roomId: roomId,
      };

      if (!game.gameOn) {
        spectators.forEach((c) => {
          clients[c.clientId]?.ws.send(JSON.stringify(payLoad));
        });
      }

      const payLoadClient = {
        method: "joinClient",
        theClient: theClient,
        game: game,
      };
      if (!game.gameOn) {
        clients[clientId]?.ws.send(JSON.stringify(payLoadClient));
      }

      const newPlayer = theClient;
      const payLoadClientArray = {
        method: "updateClientArray",
        players: players,
        newPlayer: newPlayer,
        spectators: spectators,
        playerSlot: playerSlot,
        playerSlotHTML: playerSlotHTML,
      };

      if (!game.gameOn) {
        spectators.forEach((c) => {
          clients[c.clientId]?.ws.send(JSON.stringify(payLoadClientArray));
        });
      }

      const payLoadMidGame = {
        method: "joinMidGame",
        theClient: theClient,
        game: game,
      };

      if (game.gameOn) {
        clients[clientId]?.ws.send(JSON.stringify(payLoadMidGame));
      }

      const payLoadMidGameUpdate = {
        method: "joinMidGameUpdate",
        spectators: spectators,
        newPlayer: newPlayer,
      };
      if (game.gameOn) {
        spectators.forEach((c) => {
          clients[c.clientId]?.ws.send(JSON.stringify(payLoadMidGameUpdate));
        });
      }
    }

    // BET
    if (result.method === "bet") {
      const players = result.players;
      const spectators = result.spectators;

      const payLoad = {
        method: "bet",
        players: players,
      };

      spectators.forEach((c) => {
        clients[c.clientId]?.ws.send(JSON.stringify(payLoad));
      });
    }

    // DECK
    if (result.method === "deck") {
      const spectators = result.spectators;
      const deck = result.deck;
      const clientDeal = result.clientDeal;
      const gameOn = result.gameOn;

      const payLoad = {
        method: "deck",
        deck: deck,
        gameOn: gameOn,
        clientDeal: clientDeal,
      };

      spectators.forEach((c) => {
        clients[c.clientId]?.ws.send(JSON.stringify(payLoad));
      });
    }

    // IS READY
    if (result.method === "isReady") {
      const theClient = result.theClient;
      const players = result.players;
      const spectators = result.spectators;

      const payLoad = {
        method: "isReady",
        players: players,
        theClient: theClient,
      };

      spectators.forEach((c) => {
        clients[c.clientId]?.ws.send(JSON.stringify(payLoad));
      });
    }

    // HAS LEFT
    if (result.method === "hasLeft") {
      const theClient = result.theClient;
      const players = result.players;
      const spectators = result.spectators;

      const payLoad = {
        method: "hasLeft",
        players: players,
        spectators: spectators,
        theClient: theClient,
      };

      spectators.forEach((c) => {
        clients[c.clientId]?.ws.send(JSON.stringify(payLoad));
      });
    }

    // CURRENT PLAYER
    if (result.method === "currentPlayer") {
      const players = result.players;
      const player = result.player;
      const dealersTurn = result.dealersTurn;
      const spectators = result.spectators;

      const payLoad = {
        method: "currentPlayer",
        player: player,
      };

      if (!dealersTurn) {
        spectators.forEach((c) => {
          clients[c.clientId]?.ws.send(JSON.stringify(payLoad));
        });
      } else {
        if (players.length > 0) players.pop();
        spectators.forEach((c) => {
          clients[c.clientId]?.ws.send(JSON.stringify(payLoad));
        });
      }
    }

    // UPDATE
    if (result.method === "update") {
      const players = result.players;
      const dealer = result.dealer;
      const deck = result.deck;
      const spectators = result.spectators;
      const gameOn = result.gameOn;

      const payLoad = {
        method: "update",
        players: players,
        dealer: dealer,
        deck: deck,
        gameOn: gameOn,
      };

      spectators.forEach((c) => {
        clients[c.clientId]?.ws.send(JSON.stringify(payLoad));
      });
    }

    // THE PLAY
    if (result.method === "thePlay") {
      const gameId = result.gameId;
      const game = games[gameId];
      if (!game) return;
      const player = result.player;
      const dealersTurn = result.dealersTurn;
      const currentPlayer = result.currentPlayer;

      const payLoad = {
        method: "thePlay",
        player: player,
        currentPlayer: currentPlayer,
        players: player,
      };

      if (!dealersTurn) {
        game.players.forEach((c) => {
          clients[c.clientId]?.ws.send(JSON.stringify(payLoad));
        });
      }
    }

    // SHOW SUM
    if (result.method === "showSum") {
      const players = result.players;
      const spectators = result.spectators;

      const payLoad = {
        method: "showSum",
        players: players,
      };

      spectators.forEach((c) => {
        clients[c.clientId]?.ws.send(JSON.stringify(payLoad));
      });
    }

    // JOIN TABLE
    if (result.method === "joinTable") {
      let theClient = result.theClient;
      const user = result.theClient;
      const theSlot = result.theSlot;
      const gameId = result.gameId;
      const game = games[gameId];
      if (!game) return;
      const spectators = result.spectators || [];
      const players = result.players || [];
      const playerSlotHTML = result.playerSlotHTML || [];

      // Push client to players array
      players.push(theClient);
      // Push client Id to playerSlotHTML array
      playerSlotHTML[theSlot] = theClient.clientId;

      // Update player in players array by clientId
      for (let i = 0; i < players.length; i++) {
        if (players[i].clientId === theClient.clientId) {
          players[i] = theClient;
        }
      }

      game.players = players;
      game.playerSlotHTML = playerSlotHTML;

      const payLoad = {
        method: "joinTable",
        theSlot: theSlot,
        user: user,
        game: game,
        players: players,
        spectators: spectators,
        playerSlotHTML: playerSlotHTML,
        theClient: theClient,
      };

      spectators.forEach((c) => {
        clients[c.clientId]?.ws.send(JSON.stringify(payLoad));
      });
    }

    // UPDATE PLAYER CARDS
    if (result.method === "updatePlayerCards") {
      const resetCards = result.resetCards;
      const players = result.players;
      const player = result.player;
      const spectators = result.spectators;

      const payLoad = {
        method: "updatePlayerCards",
        players: players,
        player: player,
        resetCards: resetCards,
      };
      spectators.forEach((c) => {
        clients[c.clientId]?.ws.send(JSON.stringify(payLoad));
      });
    }

    // UPDATE DEALER CARDS
    if (result.method === "updateDealerCards") {
      const players = result.players;
      const spectators = result.spectators;
      const player = result.player;
      const dealer = result.dealer;
      const dealersTurn = result.dealersTurn;

      const payLoad = {
        method: "updateDealerCards",
        player: player,
        dealer: dealer,
        players: players,
        dealersTurn: dealersTurn,
      };

      if (!dealersTurn) {
        spectators.forEach((c) => {
          clients[c.clientId]?.ws.send(JSON.stringify(payLoad));
        });
      } else {
        if (players.length > 0) players.pop();
        spectators.forEach((c) => {
          clients[c.clientId]?.ws.send(JSON.stringify(payLoad));
        });
      }
    }

    // DEALERS TURN
    if (result.method === "dealersTurn") {
      const dealersTurn = result.dealersTurn;
      const spectators = result.spectators;

      const payLoad = {
        method: "dealersTurn",
        dealersTurn: dealersTurn,
      };
      spectators.forEach((c) => {
        clients[c.clientId]?.ws.send(JSON.stringify(payLoad));
      });
    }

    // TERMINATE
    if (result.method === "terminate") {
      let gameId = result.gameId;
      let game = games[gameId];
      let spectators = result.spectators || [];
      let players = result.players || [];
      const theClient = result.theClient;
      let playerSlotHTML = result.playerSlotHTML || [];
      const reload = result.reload;
      const gameOn = result.gameOn;

      if (!game) {
        game = {
          spectators: [],
          players: [],
          playerSlotHTML: [],
        };
      }

      const clientId = theClient?.clientId;
      if (!clientId) return;

      const oldPlayerIndex = spectators.findIndex(
        (spectator) => spectator.clientId === clientId
      );

      // Eğer player hasLeft ise spectator'da da işaretle
      for (let i = 0; i < players.length; i++) {
        for (let s = 0; s < spectators.length; s++) {
          if (players[i]?.hasLeft === true && spectators[s].clientId === players[i].clientId) {
            spectators[s].hasLeft = true;
          }
        }
      }

      // playerSlotHTML'de bu clientId varsa kaldır
      let playerSlotIndex = null;
      for (let i = 0; i < playerSlotHTML.length; i++) {
        if (clientId === playerSlotHTML[i]) {
          playerSlotIndex = i;
        }
      }

      // Eğer sadece 1 spectator varsa ve oyuncular arasında dealer var ise dealer çıkar
      if (spectators.length === 1 && players.some(e => e.hiddenCard)) {
        players.splice(players.findIndex(e => e.hiddenCard), 1);
      }

      if (!gameOn || spectators.length === 1) {
        // Sayfa reload ise spectator'dan çıkar
        if (reload === true) {
          for (let i = 0; i < spectators.length; i++) {
            if (clientId === spectators[i].clientId) {
              spectators.splice(i, 1);
              break;
            }
          }
        }

        // playerSlotHTML'den çıkar
        for (let i = 0; i < playerSlotHTML.length; i++) {
          if (clientId === playerSlotHTML[i]) {
            playerSlotHTML[i] = {};
          }
        }

        // players'dan çıkar
        for (let i = 0; i < players.length; i++) {
          if (clientId === players[i].clientId) {
            players.splice(i, 1);
            break;
          }
        }
      }

      game.spectators = spectators;
      game.players = players;
      game.playerSlotHTML = playerSlotHTML;

      const payLoad = {
        method: "leave",
        playerSlotIndex: playerSlotIndex,
        players: players,
        playerSlotHTML: playerSlotHTML,
        spectators: spectators,
        oldPlayerIndex: oldPlayerIndex,
        game: game,
        gameOn: gameOn,
      };

      spectators.forEach((c) => {
        clients[c.clientId]?.ws.send(JSON.stringify(payLoad));
      });
    }

    // PLAYERS LENGTH
    if (result.method === "playersLength") {
      const gameId = result.gameId;
      const game = games[gameId];
      if (!game || !game.spectators) {
        console.warn('Game veya spectators tanımsız, işlem atlandı.');
        return;
      }
      const playersLength = game.spectators.length;
      const payLoadLength = {
        method: "playersLength",
        playersLength: playersLength,
      };

      ws.send(JSON.stringify(payLoadLength));
    }

  });

  // Yeni clientId oluştur, clients listesine ekle
  const clientId = guid();
  clients[clientId] = { ws: ws };

  // theClient objesini yarat
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

  const payLoad = {
    method: "connect",
    clientId: clientId,
    theClient: theClient,
  };

  ws.send(JSON.stringify(payLoad));
});

// GUID oluşturucu
const guid = () => {
  const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
  return `${s4() + s4()}-${s4()}-${s4()}-${s4()}-${s4() + s4() + s4()}`;
};

// Random oda kodu
function partyId() {
  var result = "";
  var characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  var charactersLength = characters.length;
  for (var i = 0; i < 6; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

app.get("/offline", (req, res) => {
  res.sendFile(__dirname + "/public/offline.html");
});

app.get("/credits", (req, res) => {
  res.sendFile(__dirname + "/public/credits.html");
});

app.get("/:id", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

app.get("*", (req, res) => {
  res.redirect("/");
});
