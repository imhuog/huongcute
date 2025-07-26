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
// Sửa lại GameRoom constructor để xử lý player colors đúng
class GameRoom {
    constructor(id, hostSocketId, hostName, roomName = null, mode = 'online') {
        this.id = id;
        this.roomName = roomName || id;
        this.gameMode = mode;
        this.board = Array(8).fill(0).map(() => Array(8).fill(0));
        this.currentPlayer = 1; // 1 for Black, 2 for White
        this.players = [
            { id: hostSocketId, name: hostName, color: 1, connected: true, isHost: true }, // Host là black
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

    // Method to initialize the board with starting Othello pieces
    initializeBoard() {
        this.board = Array(8).fill(0).map(() => Array(8).fill(0));
        this.board[3][3] = 2; // White
        this.board[3][4] = 1; // Black
        this.board[4][3] = 1; // Black
        this.board[4][4] = 2; // White
        this.updateScores();
    }

    addPlayer(socketId, playerName) {
        if (this.players.length < 2) {
            // Kiểm tra reconnecting player
            const existingPlayer = this.players.find(p => p.name === playerName && !p.connected);
            if (existingPlayer) {
                existingPlayer.id = socketId;
                existingPlayer.connected = true;
                this.lastActivity = Date.now();
                return { success: true, reconnected: true };
            }

            // Player mới - thêm như white player
            const playerColor = 2; // Player thứ 2 luôn là white
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

    // Các method khác giữ nguyên...
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
        this.spectators.push({ id: socketId, name: spectatorName });
        this.lastActivity = Date.now();
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
        } else if (this.winner === 0) {
            updatePlayerStats(player1.name, 'tie', this.scores[1], this.scores[2]);
            updatePlayerStats(player2.name, 'tie', this.scores[2], this.scores[1]);
        }
    }

    addChatMessage(sender, message) {
        const chatMessage = {
            id: Date.now() + Math.random(),
            sender,
            message: message.trim(),
            timestamp: Date.now(),
            type: 'message'
        };
        this.chatMessages.push(chatMessage);
        
        // Limit messages to prevent memory issues
        if (this.chatMessages.length > 100) {
            this.chatMessages.splice(0, this.chatMessages.length - 100);
        }
        return chatMessage;
    }

    addSystemMessage(message) {
        const systemMessage = {
            id: Date.now() + Math.random(),
            sender: 'System',
            message,
            timestamp: Date.now(),
            type: 'system'
        };
        this.chatMessages.push(systemMessage);
        return systemMessage;
    }

    getGameState() {
        const connectedPlayers = this.players.filter(p => p.connected);
        return {
            roomId: this.id,
            roomName: this.roomName,
            board: this.board,
            currentPlayer: this.currentPlayer,
            players: this.players.map(p => ({ 
                id: p.id, 
                name: p.name, 
                color: p.color, 
                connected: p.connected,
                isHost: p.isHost 
            })),
            spectators: this.spectators.map(s => ({ id: s.id, name: s.name })),
            gameStarted: this.gameStarted,
            gameOver: this.gameOver,
            winner: this.winner,
            scores: this.scores,
            validMoves: this.gameStarted && !this.gameOver ? this.getValidMoves(this.currentPlayer) : [],
            chatMessages: this.chatMessages,
            moveHistory: this.moveHistory.slice(-10), // Last 10 moves
            gameMode: this.gameMode
        };
    }
}

// =====================================
// Socket.IO Connection Handling
// =====================================
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Handle create room event - Fixed room name issue
   // Sửa lại event handler createRoom
socket.on('createRoom', (data) => {
    try {
        // Xử lý cả format cũ (string) và format mới (object)
        const playerName = typeof data === 'string' ? data : data.playerName;
        const roomName = typeof data === 'object' ? data.roomName : null;
        
        if (!playerName || playerName.trim() === '') {
            socket.emit('roomError', {
                success: false,
                message: 'Tên người chơi không hợp lệ.',
                type: 'error'
            });
            return;
        }

        const roomId = generateRoomId();
        const customRoomName = roomName && roomName.trim() ? roomName.trim() : roomId;
        
        const room = new GameRoom(roomId, socket.id, playerName, customRoomName, 'online');
        rooms.set(roomId, room);
        players.set(socket.id, { roomId, playerName, isHost: true });
        socket.join(roomId);
        
        console.log(`Room created: ${roomId} (${customRoomName}) by ${playerName}`);
        
        // Gửi response với format nhất quán
        socket.emit('roomCreated', {
            success: true,
            roomId: roomId,
            roomName: customRoomName,
            isHost: true
        });
            
            // Broadcast updated room list
        io.emit('updateRoomList', getRoomList());
    } catch (error) {
        console.error(`Error creating room:`, error);
        socket.emit('roomError', {
            success: false,
            message: 'Đã xảy ra lỗi khi tạo phòng. Vui lòng thử lại sau.',
            type: 'error'
        });
    }
}); // <-- Dấu đóng ngoặc cho socket.on('createRoom')

// Sửa lại event handler joinRoom
socket.on('joinRoom', (data) => {
    try {
        // Xử lý cả format cũ và format mới
        const roomId = typeof data === 'object' ? data.roomId : data;
        const playerName = typeof data === 'object' ? data.playerName : arguments[1];
        
        if (!roomId || !playerName) {
            socket.emit('roomError', {
                success: false,
                message: 'Thông tin phòng hoặc tên người chơi không hợp lệ.',
                type: 'error'
            });
            return;
        }

        const room = rooms.get(roomId);
        
        if (!room) {
            socket.emit('roomError', {
                success: false,
                message: 'Phòng không tồn tại.',
                type: 'error'
            });
            return;
        }

        if (room.gameMode !== 'online') {
            socket.emit('roomError', {
                success: false,
                message: 'Không thể tham gia phòng này.',
                type: 'error'
            });
            return;
        }

          // Kiểm tra xem player đã trong phòng chưa
        if (room.players.some(p => p.id === socket.id)) {
            socket.emit('roomError', {
                success: false,
                message: 'Bạn đã ở trong phòng này rồi.',
                type: 'warning'
            });
            return;
        }

           // Kiểm tra trùng tên
        if (room.players.some(p => p.name === playerName && p.connected)) {
            socket.emit('roomError', {
                success: false,
                message: 'Tên người chơi đã tồn tại trong phòng.',
                type: 'error'
            });
            return;
        }

            const joinResult = room.addPlayer(socket.id, playerName);
        
        if (joinResult.success) {
            players.set(socket.id, { roomId, playerName, isHost: false });
            socket.join(roomId);
            
            console.log(`Player ${playerName} ${joinResult.reconnected ? 'reconnected to' : 'joined'} room: ${roomId}`);

            // Thêm system message
            if (!joinResult.reconnected) {
                room.addSystemMessage(`${playerName} đã tham gia phòng`);
            } else {
                room.addSystemMessage(`${playerName} đã kết nối lại`);
            }

               // Gửi thông báo cho tất cả players trong phòng
            io.to(roomId).emit('playerJoined', {
                success: true,
                gameState: room.getGameState()
            });

            // Gửi game state cho player vừa join
            socket.emit('roomJoined', {
                success: true,
                gameState: room.getGameState(),
                playerColor: room.players.find(p => p.id === socket.id)?.color
            });

               // Update room list
            io.emit('updateRoomList', getRoomList());

            // Tự động start game nếu đủ 2 người
            if (room.players.filter(p => p.connected).length === 2 && !room.gameStarted) {
                setTimeout(() => {
                    if (room.startGame()) {
                        room.addSystemMessage('Trò chơi bắt đầu!');
                        io.to(roomId).emit('gameStarted', {
                            success: true,
                            gameState: room.getGameState()
                        });
                        io.emit('updateRoomList', getRoomList());
                    }
                }, 1000); // Delay 1 giây để UI kịp update
            }
        } else {
              // Thử join như spectator nếu phòng đầy
            if (room.players.length === 2) {
                room.addSpectator(socket.id, playerName);
                players.set(socket.id, { roomId, playerName, isHost: false, isSpectator: true });
                socket.join(roomId);
                
                room.addSystemMessage(`${playerName} đã tham gia với tư cách khán giả`);
                
                socket.emit('roomJoined', {
                    success: true,
                    asSpectator: true,
                    gameState: room.getGameState()
                });
                
                io.to(roomId).emit('spectatorJoined', {
                    gameState: room.getGameState()
                });
            } else {
                socket.emit('roomError', {
                    success: false,
                    message: joinResult.reason || 'Không thể tham gia phòng.',
                    type: 'error'
                });
            }
        }
    } catch (error) {
        console.error(`Error joining room:`, error);
        socket.emit('roomError', {
            success: false,
            message: 'Đã xảy ra lỗi khi tham gia phòng.',
            type: 'error'
        });
    }
});

    // Handle game move
    socket.on('makeMove', ({ roomId, r, c }) => {
        try {
            const room = rooms.get(roomId);
            const playerInfo = players.get(socket.id);

            if (!room || !playerInfo) {
                socket.emit('moveError', {
                    success: false,
                    message: 'Phòng không hợp lệ.'
                });
                return;
            }

            if (!room.gameStarted || room.gameOver) {
                socket.emit('moveError', {
                    success: false,
                    message: 'Trò chơi chưa bắt đầu hoặc đã kết thúc.'
                });
                return;
            }

            const currentPlayerData = room.players.find(p => p.color === room.currentPlayer);
            if (!currentPlayerData || currentPlayerData.id !== socket.id) {
                socket.emit('moveError', {
                    success: false,
                    message: 'Không phải lượt của bạn.'
                });
                return;
            }

            const moveResult = room.makeMove(r, c, room.currentPlayer);
            if (moveResult.success) {
                // Broadcast move to all players
                io.to(roomId).emit('boardUpdate', {
                    success: true,
                    gameState: room.getGameState(),
                    lastMove: { r, c, player: room.currentPlayer },
                    flippedPieces: moveResult.flippedPieces
                });

                // Check for game end
                if (!room.checkGameEnd()) {
                    room.switchPlayer();
                    io.to(roomId).emit('turnUpdate', {
                        currentPlayer: room.currentPlayer,
                        validMoves: room.getValidMoves(room.currentPlayer)
                    });
                } else {
                    const winnerName = room.winner === 0 ? 'Hòa' : 
                                    room.players.find(p => p.color === room.winner)?.name || 'Unknown';
                    room.addSystemMessage(`Trò chơi kết thúc! ${winnerName === 'Hòa' ? 'Kết quả hòa' : `${winnerName} thắng`}`);
                    
                    io.to(roomId).emit('gameEnded', {
                        success: true,
                        gameState: room.getGameState(),
                        winner: room.winner,
                        finalScores: room.scores
                    });
                }
            } else {
                socket.emit('moveError', {
                    success: false,
                    message: moveResult.reason || 'Nước đi không hợp lệ.'
                });
            }
        } catch (error) {
            console.error(`Error making move in room ${roomId}:`, error);
            socket.emit('moveError', {
                success: false,
                message: 'Đã xảy ra lỗi khi thực hiện nước đi.'
            });
        }
    });

    // Handle chat message
    socket.on('chatMessage', ({ roomId, message }) => {
        try {
            const playerInfo = players.get(socket.id);
            const room = rooms.get(roomId);
            
            if (playerInfo && room && message && message.trim()) {
                const chatMessage = room.addChatMessage(playerInfo.playerName, message);
                io.to(roomId).emit('newChatMessage', {
                    message: chatMessage,
                    allMessages: room.getGameState().chatMessages
                });
            }
        } catch (error) {
            console.error(`Error sending chat message in room ${roomId}:`, error);
        }
    });

    // Handle leave room
    socket.on('leaveRoom', () => {
        try {
            const playerInfo = players.get(socket.id);
            if (!playerInfo) return;

            const { roomId, playerName } = playerInfo;
            const room = rooms.get(roomId);

            if (room) {
                const removeResult = room.removePlayer(socket.id);
                players.delete(socket.id);
                socket.leave(roomId);
                
                console.log(`Player ${playerName} left room ${roomId}`);
                
                // Add system message
                room.addSystemMessage(`${playerName} đã rời khỏi phòng`);

                // Handle game interruption
                if (room.gameStarted && !room.gameOver && removeResult.success && removeResult.player) {
                    const remainingPlayer = room.players.find(p => p.connected);
                    if (remainingPlayer) {
                        room.gameOver = true;
                        room.winner = remainingPlayer.color;
                        room.handleGameResult();
                        room.addSystemMessage(`${remainingPlayer.name} thắng do đối thủ rời khỏi phòng`);
                        
                        io.to(roomId).emit('gameEnded', {
                            success: true,
                            gameState: room.getGameState(),
                            reason: 'opponent_left'
                        });
                    }
                }

                // Notify remaining players
                if (room.players.some(p => p.connected) || room.spectators.length > 0) {
                    io.to(roomId).emit('playerLeft', {
                        players: room.getGameState().players,
                        spectators: room.getGameState().spectators,
                        chatMessages: room.getGameState().chatMessages
                    });
                }

                // Clean up empty rooms
                if (room.players.every(p => !p.connected) && room.spectators.length === 0) {
                    setTimeout(() => {
                        if (rooms.has(roomId) && 
                            room.players.every(p => !p.connected) && 
                            room.spectators.length === 0) {
                            rooms.delete(roomId);
                            console.log(`Room ${roomId} removed due to inactivity.`);
                        }
                        io.emit('updateRoomList', getRoomList());
                    }, 2000);
                } else {
                    io.emit('updateRoomList', getRoomList());
                }
            }
        } catch (error) {
            console.error(`Error leaving room:`, error);
        }
    });

    // Handle reconnect attempt
    socket.on('reconnectAttempt', ({ roomId, playerName }) => {
        try {
            const room = rooms.get(roomId);
            if (!room) {
                socket.emit('reconnectResult', {
                    success: false,
                    message: 'Phòng không tồn tại.'
                });
                return;
            }

            const player = room.players.find(p => p.name === playerName);
            if (player && !player.connected) {
                player.id = socket.id;
                player.connected = true;
                players.set(socket.id, { 
                    roomId, 
                    playerName, 
                    isHost: player.isHost,
                    isSpectator: false 
                });
                socket.join(roomId);
                
                room.addSystemMessage(`${playerName} đã kết nối lại`);
                console.log(`Player ${playerName} reconnected to room ${roomId}`);
                
                io.to(roomId).emit('playerReconnected', {
                    players: room.getGameState().players,
                    chatMessages: room.getGameState().chatMessages
                });
                
                socket.emit('reconnectResult', {
                    success: true,
                    gameState: room.getGameState()
                });
            } else {
                socket.emit('reconnectResult', {
                    success: false,
                    message: 'Không thể kết nối lại. Vui lòng thử tạo/tham gia phòng mới.'
                });
            }
        } catch (error) {
            console.error(`Error reconnecting to room ${roomId}:`, error);
            socket.emit('reconnectResult', {
                success: false,
                message: 'Đã xảy ra lỗi khi kết nối lại.'
            });
        }
    });

    // Handle get room list
    socket.on('getRoomList', () => {
        socket.emit('updateRoomList', getRoomList());
    });

    // Handle get room info (for direct links)
    socket.on('getRoomInfo', ({ roomId }) => {
        const room = rooms.get(roomId);
        if (room) {
            socket.emit('roomInfo', {
                success: true,
                roomExists: true,
                roomData: {
                    id: room.id,
                    name: room.roomName,
                    players: room.players.filter(p => p.connected).length,
                    maxPlayers: 2,
                    gameStarted: room.gameStarted,
                    gameOver: room.gameOver,
                    canJoin: room.players.filter(p => p.connected).length < 2
                }
            });
        } else {
            socket.emit('roomInfo', {
                success: false,
                roomExists: false,
                message: 'Phòng không tồn tại.'
            });
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
                room.addSystemMessage(`${playerName} đã mất kết nối`);
                
                // Notify other players about disconnection
                io.to(roomId).emit('playerDisconnected', {
                    players: room.getGameState().players,
                    chatMessages: room.getGameState().chatMessages
                });
                
                io.emit('updateRoomList', getRoomList());
            }
        }
    });

