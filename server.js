// ================================\
// SERVER.JS - Enhanced Backend Server
// ================================\
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
const DATA_DIR = path.join(__dirname, 'data');
const LEADERBOARD_FILE = path.join(DATA_DIR, 'leaderboard.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');

// GameRoom class (đảm bảo rằng bạn có lớp này hoặc thêm nó vào đây nếu chưa có)
// Ví dụ cơ bản về cấu trúc lớp GameRoom:
class GameRoom {
    constructor(id, hostSocketId, hostPlayerName) {
        this.id = id;
        this.host = { socketId: hostSocketId, name: hostPlayerName };
        this.players = [{ socketId: hostSocketId, name: hostPlayerName, connected: true, isHost: true }];
        this.spectators = [];
        this.gameState = {}; // Trạng thái game (bàn cờ, lượt đi, điểm số, v.v.)
        this.chatMessages = [];
        this.lastActivity = Date.now(); // Cập nhật thời gian hoạt động
    }

    // Phương thức để cập nhật trạng thái game, thêm người chơi, v.v.
    getGameState() {
        return {
            roomId: this.id,
            players: this.players.map(p => ({ name: p.name, connected: p.connected, isHost: p.isHost })),
            spectators: this.spectators.map(s => s.name),
            chatMessages: this.chatMessages,
            board: this.gameState.board, // ví dụ
            turn: this.gameState.turn,   // ví dụ
            scores: this.gameState.scores // ví dụ
        };
    }

    addPlayer(socketId, playerName) {
        if (this.players.length < 2) {
            this.players.push({ socketId, name: playerName, connected: true, isHost: false });
            this.lastActivity = Date.now();
            return true;
        }
        return false;
    }

    addSpectator(socketId, playerName) {
        this.spectators.push({ socketId, name: playerName });
        this.lastActivity = Date.now();
    }

    removePlayerOrSpectator(socketId) {
        this.players = this.players.map(p => p.socketId === socketId ? { ...p, connected: false } : p);
        this.spectators = this.spectators.filter(s => s.socketId !== socketId);
        this.lastActivity = Date.now();
        // Có thể cần thêm logic để xử lý nếu host ngắt kết nối
    }

    // Các phương thức khác của game logic
}


// Initialize data directory
async function initializeDataDirectory() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        console.log('Data directory ensured.');
        await loadLeaderboard();
        await loadStats();
    } catch (error) {
        console.error('Error initializing data directory:', error);
        // Không exit ở đây để server vẫn có thể chạy mà không cần persistence
    }
}

// Leaderboard management
async function loadLeaderboard() {
    try {
        const data = await fs.readFile(LEADERBOARD_FILE, 'utf8');
        const loadedLeaderboard = JSON.parse(data);
        for (const player of loadedLeaderboard) {
            leaderboard.set(player.name, player);
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
        await fs.writeFile(LEADERBOARD_FILE, JSON.stringify(Array.from(leaderboard.values()), null, 2), 'utf8');
        console.log('Leaderboard saved.');
    } catch (error) {
        console.error('Error saving leaderboard:', error);
    }
}

// Game stats management
async function loadStats() {
    try {
        const data = await fs.readFile(STATS_FILE, 'utf8');
        const loadedStats = JSON.parse(data);
        for (const stats of loadedStats) {
            gameStats.set(stats.name, stats);
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
        await fs.writeFile(STATS_FILE, JSON.stringify(Array.from(gameStats.values()), null, 2), 'utf8');
        console.log('Game stats saved.');
    } catch (error) {
        console.error('Error saving game stats:', error);
    }
}

// Middleware
app.use(helmet({
    contentSecurityPolicy: false, // Bạn có thể muốn cấu hình CSP cụ thể hơn
    crossOriginEmbedderPolicy: false
}));
app.use(compression()); // Nén phản hồi HTTP
app.use(cors()); // Cho phép Cross-Origin Resource Sharing
app.use(express.json()); // Phân tích các yêu cầu JSON
// app.use(express.static(path.join(__dirname, 'public'))); // Phục vụ các tệp tĩnh từ thư mục 'public' - Bỏ comment nếu bạn phục vụ HTML từ đây

// =========================================================================
// THAY ĐỔI: THÊM HEALTH CHECK ENDPOINT VÀ XỬ LÝ LỖI TOÀN CỤC
// =========================================================================

// Health Check Endpoint for Render and general status
app.get('/', (req, res) => {
    res.status(200).send('Othello Server is healthy and running!');
});

app.get('/status', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        message: 'Othello Server is running smoothly',
        timestamp: new Date()
    });
});

