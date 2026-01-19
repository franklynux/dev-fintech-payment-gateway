# Example for Node.js Dockerfile
FROM node:18-alpine

# Create a non-root user and group
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Set working directory
WORKDIR /app

# Copy package files first
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy app source code
COPY . .

# Change ownership 
RUN chown -R appuser:appgroup /app

# Switch to the non-root user
USER appuser

# Expose port and start app
EXPOSE 8888
CMD ["node", "server.js"]
