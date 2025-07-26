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

// Game rooms storage
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
        const leaderData = JSON.parse(data);
        leaderData.forEach(player => leaderboard.set(player.name, player));
    } catch (error) {
        console.log('No existing leaderboard found, starting fresh');
    }
}

async function saveLeaderboard() {
    try {
        const leaderData = Array.from(leaderboard.values());
        await fs.writeFile(LEADERBOARD_FILE, JSON.stringify(leaderData, null, 2));
    } catch (error) {
        console.error('Error saving leaderboard:', error);
    }
}

async function loadStats() {
    try {
        const data = await fs.readFile(STATS_FILE, 'utf8');
        const statsData = JSON.parse(data);
        statsData.forEach(stat => gameStats.set(stat.playerName, stat));
    } catch (error) {
        console.log('No existing stats found, starting fresh');
    }
}

async function saveStats() {
    try {
        const statsData = Array.from(gameStats.values());
        await fs.writeFile(STATS_FILE, JSON.stringify(statsData, null, 2));
    } catch (error) {
        console.error('Error saving stats:', error);
    }
}

function updatePlayerStats(playerName, won, totalPieces, opponentPieces, gameType) {
    if (!gameStats.has(playerName)) {
        gameStats.set(playerName, {
            playerName,
            gamesPlayed: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            totalPieces: 0,
            aiWins: 0,
            onlineWins: 0,
            winStreak: 0,
            maxWinStreak: 0,
            averageScore: 0
        });
    }

    const stats = gameStats.get(playerName);
    stats.gamesPlayed++;
    stats.totalPieces += totalPieces;

    if (won === 'win') {
        stats.wins++;
        stats.winStreak++;
        if (gameType === 'ai') stats.aiWins++;
        if (gameType === 'online') stats.onlineWins++;
        stats.maxWinStreak = Math.max(stats.maxWinStreak, stats.winStreak);
    } else if (won === 'loss') {
        stats.losses++;
        stats.winStreak = 0;
    } else {
        stats.draws++;
        stats.winStreak = 0;
    }

    stats.averageScore = Math.round(stats.totalPieces / stats.gamesPlayed);
    saveStats();
}

function updateLeaderboard(playerName, won, rating = 1200) {
    if (!leaderboard.has(playerName)) {
        leaderboard.set(playerName, {
            name: playerName,
            rating: rating,
            wins: 0,
            losses: 0,
            draws: 0,
            gamesPlayed: 0
        });
    }

    const player = leaderboard.get(playerName);
    player.gamesPlayed++;

    if (won === 'win') {
        player.wins++;
        player.rating += 25;
    } else if (won === 'loss') {
        player.losses++;
        player.rating = Math.max(800, player.rating - 20);
    } else {
        player.draws++;
        player.rating += 5;
    }

    saveLeaderboard();
}

// Room ID generator
function generateRoomId() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// AI Player Implementation
class AIPlayer {
    constructor(difficulty = 'medium') {
        this.difficulty = difficulty;
        this.name = this.getAIName();
        this.emoji = this.getAIEmoji();
    }

    getAIName() {
        const names = {
            easy: ['AI Mèo', 'Bot Dễ', 'Máy Học Việc'],
            medium: ['AI Thông Minh', 'Bot Trung Bình', 'Máy Tính'],
            hard: ['AI Siêu Cấp', 'Bot Khó', 'Máy Chủ']
        };
        const nameList = names[this.difficulty];
        return nameList[Math.floor(Math.random() * nameList.length)];
    }

    getAIEmoji() {
        const emojis = ['🤖', '🔥', '⚡', '💀', '👑'];
        return emojis[Math.floor(Math.random() * emojis.length)];
    }

    async makeMove(board, validMoves, currentPlayer) {
        // Simulate thinking time
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

        if (validMoves.length === 0) return null;

        switch (this.difficulty) {
            case 'easy':
                return this.makeRandomMove(validMoves);
            case 'medium':
                return this.makeSmartMove(board, validMoves, currentPlayer);
            case 'hard':
                return this.makeExpertMove(board, validMoves, currentPlayer);
            default:
                return this.makeRandomMove(validMoves);
        }
    }

    makeRandomMove(validMoves) {
        return validMoves[Math.floor(Math.random() * validMoves.length)];
    }

