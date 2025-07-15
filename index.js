// Websocket server
const express = require("express");
const app = express();
const server = require("http").createServer(app);
const PORT = process.env.PORT || 8080;
const WebSocket = require("ws");
// PRODUCTION ortamında DOMAIN_NAME'in ayarlandığından emin ol.
// Aksi takdirde localhost'u kullanır. Render genellikle PORT'u otomatik ayarlar.
const WEB_URL = process.env.NODE_ENV === "production" ? `https://${process.env.DOMAIN_NAME || 'YOUR_RENDER_DOMAIN_HERE'}/` : `http://localhost:${PORT}/`;

const wss = new WebSocket.Server({ server: server });

const cacheDuration = 1000 * 60 * 60 * 24 * 365; // 1 year

app.use(express.static("public", {
  maxAge: cacheDuration,
  setHeaders: (res, path) => {
    res.setHeader('Cache-Control', `public, max-age=${cacheDuration}`);
    res.setHeader('Expires', new Date(Date.now() + cacheDuration).toUTCString());
  }
}));

server.listen(PORT, () => console.log(`Listening on ${PORT}`));

// hashmap clients: Bağlı olan tüm WebSocket istemcilerini ve onların verilerini tutar.
const clients = {};
// games: Oluşturulmuş oyunların durumlarını tutar. Key'i gameId'dir.
const games = {};

// Bu global değişkenler önceki versiyonda vardı ve kaldırılmalı/kullanılmamalıdır.
// Çünkü oyun durumu 'games' objesi içinde her oyuna özel olarak tutulmalı.
// const players = {};
// const spectators = {};
// let dealer = null;
// let gameOn = null;