    // Handle start game manually (for host)
    socket.on('startGame', ({ roomId }) => {
        try {
            const room = rooms.get(roomId);
            const playerInfo = players.get(socket.id);
            
            if (!room || !playerInfo || !playerInfo.isHost) {
                socket.emit('startGameError', {
                    success: false,
                    message: 'Chỉ chủ phòng mới có thể bắt đầu trò chơi.'
                });
                return;
            }

            if (room.players.filter(p => p.connected).length < 2) {
                socket.emit('startGameError', {
                    success: false,
                    message: 'Cần ít nhất 2 người chơi để bắt đầu.'
                });
                return;
            }

            if (room.startGame()) {
                room.addSystemMessage('Chủ phòng đã bắt đầu trò chơi!');
                io.to(roomId).emit('gameStarted', {
                    success: true,
                    gameState: room.getGameState()
                });
                io.emit('updateRoomList', getRoomList());
            } else {
                socket.emit('startGameError', {
                    success: false,
                    message: 'Không thể bắt đầu trò chơi.'
                });
            }
        } catch (error) {
            console.error(`Error starting game in room ${roomId}:`, error);
            socket.emit('startGameError', {
                success: false,
                message: 'Đã xảy ra lỗi khi bắt đầu trò chơi.'
            });
        }
    });