    makeSmartMove(board, validMoves, currentPlayer) {
        // Prioritize corners, then edges, then try to maximize pieces flipped
        const corners = validMoves.filter(move => 
            (move.row === 0 || move.row === 7) && (move.col === 0 || move.col === 7)
        );
        if (corners.length > 0) {
            return corners[Math.floor(Math.random() * corners.length)];
        }

        // Evaluate moves by potential pieces flipped
        let bestMove = validMoves[0];
        let maxFlips = 0;

        validMoves.forEach(move => {
            const flips = this.countFlips(board, move.row, move.col, currentPlayer);
            if (flips > maxFlips) {
                maxFlips = flips;
                bestMove = move;
            }
        });

        return bestMove;
    }

    makeExpertMove(board, validMoves, currentPlayer) {
        // Advanced minimax-like evaluation
        let bestMove = validMoves[0];
        let bestScore = -Infinity;

        validMoves.forEach(move => {
            let score = 0;
            
            // Corner bonus
            if ((move.row === 0 || move.row === 7) && (move.col === 0 || move.col === 7)) {
                score += 100;
            }
            
            // Edge bonus (but not next to corner)
            else if (move.row === 0 || move.row === 7 || move.col === 0 || move.col === 7) {
                if (!this.isNextToCorner(move.row, move.col)) {
                    score += 20;
                }
            }
            
            // Avoid squares next to corners
            if (this.isNextToCorner(move.row, move.col)) {
                score -= 50;
            }
            
            // Maximize pieces flipped
            score += this.countFlips(board, move.row, move.col, currentPlayer) * 2;
            
            // Mobility consideration
            score += this.evaluateMobility(board, move, currentPlayer);

            if (score > bestScore) {
                bestScore = score;
                bestMove = move;
            }
        });

        return bestMove;
    }

    isNextToCorner(row, col) {
        const corners = [[0,0], [0,7], [7,0], [7,7]];
        return corners.some(([cr, cc]) => 
            Math.abs(row - cr) <= 1 && Math.abs(col - cc) <= 1 && !(row === cr && col === cc)
        );
    }

    countFlips(board, row, col, player) {
        const directions = [[-1,-1], [-1,0], [-1,1], [0,-1], [0,1], [1,-1], [1,0], [1,1]];
        let totalFlips = 0;

        directions.forEach(([dx, dy]) => {
            let flips = 0;
            let x = row + dx;
            let y = col + dy;

            while (x >= 0 && x < 8 && y >= 0 && y < 8) {
                if (board[x][y] === 0) break;
                if (board[x][y] === player) {
                    totalFlips += flips;
                    break;
                }
                flips++;
                x += dx;
                y += dy;
            }
        });

        return totalFlips;
    }

    evaluateMobility(board, move, player) {
        // Simplified mobility evaluation
        const tempBoard = board.map(row => [...row]);
        tempBoard[move.row][move.col] = player;
        
        // Count opponent's potential moves after this move
        const opponent = player === 1 ? 2 : 1;
        const opponentMoves = this.getValidMovesForBoard(tempBoard, opponent);
        
        return -opponentMoves.length; // Fewer opponent moves is better
    }

    getValidMovesForBoard(board, player) {
        const validMoves = [];
        const directions = [[-1,-1], [-1,0], [-1,1], [0,-1], [0,1], [1,-1], [1,0], [1,1]];

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                if (board[row][col] === 0) {
                    for (let [dx, dy] of directions) {
                        if (this.isValidDirectionForBoard(board, row, col, dx, dy, player)) {
                            validMoves.push({ row, col });
                            break;
                        }
                    }
                }
            }
        }

        return validMoves;
    }

    isValidDirectionForBoard(board, row, col, dx, dy, player) {
        let x = row + dx;
        let y = col + dy;
        let hasOpponent = false;

        while (x >= 0 && x < 8 && y >= 0 && y < 8) {
            if (board[x][y] === 0) return false;
            if (board[x][y] === player) return hasOpponent;
            hasOpponent = true;
            x += dx;
            y += dy;
        }

        return false;
    }
}