// THAY ĐỔI: Global error handling for unhandled exceptions
process.on('uncaughtException', (error) => {
    console.error('FATAL ERROR: Caught unhandled exception:', error.stack || error.message || error);
    // Ghi lại lỗi và sau đó thoát tiến trình.
    // Trong môi trường production, điều này giúp các hệ thống quản lý tiến trình (như Render)
    // khởi động lại ứng dụng một cách sạch sẽ.
    process.exit(1);
});

// THAY ĐỔI: Global error handling for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('WARNING: Caught unhandled promise rejection at:', promise, 'reason:', reason.stack || reason.message || reason);
    // Không thoát tiến trình ngay lập tức, nhưng vẫn ghi lại lỗi.
    // Có thể cần thêm logic cụ thể tùy thuộc vào ứng dụng.
});

// =========================================================================
// KẾT THÚC THAY ĐỔI
// =========================================================================


// Helper to get current room list for clients
function getRoomList() {
    return Array.from(rooms.values()).map(room => ({
        id: room.id,
        players: room.players.filter(p => p.connected).map(p => p.name),
        spectators: room.spectators.map(s => s.name),
        state: room.gameState.status || 'waiting', // Ví dụ: 'waiting', 'playing', 'finished'
        lastActivity: room.lastActivity // Thời gian hoạt động gần nhất
    }));
}