    // Handle restart game (for completed games)
    socket.on('restartGame', ({ roomId }) => {
        try {
            const room = rooms.get(roomId);
            const playerInfo = players.get(socket.id);
            
            if (!room || !playerInfo || !playerInfo.isHost) {
                socket.emit('restartGameError', {
                    success: false,
                    message: 'Chỉ chủ phòng mới có thể khởi động lại trò chơi.'
                });
                return;
            }

            if (!room.gameOver) {
                socket.emit('restartGameError', {
                    success: false,
                    message: 'Trò chơi chưa kết thúc.'
                });
                return;
            }

            // Reset game state
            room.initializeBoard();
            room.currentPlayer = 1;
            room.gameStarted = false;
            room.gameOver = false;
            room.winner = null;
            room.moveHistory = [];
            room.lastActivity = Date.now();
            
            room.addSystemMessage('Trò chơi đã được khởi động lại');
            
            io.to(roomId).emit('gameRestarted', {
                success: true,
                gameState: room.getGameState()
            });
            
            io.emit('updateRoomList', getRoomList());
        } catch (error) {
            console.error(`Error restarting game in room ${roomId}:`, error);
            socket.emit('restartGameError', {
                success: false,
                message: 'Đã xảy ra lỗi khi khởi động lại trò chơi.'
            });
        }
    });
});

