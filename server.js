// ==================================
// SERVER.JS - Enhanced Backend Server
// ==================================
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const fs = require('fs').promises;

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware  
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Game storage
const rooms = new Map();
const players = new Map(); // Stores socketId -> { name, roomId, isSpectator }
const leaderboard = new Map();
const gameStats = new Map();

// File paths for persistence
const LEADERBOARD_FILE = path.join(__dirname, 'data', 'leaderboard.json');
const STATS_FILE = path.join(__dirname, 'data', 'stats.json');

// Initialize data directory
async function initializeDataDirectory() {
    try {
        await fs.mkdir(path.join(__dirname, 'data'), { recursive: true });
        console.log('Data directory ensured.');
        await loadLeaderboard();
        await loadStats();
    } catch (error) {
        console.error('Error initializing data directory:', error);
    }
}

// Leaderboard management
async function loadLeaderboard() {
    try {
        const data = await fs.readFile(LEADERBOARD_FILE, 'utf8');
        const parsed = JSON.parse(data);
        leaderboard.clear();
        parsed.forEach(entry => leaderboard.set(entry.name, entry));
        console.log('Leaderboard loaded.');
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('Leaderboard file not found, starting fresh.');
        } else {
            console.error('Error loading leaderboard:', error);
        }
    }
}

async function saveLeaderboard() {
    try {
        const data = JSON.stringify(Array.from(leaderboard.values()), null, 2);
        await fs.writeFile(LEADERBOARD_FILE, data, 'utf8');
        console.log('Leaderboard saved.');
    } catch (error) {
        console.error('Error saving leaderboard:', error);
    }
}

// Game stats management
async function loadStats() {
    try {
        const data = await fs.readFile(STATS_FILE, 'utf8');
        const parsed = JSON.parse(data);
        gameStats.clear();
        parsed.forEach(entry => gameStats.set(entry.name, entry));
        console.log('Game stats loaded.');
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('Game stats file not found, starting fresh.');
        } else {
            console.error('Error loading game stats:', error);
        }
    }
}

async function saveStats() {
    try {
        const data = JSON.stringify(Array.from(gameStats.values()), null, 2);
        await fs.writeFile(STATS_FILE, data, 'utf8');
        console.log('Game stats saved.');
    } catch (error) {
        console.error('Error saving game stats:', error);
    }
}

function updateLeaderboardRating(playerName, result) {
    let player = leaderboard.get(playerName) || { name: playerName, rating: 1000, wins: 0, losses: 0 };

    if (result === 'win') {
        player.rating += 15;
        player.wins += 1;
    } else if (result === 'loss') {
        player.rating = Math.max(100, player.rating - 10);
        player.losses += 1;
    }
    leaderboard.set(playerName, player);
    saveLeaderboard();
}

function updatePlayerStats(playerName, result, pointsScored = 0, pointsConceded = 0) {
    let stats = gameStats.get(playerName) || { 
        name: playerName, 
        totalGames: 0, 
        wins: 0, 
        losses: 0, 
        ties: 0, 
        pointsScored: 0, 
        pointsConceded: 0 
    };
    
    stats.totalGames += 1;
    stats.pointsScored += pointsScored;
    stats.pointsConceded += pointsConceded;

    if (result === 'win') {
        stats.wins += 1;
    } else if (result === 'loss') {
        stats.losses += 1;
    } else if (result === 'tie') {
        stats.ties += 1;
    }
    gameStats.set(playerName, stats);
    saveStats();
}

// Helper to generate unique room ID
function generateRoomId() {
    let id;
    do {
        id = Math.random().toString(36).substring(2, 8).toUpperCase();
    } while (rooms.has(id));
    return id;
}

