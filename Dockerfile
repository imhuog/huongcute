FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (chỉ cài dependencies cần thiết)
RUN npm install --omit=dev

# Copy toàn bộ source code
COPY . .

# Tạo user không phải root để chạy an toàn
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001
RUN chown -R nextjs:nodejs /app
USER nextjs

# Expose cổng app (Render sẽ gán PORT)
EXPOSE 3000

# ❌ Bỏ dòng HEALTHCHECK để tránh bị kill vì endpoint fail

# Start app
CMD ["npm", "start"]
