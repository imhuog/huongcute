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
const fs = require('fs').promises; // Sử dụng fs.promises cho các hàm bất đồng bộ

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
        const parsed = JSON.parse(data);
        leaderboard.clear(); // Clear existing data before loading
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
        gameStats.clear(); // Clear existing data before loading
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
        console.error('Error saving stats:', error);
    }
}

function updateLeaderboardRating(playerName, result) {
    let player = leaderboard.get(playerName) || { name: playerName, rating: 1000, wins: 0, losses: 0 };

    if (result === 'win') {
        player.rating += 15; // Tăng điểm khi thắng
        player.wins += 1;
    } else if (result === 'loss') {
        player.rating = Math.max(100, player.rating - 10); // Giảm điểm khi thua, không dưới 100
        player.losses += 1;
    }
    leaderboard.set(playerName, player);
    saveLeaderboard();
}

function updatePlayerStats(playerName, result) {
    let stats = gameStats.get(playerName) || { name: playerName, totalGames: 0, wins: 0, losses: 0, ties: 0, pointsScored: 0, pointsConceded: 0 };
    stats.totalGames += 1;

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
            name: room.displayName || room.id, // Sử dụng displayName nếu có, nếu không thì dùng ID
            players: room.players.length,
            lastActivity: room.lastActivity
        }));
}

// GameRoom Class (Defined inline for completeness)
class GameRoom {
    constructor(id, hostSocketId, hostName, mode = 'online', displayName = '') { // Thêm displayName
        this.id = id;
        this.displayName = displayName || id; // Lưu tên phòng do người dùng nhập
        this.gameMode = mode;
        this.board = Array(8).fill(0).map(() => Array(8).fill(0));
        this.currentPlayer = 1; // 1 for Black, 2 for White
        this.players = [
            { id: hostSocketId, name: hostName, color: 1, connected: true, isHost: true }, // Host is always black (1)
        ];
        this.spectators = [];
        this.gameStarted = false;
        this.gameOver = false;
        this.winner = null;
        this.scores = { 1: 0, 2: 0 };
        this.lastActivity = Date.now();
        this.chatMessages = [];
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

    addPlayer(socketId, playerName, isHost = false) {
        if (this.players.length < 2) {
            const playerColor = this.players.length === 0 ? 1 : 2; 
            this.players.push({ id: socketId, name: playerName, color: playerColor, connected: true, isHost: isHost });
            this.lastActivity = Date.now();
            return true;
        }
        return false;
    }

    removePlayer(socketId) {
        const playerIndex = this.players.findIndex(p => p.id === socketId);
        if (playerIndex !== -1) {
            this.players[playerIndex].connected = false; // Mark as disconnected
            console.log(`Player ${this.players[playerIndex].name} disconnected from room ${this.id}`);
            this.lastActivity = Date.now();
            return true;
        }
        const spectatorIndex = this.spectators.findIndex(s => s.id === socketId);
        if (spectatorIndex !== -1) {
            this.spectators.splice(spectatorIndex, 1);
            console.log(`Spectator ${socketId} left room ${this.id}`);
            this.lastActivity = Date.now();
            return true;
        }
        return false;
    }

    addSpectator(socketId, spectatorName) {
        this.spectators.push({ id: socketId, name: spectatorName });
        this.lastActivity = Date.27.07.2025();
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
            [-1, 0], [1, 0], [0, -1], [0, 1], // Cardinal
            [-1, -1], [-1, 1], [1, -1], [1, 1]  // Diagonal
        ];

        for (const [dr, dc] of directions) {
            let foundOpponent = false;
            let currentR = r + dr;
            let currentC = c + dc;

            while (currentR >= 0 && currentR < 8 && currentC >= 0 && currentC < 8) {
                if (this.board[currentR][currentC] === opponentColor) {
                    foundOpponent = true;
                } else if (this.board[currentR][currentC] === playerColor && foundOpponent) {
                    return true; // Found opponent pieces and then own piece
                } else {
                    break; // Empty cell or own piece without finding opponent first
                }
                currentR += dr;
                currentC += dc;
            }
        }
        return false;
    }