// Enhanced Game Room with new features
class GameRoom {
    constructor(roomId, creatorId, creatorName, gameMode = 'online') {
        this.id = roomId;
        this.gameMode = gameMode; // 'online', 'ai', 'local'
        this.aiDifficulty = 'medium';
        this.players = [
            { 
                id: creatorId, 
                name: creatorName, 
                emoji: '⚫', 
                playerNumber: 1,
                connected: true,
                isAI: false
            }
        ];
        this.board = Array(8).fill().map(() => Array(8).fill(0));
        this.currentPlayer = 1;
        this.gameStarted = false;
        this.gameOver = false;
        this.winner = null;
        this.spectators = [];
        this.lastActivity = Date.now();
        this.chatMessages = [];
        this.theme = 'default';
        this.moveHistory = [];
        this.ai = null;
        
        // Initialize starting position
        this.board[3][3] = 2;
        this.board[3][4] = 1;
        this.board[4][3] = 1;
        this.board[4][4] = 2;
    }

    addAIPlayer(difficulty = 'medium') {
        if (this.players.length >= 2) return false;
        
        this.ai = new AIPlayer(difficulty);
        this.aiDifficulty = difficulty;
        
        this.players.push({
            id: 'ai-player',
            name: this.ai.name,
            emoji: this.ai.emoji,
            playerNumber: 2,
            connected: true,
            isAI: true
        });
        
        this.gameMode = 'ai';
        this.gameStarted = true;
        return true;
    }

    addPlayer(playerId, playerName) {
        if (this.players.length >= 2) {
            return false;
        }
        
        this.players.push({
            id: playerId,
            name: playerName,
            emoji: '⚪',
            playerNumber: 2,
            connected: true,
            isAI: false
        });
        
        if (this.players.length === 2) {
            this.gameStarted = true;
        }
        
        return true;
    }

    addChatMessage(playerId, message) {
        const player = this.players.find(p => p.id === playerId);
        if (!player || player.isAI) return false;

        const chatMessage = {
            id: Date.now(),
            playerId,
            playerName: player.name,
            message: message.trim(),
            timestamp: Date.now(),
            emoji: player.emoji
        };

        this.chatMessages.push(chatMessage);
        
        // Keep only last 50 messages
        if (this.chatMessages.length > 50) {
            this.chatMessages = this.chatMessages.slice(-50);
        }

        return chatMessage;
    }

    setTheme(theme) {
        const validThemes = ['default', 'dark', 'neon', 'nature', 'ocean'];
        if (validThemes.includes(theme)) {
            this.theme = theme;
            return true;
        }
        return false;
    }

    removePlayer(playerId) {
        const playerIndex = this.players.findIndex(p => p.id === playerId);
        if (playerIndex !== -1) {
            this.players[playerIndex].connected = false;
        }
    }

    reconnectPlayer(playerId) {
        const player = this.players.find(p => p.id === playerId);
        if (player) {
            player.connected = true;
            return true;
        }
        return false;
    }

    getGameState() {
        return {
            roomId: this.id,
            board: this.board,
            players: this.players,
            currentPlayer: this.currentPlayer,
            gameStarted: this.gameStarted,
            gameOver: this.gameOver,
            winner: this.winner,
            scores: this.getScores(),
            validMoves: this.gameStarted ? this.getValidMoves(this.currentPlayer) : [],
            chatMessages: this.chatMessages.slice(-20), // Last 20 messages
            theme: this.theme,
            gameMode: this.gameMode,
            aiDifficulty: this.aiDifficulty,
            moveHistory: this.moveHistory
        };
    }

