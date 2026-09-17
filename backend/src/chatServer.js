require('dotenv').config();

/**
 * Standalone real-time chat service (`npm run chat`).
 *
 * Runs only Socket.io, so chat connections scale independently of REST
 * traffic. Run any number of instances behind one domain; they share rooms
 * through the Redis adapter, and the API reaches them through the Redis
 * emitter (src/realtime). Point the app at it with EXPO_PUBLIC_SOCKET_URL and
 * set ENABLE_SOCKETS=false on the API service.
 */
const http = require('http');
const logger = require('./config/logger');
const { initSocket, closeSocket } = require('./socket');
const { healthBody, onShutdown, closeDatabase, closeRedis } = require('./lifecycle');

if (!process.env.REDIS_URL && process.env.NODE_ENV === 'production') {
  // Without Redis the API cannot reach these sockets (bans, blocks, account
  // deletion) and a second instance would split the rooms.
  logger.error('REDIS_URL is required for the standalone chat service');
  process.exit(1);
}

const PORT = process.env.PORT || 3001;

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(healthBody('chat')));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Route not found' }));
});

initSocket(server);

server.listen(PORT, () => {
  logger.info(`💬 Matcherc chat service listening on port ${PORT}`);
});

// Closing Socket.io also closes the HTTP server.
onShutdown([closeSocket, closeDatabase, closeRedis]);

module.exports = server;
