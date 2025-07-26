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
const players = new Map(); // Stores socketId -> { roomId, name, pieceShape }
const leaderboard = new Map(); // Stores playerName -> { wins, losses, draws }
const gameStats = new Map(); // Stores player stats: { gamesPlayed, totalMoves, avgMoveTime, maxScore }

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

// Load/Save Data
async function loadLeaderboard() {
    try {
        const data = await fs.readFile(LEADERBOARD_FILE, 'utf8');
        const parsed = JSON.parse(data);
        for (const [key, value] of Object.entries(parsed)) {
            leaderboard.set(key, value);
        }
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
        const data = JSON.stringify(Object.fromEntries(leaderboard), null, 2);
        await fs.writeFile(LEADERBOARD_FILE, data, 'utf8');
        console.log('Leaderboard saved.');
    } catch (error) {
        console.error('Error saving leaderboard:', error);
    }
}

async function loadStats() {
    try {
        const data = await fs.readFile(STATS_FILE, 'utf8');
        const parsed = JSON.parse(data);
        for (const [key, value] of Object.entries(parsed)) {
            gameStats.set(key, value);
        }
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
        const data = JSON.stringify(Object.fromEntries(gameStats), null, 2);
        await fs.writeFile(STATS_FILE, data, 'utf8');
        console.log('Game stats saved.');
    } catch (error) {
        console.error('Error saving game stats:', error);
    }
}


// Othello Game Logic (Server-side)
class GameRoom {
    constructor(id, hostSocketId, hostName, hostPieceShape, roomName = null, mode = 'online') {
        this.id = id;
        this.roomName = roomName || id;
        this.gameMode = mode;
        this.board = Array(8).fill(0).map(() => Array(8).fill(0));
        this.currentPlayer = 1; // 1 for Black, 2 for White
        this.players = [
            { id: hostSocketId, name: hostName, color: 1, connected: true, isHost: true, pieceShape: hostPieceShape }, // Host is black
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

    initializeBoard() {
        this.board = Array(8).fill(0).map(() => Array(8).fill(0));
        this.board[3][3] = 1; // Black
        this.board[3][4] = 2; // White
        this.board[4][3] = 2; // White
        this.board[4][4] = 1; // Black
        this.scores = { 1: 2, 2: 2 };
        this.currentPlayer = 1; // Black starts
        this.gameStarted = false; // Reset game started status
        this.gameOver = false;
        this.winner = null;
        this.moveHistory = [];
        this.lastActivity = Date.now();
    }

    addPlayer(socketId, playerName, playerPieceShape) {
        if (this.players.length < 2) {
            // Check for reconnecting player
            const existingPlayer = this.players.find(p => p.name === playerName && !p.connected);
            if (existingPlayer) {
                existingPlayer.id = socketId;
                existingPlayer.connected = true;
                existingPlayer.pieceShape = playerPieceShape; // Update piece shape on reconnect
                this.lastActivity = Date.now();
                return { success: true, reconnected: true };
            }

            // New player - add as white player
            const playerColor = 2; // Second player is always white
            this.players.push({
                id: socketId,
                name: playerName,
                color: playerColor,
                connected: true,
                isHost: false,
                pieceShape: playerPieceShape // Store piece shape for new player
            });
            this.lastActivity = Date.now();
            return { success: true, reconnected: false };
        }
        return { success: false, reason: 'Room is full' };
    }

    removePlayer(socketId) {
        const playerIndex = this.players.findIndex(p => p.id === socketId);
        if (playerIndex !== -1) {
            this.players[playerIndex].connected = false; // Mark as disconnected
            this.lastActivity = Date.now();
            return this.players[playerIndex];
        }
        return null;
    }

    // Helper to get actual connected player count
    getConnectedPlayerCount() {
        return this.players.filter(p => p.connected).length;
    }

    startGame() {
        if (this.players.length === 2) {
            this.gameStarted = true;
            this.gameOver = false;
            this.initializeBoard();
            this.lastActivity = Date.now();
            console.log(`Game started in room ${this.id}`);
            return true;
        }
        return false;
    }

    resetGame() {
        this.initializeBoard();
        this.gameStarted = false; // Set to false, host can start again
        this.gameOver = false;
        this.winner = null;
        this.lastActivity = Date.now();
        console.log(`Room ${this.id} game reset.`);
    }

    calculateValidMoves(player) {
        const validMoves = [];
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if (this.board[r][c] === 0 && this.isValidMove(r, c, player)) {
                    validMoves.push({ r, c });
                }
            }
        }
        return validMoves;
    }