// Helper to get room list for display
function getRoomList() {
    return Array.from(rooms.values())
        .filter(room => room.gameMode === 'online' && room.players.length < 2 && !room.gameStarted)
        .map(room => ({
            id: room.id,
            name: room.roomName || room.id, // Use custom room name or fallback to ID
            hostName: room.players[0]?.name || 'Unknown',
            players: room.players.filter(p => p.connected).length,
            maxPlayers: 2,
            lastActivity: room.lastActivity,
            gameMode: room.gameMode
        }));
}

// GameRoom Class
class GameRoom {
    constructor(id, hostSocketId, hostName, roomName = null, mode = 'online') {
        this.id = id;
        this.roomName = roomName || id;
        this.gameMode = mode;
        this.board = Array(8).fill(0).map(() => Array(8).fill(0));
        this.currentPlayer = 1; // 1 for Black, 2 for White
        this.players = [
            { id: hostSocketId, name: hostName, color: 1, connected: true, isHost: true }, // Host is black
        ];
        this.spectators = [];
        this.gameStarted = false;
        this.gameOver = false;
        this.winner = null;
        this.scores = { 1: 0, 2: 0 };
        this.lastActivity = Date.now();
        this.chatMessages = [];
        this.moveHistory = [];
        this.initializeBoard();
    }

    addPlayer(socketId, playerName) {
        if (this.players.length < 2) {
            // Check for reconnecting player by name (if disconnected)
            const existingPlayer = this.players.find(p => p.name === playerName && !p.connected);
            if (existingPlayer) {
                existingPlayer.id = socketId;
                existingPlayer.connected = true;
                this.lastActivity = Date.now();
                return { success: true, reconnected: true };
            }

            // New player - add as white player
            const playerColor = 2; // Second player always white
            this.players.push({ 
                id: socketId, 
                name: playerName, 
                color: playerColor, 
                connected: true, 
                isHost: false 
            });
            this.lastActivity = Date.now();
            return { success: true, reconnected: false };
        }
        return { success: false, reason: 'Room is full' };
    }

    removePlayer(socketId) {
        const playerIndex = this.players.findIndex(p => p.id === socketId);
        if (playerIndex !== -1) {
            this.players[playerIndex].connected = false;
            console.log(`Player ${this.players[playerIndex].name} disconnected from room ${this.id}`);
            this.lastActivity = Date.now();
            return { success: true, player: this.players[playerIndex] };
        }
        
        const spectatorIndex = this.spectators.findIndex(s => s.id === socketId);
        if (spectatorIndex !== -1) {
            const spectator = this.spectators.splice(spectatorIndex, 1)[0];
            console.log(`Spectator ${spectator.name} left room ${this.id}`);
            this.lastActivity = Date.now();
            return { success: true, spectator };
        }
        return { success: false };
    }

    addSpectator(socketId, spectatorName) {
        // Ensure not adding the same spectator twice
        if (!this.spectators.some(s => s.id === socketId)) {
            this.spectators.push({ id: socketId, name: spectatorName });
            this.lastActivity = Date.now();
            return { success: true };
        }
        return { success: false, reason: "Already a spectator" };
    }

    startGame() {
        if (this.players.length === 2 && !this.gameStarted) {
            this.gameStarted = true;
            this.lastActivity = Date.now();
            console.log(`Game started in room ${this.id}`);
            return true;
        }
        return false;
    }

    // Othello game logic
    initializeBoard() {
        this.board = Array(8).fill(0).map(() => Array(8).fill(0));
        this.board[3][3] = 2; // White
        this.board[3][4] = 1; // Black
        this.board[4][3] = 1; // Black
        this.board[4][4] = 2; // White
        this.updateScores();
    }