// =====================================
// API Endpoints
// =====================================

// Get active rooms list
app.get('/api/rooms', (req, res) => {
    try {
        const roomList = getRoomList();
        res.json({
            success: true,
            rooms: roomList,
            total: roomList.length
        });
    } catch (error) {
        console.error('Error getting room list:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy danh sách phòng'
        });
    }
});

// Get specific room state
app.get('/api/room/:roomId', (req, res) => {
    try {
        const room = rooms.get(req.params.roomId);
        if (room) {
            res.json({
                success: true,
                room: room.getGameState()
            });
        } else {
            res.status(404).json({
                success: false,
                message: 'Phòng không tồn tại'
            });
        }
    } catch (error) {
        console.error(`Error getting room ${req.params.roomId}:`, error);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy thông tin phòng'
        });
    }
});

// Get leaderboard data
app.get('/api/leaderboard', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const leaderData = Array.from(leaderboard.values())
            .sort((a, b) => b.rating - a.rating)
            .slice(0, Math.min(limit, 100)); // Max 100 entries
        
        res.json({
            success: true,
            leaderboard: leaderData,
            total: leaderboard.size
        });
    } catch (error) {
        console.error('Error getting leaderboard:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy bảng xếp hạng'
        });
    }
});

// Get player stats
app.get('/api/stats/:playerName', (req, res) => {
    try {
        const playerName = decodeURIComponent(req.params.playerName);
        const stats = gameStats.get(playerName);
        const leaderInfo = leaderboard.get(playerName);
        
        if (stats || leaderInfo) {
            res.json({
                success: true,
                player: {
                    name: playerName,
                    stats: stats || {
                        name: playerName,
                        totalGames: 0,
                        wins: 0,
                        losses: 0,
                        ties: 0,
                        pointsScored: 0,
                        pointsConceded: 0
                    },
                    rating: leaderInfo ? {
                        rating: leaderInfo.rating,
                        wins: leaderInfo.wins,
                        losses: leaderInfo.losses
                    } : {
                        rating: 1000,
                        wins: 0,
                        losses: 0
                    }
                }
            });
        } else {
            res.status(404).json({
                success: false,
                message: 'Không tìm thấy thống kê người chơi'
            });
        }
    } catch (error) {
        console.error(`Error getting stats for ${req.params.playerName}:`, error);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy thống kê người chơi'
        });
    }
});