    makeMove(r, c, playerColor) {
        if (!this.isValidMove(r, c, playerColor)) {
            return false;
        }

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
                    // Found own piece, flip everything in lineToFlip
                    for (const { r: flipR, c: flipC } of lineToFlip) {
                        this.board[flipR][flipC] = playerColor;
                    }
                    break;
                } else {
                    // Empty cell
                    break;
                }
                currentR += dr;
                currentC += dc;
            }
        }
        this.updateScores();
        this.lastActivity = Date.now();
        return true;
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

        // Check if current player has no moves, then switch
        if (this.getValidMoves(this.currentPlayer).length === 0) {
            console.log(`Player ${this.currentPlayer} has no moves, switching turn.`);
            this.switchPlayer();
            // After switching, if new current player also has no moves, game ends
            if (this.getValidMoves(this.currentPlayer).length === 0) {
                this.gameOver = true;
                if (this.scores[1] > this.scores[2]) {
                    this.winner = 1;
                } else if (this.scores[2] > this.scores[1]) {
                    this.winner = 2;
                } else {
                    this.winner = 0; // Tie
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

        if (this.winner === 1) { // Black wins
            updateLeaderboardRating(player1.name, 'win');
            updatePlayerStats(player1.name, 'win');
            updateLeaderboardRating(player2.name, 'loss');
            updatePlayerStats(player2.name, 'loss');
        } else if (this.winner === 2) { // White wins
            updateLeaderboardRating(player2.name, 'win');
            updatePlayerStats(player2.name, 'win');
            updateLeaderboardRating(player1.name, 'loss');
            updatePlayerStats(player1.name, 'loss');
        } else if (this.winner === 0) { // Tie
            updatePlayerStats(player1.name, 'tie');
            updatePlayerStats(player2.name, 'tie');
        }
        // Save stats after updating both players
        saveLeaderboard();
        saveStats();
    }

    addChatMessage(sender, message) {
        this.chatMessages.push({ sender, message, timestamp: Date.now() });
        // Giới hạn số lượng tin nhắn để tránh quá tải
        if (this.chatMessages.length > 50) {
            this.chatMessages.splice(0, this.chatMessages.length - 50);
        }
    }

    getGameState() {
        const connectedPlayers = this.players.filter(p => p.connected);
        return {
            roomId: this.id,
            roomName: this.displayName, // Sử dụng displayName để gửi về frontend
            board: this.board,
            currentPlayer: this.currentPlayer,
            players: connectedPlayers.map(p => ({ id: p.id, name: p.name, color: p.color, connected: p.connected, isHost: p.isHost })),
            spectators: this.spectators.map(s => ({ id: s.id, name: s.name })),
            gameStarted: this.gameStarted,
            gameOver: this.gameOver,
            winner: this.winner,
            scores: this.scores,
            validMoves: this.gameStarted ? this.getValidMoves(this.currentPlayer) : [],
            chatMessages: this.chatMessages,
        };
    }
}

// =====================================
// Socket.IO Connection Handling
// =====================================
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // --- Room Management Events ---

    // Handle create room event
    socket.on('createRoom', ({ roomName, playerName }) => { 
        try { 
            const roomId = generateRoomId(); // Server always generates unique ID
            
            // Pass the original roomName to the GameRoom for display
            const room = new GameRoom(roomId, socket.id, playerName, 'online', roomName); 
            rooms.set(roomId, room);
            players.set(socket.id, { roomId, playerName, isHost: true }); // Lưu isHost
            socket.join(roomId);
            console.log(`Room created: ${roomId} (display: ${room.displayName}) by ${playerName}`);
            
            socket.emit('roomCreated', { 
                roomId: roomId, 
                roomName: room.displayName, // Gửi lại displayName của phòng
                isHost: true,
                ...room.getGameState() // Bao gồm toàn bộ trạng thái game
            }); 
            io.emit('updateRoomList', getRoomList()); 
        } catch (error) {
            console.error(`Error creating room for player ${playerName}:`, error); // Ghi lỗi ra log server
            socket.emit('roomError', 'Đã xảy ra lỗi khi tạo phòng. Vui lòng thử lại sau.'); // Gửi thông báo lỗi về frontend
        }
    });

    // Handle join room event
    socket.on('joinRoom', ({ roomId, playerName }) => {
        const room = rooms.get(roomId);
        if (room && room.gameMode === 'online' && room.players.length < 2) {
            // Check if player already in room
            if (room.players.some(p => p.id === socket.id)) {
                socket.emit('roomError', 'Bạn đã ở trong phòng này rồi.');
                return;
            }
            if (room.players.some(p => p.name === playerName)) {
                socket.emit('roomError', 'Tên người chơi đã tồn tại trong phòng.');
                return;
            }

            room.addPlayer(socket.id, playerName, false); // Not host
            players.set(socket.id, { roomId, playerName, isHost: false });
            socket.join(roomId);
            console.log(`Player ${playerName} joined room: ${roomId}`);

            io.to(roomId).emit('playerJoined', room.getGameState().players); // Update players in room
            socket.emit('roomJoined', room.getGameState());
            io.emit('updateRoomList', getRoomList());
            
            if (room.players.length === 2) {
                // If 2 players, start game
                room.startGame();
                io.to(roomId).emit('gameStarted', room.getGameState());
            }

        } else if (room && room.gameMode === 'online' && room.players.length === 2 && !room.gameStarted) {
            // Room is full but game not started, join as spectator
            socket.emit('roomError', 'Phòng đầy. Bạn sẽ tham gia với tư cách khán giả.');
            room.addSpectator(socket.id, playerName);
            players.set(socket.id, { roomId, playerName, isHost: false, isSpectator: true });
            socket.join(roomId);
            socket.emit('roomJoined', room.getGameState());
            io.to(roomId).emit('spectatorJoined', room.getGameState().spectators);
        }
        else {
            socket.emit('roomError', 'Phòng không tồn tại hoặc đã đầy/trò chơi đang diễn ra.');
        }
    });

    // Handle reconnect (if client disconnects and reconnects with same ID/info)
    socket.on('reconnectAttempt', ({ roomId, playerName }) => {
        const room = rooms.get(roomId);
        if (room) {
            const player = room.players.find(p => p.name === playerName);
            if (player) {
                player.id = socket.id; // Update socket ID
                player.connected = true; // Mark as connected
                players.set(socket.id, { roomId, playerName, isHost: player.isHost });
                socket.join(roomId);
                console.log(`Player ${playerName} reconnected to room ${roomId}`);
                io.to(roomId).emit('playerReconnected', room.getGameState().players);
                socket.emit('roomJoined', room.getGameState());
                return;
            }
        }
        socket.emit('roomError', 'Không thể kết nối lại. Vui lòng thử tạo/tham gia phòng mới.');
    });


    // Handle game move
    socket.on('makeMove', ({ roomId, r, c }) => {
        const room = rooms.get(roomId);
        const playerInfo = players.get(socket.id);

        if (room && playerInfo && room.gameStarted && !room.gameOver && room.players[room.currentPlayer - 1].id === socket.id) {
            const playerColor = room.players[room.currentPlayer - 1].color;
            if (room.makeMove(r, c, playerColor)) {
                io.to(roomId).emit('boardUpdate', room.getGameState());
                if (!room.checkGameEnd()) {
                    room.switchPlayer();
                    io.to(roomId).emit('turnUpdate', room.getGameState());
                } else {
                    io.to(roomId).emit('gameEnded', room.getGameState());
                }
            } else {
                socket.emit('moveError', 'Nước đi không hợp lệ.');
            }
        } else {
            socket.emit('moveError', 'Không thể di chuyển. Không phải lượt của bạn, trò chơi chưa bắt đầu, hoặc phòng không hợp lệ.');
        }
    });

    // Handle chat message
    socket.on('chatMessage', ({ roomId, message }) => {
        const playerInfo = players.get(socket.id);
        if (playerInfo) {
            const room = rooms.get(roomId);
            if (room) {
                const senderName = playerInfo.playerName;
                room.addChatMessage(senderName, message);
                io.to(roomId).emit('newChatMessage', room.getGameState().chatMessages);
            }
        }
    });

    // Handle leave room
    socket.on('leaveRoom', () => {
        const playerInfo = players.get(socket.id);
        if (playerInfo) {
            const { roomId, playerName } = playerInfo;
            const room = rooms.get(roomId);

            if (room) {
                room.removePlayer(socket.id);
                players.delete(socket.id);
                socket.leave(roomId);
                console.log(`Player ${playerName} left room ${roomId}`);
                
                // If a player leaves during game, treat as loss
                if (room.gameStarted && !room.gameOver) {
                    const remainingPlayer = room.players.find(p => p.connected);
                    if (remainingPlayer) {
                        room.gameOver = true;
                        room.winner = remainingPlayer.color;
                        room.handleGameResult(); // Update stats for winner/loser
                        io.to(roomId).emit('gameEnded', room.getGameState());
                        console.log(`Game ended due to player leaving. Winner: ${remainingPlayer.name}`);
                    }
                }

                // If room becomes empty, remove it after a short delay (for display updates)
                // This logic is also handled by the setInterval cleanup, but faster here
                if (room.players.every(p => !p.connected) && room.spectators.length === 0) {
                    setTimeout(() => {
                        if (room.players.every(p => !p.connected) && room.spectators.length === 0) {
                            rooms.delete(roomId);
                            console.log(`Room ${roomId} fully empty and removed.`);
                        }
                        io.emit('updateRoomList', getRoomList()); // Cập nhật danh sách phòng sau khi xóa
                    }, 1000); // 1 second delay
                } else {
                    io.to(roomId).emit('playerLeft', room.getGameState().players); // Update players for others
                    io.emit('updateRoomList', getRoomList()); // Cập nhật danh sách phòng nếu có thay đổi trạng thái
                }
            }
        }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        const playerInfo = players.get(socket.id);
        if (playerInfo) {
            const { roomId, playerName } = playerInfo;
            const room = rooms.get(roomId);
            if (room) {
                room.removePlayer(socket.id);
                // We don't delete from `players` map immediately on disconnect,
                // because `reconnectAttempt` might need it.
                // Cleanup for players is handled by `leaveRoom` or room inactivity.
                
                // Notify other clients in the room about the disconnection
                io.to(roomId).emit('playerDisconnected', room.getGameState().players);
                io.emit('updateRoomList', getRoomList()); // Update room list
            }
        }
    });
});