    getValidMoves(playerColor) {
        const validMoves = [];
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if (this.board[r][c] === 0 && this.isValidMove(r, c, playerColor)) {
                    validMoves.push({ r, c });
                }
            }
        }
        return validMoves;
    }

    isValidMove(r, c, playerColor) {
        if (this.board[r][c] !== 0) return false;

        const opponentColor = playerColor === 1 ? 2 : 1;
        const directions = [
            [-1, 0], [1, 0], [0, -1], [0, 1],
            [-1, -1], [-1, 1], [1, -1], [1, 1]
        ];

        for (const [dr, dc] of directions) {
            let foundOpponent = false;
            let currentR = r + dr;
            let currentC = c + dc;

            while (currentR >= 0 && currentR < 8 && currentC >= 0 && currentC < 8) {
                if (this.board[currentR][currentC] === opponentColor) {
                    foundOpponent = true;
                } else if (this.board[currentR][currentC] === playerColor && foundOpponent) {
                    return true;
                } else {
                    break;
                }
                currentR += dr;
                currentC += dc;
            }
        }
        return false;
    }

    makeMove(r, c, playerColor) {
        if (!this.isValidMove(r, c, playerColor)) {
            return { success: false, reason: 'Invalid move' };
        }

        const flippedPieces = [];
        this.board[r][c] = playerColor;
        const opponentColor = playerColor === 1 ? 2 : 1;
        const directions = [
            [-1, 0], [1, 0], [0, -1], [0, 1],
            [-1, -1], [-1, 1], [1, -1], [1, 1]
        ];

        for (const [dr, dc] of directions) {
            let lineToFlip = [];
            let currentR = r + dr;
            let currentC = c + dc;

            while (currentR >= 0 && currentR < 8 && currentC >= 0 && currentC < 8) {
                if (this.board[currentR][currentC] === opponentColor) {
                    lineToFlip.push({ r: currentR, c: currentC });
                } else if (this.board[currentR][currentC] === playerColor) {
                    for (const { r: flipR, c: flipC } of lineToFlip) {
                        this.board[flipR][flipC] = playerColor;
                        flippedPieces.push({ r: flipR, c: flipC });
                    }
                    break;
                } else {
                    break;
                }
                currentR += dr;
                currentC += dc;
            }
        }

        // Record move in history
        this.moveHistory.push({
            player: playerColor,
            position: { r, c },
            flippedPieces: flippedPieces,
            timestamp: Date.now()
        });

        this.updateScores();
        this.lastActivity = Date.now();
        return { success: true, flippedPieces };
    }

    updateScores() {
        let blackCount = 0;
        let whiteCount = 0;
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if (this.board[r][c] === 1) blackCount++;
                else if (this.board[r][c] === 2) whiteCount++;
            }
        }
        this.scores[1] = blackCount;
        this.scores[2] = whiteCount;
    }

    switchPlayer() {
        this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
        this.lastActivity = Date.now();
    }

    checkGameEnd() {
        const movesForBlack = this.getValidMoves(1).length;
        const movesForWhite = this.getValidMoves(2).length;

        if (movesForBlack === 0 && movesForWhite === 0) {
            this.gameOver = true;
            if (this.scores[1] > this.scores[2]) {
                this.winner = 1;
            } else if (this.scores[2] > this.scores[1]) {
                this.winner = 2;
            } else {
                this.winner = 0; // Tie
            }
            this.handleGameResult();
            console.log(`Game over in room ${this.id}. Winner: ${this.winner}`);
            return true;
        }

        if (this.getValidMoves(this.currentPlayer).length === 0) {
            console.log(`Player ${this.currentPlayer} has no moves, switching turn.`);
            this.switchPlayer();
            // Check if the other player also has no moves
            if (this.getValidMoves(this.currentPlayer).length === 0) {
                this.gameOver = true;
                if (this.scores[1] > this.scores[2]) {
                    this.winner = 1;
                } else if (this.scores[2] > this.scores[1]) {
                    this.winner = 2;
                } else {
                    this.winner = 0;
                }
                this.handleGameResult();
                console.log(`Game over in room ${this.id}. Both players no moves. Winner: ${this.winner}`);
                return true;
            }
        }
        return false;
    }

    handleGameResult() {
        if (!this.gameOver || this.players.length !== 2) return;

        const player1 = this.players.find(p => p.color === 1);
        const player2 = this.players.find(p => p.color === 2);

        if (this.winner === 1) {
            updateLeaderboardRating(player1.name, 'win');
            updatePlayerStats(player1.name, 'win', this.scores[1], this.scores[2]);
            updateLeaderboardRating(player2.name, 'loss');
            updatePlayerStats(player2.name, 'loss', this.scores[2], this.scores[1]);
        } else if (this.winner === 2) {
            updateLeaderboardRating(player2.name, 'win');
            updatePlayerStats(player2.name, 'win', this.scores[2], this.scores[1]);
            updateLeaderboardRating(player1.name, 'loss');
            updatePlayerStats(player1.name, 'loss', this.scores[1], this.scores[2]);
        } else if (this.winner === 0) { // Tie
            updatePlayerStats(player1.name, 'tie', this.scores[1], this.scores[2]);
            updatePlayerStats(player2.name, 'tie', this.scores[2], this.scores[1]);
        }
    }
}

