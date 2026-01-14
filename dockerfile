# A lightweight LTS Node image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy dependency definitions first
COPY package*.json ./

# Install production dependencies only
RUN npm install --only=production

# Copy application source
COPY . .

# Expose port
EXPOSE 8080

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', res => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Start the app
CMD ["node", "server.js"]