    getScores() {
        let player1Score = 0;
        let player2Score = 0;

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                if (this.board[row][col] === 1) player1Score++;
                if (this.board[row][col] === 2) player2Score++;
            }
        }

        return { player1Score, player2Score };
    }

    getValidMoves(player) {
        const validMoves = [];
        const directions = [
            [-1, -1], [-1, 0], [-1, 1],
            [0, -1],           [0, 1],
            [1, -1],  [1, 0],  [1, 1]
        ];

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                if (this.board[row][col] === 0) {
                    for (let [dx, dy] of directions) {
                        if (this.isValidDirection(row, col, dx, dy, player)) {
                            validMoves.push({ row, col });
                            break;
                        }
                    }
                }
            }
        }

        return validMoves;
    }

    isValidDirection(row, col, dx, dy, player) {
        let x = row + dx;
        let y = col + dy;
        let hasOpponent = false;

        while (x >= 0 && x < 8 && y >= 0 && y < 8) {
            if (this.board[x][y] === 0) {
                return false;
            }
            if (this.board[x][y] === player) {
                return hasOpponent;
            }
            hasOpponent = true;
            x += dx;
            y += dy;
        }

        return false;
    }

    async makeMove(row, col, playerId) {
        if (this.gameOver || !this.gameStarted) {
            return { success: false, error: 'Game not active' };
        }

        const player = this.players.find(p => p.id === playerId);
        if (!player || player.playerNumber !== this.currentPlayer) {
            return { success: false, error: 'Not your turn' };
        }

        if (this.board[row][col] !== 0) {
            return { success: false, error: 'Cell occupied' };
        }

        const validMoves = this.getValidMoves(this.currentPlayer);
        const isValid = validMoves.some(move => move.row === row && move.col === col);

        if (!isValid) {
            return { success: false, error: 'Invalid move' };
        }

        // Make move
        this.board[row][col] = this.currentPlayer;
        const flippedPieces = this.flipPieces(row, col, this.currentPlayer);

        // Record move in history
        this.moveHistory.push({
            player: this.currentPlayer,
            row,
            col,
            flippedPieces,
            timestamp: Date.now()
        });

        // Switch player
        this.switchPlayer();

        // Check game over
        this.checkGameOver();

        this.lastActivity = Date.now();

        const result = { 
            success: true, 
            flippedPieces,
            gameState: this.getGameState()
        };

        // Handle AI move if it's AI's turn
        if (this.gameMode === 'ai' && !this.gameOver && this.currentPlayer === 2) {
            setTimeout(async () => {
                await this.makeAIMove();
            }, 500);
        }

        return result;
    }

    async makeAIMove() {
        if (!this.ai || this.gameOver || this.currentPlayer !== 2) return;

        const validMoves = this.getValidMoves(2);
        if (validMoves.length === 0) {
            this.switchPlayer();
            return;
        }

        const move = await this.ai.makeMove(this.board, validMoves, 2);
        if (move) {
            this.board[move.row][move.col] = 2;
            const flippedPieces = this.flipPieces(move.row, move.col, 2);

            this.moveHistory.push({
                player: 2,
                row: move.row,
                col: move.col,
                flippedPieces,
                timestamp: Date.now()
            });

            this.switchPlayer();
            this.checkGameOver();
            this.lastActivity = Date.now();

            return {
                success: true,
                move,
                flippedPieces,
                gameState: this.getGameState()
            };
        }
    }

    flipPieces(row, col, player) {
        const directions = [
            [-1, -1], [-1, 0], [-1, 1],
            [0, -1],           [0, 1],
            [1, -1],  [1, 0],  [1, 1]
        ];

        const toFlip = [];

        for (let [dx, dy] of directions) {
            const piecesToFlip = [];
            let x = row + dx;
            let y = col + dy;

            while (x >= 0 && x < 8 && y >= 0 && y < 8) {
                if (this.board[x][y] === 0) {
                    break;
                }
                if (this.board[x][y] === player) {
                    toFlip.push(...piecesToFlip);
                    break;
                }
                piecesToFlip.push({ x, y });
                x += dx;
                y += dy;
            }
        }

        // Flip pieces
        toFlip.forEach(({ x, y }) => {
            this.board[x][y] = player;
        });

        return toFlip;
    }

    switchPlayer() {
        const nextPlayer = this.currentPlayer === 1 ? 2 : 1;
        const validMoves = this.getValidMoves(nextPlayer);

        if (validMoves.length > 0) {
            this.currentPlayer = nextPlayer;
        } else {
            const currentValidMoves = this.getValidMoves(this.currentPlayer);
            if (currentValidMoves.length === 0) {
                this.endGame();
                return;
            }
        }
    }

    checkGameOver() {
        const { player1Score, player2Score } = this.getScores();
        const totalPieces = player1Score + player2Score;

        if (totalPieces === 64) {
            this.endGame();
            return;
        }

        const player1Moves = this.getValidMoves(1);
        const player2Moves = this.getValidMoves(2);

        if (player1Moves.length === 0 && player2Moves.length === 0) {
            this.endGame();
        }
    }

    endGame() {
        this.gameOver = true;
        const { player1Score, player2Score } = this.getScores();
        
        if (player1Score > player2Score) {
            this.winner = 1;
        } else if (player2Score > player1Score) {
            this.winner = 2;
        } else {
            this.winner = 0; // Draw
        }

        // Update stats and leaderboard
        this.players.forEach(player => {
            if (!player.isAI) {
                let result = 'draw';
                if (this.winner === player.playerNumber) result = 'win';
                else if (this.winner !== 0) result = 'loss';

                const playerScore = player.playerNumber === 1 ? player1Score : player2Score;
                const opponentScore = player.playerNumber === 1 ? player2Score : player1Score;

                updatePlayerStats(player.name, result, playerScore, opponentScore, this.gameMode);
                updateLeaderboard(player.name, result);
            }
        });
    }

    updatePlayerEmoji(playerId, emoji) {
        const player = this.players.find(p => p.id === playerId);
        if (player && !player.isAI) {
            player.emoji = emoji;
            return true;
        }
        return false;
    }

    resetGame() {
        this.board = Array(8).fill().map(() => Array(8).fill(0));
        this.board[3][3] = 2;
        this.board[3][4] = 1;
        this.board[4][3] = 1;
        this.board[4][4] = 2;
        this.currentPlayer = 1;
        this.gameOver = false;
        this.winner = null;
        this.moveHistory = [];
        this.lastActivity = Date.now();
    }
}