wss.on("connection", (ws) => {
  // Yeni clientId oluştur ve clients listesine ekle
  const clientId = guid();
  clients[clientId] = {
    ws: ws,
    // theClient objesinin başlangıç değerleri burada saklanmalı.
    // Client tarafından gelen nickname ve avatar ile güncellenecek.
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
    clientId: clientId, // Her client objesinin kendi clientId'ı olsun
  };

  const payLoadConnect = {
    method: "connect",
    clientId: clientId,
    theClient: clients[clientId], // clients[clientId] içindeki theClient objesini gönder
  };

  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payLoadConnect));
  }

  ws.on("open", () => console.log("WebSocket opened"));
  ws.on("close", () => {
    console.log(`Client ${clientId} disconnected`);
    // Bağlantı kapandığında client'ı ve ilgili oyunlardan çıkarmayı yönet.
    // Bu mantık 'terminate' metodunda zaten ele alınmış gibi görünüyor.
    // Burada doğrudan `delete clients[clientId];` yapmak yerine, `terminate` metodunun
    // istemci tarafında veya burada tetiklendiğinden emin olmalısın.
    // Örneğin, otomatik olarak terminate mesajı gönderebilirsin.
    // disconnect durumunda temizlik için buraya ekleyelim:
    if (clients[clientId]) {
        // İlgili client'ın oynadığı veya izlediği oyunları bulup güncelle
        for (const gameId in games) {
            const game = games[gameId];
            if (!game) continue; // Oyun objesi yoksa atla

            // Spectator'dan çıkar
            const spectatorIndex = game.spectators.findIndex(s => s.clientId === clientId);
            if (spectatorIndex !== -1) {
                game.spectators.splice(spectatorIndex, 1);
                console.log(`Client ${clientId} removed from spectators in game ${gameId}`);
            }

            // Player'dan çıkar
            const playerIndex = game.players.findIndex(p => p.clientId === clientId);
            if (playerIndex !== -1) {
                game.players.splice(playerIndex, 1);
                console.log(`Client ${clientId} removed from players in game ${gameId}`);
                // Player slot HTML'den de çıkar
                for (let i = 0; i < game.playerSlotHTML.length; i++) {
                    if (game.playerSlotHTML[i] === clientId) {
                        game.playerSlotHTML[i] = {}; // veya null yap
                        console.log(`Client ${clientId} removed from playerSlotHTML in game ${gameId}`);
                        break;
                    }
                }
            }

            // Eğer oyunda hiç oyuncu veya izleyici kalmazsa oyunu sil.
            if (game.players.length === 0 && game.spectators.length === 0) {
                delete games[gameId];
                console.log(`Game ${gameId} deleted due to no remaining players/spectators.`);
            } else {
                // Kalan herkese güncelleme gönder
                const payLoadLeaveUpdate = {
                    method: "leave",
                    players: game.players,
                    spectators: game.spectators,
                    playerSlotHTML: game.playerSlotHTML,
                    game: game,
                    gameOn: game.gameOn,
                };
                Object.values(clients).forEach((clientObj) => {
                    if (clientObj.ws && clientObj.ws.readyState === WebSocket.OPEN) {
                        clientObj.ws.send(JSON.stringify(payLoadLeaveUpdate));
                    }
                });
            }
        }
        delete clients[clientId]; // Ana clients hashmap'ten sil
    }
  });

  ws.on("message", (message) => {
    const result = JSON.parse(message);
    console.log(`Received message from ${clientId}:`, result.method, result.gameId || '');

    // CREATE game
    if (result.method === "create") {
      const clientId = result.clientId; // result.clientId zaten bağlantıda belirlenen clientId ile aynı olmalı
      const playerSlot = result.playerSlot; // Bu tek bir değer gibi duruyor, playerSlotHTML ile çakışabilir mi?
      const offline = result.offline;
      const roomId = partyId();
      const gameId = WEB_URL + roomId;

      // Yeni oyun oluşturulurken 'game' nesnesinin tüm gerekli özelliklerini başlat.
      if (games[gameId]) {
          console.warn(`Game with ID ${gameId} already exists, not re-creating.`);
          // İstemciye zaten var olan bir oyun olduğunu bildirmek isteyebilirsin.
          clients[clientId]?.ws.send(JSON.stringify({ method: "error", message: "Bu oyun ID'si zaten mevcut." }));
          return;
      }

      games[gameId] = {
        id: gameId,
        players: [],
        dealer: null,
        gameOn: false,
        player: null, // Bu özellik muhtemelen aktif oyuncu için
        spectators: [],
        playerSlot: playerSlot, // Bu özellik muhtemelen genel ayar
        playerSlotHTML: [{}, {}, {}, {}, {}, {}, {}], // 7 boş slot
      };

      const payLoad = {
        method: "create",
        game: games[gameId],
        roomId: roomId,
        offline: offline,
      };

      const con = clients[clientId]?.ws;
      if (con && con.readyState === WebSocket.OPEN) con.send(JSON.stringify(payLoad));
      console.log(`Game created with ID: ${gameId}`);
    }

    // JOIN game
    if (result.method === "join") {
      const nickname = result.nickname;
      const avatar = result.avatar;
      const gameId = result.gameId; // İstemciden gelen gameId

      const game = games[gameId];
      if (!game) {
        console.warn(`Game undefined, join işlemi atlandı. Game ID: ${gameId}`);
        // İstemciye oyunun bulunamadığına dair bir mesaj göndermek iyi bir fikir olabilir.
        const con = clients[clientId]?.ws;
        if (con && con.readyState === WebSocket.OPEN) {
            con.send(JSON.stringify({ method: "error", message: "Oyun bulunamadı veya sunucu yeniden başlatıldı." }));
        }
        return;
      }

      // 'theClient' objesini clients[clientId] üzerinden al ve güncelle
      let theClient = clients[clientId];
      if (!theClient) {
          console.error("Join sırasında clientId bulunamadı:", clientId);
          return; // Bu durum olmamalıydı
      }
      theClient.nickname = nickname;
      theClient.avatar = avatar;

      // Oyunun mevcut durumunu al
      let players = game.players;
      let spectators = game.spectators;
      let playerSlotHTML = game.playerSlotHTML;

      // Spectator listesine ekle veya güncelle
      const existingSpectatorIndex = spectators.findIndex(s => s.clientId === clientId);
      if (existingSpectatorIndex === -1) {
          spectators.push(theClient); // Yeni spectator
          console.log(`Client ${clientId} added as new spectator to game ${gameId}`);
      } else {
          spectators[existingSpectatorIndex] = theClient; // Mevcut spectator'ı güncelle
          console.log(`Client ${clientId} updated as existing spectator in game ${gameId}`);
      }

      // Maksimum spectator sayısını kontrol et (oyuncu + izleyici toplamı olabilir)
      // Bu mantık oyundaki toplam kişi sayısına göre değişir.
      // Eğer spectatorlar da masada yer alıyorsa bu kontrol önemlidir.
      if (spectators.length >= 7) { // Bu eşik değeri oyunun kurallarına göre değişmeli
        const con = clients[clientId]?.ws;
        if (con && con.readyState === WebSocket.OPEN) {
            con.send(JSON.stringify({ method: "error", message: "Maksimum oyuncu/izleyici sayısına ulaşıldı." }));
        }
        // Spectator olarak eklenmişse geri al
        const currentSpectatorIndex = spectators.findIndex(s => s.clientId === clientId);
        if (currentSpectatorIndex !== -1) {
            spectators.splice(currentSpectatorIndex, 1);
        }
        return;
      }

      const payLoad = {
        method: "join",
        game: game,
        players: players,
        spectators: spectators,
        playerSlotHTML: playerSlotHTML,
        roomId: game.id.split('/').pop(), // gameId'den oda ID'sini al
      };

      // Eğer oyun başlamamışsa (game.gameOn === false) tüm izleyicilere ve oyunculara güncelleme gönder.
      if (!game.gameOn) {
        spectators.forEach((c) => {
          if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
            clients[c.clientId].ws.send(JSON.stringify(payLoad));
          }
        });
        players.forEach((c) => { // Oyunculara da gönder
            if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
                clients[c.clientId].ws.send(JSON.stringify(payLoad));
            }
        });
      }

      const payLoadClient = {
        method: "joinClient",
        theClient: theClient,
        game: game,
      };
      if (!game.gameOn) {
        const con = clients[clientId]?.ws;
        if (con && con.readyState === WebSocket.OPEN) {
            con.send(JSON.stringify(payLoadClient));
        }
      }

      const newPlayer = theClient; // newPlayer aslında theClient
      const payLoadClientArray = {
        method: "updateClientArray",
        players: players,
        newPlayer: newPlayer, // newPlayer olarak eklenen (veya güncellenen) client'ı gönder
        spectators: spectators,
        playerSlot: game.playerSlot,
        playerSlotHTML: playerSlotHTML,
      };

      if (!game.gameOn) {
        // Tüm izleyicilere ve oyunculara gönder
        spectators.forEach((c) => {
          if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
            clients[c.clientId].ws.send(JSON.stringify(payLoadClientArray));
          }
        });
        players.forEach((c) => {
            if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
                clients[c.clientId].ws.send(JSON.stringify(payLoadClientArray));
            }
        });
      }

      // Eğer oyun zaten devam ediyorsa, yeni katılan istemciye mevcut oyun durumunu gönder
      const payLoadMidGame = {
        method: "joinMidGame",
        theClient: theClient,
        game: game,
      };

      if (game.gameOn) {
        const con = clients[clientId]?.ws;
        if (con && con.readyState === WebSocket.OPEN) {
            con.send(JSON.stringify(payLoadMidGame));
        }
      }

      const payLoadMidGameUpdate = {
        method: "joinMidGameUpdate",
        spectators: spectators,
        newPlayer: newPlayer,
        players: players, // Mid-game update için oyuncu listesini de gönder
      };
      if (game.gameOn) {
        // Tüm izleyicilere ve oyunculara gönder
        spectators.forEach((c) => {
          if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
            clients[c.clientId].ws.send(JSON.stringify(payLoadMidGameUpdate));
          }
        });
        players.forEach((c) => {
            if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
                clients[c.clientId].ws.send(JSON.stringify(payLoadMidGameUpdate));
            }
        });
      }
      console.log(`Client ${clientId} joined game ${gameId}`);
    }

    // BET
    if (result.method === "bet") {
      const gameId = result.gameId;
      const game = games[gameId];
      if (!game) {
        console.warn(`Game undefined for bet, operation skipped. Game ID: ${gameId}`);
        return;
      }

      // Bet yapan oyuncunun bilgilerini game.players içinde güncellemen gerekebilir.
      const playerBet = result.player; // İstemciden gelen güncel oyuncu objesi (bahsi yapılmış)
      const playerToUpdateIndex = game.players.findIndex(p => p.clientId === playerBet.clientId);
      if (playerToUpdateIndex !== -1) {
          game.players[playerToUpdateIndex] = playerBet;
      }

      const payLoad = {
        method: "bet",
        players: game.players, // Güncellenmiş oyuncular listesini gönder
      };

      // Tüm izleyicilere ve oyunculara gönder
      game.spectators.forEach((c) => {
        if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
      game.players.forEach((c) => {
        if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
    }

    // DECK
    if (result.method === "deck") {
      const gameId = result.gameId;
      const game = games[gameId];
      if (!game) {
        console.warn(`Game undefined for deck, operation skipped. Game ID: ${gameId}`);
        return;
      }
      const deck = result.deck; // Deck istemciden gelebilir, ama sunucuda yönetilmesi daha güvenli olabilir.
      const clientDeal = result.clientDeal; // Kimin kart çektiği bilgisi
      const gameOn = result.gameOn; // Oyunun devam edip etmediği bilgisi

      game.gameOn = gameOn; // Sunucu tarafındaki gameOn durumunu güncelle

      const payLoad = {
        method: "deck",
        deck: deck,
        gameOn: game.gameOn,
        clientDeal: clientDeal,
      };

      // Tüm izleyicilere ve oyunculara gönder
      game.spectators.forEach((c) => {
        if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
      game.players.forEach((c) => {
        if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
    }

    // IS READY
    if (result.method === "isReady") {
      const gameId = result.gameId;
      const game = games[gameId];
      if (!game) {
        console.warn(`Game undefined for isReady, operation skipped. Game ID: ${gameId}`);
        return;
      }
      const theClient = result.theClient; // isReady durumunu güncelleyen client

      // theClient'ın isReady durumunu game.players veya game.spectators içinde güncelle
      const clientInPlayers = game.players.find(p => p.clientId === theClient.clientId);
      if (clientInPlayers) {
          clientInPlayers.isReady = theClient.isReady; // result.theClient.isReady'yi kullan
      }
      const clientInSpectators = game.spectators.find(s => s.clientId === theClient.clientId);
      if (clientInSpectators) {
          clientInSpectators.isReady = theClient.isReady; // result.theClient.isReady'yi kullan
      }

      const payLoad = {
        method: "isReady",
        players: game.players, // Güncellenmiş players listesini gönder
        theClient: theClient, // Güncellenmiş theClient'ı gönder
      };

      // Tüm izleyicilere ve oyunculara gönder
      game.spectators.forEach((c) => {
        if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
      game.players.forEach((c) => {
        if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
    }

    // HAS LEFT
    if (result.method === "hasLeft") {
      const gameId = result.gameId;
      const game = games[gameId];
      if (!game) {
        console.warn(`Game undefined for hasLeft, operation skipped. Game ID: ${gameId}`);
        return;
      }
      const theClient = result.theClient;

      // theClient'ın hasLeft durumunu game.players veya game.spectators içinde güncelle
      const clientInPlayers = game.players.find(p => p.clientId === theClient.clientId);
      if (clientInPlayers) {
          clientInPlayers.hasLeft = theClient.hasLeft; // result.theClient.hasLeft'i kullan
      }
      const clientInSpectators = game.spectators.find(s => s.clientId === theClient.clientId);
      if (clientInSpectators) {
          clientInSpectators.hasLeft = theClient.hasLeft; // result.theClient.hasLeft'i kullan
      }

      const payLoad = {
        method: "hasLeft",
        players: game.players,
        spectators: game.spectators,
        theClient: theClient,
      };

      // Tüm izleyicilere ve oyunculara gönder
      game.spectators.forEach((c) => {
        if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
      game.players.forEach((c) => {
        if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
    }

    // CURRENT PLAYER
    if (result.method === "currentPlayer") {
      const gameId = result.gameId;
      const game = games[gameId];
      if (!game) {
        console.warn(`Game undefined for currentPlayer, operation skipped. Game ID: ${gameId}`);
        return;
      }
      const player = result.player; // Sırası gelen oyuncu
      const dealersTurn = result.dealersTurn;

      // Sırası gelen oyuncu bilgilerini güncelle (eğer gerekiyorsa)
      const currentPlayerInPlayers = game.players.find(p => p.clientId === player.clientId);
      if (currentPlayerInPlayers) {
          Object.assign(currentPlayerInPlayers, player); // Oyuncunun güncel durumunu kopyala
      }


      const payLoad = {
        method: "currentPlayer",
        player: player, // Sırası gelen oyuncu
        players: game.players, // Güncel tüm oyuncu listesi
      };

      // Tüm izleyicilere ve oyunculara gönder
      game.spectators.forEach((c) => {
        if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
      game.players.forEach((c) => {
        if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
      // Dealer'ın sırası ise özel işlem yapılması gerekiyorsa buraya eklenecek.
      // `players.pop()` mantığı yanlıştır, oyuncu listesinden eleman çıkarmamalıdır.
    }

    // UPDATE
    if (result.method === "update") {
      const gameId = result.gameId;
      const game = games[gameId];
      if (!game) {
        console.warn(`Game undefined for update, operation skipped. Game ID: ${gameId}`);
        return;
      }
      const playersResult = result.players; // İstemciden gelen oyuncu listesi (güncel durum)
      const dealerResult = result.dealer; // İstemciden gelen dealer bilgisi
      const deckResult = result.deck; // İstemciden gelen deck bilgisi
      const gameOnResult = result.gameOn; // İstemciden gelen gameOn durumu

      // Sunucu tarafındaki oyun durumunu güncelle
      game.players = playersResult;
      game.dealer = dealerResult;
      // game.deck = deckResult; // Eğer deck sunucuda tutuluyorsa
      game.gameOn = gameOnResult;


      const payLoad = {
        method: "update",
        players: game.players,
        dealer: game.dealer,
        deck: deckResult, // İstemciden gelen deck'i kullan
        gameOn: game.gameOn,
      };

      // Tüm izleyicilere ve oyunculara gönder
      game.spectators.forEach((c) => {
        if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
      game.players.forEach((c) => {
        if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
    }

    // THE PLAY
    if (result.method === "thePlay") {
      const gameId = result.gameId;
      const game = games[gameId];
      if (!game || !game.players) {
          console.warn(`Game or game.players undefined for thePlay, operation skipped. Game ID: ${gameId}`);
          return;
      }
      const player = result.player; // Kart çekme/kalma işlemi yapan oyuncu
      const dealersTurn = result.dealersTurn; // Dealer'ın sırası mı?
      const currentPlayer = result.currentPlayer; // Şu anki oyuncu (muhtemelen result.player ile aynı)

      // Oyuncunun durumunu güncelle
      const playerToUpdateIndex = game.players.findIndex(p => p.clientId === player.clientId);
      if (playerToUpdateIndex !== -1) {
          Object.assign(game.players[playerToUpdateIndex], player); // Güncel oyuncu verilerini kopyala
      }

      const payLoad = {
        method: "thePlay",
        player: player,
        currentPlayer: currentPlayer,
        players: game.players, // Güncellenmiş oyuncu listesi
      };

      // Tüm izleyicilere ve oyunculara gönder
      game.spectators.forEach((c) => {
        if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
      game.players.forEach((c) => {
        if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
      // Dealer'ın sırasıysa ne olacağı istemci tarafından yönetiliyorsa tamam, aksi halde buraya eklenmeli.
    }

    // SHOW SUM
    if (result.method === "showSum") {
      const gameId = result.gameId;
      const game = games[gameId];
      if (!game) {
        console.warn(`Game undefined for showSum, operation skipped. Game ID: ${gameId}`);
        return;
      }
      const playersResult = result.players; // İstemciden gelen güncel oyuncu listesi (sum'lar hesaplanmış)

      // Sunucu tarafındaki oyuncu listesini güncelle
      game.players = playersResult;

      const payLoad = {
        method: "showSum",
        players: game.players, // Güncellenmiş oyuncu listesini gönder
      };

      // Tüm izleyicilere ve oyunculara gönder
      game.spectators.forEach((c) => {
        if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
      game.players.forEach((c) => {
        if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
    }

    // JOIN TABLE
    if (result.method === "joinTable") {
      const gameId = result.gameId;
      const game = games[gameId];
      if (!game) {
          console.warn(`Game undefined for joinTable, operation skipped. Game ID: ${gameId}`);
          const con = clients[clientId]?.ws;
          if (con && con.readyState === WebSocket.OPEN) {
            con.send(JSON.stringify({ method: "error", message: "Oyun bulunamadı veya sunucu yeniden başlatıldı." }));
          }
          return;
      }

      const theClient = clients[clientId]; // clients[clientId] üzerinden al
      if (!theClient) {
          console.error("joinTable sırasında theClient.clientId bulunamadı:", clientId);
          return;
      }

      const user = result.theClient; // Client'tan gelen user bilgisi (nickname, avatar vb.)
      const theSlot = result.theSlot; // Oturulan slot numarası

      // Client'tan gelen user bilgilerini sunucudaki theClient objesine kopyala
      Object.assign(theClient, user);


      // 'game' nesnesinin 'spectators', 'players', 'playerSlotHTML' özelliklerinin varlığını kontrol et ve gerekirse başlat.
      if (!game.spectators) game.spectators = [];
      if (!game.players) game.players = [];
      if (!game.playerSlotHTML) game.playerSlotHTML = [{}, {}, {}, {}, {}, {}, {}];

      // Spectator listesinden çıkar, eğer oyuncu masaya oturuyorsa
      const spectatorIndex = game.spectators.findIndex(s => s.clientId === theClient.clientId);
      if (spectatorIndex !== -1) {
          game.spectators.splice(spectatorIndex, 1);
          console.log(`Client ${theClient.clientId} removed from spectators in game ${gameId}`);
      }

      // Oyuncu zaten players içinde mi?
      const existingPlayerIndex = game.players.findIndex(p => p.clientId === theClient.clientId);
      if (existingPlayerIndex === -1) {
          game.players.push(theClient); // Yeni oyuncu
          console.log(`Client ${theClient.clientId} added as new player to game ${gameId}`);
      } else {
          game.players[existingPlayerIndex] = theClient; // Mevcut oyuncuyu güncelle
          console.log(`Client ${theClient.clientId} updated as existing player in game ${gameId}`);
      }

      // PlayerSlotHTML'i güncelle
      if (theSlot >= 0 && theSlot < game.playerSlotHTML.length) {
          game.playerSlotHTML[theSlot] = theClient.clientId;
          console.log(`Client ${theClient.clientId} assigned to slot ${theSlot} in game ${gameId}`);
      } else {
          console.warn(`Invalid slot number ${theSlot} for client ${theClient.clientId} in game ${gameId}`);
      }


      const payLoad = {
        method: "joinTable",
        theSlot: theSlot,
        user: theClient, // Güncel theClient objesi
        game: game, // Güncel game objesi
        players: game.players,
        spectators: game.spectators,
        playerSlotHTML: game.playerSlotHTML,
        theClient: theClient,
      };

      // Tüm ilgili client'lara gönder (hem oyunculara hem de izleyicilere).
      [...game.players, ...game.spectators].forEach((c) => {
          if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
              clients[c.clientId].ws.send(JSON.stringify(payLoad));
          }
      });
    }

    // UPDATE PLAYER CARDS
    if (result.method === "updatePlayerCards") {
      const gameId = result.gameId;
      const game = games[gameId];
      if (!game) {
        console.warn(`Game undefined for updatePlayerCards, operation skipped. Game ID: ${gameId}`);
        return;
      }
      const resetCards = result.resetCards;
      const player = result.player; // Güncellenen oyuncunun kendisi (kartları güncellenmiş)

      // player objesini game.players dizisi içinde güncelle
      const playerToUpdateIndex = game.players.findIndex(p => p.clientId === player.clientId);
      if (playerToUpdateIndex !== -1) {
          Object.assign(game.players[playerToUpdateIndex], player); // Güncel oyuncu verilerini kopyala
      }

      const payLoad = {
        method: "updatePlayerCards",
        players: game.players, // Güncellenmiş oyuncular listesi
        player: player, // Tekil güncellenen oyuncu
        resetCards: resetCards,
      };

      // Tüm izleyicilere ve oyunculara gönder
      game.spectators.forEach((c) => {
        if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
      game.players.forEach((c) => {
        if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
    }

    // UPDATE DEALER CARDS
    if (result.method === "updateDealerCards") {
      const gameId = result.gameId;
      const game = games[gameId];
      if (!game) {
        console.warn(`Game undefined for updateDealerCards, operation skipped. Game ID: ${gameId}`);
        return;
      }
      const player = result.player; // Bu muhtemelen dealer değil, mevcut oyuncu (dealer'ın sırasına geçtiyse bile)
      const dealer = result.dealer; // Dealer objesi istemciden geliyor.

      // Dealer objesini game.dealer'a kaydet
      game.dealer = dealer;

      const payLoad = {
        method: "updateDealerCards",
        player: player, // İstemciden gelen player (muhtemelen boş veya gereksiz)
        dealer: game.dealer, // Güncel dealer objesi
        players: game.players, // Güncel oyuncu listesi (dealer'ın elini etkileyecekse)
      };

      // Tüm izleyicilere ve oyunculara gönder
      game.spectators.forEach((c) => {
        if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
      game.players.forEach((c) => {
        if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
      // `players.pop()` mantığı yanlıştır, oyuncu listesinden eleman çıkarmamalıdır.
    }

    // DEALERS TURN
    if (result.method === "dealersTurn") {
      const gameId = result.gameId;
      const game = games[gameId];
      if (!game) {
        console.warn(`Game undefined for dealersTurn, operation skipped. Game ID: ${gameId}`);
        return;
      }
      const dealersTurn = result.dealersTurn;

      game.gameOn = dealersTurn; // gameOn durumunu güncelle (dealersTurn true ise oyun devam ediyor demektir)

      const payLoad = {
        method: "dealersTurn",
        dealersTurn: game.gameOn,
      };
      // Tüm izleyicilere ve oyunculara gönder
      game.spectators.forEach((c) => {
        if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
      game.players.forEach((c) => {
        if (clients[c.clientId]?.ws && clients[c.clientId].ws.readyState === WebSocket.OPEN) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
    }

    // TERMINATE (Oyun veya bağlantı sonlandığında)
    // Bu metod genellikle istemciden bir ayrılma veya oyun bitiş sinyali geldiğinde tetiklenir.
    if (result.method === "terminate") {
      let gameId = result.gameId;
      let game = games[gameId];
      // Eğer oyun bulunamazsa veya game'in gerekli özellikleri yoksa hata vermemek için başlat
      if (!game) {
        console.warn(`Terminate sırasında oyun bulunamadı veya game nesnesi eksik. Game ID: ${gameId}.`);
        return; // Oyun yoksa işleme devam etmeye gerek yok
      }

      const theClient = clients[clientId]; // Doğrudan sunucudaki client objesini kullan
      if (!theClient) {
          console.warn(`Terminate metodu için clientId ${clientId} bulunamadı.`);
          return;
      }
      const reload = result.reload; // reload bilgisini istemciden al.

      // client'ı spectators ve players listelerinden çıkar
      const oldSpectatorIndex = game.spectators.findIndex(s => s.clientId === clientId);
      if (oldSpectatorIndex !== -1) {
          game.spectators.splice(oldSpectatorIndex, 1);
          console.log(`Client ${clientId} spectators listesinden çıkarıldı.`);
      }

      const oldPlayerIndex = game.players.findIndex(p => p.clientId === clientId);
      if (oldPlayerIndex !== -1) {
          game.players.splice(oldPlayerIndex, 1);
          console.log(`Client ${clientId} players listesinden çıkarıldı.`);

          // Player slot HTML'den de çıkar
          for (let i = 0; i < game.playerSlotHTML.length; i++) {
            if (game.playerSlotHTML[i] === clientId) {
              game.playerSlotHTML[i] = {};
              console.log(`Client ${clientId} playerSlotHTML'den çıkarıldı.`);
              break;
            }
          }
      }

      // Eğer oyunda hiç oyuncu veya izleyici kalmazsa oyunu sil.
      if (game.players.length === 0 && game.spectators.length === 0) {
          delete games[gameId];
          console.log(`Oyun ${gameId} silindi, çünkü kimse kalmadı.`);
      }

      // Kalan herkese güncelleme gönder
      const payLoad = {
        method: "leave",
        players: game.players,
        playerSlotHTML: game.playerSlotHTML,
        spectators: game.spectators,
        game: game,
        gameOn: game.gameOn,
        leavingClientId: clientId, // Ayrılan client'ın ID'sini de gönder
      };

      // Kalan tüm izleyicilere ve oyunculara güncelleme gönder.
      // Silinen client'a göndermeyeceğiz.
      // Mevcut client'ları iterate ederken kontrol et.
      Object.values(clients).forEach((clientObj) => {
          if (clientObj.ws && clientObj.ws.readyState === WebSocket.OPEN) {
              clientObj.ws.send(JSON.stringify(payLoad));
          }
      });
    }

    // PLAYERS LENGTH
    // Bu method, genellikle aktif oyuncu sayısını istemciye bildirmek için kullanılır.
    // 'spectators.length' yerine 'players.length' kullanmak daha doğru olabilir
    // eğer sadece masadaki oyuncuları kastediyorsan.
 // PLAYERS LENGTH
   // PLAYERS LENGTH
    // Bu method, genellikle aktif oyuncu sayısını istemciye bildirmek için kullanılır.
    if (result.method === "playersLength") {
      const gameId = result.gameId;
      const game = games[gameId];

      // Eğer 'game' objesi tanımsızsa, işlemi atla ve hata logu yaz
      if (!game) {
        console.log(`Game veya oyuncular/izleyiciler tanımsız, playersLength işlemi atlandı. Game ID: ${gameId}`);
        return; // 'game' tanımsızsa işlemi durdur
      }

      // Masadaki aktif oyuncu sayısını almak için 'game.players.length' kullanıldı.
      // Eğer hem oyuncular hem de izleyiciler dahil tüm bağlantıların sayısını istiyorsan
      // 'game.clients.length' veya 'game.spectators.length' kullanabilirsin.
      const playersLength = game.players.length; 

      const payLoadLength = {
        method: "playersLength",
        playersLength: playersLength,
        gameId: gameId, // Hangi oyunun uzunluğu olduğunu belirtmek için eklendi
      };

      ws.send(JSON.stringify(payLoadLength));
    }

// GUID oluşturucu (Globally Unique Identifier)
const guid = () => {
  const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
  return `${s4() + s4()}-${s4()}-${s4()}-${s4()}-${s4() + s4() + s4()}`;
};

// Random oda kodu oluşturucu (6 karakter)
function partyId() {
  var result = "";
  var characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  var charactersLength = characters.length;
  for (var i = 0; i < 6; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

// Statik dosyalar için route'lar
app.get("/offline", (req, res) => {
  res.sendFile(__dirname + "/public/offline.html");
});

app.get("/credits", (req, res) => {
  res.sendFile(__dirname + "/public/credits.html");
});

// Dinamik oda ID'leri için wildcard route
app.get("/:id", (req, res) => {
  // Eğer id bir HTML dosyası veya özel bir route değilse, index.html gönder
  // 'id' değerini kontrol ederek belirli odalara yönlendirme yapabilirsin.
  // Örneğin, `games[WEB_URL + req.params.id]` kontrolü yapabilirsin.
  // Şimdilik sadece index.html göndermeye devam edelim.
  res.sendFile(__dirname + "/public/index.html");
});

// Herhangi bir eşleşmeyen istek için ana sayfaya yönlendirme
app.get("*", (req, res) => {
  res.redirect("/");
});
