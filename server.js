// ================================
// SERVER.JS - Enhanced Backend Server
// ================================
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
        origin: "*", // Cho phép tất cả các nguồn truy cập (có thể thay đổi thành miền cụ thể của bạn)
        methods: ["GET", "POST"]
    }
});

// Middleware  
app.use(helmet({
    contentSecurityPolicy: false, // Bạn có thể muốn cấu hình CSP cụ thể hơn
    crossOriginEmbedderPolicy: false
}));
app.use(compression()); // Nén phản hồi HTTP
app.use(cors()); // Cho phép Cross-Origin Resource Sharing
app.use(express.json()); // Phân tích các yêu cầu JSON
app.use(express.static(path.join(__dirname, 'public'))); // Phục vụ các tệp tĩnh từ thư mục 'public'

// Game rooms storage
// rooms: Map<roomId, GameRoom instance>
// players: Map<socket.id, { roomId, playerName }>
// leaderboard: Map<playerName, { name, rating, wins, losses }>
// gameStats: Map<playerName, { name, totalGames, wins, losses, ties, pointsScored, pointsConceded }>
const rooms = new Map();
const players = new Map();
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
        const parsedData = JSON.parse(data);
        parsedData.forEach(entry => leaderboard.set(entry.name, entry));
        console.log('Leaderboard loaded successfully.');
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
        console.log('Leaderboard saved successfully.');
    } catch (error) {
        console.error('Error saving leaderboard:', error);
    }
}

// Game Stats management
async function loadStats() {
    try {
        const data = await fs.readFile(STATS_FILE, 'utf8');
        const parsedData = JSON.parse(data);
        parsedData.forEach(entry => gameStats.set(entry.name, entry));
        console.log('Game stats loaded successfully.');
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
        console.log('Game stats saved successfully.');
    } catch (error) {
        console.error('Error saving game stats:', error);
    }
}

// Helper function to update player stats
function updatePlayerStats(playerName, result) { // 'win', 'loss', 'tie'
    let stats = gameStats.get(playerName) || { name: playerName, totalGames: 0, wins: 0, losses: 0, ties: 0, pointsScored: 0, pointsConceded: 0 };
    stats.totalGames++;
    if (result === 'win') stats.wins++;
    else if (result === 'loss') stats.losses++;
    else if (result === 'tie') stats.ties++;
    gameStats.set(playerName, stats);
    saveStats();
}

// Helper function to update leaderboard rating (simplified ELO-like system)
function updateLeaderboardRating(winnerName, loserName, tie = false) {
    let winner = leaderboard.get(winnerName) || { name: winnerName, rating: 1000, wins: 0, losses: 0 };
    let loser = leaderboard.get(loserName) || { name: loserName, rating: 1000, wins: 0, losses: 0 };

    const K = 32; // K-factor

    if (tie) {
        // No rating change for ties in this simplified model, but update wins/losses
        winner.wins++;
        loser.wins++; // Both get a win in a tie for simplified tracking
    } else {
        const expectedWinProb = 1 / (1 + Math.pow(10, (loser.rating - winner.rating) / 400));
        const expectedLossProb = 1 / (1 + Math.pow(10, (winner.rating - loser.rating) / 400));

        winner.rating = Math.round(winner.rating + K * (1 - expectedWinProb));
        loser.rating = Math.round(loser.rating + K * (0 - expectedLossProb));

        winner.wins++;
        loser.losses++;
    }

    leaderboard.set(winnerName, winner);
    leaderboard.set(loserName, loser);
    saveLeaderboard();
}


// Game Logic
// =====================================

class GameRoom {
    constructor(id, hostSocketId, hostName, mode = 'online') {
        this.id = id;
        this.gameMode = mode; // 'online', 'local', 'ai'
        this.board = Array(8).fill(0).map(() => Array(8).fill(0)); // 0: empty, 1: black, 2: white
        this.currentPlayer = 1; // 1 for black, 2 for white
        this.players = [
            { id: hostSocketId, name: hostName, color: 1, connected: true }, // Host is always black (1)
        ];
        this.spectators = []; // For future spectator mode
        this.gameStarted = false;
        this.gameOver = false;
        this.winner = null;
        this.scores = { 1: 0, 2: 0 }; // Scores for black and white
        this.lastActivity = Date.now();
        this.chatMessages = []; // Store chat messages
        this.initializeBoard();
    }

    initializeBoard() {
        this.board = Array(8).fill(0).map(() => Array(8).fill(0));
        this.board[3][3] = 2; // White
        this.board[3][4] = 1; // Black
        this.board[4][3] = 1; // Black
        this.board[4][4] = 2; // White
        this.updateScores();
    }

