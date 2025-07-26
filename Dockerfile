FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (chỉ production)
RUN npm install --omit=dev

# Copy toàn bộ source code vào container
COPY . .

# Tạo user không phải root (bảo mật hơn)
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001
RUN chown -R nextjs:nodejs /app
USER nextjs

# Expose cổng server (Render sẽ tự set PORT)
EXPOSE 3000

# ✅ Sửa Healthcheck dùng đúng PORT do Render cấp
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:$PORT/api/rooms || exit 1

# Start server bằng npm script
CMD ["npm", "start"]