    isValidMove(r, c, player) {
        if (this.board[r][c] !== 0) return false;

        const opponent = player === 1 ? 2 : 1;
        let foundFlip = false;

        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue; // Skip current cell

                let nr = r + dr;
                let nc = c + dc;
                let path = [];

                // Traverse in direction (dr, dc) as long as we find opponent's pieces
                while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && this.board[nr][nc] === opponent) {
                    path.push({ r: nr, c: nc });
                    nr += dr;
                    nc += dc;
                }

                // If we found opponent's pieces and then found our own piece, it's a valid flip
                if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && this.board[nr][nc] === player && path.length > 0) {
                    foundFlip = true;
                    break;
                }
            }
            if (foundFlip) break;
        }
        return foundFlip;
    }

    applyMove(r, c, player) {
        this.board[r][c] = player; // Place the new piece
        const opponent = player === 1 ? 2 : 1;
        let piecesFlipped = 0;

        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue;

                let nr = r + dr;
                let nc = c + dc;
                let path = [];

                while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && this.board[nr][nc] === opponent) {
                    path.push({ r: nr, c: nc });
                    nr += dr;
                    nc += dc;
                }

                if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && this.board[nr][nc] === player && path.length > 0) {
                    path.forEach(pos => {
                        this.board[pos.r][pos.c] = player; // Flip pieces
                        piecesFlipped++;
                    });
                }
            }
        }
        return piecesFlipped;
    }

    updateScores() {
        let blackScore = 0;
        let whiteScore = 0;
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if (this.board[r][c] === 1) blackScore++;
                else if (this.board[r][c] === 2) whiteScore++;
            }
        }
        this.scores = { 1: blackScore, 2: whiteScore };
    }

    checkGameEnd() {
        const movesForCurrent = this.calculateValidMoves(this.currentPlayer);
        const movesForOpponent = this.calculateValidMoves(this.currentPlayer === 1 ? 2 : 1);

        if (this.scores[1] + this.scores[2] === 64 || // Board is full
            (movesForCurrent.length === 0 && movesForOpponent.length === 0) // No moves for both players
        ) {
            this.gameOver = true;
            this.determineWinner();
            return true;
        }

        // If current player has no moves, switch turn.
        // This is handled by the game logic after a move.
        return false;
    }

    determineWinner() {
        if (this.scores[1] > this.scores[2]) {
            this.winner = 1; // Black wins
        } else if (this.scores[2] > this.scores[1]) {
            this.winner = 2; // White wins
        } else {
            this.winner = 0; // Draw
        }
    }

    addChatMessage(sender, message) {
        this.chatMessages.push({ sender, message, timestamp: Date.now() });
        // Keep chat messages limited to a certain number, e.g., 50
        if (this.chatMessages.length > 50) {
            this.chatMessages.shift();
        }
    }
}

// Utility functions
function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getRoomList() {
    return Array.from(rooms.values()).map(room => ({
        id: room.id,
        name: room.roomName,
        players: room.players.filter(p => p.connected).map(p => ({ name: p.name, color: p.color, pieceShape: p.pieceShape })),
        playerCount: room.getConnectedPlayerCount(),
        gameStarted: room.gameStarted,
        lastActivity: room.lastActivity
    }));
}