    addPlayer(socketId, playerName) {
        if (this.players.length < 2 && !this.players.some(p => p.id === socketId)) {
            // Assign the second player as white (2)
            const playerColor = this.players[0].color === 1 ? 2 : 1; 
            this.players.push({ id: socketId, name: playerName, color: playerColor, connected: true });
            this.lastActivity = Date.now();
            return true;
        }
        return false;
    }

    removePlayer(socketId) {
        this.players = this.players.filter(p => p.id !== socketId);
        this.spectators = this.spectators.filter(s => s.id !== socketId);
        this.lastActivity = Date.now();
    }

    addSpectator(socketId, spectatorName) {
        if (!this.spectators.some(s => s.id === socketId) && !this.players.some(p => p.id === socketId)) {
            this.spectators.push({ id: socketId, name: spectatorName });
            this.lastActivity = Date.now();
            return true;
        }
        return false;
    }

    getPlayerBySocketId(socketId) {
        return this.players.find(p => p.id === socketId);
    }

    getPlayerByColor(color) {
        return this.players.find(p => p.color === color);
    }

    // Call this when the second player joins and game is ready to start
    startGame() {
        if (this.players.length === 2 && !this.gameStarted) {
            this.gameStarted = true;
            this.gameOver = false;
            this.winner = null;
            this.initializeBoard();
            console.log(`Game started in room ${this.id}`);
        }
    }

    getValidMoves(playerColor) {
        const moves = [];
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if (this.board[r][c] === 0 && this.isValidMove(r, c, playerColor, false)) {
                    moves.push({ r, c });
                }
            }
        }
        return moves;
    }

    isValidMove(row, col, playerColor, executeFlip) {
        if (this.board[row][col] !== 0) {
            return false;
        }

        const opponentColor = playerColor === 1 ? 2 : 1;
        let flippedDiscs = [];
        let isValid = false;

        const directions = [
            [-1, -1], [-1, 0], [-1, 1], // Top-left, Top, Top-right
            [0, -1],           [0, 1],   // Left, Right
            [1, -1], [1, 0], [1, 1]    // Bottom-left, Bottom, Bottom-right
        ];

        for (const [dr, dc] of directions) {
            let r = row + dr;
            let c = col + dc;
            let currentDirFlipped = [];

            while (r >= 0 && r < 8 && c >= 0 && c < 8 && this.board[r][c] === opponentColor) {
                currentDirFlipped.push({ r, c });
                r += dr;
                c += dc;
            }

            if (r >= 0 && r < 8 && c >= 0 && c < 8 && this.board[r][c] === playerColor && currentDirFlipped.length > 0) {
                isValid = true;
                if (executeFlip) {
                    flippedDiscs = flippedDiscs.concat(currentDirFlipped);
                }
            }
        }

        if (executeFlip && isValid) {
            this.board[row][col] = playerColor;
            for (const { r, c } of flippedDiscs) {
                this.board[r][c] = playerColor;
            }
        }
        return isValid;
    }

    makeMove(row, col, playerSocketId) {
        this.lastActivity = Date.now();
        const player = this.getPlayerBySocketId(playerSocketId);
        if (!player || player.color !== this.currentPlayer) {
            console.log(`Invalid move: Not current player or player not in room. Player: ${playerSocketId}, Current Turn: ${this.currentPlayer}`);
            return false;
        }

        if (!this.gameStarted || this.gameOver) {
            console.log(`Invalid move: Game not started or already over.`);
            return false;
        }

        if (this.isValidMove(row, col, this.currentPlayer, true)) {
            this.updateScores();
            this.checkGameEnd(); // Check if game ended after this move
            if (!this.gameOver) {
                this.switchPlayer();
                // Check if next player has valid moves, if not, switch back
                if (this.getValidMoves(this.currentPlayer).length === 0) {
                    console.log(`Player ${this.currentPlayer} has no valid moves. Skipping turn.`);
                    this.switchPlayer(); // Switch back
                    if (this.getValidMoves(this.currentPlayer).length === 0) {
                        // If both players have no moves, game ends
                        this.checkGameEnd(true);
                    }
                }
            }
            return true;
        }
        console.log(`Invalid move: Position (${row},${col}) for player ${this.currentPlayer}`);
        return false;
    }

    switchPlayer() {
        this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
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

    checkGameEnd(bothPlayersNoMoves = false) {
        if (this.getValidMoves(1).length === 0 && this.getValidMoves(2).length === 0 || bothPlayersNoMoves) {
            this.gameOver = true;
            if (this.scores[1] > this.scores[2]) {
                this.winner = 1;
            } else if (this.scores[2] > this.scores[1]) {
                this.winner = 2;
            } else {
                this.winner = 0; // Tie
            }
            console.log(`Game over in room ${this.id}. Winner: ${this.winner === 0 ? 'Tie' : this.winner}`);
            this.handleGameResult();
            return true;
        }
        return false;
    }

    handleGameResult() {
        const player1 = this.getPlayerByColor(1);
        const player2 = this.getPlayerByColor(2);

        if (!player1 || !player2) {
            console.warn(`Game ended in room ${this.id} but not enough players to update stats.`);
            return;
        }

        if (this.winner === 1) { // Black wins
            updateLeaderboardRating(player1.name, player2.name);
            updatePlayerStats(player1.name, 'win');
            updatePlayerStats(player2.name, 'loss');
        } else if (this.winner === 2) { // White wins
            updateLeaderboardRating(player2.name, player1.name);
            updatePlayerStats(player2.name, 'win');
            updatePlayerStats(player1.name, 'loss');
        } else if (this.winner === 0) { // Tie
            updateLeaderboardRating(player1.name, player2.name, true); // True for tie
            updatePlayerStats(player1.name, 'tie');
            updatePlayerStats(player2.name, 'tie');
        }
        console.log(`Game results processed for room ${this.id}`);
    }

    addChatMessage(senderName, message) {
        this.chatMessages.push({ sender: senderName, message, timestamp: Date.now() });
        // Keep chat history to a reasonable limit, e.g., last 50 messages
        if (this.chatMessages.length > 50) {
            this.chatMessages.shift();
        }
    }

    getGameState() {
        return {
            id: this.id,
            gameMode: this.gameMode,
            board: this.board,
            currentPlayer: this.currentPlayer,
            players: this.players.map(p => ({ name: p.name, color: p.color, id: p.id })),
            spectators: this.spectators.map(s => ({ name: s.name })),
            gameStarted: this.gameStarted,
            gameOver: this.gameOver,
            winner: this.winner,
            scores: this.scores,
            validMoves: this.gameStarted && !this.gameOver ? this.getValidMoves(this.currentPlayer) : [],
            lastActivity: this.lastActivity,
            chatMessages: this.chatMessages // Include chat messages in game state
        };
    }
}