// =====================================
// Socket.IO Events
// =====================================
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Initialize player in global players map
    players.set(socket.id, { id: socket.id, name: 'Guest', roomId: null });

    // Emit current room list to new connections
    socket.emit('updateRoomList', getRoomList());

    socket.on('createRoom', ({ playerName, roomName, gameMode }) => {
        if (!playerName) {
            socket.emit('createRoomError', 'Player name is required to create a room.');
            return;
        }
        
        const roomId = generateRoomId();
        const newRoom = new GameRoom(roomId, socket.id, playerName, roomName, gameMode);
        rooms.set(roomId, newRoom);
        players.set(socket.id, { id: socket.id, name: playerName, roomId: roomId, isSpectator: false });
        socket.join(roomId);

        console.log(`Room created: ${roomId} by ${playerName} (${gameMode} mode)`);
        socket.emit('roomCreated', { 
            roomId: newRoom.id, 
            roomName: newRoom.roomName,
            players: newRoom.players.map(p => ({ id: p.id, name: p.name, color: p.color, connected: p.connected })),
            board: newRoom.board,
            currentPlayer: newRoom.currentPlayer,
            scores: newRoom.scores,
            isHost: true,
            playerColor: 1, // Host is always black
            gameStarted: newRoom.gameStarted,
            spectators: newRoom.spectators
        });
        io.emit('updateRoomList', getRoomList());
    });

    socket.on('joinRoom', ({ roomId, playerName }) => {
        let room = rooms.get(roomId);

        if (!playerName) {
            socket.emit('joinRoomError', 'Player name is required to join a room.');
            return;
        }

        if (!room) {
            socket.emit('roomNotFound', roomId);
            console.log(`Join attempt failed: Room ${roomId} not found.`);
            return;
        }

        // Check if the player is already in this room and connected
        const playerAlreadyConnected = room.players.some(p => p.id === socket.id && p.connected);
        const spectatorAlreadyConnected = room.spectators.some(s => s.id === socket.id);

        if (playerAlreadyConnected || spectatorAlreadyConnected) {
            // Player or spectator is already in this room and connected via this socket.
            // Just re-emit joinedRoom for state sync, no new join action needed.
            const playerInRoom = room.players.find(p => p.id === socket.id);
            const playerColor = playerInRoom ? playerInRoom.color : 0; // 0 for spectator/not a player
            const isHost = playerInRoom ? playerInRoom.isHost : false;
            
            socket.emit('joinedRoom', {
                roomId: room.id,
                roomName: room.roomName,
                players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, connected: p.connected })),
                board: room.board,
                currentPlayer: room.currentPlayer,
                scores: room.scores,
                isHost: isHost,
                playerColor: playerColor,
                gameStarted: room.gameStarted,
                spectators: room.spectators
            });
            socket.join(roomId); // Ensure socket is in the room
            console.log(`Player ${playerName} (${socket.id}) already in room ${roomId}, re-synced state.`);
            return;
        }

        // Handle rejoining for a player whose previous socket disconnected
        const existingPlayerByName = room.players.find(p => p.name === playerName && !p.connected);
        if (existingPlayerByName) {
            // Update the existing player with the new socket ID and set connected to true
            existingPlayerByName.id = socket.id;
            existingPlayerByName.connected = true;
            players.set(socket.id, { id: socket.id, name: playerName, roomId: roomId, isSpectator: false });
            socket.join(roomId);
            room.lastActivity = Date.now();
            
            socket.emit('joinedRoom', {
                roomId: room.id,
                roomName: room.roomName,
                players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, connected: p.connected })),
                board: room.board,
                currentPlayer: room.currentPlayer,
                scores: room.scores,
                isHost: existingPlayerByName.isHost,
                playerColor: existingPlayerByName.color,
                gameStarted: room.gameStarted,
                spectators: room.spectators
            });
            io.to(roomId).emit('playerReconnected', {
                id: socket.id,
                name: playerName,
                playersInRoom: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, connected: p.connected })),
                spectators: room.spectators
            });
            io.emit('updateRoomList', getRoomList());
            console.log(`Player ${playerName} reconnected to room ${roomId}`);
            return;
        }

        // If room is full for players, add as spectator
        if (room.players.length >= 2) {
            const addSpectatorResult = room.addSpectator(socket.id, playerName);
            if (addSpectatorResult.success) {
                players.set(socket.id, { id: socket.id, name: playerName, roomId: roomId, isSpectator: true });
                socket.join(roomId);
                room.lastActivity = Date.now();
                
                socket.emit('roomFullAsSpectator', {
                    roomId: room.id,
                    roomName: room.roomName,
                    players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, connected: p.connected })),
                    board: room.board,
                    currentPlayer: room.currentPlayer,
                    scores: room.scores,
                    spectators: room.spectators
                });
                io.to(roomId).emit('spectatorJoined', {
                    id: socket.id,
                    name: playerName,
                    spectators: room.spectators
                });
                console.log(`Player ${playerName} joined room ${roomId} as spectator`);
            } else {
                 socket.emit('joinRoomError', addSpectatorResult.reason);
            }
            return;
        }
        
        // Add new player to room
        const addPlayerResult = room.addPlayer(socket.id, playerName);
        if (addPlayerResult.success) {
            players.set(socket.id, { id: socket.id, name: playerName, roomId: roomId, isSpectator: false });
            socket.join(roomId);
            room.lastActivity = Date.now();

            const playerInRoom = room.players.find(p => p.id === socket.id);

            socket.emit('joinedRoom', {
                roomId: room.id,
                roomName: room.roomName,
                players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, connected: p.connected })),
                board: room.board,
                currentPlayer: room.currentPlayer,
                scores: room.scores,
                isHost: playerInRoom.isHost,
                playerColor: playerInRoom.color,
                gameStarted: room.gameStarted,
                spectators: room.spectators
            });
            io.to(roomId).emit('playerJoined', {
                id: socket.id,
                name: playerName,
                playersInRoom: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, connected: p.connected })),
                spectators: room.spectators
            });
            io.emit('updateRoomList', getRoomList());
            console.log(`Player ${playerName} joined room ${roomId}`);

            if (room.players.length === 2 && !room.gameStarted) {
                room.startGame();
                io.to(roomId).emit('gameStarted', {
                    board: room.board,
                    currentPlayer: room.currentPlayer,
                    players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, connected: p.connected }))
                });
                io.emit('updateRoomList', getRoomList());
                console.log(`Game auto-started in room ${roomId}`);
            }
        } else {
            socket.emit('joinRoomError', addPlayerResult.reason);
            console.log(`Join attempt failed for ${playerName} in room ${roomId}: ${addPlayerResult.reason}`);
        }
    });

    socket.on('makeMove', ({ roomId, r, c }) => {
        const playerInfo = players.get(socket.id);
        if (!playerInfo || !playerInfo.roomId || playerInfo.roomId !== roomId) {
            console.warn(`Invalid move attempt by ${socket.id} (not in room or wrong room).`);
            socket.emit('gameError', 'You are not in this room or not a player.');
            return;
        }

        const room = rooms.get(roomId);
        if (!room || !room.gameStarted || room.gameOver) {
            console.warn(`Move attempt in invalid room state: Room ${roomId}, Started: ${room?.gameStarted}, Over: ${room?.gameOver}`);
            socket.emit('gameError', 'Game has not started or is already over.');
            return;
        }

        const currentPlayerInRoom = room.players.find(p => p.id === socket.id);
        if (!currentPlayerInRoom || currentPlayerInRoom.color !== room.currentPlayer) {
            console.warn(`Move out of turn by ${playerInfo.name} in room ${roomId}.`);
            socket.emit('gameError', 'It is not your turn.');
            return;
        }

        const moveResult = room.makeMove(r, c, room.currentPlayer);
        if (moveResult.success) {
            io.to(roomId).emit('updateBoard', {
                board: room.board,
                scores: room.scores,
                flippedPieces: moveResult.flippedPieces,
                move: { r, c, playerColor: room.currentPlayer }
            });

            // Check game end and switch player
            if (!room.checkGameEnd()) {
                room.switchPlayer();
                // Check if current player has no valid moves
                if (room.getValidMoves(room.currentPlayer).length === 0) {
                    io.to(roomId).emit('noValidMoves', {
                        playerColor: room.currentPlayer,
                        message: `Player ${room.currentPlayer === 1 ? 'Black' : 'White'} has no valid moves. Turn skipped.`
                    });
                    // Try switching back if the other player still has moves
                    room.switchPlayer();
                    if (room.getValidMoves(room.currentPlayer).length === 0) {
                         // Still no moves for the other player, game ends
                        room.gameOver = true;
                        room.checkGameEnd(); // Final check to determine winner
                    }
                }
                if (!room.gameOver) {
                    io.to(roomId).emit('switchTurn', { currentPlayer: room.currentPlayer });
                }
            }
            if (room.gameOver) {
                io.to(roomId).emit('gameOver', {
                    winner: room.winner,
                    scores: room.scores,
                    players: room.players.map(p => ({ name: p.name, color: p.color }))
                });
                io.emit('updateRoomList', getRoomList());
            }
        } else {
            socket.emit('gameError', moveResult.reason);
        }
    });

    socket.on('chatMessage', ({ roomId, message }) => {
        const playerInfo = players.get(socket.id);
        if (!playerInfo || !playerInfo.roomId || playerInfo.roomId !== roomId) {
            console.warn(`Chat message attempt by ${socket.id} (not in room or wrong room).`);
            return;
        }
        const room = rooms.get(roomId);
        if (room) {
            const senderName = playerInfo.name || 'Guest';
            const timestamp = Date.now();
            const fullMessage = { sender: senderName, message, timestamp };
            room.chatMessages.push(fullMessage);
            io.to(roomId).emit('chatMessage', fullMessage);
        }
    });

    socket.on('requestRoomList', () => {
        socket.emit('updateRoomList', getRoomList());
    });

    socket.on('requestLeaderboard', () => {
        const sortedLeaderboard = Array.from(leaderboard.values()).sort((a, b) => b.rating - a.rating);
        socket.emit('updateLeaderboard', sortedLeaderboard);
    });

    socket.on('requestStats', () => {
        const sortedStats = Array.from(gameStats.values()).sort((a, b) => b.totalGames - a.totalGames);
        socket.emit('updateStats', sortedStats);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        const playerInfo = players.get(socket.id);
        if (playerInfo && playerInfo.roomId) {
            const room = rooms.get(playerInfo.roomId);
            if (room) {
                const removed = room.removePlayer(socket.id);
                if (removed.success) {
                    io.to(room.id).emit('playerDisconnected', {
                        id: socket.id,
                        name: removed.player ? removed.player.name : (removed.spectator ? removed.spectator.name : 'Unknown'),
                        playersInRoom: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, connected: p.connected })),
                        spectators: room.spectators
                    });
                    
                    // Cleanup room if all players are disconnected and no spectators
                    const allPlayersDisconnected = room.players.every(p => !p.connected);
                    const noSpectators = room.spectators.length === 0;

                    if (allPlayersDisconnected && noSpectators && !room.gameStarted) {
                        // If game hasn't started and everyone left, delete room
                        rooms.delete(room.id);
                        console.log(`Room ${room.id} removed due to inactivity and no players/spectators.`);
                    } else if (allPlayersDisconnected && room.gameStarted && !room.gameOver) {
                        // If game started and all players disconnected, end game and set winner to remaining player if any or tie
                        console.log(`All players disconnected from active game in room ${room.id}. Ending game.`);
                        // Determine winner based on scores at disconnect
                        if (room.scores[1] !== room.scores[2]) {
                            room.winner = room.scores[1] > room.scores[2] ? 1 : 2;
                        } else {
                            room.winner = 0; // Tie
                        }
                        room.gameOver = true;
                        room.handleGameResult(); // Update stats and leaderboard
                        io.to(room.id).emit('gameOver', {
                            winner: room.winner,
                            scores: room.scores,
                            players: room.players.map(p => ({ name: p.name, color: p.color }))
                        });
                        // Do not delete room immediately to allow rejoining or spectating if desired
                    }
                    io.emit('updateRoomList', getRoomList());
                }
            }
        }
        players.delete(socket.id);
    });
});