function updateLeaderboard(winnerName, loserName, isDraw) {
    leaderboard.set(winnerName, {
        wins: (leaderboard.get(winnerName)?.wins || 0) + (isDraw ? 0 : 1),
        losses: (leaderboard.get(winnerName)?.losses || 0) + (isDraw ? 0 : 0),
        draws: (leaderboard.get(winnerName)?.draws || 0) + (isDraw ? 1 : 0),
    });
    if (!isDraw) {
        leaderboard.set(loserName, {
            wins: (leaderboard.get(loserName)?.wins || 0) + 0,
            losses: (leaderboard.get(loserName)?.losses || 0) + 1,
            draws: (leaderboard.get(loserName)?.draws || 0) + 0,
        });
    } else {
        leaderboard.set(loserName, {
            wins: (leaderboard.get(loserName)?.wins || 0) + 0,
            losses: (leaderboard.get(loserName)?.losses || 0) + 0,
            draws: (leaderboard.get(loserName)?.draws || 0) + 1,
        });
    }
    // Ensure players exist in leaderboard with initial stats if they just joined
    [winnerName, loserName].forEach(name => {
        if (!leaderboard.has(name)) {
            leaderboard.set(name, { wins: 0, losses: 0, draws: 0 });
        }
    });

    saveLeaderboard();
}

function updatePlayerStats(playerName) {
    const stats = gameStats.get(playerName) || { gamesPlayed: 0, totalMoves: 0, avgMoveTime: 0, maxScore: 0 };
    stats.gamesPlayed++;
    // Add logic to update totalMoves, avgMoveTime, maxScore later
    gameStats.set(playerName, stats);
    saveStats();
}