// Helper to generate a unique, short room ID
function generateRoomId() {
    let id;
    do {
        id = Math.random().toString(36).substring(2, 8).toUpperCase();
    } while (rooms.has(id));
    return id;
}

// Helper function to get a list of active rooms for display
function getRoomList() {
    const activeRooms = [];
    for (const [roomId, room] of rooms.entries()) {
        // Only list online rooms that are not full and not yet started
        if (room.gameMode === 'online' && room.players.length < 2 && !room.gameStarted) {
            activeRooms.push({
                id: roomId,
                players: room.players.map(p => ({ name: p.name, connected: p.connected })),
                playerCount: room.players.length,
                lastActivity: room.lastActivity
            });
        }
    }
    return activeRooms;
}


// Socket.IO Connection Handling
// =====================================
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // --- Room Management Events ---

    // Handle create room event
    socket.on('createRoom', ({ playerName }) => {
        const roomId = generateRoomId();
        const room = new GameRoom(roomId, socket.id, playerName, 'online');
        rooms.set(roomId, room);
        players.set(socket.id, { roomId, playerName });
        socket.join(roomId);
        console.log(`Room created: ${roomId} by ${playerName}`);
        socket.emit('roomCreated', room.getGameState()); // Gửi trạng thái phòng cho người tạo
        io.emit('updateRoomList', getRoomList()); // Cập nhật danh sách phòng cho tất cả các máy khách
    });

    // Handle join room event
    socket.on('joinRoom', ({ roomId, playerName }) => {
        const room = rooms.get(roomId);
        if (room && room.gameMode === 'online' && room.players.length < 2) {
            if (room.addPlayer(socket.id, playerName)) {
                players.set(socket.id, { roomId, playerName });
                socket.join(roomId);
                console.log(`${playerName} joined room: ${roomId}`);
                io.to(roomId).emit('playerJoined', room.getGameState()); // Gửi trạng thái phòng mới
                
                if (room.players.length === 2) {
                    room.startGame(); // Bắt đầu trò chơi khi đủ người
                    io.to(roomId).emit('gameStarted', room.getGameState());
                }
                io.emit('updateRoomList', getRoomList()); // Cập nhật danh sách phòng
            } else {
                socket.emit('joinRoomError', { message: 'Failed to add player to room.' });
            }
        } else if (room && room.players.length >= 2) {
            socket.emit('joinRoomError', { message: 'Room is full.' });
        } else {
            socket.emit('joinRoomError', { message: 'Room not found.' });
        }
    });

    // Handle leave room event
    socket.on('leaveRoom', () => {
        const playerInfo = players.get(socket.id);
        if (playerInfo) {
            const room = rooms.get(playerInfo.roomId);
            if (room) {
                room.removePlayer(socket.id);
                socket.leave(playerInfo.roomId);
                // Nếu phòng trống hoàn toàn (cả người chơi và người xem), xóa phòng
                if (room.players.length === 0 && room.spectators.length === 0) {
                    rooms.delete(playerInfo.roomId);
                    console.log(`Room ${playerInfo.roomId} deleted after all players/spectators left.`);
                } else {
                    io.to(playerInfo.roomId).emit('playerLeft', room.getGameState());
                }
                io.emit('updateRoomList', getRoomList()); // Cập nhật danh sách phòng
            }
            players.delete(socket.id);
        }
    });

    // --- Game Play Events ---

    socket.on('makeMove', ({ row, col }) => {
        const playerInfo = players.get(socket.id);
        if (playerInfo) {
            const room = rooms.get(playerInfo.roomId);
            if (room && room.gameStarted && !room.gameOver) {
                if (room.makeMove(row, col, socket.id)) {
                    io.to(playerInfo.roomId).emit('gameStateUpdate', room.getGameState());
                } else {
                    socket.emit('invalidMove', { message: 'Invalid move or not your turn.' });
                }
            }
        }
    });

    socket.on('requestGameState', () => {
        const playerInfo = players.get(socket.id);
        if (playerInfo) {
            const room = rooms.get(playerInfo.roomId);
            if (room) {
                socket.emit('gameStateUpdate', room.getGameState());
            }
        }
    });

    // --- Chat Events ---
    socket.on('chatMessage', ({ roomId, playerName, message }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.addChatMessage(playerName, message);
            io.to(roomId).emit('newChatMessage', { sender: playerName, message, timestamp: Date.now() });
        }
    });

    // --- Disconnect Handling ---
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        const playerInfo = players.get(socket.id);
        if (playerInfo) {
            const room = rooms.get(playerInfo.roomId);
            if (room) {
                // Đánh dấu người chơi là bị ngắt kết nối thay vì xóa ngay lập tức
                const disconnectedPlayer = room.players.find(p => p.id === socket.id);
                if (disconnectedPlayer) {
                    disconnectedPlayer.connected = false;
                }
                
                // Nếu cả hai người chơi ngắt kết nối hoặc một người chơi và không có người xem
                if (room.players.every(p => !p.connected) && room.spectators.length === 0) {
                    rooms.delete(playerInfo.roomId);
                    console.log(`Room ${playerInfo.roomId} deleted due to all players disconnected.`);
                } else {
                    io.to(playerInfo.roomId).emit('playerDisconnected', room.getGameState());
                }
                io.emit('updateRoomList', getRoomList());
            }
            players.delete(socket.id); // Xóa khỏi bản đồ người chơi
        }
    });
});