// Get server statistics
app.get('/api/server-stats', (req, res) => {
    try {
        const activeRooms = Array.from(rooms.values());
        const onlineRooms = activeRooms.filter(r => r.gameMode === 'online');
        const activeGames = onlineRooms.filter(r => r.gameStarted && !r.gameOver);
        const totalPlayers = onlineRooms.reduce((sum, room) => 
            sum + room.players.filter(p => p.connected).length + room.spectators.length, 0);

        res.json({
            success: true,
            stats: {
                totalRooms: onlineRooms.length,
                activeGames: activeGames.length,
                totalPlayers: totalPlayers,
                registeredPlayers: leaderboard.size,
                totalGamesPlayed: Array.from(gameStats.values())
                    .reduce((sum, stats) => sum + stats.totalGames, 0)
            }
        });
    } catch (error) {
        console.error('Error getting server stats:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy thống kê server'
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Serve main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handle room direct links
app.get('/room/:roomId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Clean up inactive rooms and disconnected players
setInterval(() => {
    const now = Date.now();
    const INACTIVE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
    const DISCONNECT_TIMEOUT = 5 * 60 * 1000; // 5 minutes for disconnected players
    let cleanedRooms = 0;

    for (const [roomId, room] of rooms.entries()) {
        let shouldRemoveRoom = false;

        // Remove disconnected players after timeout
        room.players = room.players.filter(player => {
            if (!player.connected && (now - room.lastActivity) > DISCONNECT_TIMEOUT) {
                console.log(`Removing disconnected player ${player.name} from room ${roomId}`);
                return false;
            }
            return true;
        });

        // Check if room should be removed
        if (now - room.lastActivity > INACTIVE_TIMEOUT) {
            if (room.players.every(p => !p.connected) && room.spectators.length === 0) {
                shouldRemoveRoom = true;
            }
        }

        // Also remove empty rooms that have been inactive for shorter time
        if (room.players.length === 0 && room.spectators.length === 0) {
            shouldRemoveRoom = true;
        }

        if (shouldRemoveRoom) {
            rooms.delete(roomId);
            cleanedRooms++;
            console.log(`Cleaned up inactive room: ${roomId}`);
        }
    }

    // Clean up orphaned players
    for (const [socketId, playerInfo] of players.entries()) {
        if (!rooms.has(playerInfo.roomId)) {
            players.delete(socketId);
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
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Othello Server running on port ${PORT}`);
    console.log(`📊 Server started at ${new Date().toISOString()}`);
    initializeDataDirectory();
});
