import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';
import { networkInterfaces } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { RoomManager } from './engine/index.js';
import { setupSocketHandlers } from './socket.js';
import { setupRoutes } from './routes/api.js';

const app = express();
const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());

const roomManager = new RoomManager();

// REST API
setupRoutes(app, roomManager);

// WebSocket
setupSocketHandlers(io, roomManager);

// Serve client static files (production)
const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDist = join(__dirname, '../../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(join(clientDist, 'index.html'));
  });
}

const PORT = parseInt(process.env.PORT || '3001', 10);

httpServer.listen(PORT, '0.0.0.0', () => {
  const addresses = getLocalAddresses();
  console.log(`\n🐺 狼人杀游戏服务器启动成功`);
  console.log(`   本地访问: http://localhost:${PORT}`);
  addresses.forEach(addr => {
    console.log(`   局域网访问: http://${addr}:${PORT}`);
  });
  console.log('');
});

function getLocalAddresses(): string[] {
  const interfaces = networkInterfaces();
  const addresses: string[] = [];
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const alias of iface) {
      if (alias.family === 'IPv4' && !alias.internal) {
        addresses.push(alias.address);
      }
    }
  }
  return addresses;
}

export { io, roomManager };