// Socket.IO Connections
io.on('connection', (socket) => {
    console.log(`A user connected: ${socket.id}`);

    // Request room list on connection
    socket.on('requestRoomList', () => {
        socket.emit('updateRoomList', getRoomList());
    });

    // Request stats on connection
    socket.on('requestStats', () => {
        const sortedLeaderboard = Array.from(leaderboard.entries())
            .map(([name, stats]) => ({ name, ...stats }))
            .sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.draws - b.draws); // Sort by wins (desc), then losses (asc), then draws (asc)

        socket.emit('updateStats', {
            totalOnlinePlayers: players.size,
            leaderboard: sortedLeaderboard
        });
    });


    socket.on('createRoom', ({ playerName, playerPieceShape }) => {
        const roomId = generateRoomId();
        const room = new GameRoom(roomId, socket.id, playerName, playerPieceShape);
        rooms.set(roomId, room);
        socket.join(roomId);
        players.set(socket.id, { roomId: roomId, name: playerName, pieceShape: playerPieceShape });
        socket.emit('roomCreated', { roomId, playerColor: 1, board: room.board, players: room.players, scores: room.scores, chatMessages: room.chatMessages, playerPieceShape: playerPieceShape });
        io.emit('updateRoomList', getRoomList());
        console.log(`Room ${roomId} created by ${playerName} with piece ${playerPieceShape}`);
        // Initialize leaderboard entry for host
        if (!leaderboard.has(playerName)) {
            leaderboard.set(playerName, { wins: 0, losses: 0, draws: 0 });
            saveLeaderboard();
        }
        io.emit('updateStats', {
            totalOnlinePlayers: players.size,
            leaderboard: Array.from(leaderboard.entries()).map(([name, stats]) => ({ name, ...stats })).sort((a, b) => b.wins - a.wins)
        });
    });

    socket.on('joinRoom', ({ roomId, playerName, playerPieceShape }) => {
        const room = rooms.get(roomId);
        if (!room) {
            socket.emit('joinRoomError', 'Phòng không tồn tại.');
            return;
        }

        if (room.players.length >= 2) {
            // Check for reconnection attempt by name
            const existingPlayer = room.players.find(p => p.name === playerName);
            if (existingPlayer && !existingPlayer.connected) {
                const { success, reconnected } = room.addPlayer(socket.id, playerName, playerPieceShape);
                if (success && reconnected) {
                    socket.join(roomId);
                    players.set(socket.id, { roomId: roomId, name: playerName, pieceShape: playerPieceShape });
                    // Re-send room state for reconnected player
                    socket.emit('roomJoined', { roomId, playerColor: existingPlayer.color, board: room.board, players: room.players, scores: room.scores, chatMessages: room.chatMessages, gameStarted: room.gameStarted, playerPieceShape: playerPieceShape });
                    io.to(roomId).emit('playerJoined', room.players); // Notify others in room
                    io.emit('updateRoomList', getRoomList());
                    console.log(`Player ${playerName} reconnected to room ${roomId} with piece ${playerPieceShape}`);
                    if (room.gameStarted) {
                        io.to(roomId).emit('gameStarted', {
                            currentPlayer: room.currentPlayer,
                            board: room.board,
                            scores: room.scores,
                            validMoves: room.calculateValidMoves(room.currentPlayer)
                        });
                    }
                    io.emit('updateStats', {
                        totalOnlinePlayers: players.size,
                        leaderboard: Array.from(leaderboard.entries()).map(([name, stats]) => ({ name, ...stats })).sort((a, b) => b.wins - a.wins)
                    });
                    return;
                }
            }
            socket.emit('joinRoomError', 'Phòng đã đầy.');
            return;
        }

        // Add new player to room
        const { success, reconnected } = room.addPlayer(socket.id, playerName, playerPieceShape);
        if (success && !reconnected) {
            socket.join(roomId);
            players.set(socket.id, { roomId: roomId, name: playerName, pieceShape: playerPieceShape });
            const joinedPlayer = room.players.find(p => p.id === socket.id);
            socket.emit('roomJoined', { roomId, playerColor: joinedPlayer.color, board: room.board, players: room.players, scores: room.scores, chatMessages: room.chatMessages, gameStarted: room.gameStarted, playerPieceShape: playerPieceShape });
            io.to(roomId).emit('playerJoined', room.players); // Notify others in room
            io.emit('updateRoomList', getRoomList());
            console.log(`Player ${playerName} joined room ${roomId} with piece ${playerPieceShape}`);

            // Initialize leaderboard entry for new player
            if (!leaderboard.has(playerName)) {
                leaderboard.set(playerName, { wins: 0, losses: 0, draws: 0 });
                saveLeaderboard();
            }

            if (room.players.length === 2) {
                room.startGame();
                const validMoves = room.calculateValidMoves(room.currentPlayer);
                io.to(roomId).emit('gameStarted', {
                    currentPlayer: room.currentPlayer,
                    board: room.board,
                    scores: room.scores,
                    validMoves: validMoves
                });
                console.log(`Game started in room ${roomId} with players: ${room.players.map(p => p.name).join(', ')}`);
            }
        } else if (!success) {
            socket.emit('joinRoomError', room.reason);
        }
        io.emit('updateStats', {
            totalOnlinePlayers: players.size,
            leaderboard: Array.from(leaderboard.entries()).map(([name, stats]) => ({ name, ...stats })).sort((a, b) => b.wins - a.wins)
        });
    });

    // Rejoin Room logic (for page refresh/browser tab close)
    socket.on('rejoinRoom', ({ roomId, playerName }) => {
        const room = rooms.get(roomId);
        if (room) {
            const existingPlayer = room.players.find(p => p.name === playerName);
            if (existingPlayer && !existingPlayer.connected) {
                // Ensure playerPieceShape is also passed or retrieved if needed for display
                const { success, reconnected } = room.addPlayer(socket.id, playerName, existingPlayer.pieceShape); // Use existing pieceShape
                if (success && reconnected) {
                    socket.join(roomId);
                    players.set(socket.id, { roomId: roomId, name: playerName, pieceShape: existingPlayer.pieceShape });
                    socket.emit('roomJoined', { roomId, playerColor: existingPlayer.color, board: room.board, players: room.players, scores: room.scores, chatMessages: room.chatMessages, gameStarted: room.gameStarted, playerPieceShape: existingPlayer.pieceShape });
                    io.to(roomId).emit('playerJoined', room.players);
                    io.emit('updateRoomList', getRoomList());
                    console.log(`Player ${playerName} reconnected to room ${roomId}`);
                    if (room.gameStarted) {
                        io.to(roomId).emit('gameStarted', {
                            currentPlayer: room.currentPlayer,
                            board: room.board,
                            scores: room.scores,
                            validMoves: room.calculateValidMoves(room.currentPlayer)
                        });
                    }
                    io.emit('updateStats', {
                        totalOnlinePlayers: players.size,
                        leaderboard: Array.from(leaderboard.entries()).map(([name, stats]) => ({ name, ...stats })).sort((a, b) => b.wins - a.wins)
                    });
                    return;
                }
            }
        }
        socket.emit('roomNotFound', 'Không thể tham gia lại phòng. Phòng không tồn tại hoặc đã đầy.');
    });


    socket.on('makeMove', ({ roomId, row, col }) => {
        const room = rooms.get(roomId);
        if (!room || !room.gameStarted || room.gameOver) {
            socket.emit('invalidMove', 'Trò chơi chưa bắt đầu hoặc đã kết thúc.');
            return;
        }

        const playerInfo = room.players.find(p => p.id === socket.id);
        if (!playerInfo || playerInfo.color !== room.currentPlayer) {
            socket.emit('invalidMove', 'Không phải lượt của bạn!');
            return;
        }

        if (room.isValidMove(row, col, room.currentPlayer)) {
            const piecesFlipped = room.applyMove(row, col, room.currentPlayer);
            room.updateScores();
            room.moveHistory.push({ player: room.currentPlayer, row, col, flipped: piecesFlipped });
            room.lastActivity = Date.now();

            let nextPlayer = room.currentPlayer === 1 ? 2 : 1;
            let movesForNextPlayer = room.calculateValidMoves(nextPlayer);

            if (movesForNextPlayer.length === 0) {
                // Next player has no moves, check if current player has moves
                const movesForCurrentPlayer = room.calculateValidMoves(room.currentPlayer);
                if (movesForCurrentPlayer.length === 0) {
                    // Both players have no moves, game ends
                    room.checkGameEnd();
                    io.to(roomId).emit('gameEnd', { winner: room.winner, scores: room.scores });
                    if (room.winner !== null) {
                        const winnerName = room.players.find(p => p.color === room.winner)?.name;
                        const loserName = room.players.find(p => p.color !== room.winner)?.name;
                        if (winnerName && loserName) {
                            updateLeaderboard(winnerName, loserName, room.winner === 0);
                        }
                    }
                    console.log(`Game ended in room ${roomId}. Winner: ${room.winner}`);
                } else {
                    // Current player gets another turn (opponent has no moves)
                    io.to(roomId).emit('noMovesLeft', { currentPlayer: nextPlayer, scores: room.scores, board: room.board });
                    console.log(`Player ${nextPlayer} has no moves. ${room.currentPlayer} plays again.`);
                    // currentPlayer remains the same
                }
            } else {
                room.currentPlayer = nextPlayer; // Switch turn normally
            }

            // Emit game update to all players in the room
            io.to(roomId).emit('gameUpdate', {
                board: room.board,
                currentPlayer: room.currentPlayer,
                scores: room.scores,
                validMoves: room.calculateValidMoves(room.currentPlayer)
            });

        } else {
            socket.emit('invalidMove', 'Nước đi không hợp lệ!');
        }
    });

    socket.on('chatMessage', ({ roomId, message }) => {
        const room = rooms.get(roomId);
        const player = players.get(socket.id);
        if (room && player) {
            room.addChatMessage(player.name, message);
            io.to(roomId).emit('chatMessage', { sender: player.name, message, timestamp: Date.now() });
            room.lastActivity = Date.now();
        }
    });

    socket.on('resetGame', ({ roomId }) => {
        const room = rooms.get(roomId);
        if (room) {
            const playerInfo = room.players.find(p => p.id === socket.id);
            if (playerInfo && playerInfo.isHost) {
                room.resetGame();
                io.to(roomId).emit('gameStarted', {
                    currentPlayer: room.currentPlayer,
                    board: room.board,
                    scores: room.scores,
                    validMoves: room.calculateValidMoves(room.currentPlayer)
                });
                io.to(roomId).emit('chatMessage', { sender: 'System', message: 'Trò chơi đã được chủ phòng khởi động lại!', timestamp: Date.now() });
                console.log(`Game in room ${roomId} reset by host.`);
            } else {
                socket.emit('error', 'Chỉ chủ phòng mới có thể reset trò chơi.');
            }
        }
    });


    socket.on('leaveRoom', ({ roomId }) => {
        const room = rooms.get(roomId);
        if (room) {
            const playerLeft = room.removePlayer(socket.id);
            if (playerLeft) {
                players.delete(socket.id);
                socket.leave(roomId);
                io.to(roomId).emit('playerLeft', room.players);
                io.emit('updateRoomList', getRoomList());
                console.log(`Player ${playerLeft.name} left room ${roomId}.`);
                if (room.getConnectedPlayerCount() === 0) {
                    rooms.delete(roomId);
                    console.log(`Room ${roomId} is empty and has been removed.`);
                } else if (room.getConnectedPlayerCount() === 1 && room.gameStarted) {
                    // If one player leaves in a 2-player game, end the game
                    room.gameOver = true;
                    room.winner = room.players.find(p => p.connected)?.color; // The remaining player wins
                    io.to(roomId).emit('gameEnd', { winner: room.winner, scores: room.scores });
                    const winnerName = room.players.find(p => p.color === room.winner)?.name;
                    const loserName = playerLeft.name;
                    if (winnerName && loserName) {
                        updateLeaderboard(winnerName, loserName, false); // Not a draw
                    }
                    console.log(`Game in room ${roomId} ended due to player leaving. Winner: ${winnerName}`);
                }
            }
        }
        io.emit('updateStats', {
            totalOnlinePlayers: players.size,
            leaderboard: Array.from(leaderboard.entries()).map(([name, stats]) => ({ name, ...stats })).sort((a, b) => b.wins - a.wins)
        });
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        const player = players.get(socket.id);
        if (player) {
            players.delete(socket.id); // Remove from global players map

            const room = rooms.get(player.roomId);
            if (room) {
                const disconnectedPlayer = room.removePlayer(socket.id); // Mark as disconnected in room
                io.to(room.id).emit('playerLeft', room.players); // Notify others in the room
                io.emit('updateRoomList', getRoomList());

                console.log(`Player ${disconnectedPlayer.name} disconnected from room ${room.id}.`);

                // If only one player is left and game was active, end the game for that room
                if (room.getConnectedPlayerCount() === 1 && room.gameStarted) {
                    room.gameOver = true;
                    room.winner = room.players.find(p => p.connected)?.color; // The remaining player wins
                    io.to(room.id).emit('gameEnd', { winner: room.winner, scores: room.scores });
                    const winnerName = room.players.find(p => p.color === room.winner)?.name;
                    const loserName = disconnectedPlayer.name;
                    if (winnerName && loserName) {
                        updateLeaderboard(winnerName, loserName, false); // Not a draw
                    }
                    console.log(`Game in room ${room.id} ended due to disconnection. Winner: ${winnerName}`);
                }
                // If room becomes empty, consider deleting it after a timeout or immediately
                if (room.getConnectedPlayerCount() === 0) {
                    // Add a timeout to delete room if no one reconnects
                    setTimeout(() => {
                        if (room.getConnectedPlayerCount() === 0) {
                            rooms.delete(room.id);
                            io.emit('updateRoomList', getRoomList());
                            console.log(`Room ${room.id} deleted due to inactivity after disconnection.`);
                        }
                    }, 60 * 1000); // 1 minute grace period
                }
            }
        }
        io.emit('updateStats', {
            totalOnlinePlayers: players.size,
            leaderboard: Array.from(leaderboard.entries()).map(([name, stats]) => ({ name, ...stats })).sort((a, b) => b.wins - a.wins)
        });
    });
});

// Cleanup inactive rooms periodically
setInterval(() => {
    const now = Date.now();
    let cleanedRooms = 0;
    for (const [roomId, room] of rooms.entries()) {
        // If room has no connected players for 10 minutes, remove it
        if (room.getConnectedPlayerCount() === 0 && (now - room.lastActivity > 10 * 60 * 1000)) {
            rooms.delete(roomId);
            cleanedRooms++;
            console.log(`Cleaned up inactive room: ${roomId}`);
        } else if (room.getConnectedPlayerCount() > 0 && (now - room.lastActivity > 30 * 60 * 1000) && !room.gameStarted) {
            // If room has connected players but no game started for 30 minutes, remove it
            rooms.delete(roomId);
            cleanedRooms++;
            console.log(`Cleaned up stale room (no game started): ${roomId}`);
            // Also disconnect remaining players
            room.players.forEach(p => {
                if (p.connected) {
                    io.to(p.id).emit('roomNotFound', 'Phòng đã bị xóa do không hoạt động.');
                    io.sockets.sockets.get(p.id)?.disconnect(true);
                }
            });
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
initializeDataDirectory().then(() => {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`🚀 Othello Server running on port ${PORT}`);
        console.log(`Access the game at http://localhost:${PORT}`);
    });
});
