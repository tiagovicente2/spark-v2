FROM node:22-alpine

# Install system dependencies (unzip is needed by server.js to extract uploaded sites)
RUN apk add --no-cache unzip

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy application files
COPY server/ ./server/

# Expose server port
EXPOSE 3000

# Set production variables
ENV NODE_ENV=production
ENV PORT=3000

# /usr/src/app/storage will hold the sqlite database and deployed websites
VOLUME /usr/src/app/storage

CMD [ "node", "server/server.js" ]