// =====================================
// Server Cleanup & Shutdown
// =====================================
// Cleanup inactive rooms every 5 minutes
setInterval(() => {
    const now = Date.now();
    let cleanedRooms = 0;
    for (const [roomId, room] of rooms.entries()) {
        const isGameStalled = room.gameStarted && room.players.every(p => !p.connected) && room.spectators.length === 0;
        const isInactiveUnstartedRoom = !room.gameStarted && (now - room.lastActivity > 15 * 60 * 1000) && room.players.every(p => !p.connected); // 15 minutes for unstarted rooms

        if (isGameStalled || isInactiveUnstartedRoom) {
            console.log(`Cleaning up inactive room: ${roomId}`);
            io.to(roomId).emit('roomClosed', 'This room has been closed due to inactivity.');
            rooms.delete(roomId);
            // Also remove players associated with this room from the global players map
            for (const [socketId, playerInfo] of players.entries()) {
                if (playerInfo.roomId === roomId) {
                    players.delete(socketId);
                }
            }
            cleanedRooms++;
        } else if (!room.gameStarted && (now - room.lastActivity > 5 * 60 * 1000) && room.players.length === 0) {
             // If a room is unstarted and empty for 5 minutes, clean it up
             console.log(`Cleaning up empty unstarted room: ${roomId}`);
             rooms.delete(roomId);
             cleanedRooms++;
        }
    }

    if (cleanedRooms > 0) {
        io.emit('updateRoomList', getRoomList());
        console.log(`Cleanup completed. Removed ${cleanedRooms} inactive rooms.`);
    }
}, 5 * 60 * 1000); // Run every 5 minutes

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully...');
    
    // Save data before shutdown
    try {
        await saveLeaderboard();
        await saveStats();
        console.log('Data saved successfully.');
    } catch (error) {
        console.error('Error saving data during shutdown:', error);
    }
    
    // Close server
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
});

process.on('SIGINT', async () => {
    console.log('SIGINT received, shutting down gracefully...');
    
    try {
        await saveLeaderboard();
        await saveStats();
        console.log('Data saved successfully.');
    } catch (error) {
        console.error('Error saving data during shutdown:', error);
    }
    
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
});

// =====================================
// Server Start
// =====================================
initializeDataDirectory(); // Ensure data directory exists and load data
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Othello Server running on port ${PORT}`);
});
