FROM node:22-alpine

WORKDIR /app

# Copy the install script and the installer server code
COPY install.sh ./install.sh
COPY coolify/installer/server.js ./coolify/installer/server.js

ENV PORT=3000
EXPOSE 3000

CMD ["node", "coolify/installer/server.js"]