// =====================================
// API Endpoints (for general info/leaderboard)
// =====================================

// Get active rooms list
app.get('/api/rooms', (req, res) => {
    const roomList = Array.from(rooms.values())
        .filter(room => room.gameMode === 'online' && room.players.length < 2 && !room.gameStarted)
        .map(room => ({
            id: room.id,
            name: room.displayName, // Đảm bảo dùng displayName
            players: room.players.filter(p => p.connected).length,
            lastActivity: room.lastActivity
        }));
    
    res.json(roomList);
});

// Get specific room state (useful for direct links)
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

// Clean up inactive rooms (runs periodically)
setInterval(() => {
    const now = Date.now();
    // Thời gian chờ hoạt động: 30 phút (để đủ thời gian cho trận đấu)
    const INACTIVE_TIMEOUT = 30 * 60 * 1000; 
    
    for (const [roomId, room] of rooms.entries()) {
        if (now - room.lastActivity > INACTIVE_TIMEOUT) {
            // Chỉ xóa các phòng không có người chơi nào đang kết nối và không có khán giả
            if (room.players.every(p => !p.connected) && room.spectators.length === 0) {
                rooms.delete(roomId);
                console.log(`Cleaned up inactive room: ${roomId}`);
                io.emit('updateRoomList', getRoomList()); // Cập nhật danh sách phòng
            }
        }
    }
}, 5 * 60 * 1000); // Chạy mỗi 5 phút để kiểm tra

// =====================================
// Server Start
// =====================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    initializeDataDirectory(); // Đảm bảo thư mục dữ liệu được khởi tạo khi máy chủ khởi động
});