// Socket.IO event handlers
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    socket.emit('updateRoomList', getRoomList()); // Gửi danh sách phòng khi người dùng kết nối

    // Handle 'createRoom' event
    socket.on('createRoom', ({ roomId, playerName }) => {
        if (!roomId || !playerName) {
            return socket.emit('roomError', 'Room ID and Player Name are required.');
        }
        if (rooms.has(roomId)) {
            return socket.emit('roomError', 'Room ID already exists. Please choose another.');
        }

        const newRoom = new GameRoom(roomId, socket.id, playerName);
        rooms.set(roomId, newRoom);
        players.set(socket.id, { roomId: roomId, playerName: playerName });

        socket.join(roomId);
        socket.emit('roomCreated', newRoom.getGameState());
        io.emit('updateRoomList', getRoomList());
        console.log(`Room created: ${roomId} by ${playerName} (${socket.id})`);
    });

    // Handle 'joinRoom' event
    socket.on('joinRoom', ({ roomId, playerName }) => {
        const room = rooms.get(roomId);
        if (!room) {
            return socket.emit('roomError', 'Room not found.');
        }
        if (!playerName) {
            return socket.emit('roomError', 'Player Name is required to join.');
        }

        if (room.players.length < 2) {
            room.addPlayer(socket.id, playerName);
            players.set(socket.id, { roomId: roomId, playerName: playerName });
            socket.join(roomId);
            io.to(roomId).emit('playerJoined', room.getGameState());
            io.emit('updateRoomList', getRoomList());
            console.log(`${playerName} (${socket.id}) joined room: ${roomId}`);
        } else {
            // Join as spectator
            room.addSpectator(socket.id, playerName);
            players.set(socket.id, { roomId: roomId, playerName: playerName, isSpectator: true });
            socket.join(roomId);
            socket.emit('joinedAsSpectator', room.getGameState());
            io.to(roomId).emit('spectatorJoined', { roomState: room.getGameState(), spectatorName: playerName });
            io.emit('updateRoomList', getRoomList());
            console.log(`${playerName} (${socket.id}) joined room as spectator: ${roomId}`);
        }
    });

    // Handle 'leaveRoom' event
    socket.on('leaveRoom', () => {
        const playerInfo = players.get(socket.id);
        if (playerInfo) {
            const { roomId, playerName } = playerInfo;
            const room = rooms.get(roomId);

            if (room) {
                room.removePlayerOrSpectator(socket.id);
                socket.leave(roomId);
                players.delete(socket.id);

                if (room.players.every(p => !p.connected) && room.spectators.length === 0) {
                    // Nếu không còn ai trong phòng, xóa phòng sau một thời gian ngắn
                    setTimeout(() => {
                        if (room.players.every(p => !p.connected) && room.spectators.length === 0) {
                            rooms.delete(roomId);
                            console.log(`Room ${roomId} is empty and deleted.`);
                            io.emit('updateRoomList', getRoomList());
                        }
                    }, 5000); // 5 giây chờ để đảm bảo không có reconnections
                } else {
                    io.to(roomId).emit('playerLeft', room.getGameState());
                    io.emit('updateRoomList', getRoomList());
                }
                console.log(`${playerName} (${socket.id}) left room: ${roomId}`);
            }
        }
    });

    // Handle game moves (ví dụ)
    socket.on('makeMove', ({ roomId, move }) => {
        const room = rooms.get(roomId);
        if (room && room.players.some(p => p.socketId === socket.id && p.connected)) {
            // Xử lý logic nước đi trong GameRoom
            // room.applyMove(socket.id, move);
            room.lastActivity = Date.now(); // Cập nhật hoạt động
            io.to(roomId).emit('gameStateUpdate', room.getGameState());
        }
    });

    // Handle chat messages
    socket.on('chatMessage', ({ roomId, playerName, message }) => {
        const room = rooms.get(roomId);
        if (room) {
            const timestamp = new Date().toLocaleTimeString();
            const fullMessage = { playerName, message, timestamp };
            room.chatMessages.push(fullMessage);
            // Giới hạn số lượng tin nhắn trong phòng để tránh tràn bộ nhớ
            if (room.chatMessages.length > 50) {
                room.chatMessages.shift();
            }
            io.to(roomId).emit('newChatMessage', fullMessage);
            room.lastActivity = Date.now(); // Cập nhật hoạt động
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        const playerInfo = players.get(socket.id);
        if (playerInfo) {
            const { roomId, playerName } = playerInfo;
            const room = rooms.get(roomId);

            if (room) {
                room.removePlayerOrSpectator(socket.id);
                // Nếu người chơi ngắt kết nối là host, có thể cần chuyển host hoặc đóng phòng
                if (room.host.socketId === socket.id) {
                    // Logic xử lý khi host ngắt kết nối
                    // Ví dụ: chọn host mới, hoặc thông báo phòng sẽ đóng
                    console.log(`Host ${playerName} (${socket.id}) disconnected from room ${roomId}`);
                    // Nếu không còn người chơi nào khác trong phòng, có thể xóa phòng
                    if (room.players.every(p => !p.connected) && room.spectators.length === 0) {
                        setTimeout(() => {
                            if (room.players.every(p => !p.connected) && room.spectators.length === 0) {
                                rooms.delete(roomId);
                                console.log(`Room ${roomId} is empty and deleted after host disconnect.`);
                                io.emit('updateRoomList', getRoomList());
                            }
                        }, 5000); // Chờ 5 giây để reconnect
                    } else {
                        io.to(roomId).emit('hostDisconnected', room.getGameState());
                    }
                } else {
                    io.to(roomId).emit('playerDisconnected', { playerName, roomState: room.getGameState() });
                }
                io.emit('updateRoomList', getRoomList());
            }
            players.delete(socket.id);
        }
    });

    // Handle player reconnection (if client side reconnects)
    socket.on('reconnect', (attemptNumber) => {
        console.log(`User reconnected: ${socket.id} after ${attemptNumber} attempts`);
        // Logic để đưa người chơi trở lại phòng và cập nhật trạng thái
        const playerInfo = players.get(socket.id);
        if (playerInfo) {
            const room = rooms.get(playerInfo.roomId);
            if (room) {
                // Đánh dấu người chơi là connected trở lại
                room.players = room.players.map(p => p.socketId === socket.id ? { ...p, connected: true } : p);
                io.to(room.id).emit('playerReconnected', { playerName: playerInfo.playerName, roomState: room.getGameState() });
                room.lastActivity = Date.now();
                io.emit('updateRoomList', getRoomList());
            }
        }
    });
});

// Room and player management API endpoints
app.get('/api/rooms', (req, res) => {
    const roomList = getRoomList();
    res.json(roomList);
});

app.get('/api/room/:roomId', (req, res) => {
    const room = rooms.get(req.params.roomId);
    if (room) {
        res.json(room.getGameState());
    } else {
        res.status(404).json({ error: 'Room not found' });
    }
});

app.get('/api/leaderboard', (req, res) => {
    const leaderData = Array.from(leaderboard.values())
        .sort((a, b) => b.rating - a.rating)
        .slice(0, 20); // Top 20
    res.json(leaderData);
});

app.get('/api/stats/:playerName', (req, res) => {
    const stats = gameStats.get(req.params.playerName);
    if (stats) {
        res.json(stats);
    } else {
        res.status(404).json({ error: 'Player stats not found' });
    }
});

// Clean up inactive rooms
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
}, 5 * 60 * 1000); // Chạy mỗi 5 phút để dọn dẹp phòng


const PORT = process.env.PORT || 3000;
initializeDataDirectory().then(() => {
    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
});
