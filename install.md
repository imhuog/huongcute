# 📦 Hướng dẫn cài đặt chi tiết

## 🔧 Yêu cầu hệ thống

- **Node.js**: 16.0.0 trở lên
- **npm**: 7.0.0 trở lên (hoặc yarn 1.22.0+)
- **RAM**: Tối thiểu 512MB
- **Disk**: Tối thiểu 100MB free space

## 📥 Download và cài đặt

### Cách 1: Download ZIP
1. Download file ZIP từ GitHub
2. Giải nén vào thư mục mong muốn
3. Mở Terminal/Command Prompt
4. Navigate đến thư mục project

### Cách 2: Git Clone
```bash
git clone https://github.com/your-username/othello-multiplayer-game.git
cd othello-multiplayer-game
```

## 🚀 Chạy trên Local Machine

### Bước 1: Cài đặt dependencies
```bash
# Sử dụng npm
npm install

# Hoặc sử dụng yarn
yarn install
```

### Bước 2: Chạy server
```bash
# Development mode (auto-restart)
npm run dev

# Production mode
npm start
```

### Bước 3: Mở trình duyệt
Vào địa chỉ: `http://localhost:3000`

## 🌐 Deploy lên các platform

### 🔷 Vercel (Miễn phí, Khuyến nghị)

**Cách 1: Vercel CLI**
```bash
# Cài đặt CLI
npm install -g vercel

# Login
vercel login

# Deploy
vercel

# Deploy production
vercel --prod
```

**Cách 2: Vercel Dashboard**
1. Vào [vercel.com](https://vercel.com)
2. Import GitHub repository
3. Auto-deploy sẽ chạy

### 🔷 Render (Miễn phí)

1. Push code lên GitHub
2. Vào [render.com](https://render.com)
3. Create new "Web Service"
4. Connect GitHub repo
5. Settings:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment**: Node

### 🔷 Railway (Miễn phí $5 credit)

```bash
# Cài đặt CLI
npm install -g @railway/cli

# Login
railway login

# Deploy
railway deploy
```

### 🔷 Heroku (Freemium)

```bash
# Cài đặt Heroku CLI
# Tạo app
heroku create your-app-name

# Deploy
git push heroku main

# Open app
heroku open
```

### 🔷 DigitalOcean App Platform

1. Connect GitHub repo
2. Auto-detect Node.js
3. Deploy với default settings

## 🐳 Docker Deployment

### Local Docker
```bash
# Build image
docker build -t othello-game .

# Run container
docker run -p 3000:3000 othello-game
```

### Docker Compose
```bash
# Run với compose
docker-compose up -d

# Stop
docker-compose down
```

### Docker Hub
```bash
# Build và push
docker build -t your-username/othello-game .
docker push your-username/othello-game

# Pull và run trên server khác
docker pull your-username/othello-game
docker run -p 3000:3000 your-username/othello-game
```

## ⚙️ Environment Variables

Tạo file `.env` (copy từ `.env.example`):

```env
NODE_ENV=production
PORT=3000

# Optional: Database
# MONGODB_URI=mongodb://localhost:27017/othello
# REDIS_URL=redis://localhost:6379

# Optional: Analytics
# GOOGLE_ANALYTICS_ID=GA_MEASUREMENT_ID
```

## 🔍 Kiểm tra deployment

### Health Check Endpoints
```bash
# Check server status
curl https://your-domain.com/api/rooms

# Response should be: []
```

### Test Multiplayer
1. Mở 2 tabs trình duyệt
2. Tab 1: Tạo phòng
3. Tab 2: Vào phòng bằng mã
4. Test real-time sync

## 🚨 Troubleshooting

### Lỗi thường gặp

**1. "Cannot find module" error**
```bash
# Xóa node_modules và cài lại
rm -rf node_modules package-lock.json
npm install
```

**2. Port already in use**
```bash
# Kill process trên port 3000
# Windows
netstat -ano | findstr :3000
taskkill /F /PID <PID>

# Mac/Linux
lsof -ti:3000 | xargs kill -9
```

**3. Socket.IO connection issues**
- Check firewall settings
- Ensure WebSocket support
- Try different browser

**4. Memory issues trên shared hosting**
```javascript
// Thêm vào server.js
if (process.env.NODE_ENV === 'production') {
    // Giảm memory usage
    process.env.NODE_OPTIONS = '--max-old-space-size=512';
}
```

## 📊 Performance Optimization

### Production Settings
```javascript
// server.js - Production optimizations
if (process.env.NODE_ENV === 'production') {
    app.use(compression());
    app.use(helmet());
    
    // Rate limiting
    const rateLimit = require('express-rate-limit');
    app.use(rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100 // limit each IP to 100 requests per windowMs
    }));
}
```

### CDN cho Static Files
```html
<!-- public/index.html - Use CDN for better performance -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://cdnjs.cloudflare.com">
```

## 🔐 Security Best Practices

### HTTPS Enforcement
```javascript
// server.js - Force HTTPS in production
if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
        if (req.header('x-forwarded-proto') !== 'https') {
            res.redirect(`https://${req.header('host')}${req.url}`);
        } else {
            next();
        }
    });
}
```

### Input Validation
```javascript
// Add input validation
const validator = require('validator');

socket.on('createRoom', (data) => {
    const { playerName } = data;
    
    if (!playerName || !validator.isLength(playerName, { min: 1, max: 20 })) {
        socket.emit('error', { message: 'Invalid player name' });
        return;
    }
    
    // Continue with room creation...
});
```

## 📈 Monitoring và Analytics

### Basic Logging
```javascript
// server.js - Add logging
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});

// Log room activities
logger.info('Room created', { roomId, playerName });
```

## 🎯 Hoàn tất!

Sau khi làm theo hướng dẫn này, bạn sẽ có:
- ✅ Game chạy trên local machine
- ✅ Deploy thành công lên cloud platform
- ✅ HTTPS và security đầy đủ
- ✅ Performance optimization
- ✅ Monitoring cơ bản

**🎮 Game của bạn đã sẵn sàng để chơi với bạn bè trên toàn thế giới!**