// Initialize data directory on startup
initializeDataDirectory();

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    // Create room
    socket.on('createRoom', (data) => {
        const { playerName, gameMode = 'online', aiDifficulty = 'medium' } = data;
        const roomId = generateRoomId();
        const room = new GameRoom(roomId, socket.id, playerName, gameMode);
        
        if (gameMode === 'ai') {
            room.addAIPlayer(aiDifficulty);
        }
        
        rooms.set(roomId, room);
        players.set(socket.id, { roomId, playerName });
        
        socket.join(roomId);
        
        socket.emit('roomCreated', {
            roomId,
            gameState: room.getGameState()
        });
        
        console.log(`Room created: ${roomId} by ${playerName} (${gameMode})`);
    });

    // Join room
    socket.on('joinRoom', (data) => {
        const { roomId, playerName } = data;
        const room = rooms.get(roomId);
        
        if (!room) {
            socket.emit('error', { message: 'Room not found' });
            return;
        }
        
        if (room.players.length >= 2) {
            socket.emit('error', { message: 'Room is full' });
            return;
        }
        
        const success = room.addPlayer(socket.id, playerName);
        if (success) {
            players.set(socket.id, { roomId, playerName });
            socket.join(roomId);
            
            io.to(roomId).emit('playerJoined', {
                gameState: room.getGameState()
            });
            
            console.log(`${playerName} joined room ${roomId}`);
        } else {
            socket.emit('error', { message: 'Cannot join room' });
        }
    });

    // Make move
    socket.on('makeMove', async (data) => {
        const { row, col } = data;
        const playerData = players.get(socket.id);
        
        if (!playerData) {
            socket.emit('error', { message: 'Player not in any room' });
            return;
        }
        
        const room = rooms.get(playerData.roomId);
        if (!room) {
            socket.emit('error', { message: 'Room not found' });
            return;
        }
        
        const result = await room.makeMove(row, col, socket.id);
        
        if (result.success) {
            io.to(playerData.roomId).emit('moveMade', {
                row,
                col,
                player: room.currentPlayer === 1 ? 2 : 1, // Previous player
                flippedPieces: result.flippedPieces,
                gameState: result.gameState
            });

            // Handle AI move response
            if (room.gameMode === 'ai' && !room.gameOver && room.currentPlayer === 2) {
                setTimeout(async () => {
                    const aiResult = await room.makeAIMove();
                    if (aiResult && aiResult.success) {
                        io.to(playerData.roomId).emit('aiMoveMade', {
                            row: aiResult.move.row,
                            col: aiResult.move.col,
                            flippedPieces: aiResult.flippedPieces,
                            gameState: aiResult.gameState
                        });
                    }
                }, 1000);
            }
        } else {
            socket.emit('error', { message: result.error });
        }
    });

    // Chat message
    socket.on('sendChat', (data) => {
        const { message } = data;
        const playerData = players.get(socket.id);
        
        if (!playerData) return;
        
        const room = rooms.get(playerData.roomId);
        if (!room) return;
        
        const chatMessage = room.addChatMessage(socket.id, message);
        if (chatMessage) {
            io.to(playerData.roomId).emit('chatMessage', chatMessage);
        }
    });

    // Update theme
    socket.on('updateTheme', (data) => {
        const { theme } = data;
        const playerData = players.get(socket.id);
        
        if (!playerData) return;
        
        const room = rooms.get(playerData.roomId);
        if (!room) return;
        
        if (room.setTheme(theme)) {
            io.to(playerData.roomId).emit('themeUpdated', {
                theme,
                gameState: room.getGameState()
            });
        }
    });

    // Update emoji
    socket.on('updateEmoji', (data) => {
        const { emoji } = data;
        const playerData = players.get(socket.id);
        
        if (!playerData) return;
        
        const room = rooms.get(playerData.roomId);
        if (!room) return;
        
        if (room.updatePlayerEmoji(socket.id, emoji)) {
            io.to(playerData.roomId).emit('emojiUpdated', {
                playerId: socket.id,
                emoji,
                gameState: room.getGameState()
            });
        }
    });

    // Reset game
    socket.on('resetGame', () => {
        const playerData = players.get(socket.id);
        if (!playerData) return;
        
        const room = rooms.get(playerData.roomId);
        if (!room) return;
        
        room.resetGame();
        io.to(playerData.roomId).emit('gameReset', {
            gameState: room.getGameState()
        });
    });

    // Get game state
    socket.on('getGameState', () => {
        const playerData = players.get(socket.id);
        if (!playerData) return;
        
        const room = rooms.get(playerData.roomId);
        if (!room) return;
        
        socket.emit('gameState', room.getGameState());
    });

    // Get leaderboard
    socket.on('getLeaderboard', () => {
        const leaderData = Array.from(leaderboard.values())
            .sort((a, b) => b.rating - a.rating)
            .slice(0, 10);
        socket.emit('leaderboard', leaderData);
    });

    // Get player stats
    socket.on('getPlayerStats', (data) => {
        const { playerName } = data;
        const stats = gameStats.get(playerName) || null;
        socket.emit('playerStats', { playerName, stats });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        
        const playerData = players.get(socket.id);
        if (playerData) {
            const room = rooms.get(playerData.roomId);
            if (room) {
                room.removePlayer(socket.id);
                
                // Notify other players
                socket.to(playerData.roomId).emit('playerDisconnected', {
                    playerId: socket.id,
                    gameState: room.getGameState()
                });
                
                // Clean up empty rooms after 5 minutes
                setTimeout(() => {
                    if (room.players.every(p => !p.connected)) {
                        rooms.delete(playerData.roomId);
                        console.log(`Room ${playerData.roomId} cleaned up`);
                    }
                }, 5 * 60 * 1000);
            }
            
            players.delete(socket.id);
        }
    });

    // Reconnect to room
    socket.on('reconnect', (data) => {
        const { roomId, playerName } = data;
        const room = rooms.get(roomId);
        
        if (room && room.reconnectPlayer(socket.id)) {
            players.set(socket.id, { roomId, playerName });
            socket.join(roomId);
            
            socket.emit('reconnected', {
                gameState: room.getGameState()
            });
            
            socket.to(roomId).emit('playerReconnected', {
                playerId: socket.id,
                gameState: room.getGameState()
            });
        } else {
            socket.emit('error', { message: 'Cannot reconnect to room' });
        }
    });
});

// REST API endpoints
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/rooms', (req, res) => {
    const roomList = Array.from(rooms.values()).map(room => ({
        id: room.id,
        players: room.players.length,
        gameStarted: room.gameStarted,
        gameMode: room.gameMode,
        lastActivity: room.lastActivity
    }));
    
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
        .slice(0, 20);
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

// Clean up inactive rooms every hour
setInterval(() => {
    const now = Date.now();
    const INACTIVE_TIMEOUT = 60 * 60 * 1000; // 1 hour
    
    for (const [roomId, room] of rooms.entries()) {
        if (now - room.lastActivity > INACTIVE_TIMEOUT) {
            rooms.delete(roomId);
            console.log(`Cleaned up inactive room: ${roomId}`);
        }
    }
}, 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Enhanced Othello server running on port ${PORT}`);
    console.log(`🌐 Open http://localhost:${PORT} to play`);
    console.log(`🤖 AI opponents available in Easy, Medium, Hard difficulties`);
    console.log(`🏆 Leaderboard and statistics tracking enabled`);
});

module.exports = { app, server, io };