// API Endpoints
// =====================================

// Get list of active rooms
app.get('/api/rooms', (req, res) => {
    res.json(getRoomList());
});

// Get specific room state (useful for direct links or debugging)
app.get('/api/room/:roomId', (req, res) => {
    const room = rooms.get(req.params.roomId);
    if (room) {
        res.json(room.getGameState());
    } else {
        res.status(404).json({ error: 'Room not found' });
    }
});

// Get leaderboard data
app.get('/api/leaderboard', (req, res) => {
    const leaderData = Array.from(leaderboard.values())
        .sort((a, b) => b.rating - a.rating)
        .slice(0, 20); // Top 20
    res.json(leaderData);
});

// Get player stats
app.get('/api/stats/:playerName', (req, res) => {
    const stats = gameStats.get(req.params.playerName);
    if (stats) {
        res.json(stats);
    } else {
        res.status(404).json({ error: 'Player stats not found' });
    }
});

// Clean up inactive rooms every hour
setInterval(() => {
    const now = Date.now();
    // Thời gian chờ hoạt động: 30 phút (để đủ thời gian cho trận đấu)
    const INACTIVE_TIMEOUT = 30 * 60 * 1000; 
    
    for (const [roomId, room] of rooms.entries()) {
        if (now - room.lastActivity > INACTIVE_TIMEOUT) {
            // Chỉ xóa các phòng không có người chơi nào đang kết nối
            if (room.players.every(p => !p.connected) && room.spectators.length === 0) {
                rooms.delete(roomId);
                console.log(`Cleaned up inactive room: ${roomId}`);
                io.emit('updateRoomList', getRoomList()); // Cập nhật danh sách phòng
            }
        }
    }
}, 5 * 60 * 1000); // Chạy kiểm tra mỗi 5 phút

// Start the server
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    initializeDataDirectory(); // Đảm bảo thư mục dữ liệu được khởi tạo khi máy chủ khởi động
});
