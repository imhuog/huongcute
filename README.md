# 🎯 Cờ Lật Online - Multiplayer Othello Game

Một game cờ lật (Othello/Reversi) multiplayer với tính năng real-time sử dụng Socket.IO.

## ✨ Tính năng

### 🎮 Gameplay
- ✅ Click để đi quân với validation đúng luật Othello
- ✅ Highlight nước đi hợp lệ với hiệu ứng lấp lánh
- ✅ Lật quân tự động theo 8 hướng
- ✅ Đổi lượt thông minh (bỏ lượt khi không có nước đi)
- ✅ Đếm điểm real-time và kết thúc game

### 🌐 Multiplayer Online
- ✅ Tạo room với mã ID 6 số
- ✅ Join room bằng mã hoặc link
- ✅ Đồng bộ real-time với Socket.IO
- ✅ Reconnection tự động khi mất mạng
- ✅ Thông báo khi player join/leave

### 🎨 Giao diện
- ✅ UI gradient hiện đại với glassmorphism
- ✅ Chọn emoji cho quân cờ (5 options mỗi player)
- ✅ Animation mượt mà: lật quân, hover, sparkle effects
- ✅ Responsive design cho mobile

### 📱 Tính năng bổ sung
- ✅ Chế độ offline cho 1 máy
- ✅ Connection status indicator
- ✅ Share room link
- ✅ Game rules modal
- ✅ Clean UI với notifications

## 🚀 Cài đặt và chạy

### Prerequisites
- Node.js 16+
- npm hoặc yarn

### Local Development
```bash
# Clone repository
git clone <your-repo-url>
cd othello-multiplayer-game

# Cài đặt dependencies
npm install

# Chạy development server
npm run dev

# Hoặc chạy production mode
npm start
```

Mở trình duyệt và vào `http://localhost:3000`

## 🌐 Deployment

### 1. Vercel (Khuyến nghị cho Serverless)
```bash
# Cài đặt Vercel CLI
npm install -g vercel

# Deploy
vercel

# Hoặc deploy production
vercel --prod
```

### 2. Render
1. Push code lên GitHub
2. Connect GitHub repo với Render
3. Deploy as Web Service
4. Build Command: `npm install`
5. Start Command: `npm start`

### 3. Railway
```bash
# Cài đặt Railway CLI
npm install -g @railway/cli

# Login và deploy
railway login
railway deploy
```

### 4. Heroku
```bash
# Cài đặt Heroku CLI
# Tạo Heroku app
heroku create your-app-name

# Deploy
git push heroku main
```

### 5. Docker
```bash
# Build image
docker build -t othello-game .

# Run container
docker run -p 3000:3000 othello-game

# Hoặc sử dụng Docker Compose
docker-compose up -d
```

## 📁 Cấu trúc project

```
othello-multiplayer-game/
├── server.js              # Backend server với Socket.IO
├── package.json           # Dependencies và scripts
├── public/
│   └── index.html        # Frontend client
├── vercel.json           # Vercel configuration
├── Dockerfile            # Docker configuration
├── docker-compose.yml    # Docker Compose
├── render.yaml           # Render configuration
├── .gitignore           # Git ignore rules
├── .env.example         # Environment variables example
└── README.md            # Tài liệu này
```

## 🎮 Cách chơi

### Online Multiplayer
1. **Tạo phòng**: Nhập tên → Click "Tạo Phòng Mới"
2. **Chia sẻ**: Copy mã phòng 6 số hoặc link để gửi bạn bè
3. **Chờ đối thủ**: Đợi người chơi thứ 2 vào phòng
4. **Bắt đầu**: Game tự động bắt đầu khi đủ 2 người

### Offline Mode
1. Click "Chơi Offline"
2. Chơi trực tiếp trên 1 máy với 2 người

### Luật chơi Othello
- Đặt quân vào ô trống để "kẹp" quân đối thủ
- Tất cả quân bị kẹp sẽ chuyển thành quân của bạn
- Người có nhiều quân nhất khi hết ô trống sẽ thắng

## 🛠️ Công nghệ sử dụng

### Backend
- **Node.js** - Runtime
- **Express.js** - Web framework
- **Socket.IO** - Real-time communication
- **CORS** - Cross-origin requests
- **Helmet** - Security headers
- **Compression** - Response compression

### Frontend
- **Vanilla JavaScript** - Logic game
- **Socket.IO Client** - Real-time connection
- **CSS3** - Modern styling với animations
- **HTML5** - Semantic markup

### DevOps
- **Docker** - Containerization
- **Vercel** - Serverless deployment
- **Render** - Cloud hosting
- **GitHub Actions** - CI/CD (optional)

## 🔧 Tính năng advanced có thể thêm

### Database Integration
```javascript
// Thêm vào server.js
const mongoose = require('mongoose');

// Game history schema
const GameSchema = new mongoose.Schema({
    roomId: String,
    players: [{ name: String, emoji: String }],
    winner: Number,
    moves: Array,
    startTime: Date,
    endTime: Date
});
```

### Redis cho Room Management
```javascript
// Cải thiện performance với Redis
const redis = require('redis');
const client = redis.createClient(process.env.REDIS_URL);

// Store rooms in Redis instead of memory
await client.hset('rooms', roomId, JSON.stringify(room));
```

### Advanced Features
- 🏆 Leaderboard và statistics
- 🎨 Custom themes và boards
- 🤖 AI opponent với different difficulty levels
- 💬 In-game chat
- 📊 Game replay system
- 🎵 Sound effects và background music
- 🏅 Achievement system
- 👥 Spectator mode
- 🎮 Tournament mode
- 📱 PWA support

## 🐛 Troubleshooting

### Common Issues

**1. Socket.IO connection failed**
```bash
# Check if server is running
curl http://localhost:3000/api/rooms

# Check network/firewall settings
```

**2. Room not found**
- Rooms tự động xóa sau 1 giờ không hoạt động
- Kiểm tra mã phòng 6 số

**3. Game not syncing**
- Refresh trang để reconnect
- Kiểm tra connection status (góc trên phải)

## 📝 License

MIT License - Free to use and modify

## 👨‍💻 Developer

Tạo bởi [Your Name] với ❤️

---

**🎯 Ready to play? Deploy ngay và thách đấu bạn bè!**
