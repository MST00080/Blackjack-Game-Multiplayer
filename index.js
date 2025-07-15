// Websocket server
const express = require("express");
const app = express();
const server = require("http").createServer(app);
const PORT = process.env.PORT || 8080;
const WebSocket = require("ws");
// PRODUCTION ortamında DOMAIN_NAME'in ayarlandığından emin ol.
// Aksi takdirde localhost'u kullanır.
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

server.listen(PORT, () => console.log(`Listening on ${process.env.PORT || 8080}`)); // PORT'un tanımlı olmaması durumunda 8080 kullan

// hashmap clients
const clients = {};
const games = {};
// Bu global değişkenler (players, spectators) kullanılmıyor veya yanlış kullanılıyor.
// Oyun durumları 'games' nesnesi içinde tutulmalı.
// const players = {};
// const spectators = {};

// Bu global değişkenler sadece tek bir oyun için geçerliyse sorun yaratabilir.
// Her oyunun kendi dealer ve gameOn durumuna sahip olması daha iyi.
// let dealer = null;
// let gameOn = null;

wss.on("connection", (ws) => {
  ws.on("open", () => console.log("opened"));
  ws.on("close", () => {
    console.log("closed");
    // Bağlantı kapanınca client'ı ve ilgili oyunlardan çıkarmayı düşünebilirsin.
    // Ancak bu, `terminate` methodu ile de yönetilebilir.
    // Şimdilik hata veren kısımlara odaklanalım.
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

      // Her oda için ayrı bir route oluşturmak, uygulamanın dinamik çalışmasına engel olabilir.
      // Zaten wildcard route (`app.get("/:id", ...)` ) ile hallediliyor.
      // Bu kısım muhtemelen gereksiz.
      // app.get("/" + roomId, (req, res) => {
      //   res.sendFile(__dirname + "/public/index.html");
      // });

      // Yeni oyun oluşturulurken 'game' nesnesinin tüm gerekli özelliklerini başlat.
      games[gameId] = {
        id: gameId,
        clients: [], // Bu da muhtemelen kullanılmıyor, clients hashmap'i var.
        players: [],
        dealer: null, // Her oyunun kendi dealer'ı olmalı
        gameOn: false, // Her oyunun kendi gameOn durumu olmalı
        player: null, // Bu özellik muhtemelen aktif oyuncu için, dikkatli kullan.
        spectators: [],
        playerSlot: playerSlot, // Bu tek bir değer gibi duruyor, playerSlotHTML ile çakışabilir mi?
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
      let theClient = result.theClient; // theClient zaten ws.on('connection') içinde oluşturuluyor. Burada tekrar alınıyor.
      const clientId = result.clientId;

      const game = games[gameId];
      if (!game) {
        console.warn("Game undefined, join işlemi atlandı. Game ID:", gameId);
        // İstemciye oyunun bulunamadığına dair bir mesaj göndermek iyi bir fikir olabilir.
        clients[clientId]?.ws.send(JSON.stringify({ method: "error", message: "Oyun bulunamadı." }));
        return;
      }

      // 'game' nesnesinin 'players' ve 'spectators' özelliklerinin varlığını kontrol et ve gerekirse başlat.
      // Bu, `create` metodunda zaten yapıldığı için burada sadece mevcut değerleri alıyoruz.
      // Ancak `create` metodunda `playerSlot` ve `playerSlotHTML`'in nasıl kullanıldığına dikkat et.
      // `game.players` ve `game.spectators` doğrudan `game` objesi üzerinden alınmalı,
      // `result` objesinden değil, çünkü `result` istemciden gelen veridir ve sunucu tarafındaki oyun durumu doğru olandır.
      let players = game.players; // Doğrudan game objesinden al
      let spectators = game.spectators; // Doğrudan game objesinden al
      const playerSlot = game.playerSlot; // Doğrudan game objesinden al
      const playerSlotHTML = game.playerSlotHTML; // Doğrudan game objesinden al

      // result.theClient objesinin güncellenmesi burada yapılıyor ama clientId ile eşleşen client objesi de var.
      // Buradaki theClient, muhtemelen istemcinin kendi bilgilerini gönderdiği bir kopya.
      // Sunucudaki client listesiyle senkronize etmek gerekebilir.
      // theClient.nickname = nickname; // theClient'ı doğrudan result'tan alırsak bu satır gerekli.
      // theClient.avatar = avatar;   // theClient'ı doğrudan result'tan alırsak bu satır gerekli.

      // ws.on('connection') içindeki theClient objesini güncelleyelim.
      if (clients[clientId]) {
          clients[clientId].nickname = nickname;
          clients[clientId].avatar = avatar;
          // Eğer theClient objesi doğrudan clients[clientId] içindeyse bu yeterli.
          // result.theClient objesini kullanıyorsan, onun da güncellendiğinden emin olmalısın.
          // result.theClient = clients[clientId]; // Eğer result.theClient'ı güncel client objesi olarak kullanacaksan.
      } else {
          // Bu durum olmamalı, çünkü clientId ws.on('connection') içinde oluşturuluyor.
          console.error("Join sırasında clientId bulunamadı:", clientId);
          return;
      }
      theClient = clients[clientId]; // theClient'ı sunucudaki güncel bilgilerle al

      if (spectators.length >= 7) {
        // Max players reached (7 spectator + 7 player = 14 kişi mi?) Kontrol etmelisin.
        // Genellikle 7 oyuncu olur, spectatorlar ayrı sayılmaz.
        clients[clientId]?.ws.send(JSON.stringify({ method: "error", message: "Maksimum oyuncu/izleyici sayısına ulaşıldı." }));
        return;
      }

      // theClient.clientId = clientId; // Zaten ws.on('connection') içinde atanmış olmalı.

      // Spectator listesine ekle veya güncelle
      const existingSpectatorIndex = spectators.findIndex(s => s.clientId === clientId);
      if (existingSpectatorIndex === -1) {
          spectators.push(theClient); // Yeni spectator
      } else {
          spectators[existingSpectatorIndex] = theClient; // Mevcut spectator'ı güncelle
      }

      // game.spectators = spectators; // Zaten referans ile çalıştığımız için doğrudan etkileyecek.
                                     // Ancak emin olmak için atayabiliriz.

      const payLoad = {
        method: "join",
        game: game,
        players: players, // game.players ile aynı
        spectators: spectators, // game.spectators ile aynı
        playerSlotHTML: playerSlotHTML, // game.playerSlotHTML ile aynı
        roomId: roomId,
      };

      if (!game.gameOn) {
        spectators.forEach((c) => {
          // clients[c.clientId] kontrolü önemli
          if (clients[c.clientId]?.ws) {
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
        if (clients[clientId]?.ws) {
          clients[clientId].ws.send(JSON.stringify(payLoadClient));
        }
      }

      const newPlayer = theClient; // newPlayer aslında theClient
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
          if (clients[c.clientId]?.ws) {
            clients[c.clientId].ws.send(JSON.stringify(payLoadClientArray));
          }
        });
      }

      const payLoadMidGame = {
        method: "joinMidGame",
        theClient: theClient,
        game: game,
      };

      if (game.gameOn) {
        if (clients[clientId]?.ws) {
          clients[clientId].ws.send(JSON.stringify(payLoadMidGame));
        }
      }

      const payLoadMidGameUpdate = {
        method: "joinMidGameUpdate",
        spectators: spectators,
        newPlayer: newPlayer,
      };
      if (game.gameOn) {
        spectators.forEach((c) => {
          if (clients[c.clientId]?.ws) {
            clients[c.clientId].ws.send(JSON.stringify(payLoadMidGameUpdate));
          }
        });
      }
    }

    // BET
    if (result.method === "bet") {
      // players ve spectators doğrudan result'tan alınıyor.
      // Bunların game objesindeki güncel durum olduğundan emin ol.
      // const players = result.players;
      // const spectators = result.spectators;
      const gameId = result.gameId; // gameId eksik, istemciden gelmeli
      const game = games[gameId];
      if (!game) {
        console.warn("Game undefined for bet, operation skipped.");
        return;
      }
      const players = game.players; // Game objesinden al
      const spectators = game.spectators; // Game objesinden al

      // Bet yapan oyuncunun bilgilerini players içinde güncellemen gerekebilir.
      // result.bet yapan oyuncunun clientId'ı da gelmeli.

      const payLoad = {
        method: "bet",
        players: players,
      };

      spectators.forEach((c) => {
        if (clients[c.clientId]?.ws) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
    }

    // DECK
    if (result.method === "deck") {
      // spectators, deck, clientDeal, gameOn doğrudan result'tan alınıyor.
      // Bunların game objesindeki güncel durum olduğundan emin ol.
      const gameId = result.gameId; // gameId eksik
      const game = games[gameId];
      if (!game) {
        console.warn("Game undefined for deck, operation skipped.");
        return;
      }
      const spectators = game.spectators; // Game objesinden al
      const deck = result.deck; // Deck istemciden gelebilir, ama sunucuda yönetilmesi daha güvenli.
      const clientDeal = result.clientDeal;
      const gameOn = game.gameOn; // Game objesinden al

      const payLoad = {
        method: "deck",
        deck: deck,
        gameOn: gameOn,
        clientDeal: clientDeal,
      };

      spectators.forEach((c) => {
        if (clients[c.clientId]?.ws) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
    }

    // IS READY
    if (result.method === "isReady") {
      const theClient = result.theClient; // theClient'ın clientId'ı olmalı
      const gameId = result.gameId; // gameId eksik
      const game = games[gameId];
      if (!game) {
        console.warn("Game undefined for isReady, operation skipped.");
        return;
      }
      const players = game.players;
      const spectators = game.spectators;

      // theClient'ın isReady durumunu players veya spectators içinde güncellemen gerekebilir.
      const clientInPlayers = players.find(p => p.clientId === theClient.clientId);
      if (clientInPlayers) {
          clientInPlayers.isReady = true; // Veya result.theClient.isReady
      }
      const clientInSpectators = spectators.find(s => s.clientId === theClient.clientId);
      if (clientInSpectators) {
          clientInSpectators.isReady = true; // Veya result.theClient.isReady
      }


      const payLoad = {
        method: "isReady",
        players: players,
        theClient: theClient, // Güncellenmiş theClient'ı gönder
      };

      spectators.forEach((c) => {
        if (clients[c.clientId]?.ws) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
    }

    // HAS LEFT
    if (result.method === "hasLeft") {
      const theClient = result.theClient;
      const gameId = result.gameId; // gameId eksik
      const game = games[gameId];
      if (!game) {
        console.warn("Game undefined for hasLeft, operation skipped.");
        return;
      }
      const players = game.players;
      const spectators = game.spectators;

      // theClient'ın hasLeft durumunu players veya spectators içinde güncellemen gerekebilir.
      const clientInPlayers = players.find(p => p.clientId === theClient.clientId);
      if (clientInPlayers) {
          clientInPlayers.hasLeft = true; // Veya result.theClient.hasLeft
      }
      const clientInSpectators = spectators.find(s => s.clientId === theClient.clientId);
      if (clientInSpectators) {
          clientInSpectators.hasLeft = true; // Veya result.theClient.hasLeft
      }


      const payLoad = {
        method: "hasLeft",
        players: players,
        spectators: spectators,
        theClient: theClient,
      };

      spectators.forEach((c) => {
        if (clients[c.clientId]?.ws) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
    }

    // CURRENT PLAYER
    if (result.method === "currentPlayer") {
      const gameId = result.gameId; // gameId eksik
      const game = games[gameId];
      if (!game) {
        console.warn("Game undefined for currentPlayer, operation skipped.");
        return;
      }
      const players = game.players; // game objesinden al
      const player = result.player;
      const dealersTurn = result.dealersTurn;
      const spectators = game.spectators; // game objesinden al

      const payLoad = {
        method: "currentPlayer",
        player: player,
      };

      if (!dealersTurn) {
        spectators.forEach((c) => {
          if (clients[c.clientId]?.ws) {
            clients[c.clientId].ws.send(JSON.stringify(payLoad));
          }
        });
      } else {
        // Bu kısım çok riskli. `players.pop()` her zaman doğru oyuncuyu çıkarmayabilir.
        // Dealer'ın sırası geldiğinde oyuncu listesinin son elemanını çıkarmak yerine,
        // oyunun mantığına göre oyuncuları dönmeli veya dealer'ın elini güncellemelisin.
        // if (players.length > 0) players.pop(); // BU SATIRI DİKKATLİ İNCELE, BÜYÜK İHTİMALLE YANLIŞ
        spectators.forEach((c) => {
          if (clients[c.clientId]?.ws) {
            clients[c.clientId].ws.send(JSON.stringify(payLoad));
          }
        });
      }
    }

    // UPDATE
    if (result.method === "update") {
      const gameId = result.gameId; // gameId eksik
      const game = games[gameId];
      if (!game) {
        console.warn("Game undefined for update, operation skipped.");
        return;
      }
      const players = game.players;
      const dealer = game.dealer; // dealer bilgisini game objesinden al
      const deck = result.deck; // Deck istemciden gelebilir, ama sunucuda yönetilmesi daha güvenli.
      const spectators = game.spectators;
      const gameOn = game.gameOn; // gameOn bilgisini game objesinden al

      const payLoad = {
        method: "update",
        players: players,
        dealer: dealer,
        deck: deck,
        gameOn: gameOn,
      };

      spectators.forEach((c) => {
        if (clients[c.clientId]?.ws) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
    }

    // THE PLAY
    if (result.method === "thePlay") {
      const gameId = result.gameId;
      const game = games[gameId];
      if (!game || !game.players) { // game.players'ın da varlığını kontrol et
          console.warn("Game or game.players undefined for thePlay, operation skipped.");
          return;
      }
      const player = result.player;
      const dealersTurn = result.dealersTurn;
      const currentPlayer = result.currentPlayer;

      const payLoad = {
        method: "thePlay",
        player: player,
        currentPlayer: currentPlayer,
        players: game.players, // result.players yerine game.players kullan
      };

      if (!dealersTurn) {
        game.players.forEach((c) => {
          if (clients[c.clientId]?.ws) { // client'ın ws nesnesinin varlığını kontrol et
            clients[c.clientId].ws.send(JSON.stringify(payLoad));
          }
        });
      }
      // Dealer'ın sırasıysa ne olacağı eksik veya istemci tarafından mı yönetiliyor?
    }

    // SHOW SUM
    if (result.method === "showSum") {
      const gameId = result.gameId; // gameId eksik
      const game = games[gameId];
      if (!game) {
        console.warn("Game undefined for showSum, operation skipped.");
        return;
      }
      const players = game.players; // game objesinden al
      const spectators = game.spectators; // game objesinden al

      const payLoad = {
        method: "showSum",
        players: players,
      };

      spectators.forEach((c) => {
        if (clients[c.clientId]?.ws) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
    }

    // JOIN TABLE
    if (result.method === "joinTable") {
      let theClient = result.theClient;
      const user = result.theClient; // user, theClient ile aynı
      const theSlot = result.theSlot;
      const gameId = result.gameId;
      const game = games[gameId];
      if (!game) {
          console.warn("Game undefined for joinTable, operation skipped.");
          clients[theClient?.clientId]?.ws.send(JSON.stringify({ method: "error", message: "Oyun bulunamadı." }));
          return;
      }

      // 'game' nesnesinin 'spectators', 'players', 'playerSlotHTML' özelliklerinin varlığını kontrol et ve gerekirse başlat.
      // `create` metodunda başlatıldıkları varsayılıyor, ancak yine de garantiye alalım.
      if (!game.spectators) game.spectators = [];
      if (!game.players) game.players = [];
      if (!game.playerSlotHTML) game.playerSlotHTML = [{},{},{},{},{},{},{}];

      const spectators = game.spectators; // game objesinden al
      const players = game.players; // game objesinden al
      const playerSlotHTML = game.playerSlotHTML; // game objesinden al

      // result.theClient'ın clientId'ı ile clients map'teki client objesini senkronize et.
      if (clients[theClient.clientId]) {
          // theClient'ın tüm özelliklerini clients[theClient.clientId] üzerine kopyala veya güncelle
          Object.assign(clients[theClient.clientId], theClient);
          theClient = clients[theClient.clientId]; // Güncel theClient'ı kullan
      } else {
          console.error("joinTable sırasında theClient.clientId bulunamadı:", theClient.clientId);
          return;
      }

      // Spectator listesinden çıkar, eğer oyuncu masaya oturuyorsa
      const spectatorIndex = spectators.findIndex(s => s.clientId === theClient.clientId);
      if (spectatorIndex !== -1) {
          spectators.splice(spectatorIndex, 1);
      }

      // Oyuncu zaten players içinde mi?
      const existingPlayerIndex = players.findIndex(p => p.clientId === theClient.clientId);
      if (existingPlayerIndex === -1) {
          players.push(theClient); // Yeni oyuncu
      } else {
          players[existingPlayerIndex] = theClient; // Mevcut oyuncuyu güncelle
      }

      // PlayerSlotHTML'i güncelle
      playerSlotHTML[theSlot] = theClient.clientId;


      // game.players = players; // Referans ile güncellendiği için bu satırlar gereksiz olabilir ama kesinlik için kalabilir.
      // game.playerSlotHTML = playerSlotHTML;

      const payLoad = {
        method: "joinTable",
        theSlot: theSlot,
        user: user, // user da theClient ile aynı.
        game: game,
        players: players, // game.players ile aynı
        spectators: spectators, // game.spectators ile aynı
        playerSlotHTML: playerSlotHTML, // game.playerSlotHTML ile aynı
        theClient: theClient, // Güncel theClient
      };

      // Hem oyunculara hem de izleyicilere gönderilmesi gerekebilir.
      // Tüm ilgili client'lara gönder.
      // Önce oyunculara gönder:
      players.forEach((c) => {
          if (clients[c.clientId]?.ws) {
              clients[c.clientId].ws.send(JSON.stringify(payLoad));
          }
      });
      // Sonra izleyicilere gönder:
      spectators.forEach((c) => {
        if (clients[c.clientId]?.ws) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
    }

    // UPDATE PLAYER CARDS
    if (result.method === "updatePlayerCards") {
      const gameId = result.gameId; // gameId eksik
      const game = games[gameId];
      if (!game) {
        console.warn("Game undefined for updatePlayerCards, operation skipped.");
        return;
      }
      const resetCards = result.resetCards;
      const players = game.players; // game objesinden al
      const player = result.player; // Güncellenen oyuncunun kendisi
      const spectators = game.spectators; // game objesinden al

      // player objesini players dizisi içinde güncellemen gerekebilir.
      const playerToUpdateIndex = players.findIndex(p => p.clientId === player.clientId);
      if (playerToUpdateIndex !== -1) {
          players[playerToUpdateIndex] = player; // Güncel oyuncu verilerini ata
      }

      const payLoad = {
        method: "updatePlayerCards",
        players: players, // Güncellenmiş oyuncular listesi
        player: player, // Tekil güncellenen oyuncu
        resetCards: resetCards,
      };
      spectators.forEach((c) => {
        if (clients[c.clientId]?.ws) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
    }

    // UPDATE DEALER CARDS
    if (result.method === "updateDealerCards") {
      const gameId = result.gameId; // gameId eksik
      const game = games[gameId];
      if (!game) {
        console.warn("Game undefined for updateDealerCards, operation skipped.");
        return;
      }
      const players = game.players; // game objesinden al
      const spectators = game.spectators; // game objesinden al
      const player = result.player; // Bu muhtemelen dealer değil, mevcut oyuncu. İsimlendirmeye dikkat.
      const dealer = result.dealer; // Dealer objesi istemciden geliyor. Bunu game.dealer'a atamalısın.
      const dealersTurn = result.dealersTurn;

      game.dealer = dealer; // Dealer bilgisini game objesine kaydet

      const payLoad = {
        method: "updateDealerCards",
        player: player,
        dealer: dealer,
        players: players,
        dealersTurn: dealersTurn,
      };

      if (!dealersTurn) {
        spectators.forEach((c) => {
          if (clients[c.clientId]?.ws) {
            clients[c.clientId].ws.send(JSON.stringify(payLoad));
          }
        });
      } else {
        // Bu kısım da `currentPlayer` metodundaki gibi riskli.
        // Dealer'ın sırası geldiğinde oyuncu listesinden eleman çıkarmak yanlış bir mantık.
        // if (players.length > 0) players.pop(); // BU SATIRI DİKKATLİ İNCELE, YANLIŞ OLABİLİR.
        spectators.forEach((c) => {
          if (clients[c.clientId]?.ws) {
            clients[c.clientId].ws.send(JSON.stringify(payLoad));
          }
        });
      }
    }

    // DEALERS TURN
    if (result.method === "dealersTurn") {
      const gameId = result.gameId; // gameId eksik
      const game = games[gameId];
      if (!game) {
        console.warn("Game undefined for dealersTurn, operation skipped.");
        return;
      }
      const dealersTurn = result.dealersTurn;
      const spectators = game.spectators; // game objesinden al

      game.gameOn = dealersTurn; // gameOn durumunu güncelle (dealersTurn true ise oyun devam ediyor demektir)

      const payLoad = {
        method: "dealersTurn",
        dealersTurn: dealersTurn,
      };
      spectators.forEach((c) => {
        if (clients[c.clientId]?.ws) {
          clients[c.clientId].ws.send(JSON.stringify(payLoad));
        }
      });
    }

    // TERMINATE (Oyun veya bağlantı sonlandığında)
    if (result.method === "terminate") {
      let gameId = result.gameId;
      let game = games[gameId];
      // Eğer oyun bulunamazsa veya game'in gerekli özellikleri yoksa hata vermemek için başlat
      if (!game) {
        console.warn('Terminate sırasında oyun bulunamadı veya game nesnesi eksik. Varsayılan başlatılıyor.');
        game = {
          spectators: [],
          players: [],
          playerSlotHTML: [{},{},{},{},{},{},{}], // Boş objelerle başlat
          gameOn: false, // Varsayılan değer
        };
        // Eğer gameId yoksa veya geçersizse burada işlem yapmayı bırakabiliriz.
        if (!gameId || !games[gameId]) return;
      }

      // result'tan gelen yerine game objesinden güncel durumları al.
      let spectators = game.spectators;
      let players = game.players;
      let playerSlotHTML = game.playerSlotHTML;
      let gameOn = game.gameOn; // game.gameOn kullan

      const theClient = result.theClient;
      const reload = result.reload; // reload bilgisini istemciden al.

      const clientId = theClient?.clientId;
      if (!clientId) {
          console.warn('Terminate metodu için clientId eksik.');
          return;
      }

      // clients objesinden WebSocket bağlantısını sil.
      if (clients[clientId]) {
          clients[clientId].ws.close(); // WebSocket bağlantısını kapat
          delete clients[clientId]; // clients hashmap'ten sil
          console.log(`Client ${clientId} bağlantısı kapatıldı ve listeden silindi.`);
      }

      // Eğer player hasLeft ise spectator'da da işaretle
      for (let i = 0; i < players.length; i++) {
        for (let s = 0; s < spectators.length; s++) {
          if (players[i]?.hasLeft === true && spectators[s].clientId === players[i].clientId) {
            spectators[s].hasLeft = true;
          }
        }
      }

      // Eğer sadece 1 spectator varsa ve oyuncular arasında dealer var ise dealer çıkar
      // Bu mantık yanlış olabilir, dealer bir oyuncu değil, oyunun parçasıdır.
      // Eğer dealer bir 'oyuncu' olarak tutuluyorsa, bu kısım oyunun mantığına göre düzeltilmeli.
      // Genellikle dealer ayrı bir nesne/değişken olur ve players dizisinde yer almaz.
      // Şu anki kodda dealer'ın players dizisinde `hiddenCard` özelliği ile tutulduğu varsayılıyor.
      if (spectators.length === 1 && players.some(e => e.hiddenCard)) {
        // Eğer bu kalan tek spectator dealer ise, ve diğer oyuncular gitmişse oyunu sıfırla.
        // players.splice(players.findIndex(e => e.hiddenCard), 1); // Bu, dealer'ı player listesinden çıkarır.
        // Bu satırın amacını netleştirmelisin. Oyun bittiğinde mi dealer çıkarılmalı?
      }

      if (!gameOn || spectators.length === 1) { // Eğer oyun bitmişse veya tek spectator kalmışsa
        // Sayfa reload ise spectator'dan çıkar
        if (reload === true) {
          // spectator listesinden ilgili client'ı bul ve sil
          const indexToRemove = spectators.findIndex(s => s.clientId === clientId);
          if (indexToRemove !== -1) {
            spectators.splice(indexToRemove, 1);
            console.log(`Client ${clientId} spectators listesinden çıkarıldı (reload).`);
          }
        }

        // playerSlotHTML'den çıkar
        for (let i = 0; i < playerSlotHTML.length; i++) {
          if (clientId === playerSlotHTML[i]) {
            playerSlotHTML[i] = {}; // veya null yap
            console.log(`Client ${clientId} playerSlotHTML'den çıkarıldı.`);
            break;
          }
        }

        // players'dan çıkar
        const playerIndexToRemove = players.findIndex(p => p.clientId === clientId);
        if (playerIndexToRemove !== -1) {
          players.splice(playerIndexToRemove, 1);
          console.log(`Client ${clientId} players listesinden çıkarıldı.`);
        }
      } else { // Oyun devam ediyorsa ve birden fazla spectator varsa
          // Eğer oyuncu ayrılıyorsa (terminate) ve oyun devam ediyorsa,
          // sadece hasLeft flag'ini true yapabilir veya spectator'dan çıkarıp
          // playerSlotHTML'den boşaltabilirsin, ama players'dan çıkarmayabilirsin (masadan kalkması gibi).
          // Bu, oyunun dinamiklerine bağlı. Mevcut kodun mantığına göre devam edelim:

          // playerSlotHTML'den çıkar
          for (let i = 0; i < playerSlotHTML.length; i++) {
            if (clientId === playerSlotHTML[i]) {
              playerSlotHTML[i] = {}; // veya null yap
              console.log(`Client ${clientId} playerSlotHTML'den çıkarıldı.`);
              break;
            }
          }

          // players'dan çıkar (eğer oyuncuysa)
          const playerIndexToRemove = players.findIndex(p => p.clientId === clientId);
          if (playerIndexToRemove !== -1) {
            players.splice(playerIndexToRemove, 1);
            console.log(`Client ${clientId} players listesinden çıkarıldı.`);
          }

          // spectators'dan çıkar
          const spectatorIndexToRemove = spectators.findIndex(s => s.clientId === clientId);
          if (spectatorIndexToRemove !== -1) {
            spectators.splice(spectatorIndexToRemove, 1);
            console.log(`Client ${clientId} spectators listesinden çıkarıldı.`);
          }
      }


      // game objesinin güncel durumunu sakla.
      game.spectators = spectators;
      game.players = players;
      game.playerSlotHTML = playerSlotHTML;

      // Eğer oyunda hiç oyuncu veya izleyici kalmazsa oyunu sil.
      if (game.players.length === 0 && game.spectators.length === 0) {
          delete games[gameId];
          console.log(`Oyun ${gameId} silindi, çünkü kimse kalmadı.`);
      }

      const payLoad = {
        method: "leave",
        playerSlotIndex: null, // Burada `playerSlotIndex` değeri doğru olmayabilir. Client tarafında tekrar hesaplanmalı.
        players: players,
        playerSlotHTML: playerSlotHTML,
        spectators: spectators,
        oldPlayerIndex: null, // Bu da client tarafında hesaplanmalı
        game: game, // Güncel game objesini gönder
        gameOn: gameOn, // Güncel gameOn durumunu gönder
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
    if (result.method === "playersLength") {
      const gameId = result.gameId;
      const game = games[gameId];
      if (!game || !game.spectators) {
        console.warn('Game veya spectators tanımsız, işlem atlandı.');
        // Hata durumunda istemciye bilgi gönderilebilir.
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ method: "error", message: "Oyun durumu alınamadı." }));
        }
        return;
      }
      const playersLength = game.spectators.length; // Genellikle 'spectators' değil, 'players' sayısını kastediyor olabilirsin.
                                                      // Eğer hem oyuncular hem de izleyiciler dahilse bu doğru.
                                                      // Ama Blackjack'te 'players' daha mantıklı.
      const payLoadLength = {
        method: "playersLength",
        playersLength: playersLength,
      };

      if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(payLoadLength));
      }
    }

  });

  // Yeni clientId oluştur, clients listesine ekle
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
    clientId: clientId, // clientId'ı burada da tutmak pratik olabilir.
  };

  const payLoad = {
    method: "connect",
    clientId: clientId,
    theClient: clients[clientId], // clients[clientId] içindeki theClient objesini gönder
  };

  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payLoad));
  }
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

// Dinamik oda ID'leri için wildcard route
app.get("/:id", (req, res) => {
  // Eğer id bir HTML dosyası veya özel bir route değilse, index.html gönder
  // 'id' değerini kontrol ederek belirli odalara yönlendirme yapabilirsin.
  // Örneğin, `games[WEB_URL + req.params.id]` kontrolü yapabilirsin.
  // Şimdilik sadece index.html göndermeye devam edelim.
  res.sendFile(__dirname + "/public/index.html");
});

app.get("*", (req, res) => {
  res.redirect("/");
});
