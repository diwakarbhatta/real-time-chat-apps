const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

// Initialize DB schema
require('./config/db');

const authRoutes = require('./routes/auth');
const messageRoutes = require('./routes/messages');
const { setupSocket } = require('./socket/index');

// Configurable CORS origin: specify frontend domain via CORS_ORIGIN in production
// (comma-separated for multiple origins). Defaults to '*' for local development.
const corsOriginEnv = process.env.CORS_ORIGIN;
const allowedOrigins = corsOriginEnv
  ? (corsOriginEnv.includes(',') ? corsOriginEnv.split(',').map((o) => o.trim()) : corsOriginEnv.trim())
  : '*';

const corsOptions = {
  origin: allowedOrigins,
  methods: ['GET', 'POST'],
  credentials: true,
};

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: corsOptions,
});

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static files
const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/messages', messageRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Fallback for HTML pages
app.get('/', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Setup Socket.IO logic
setupSocket(io);

const PORT = process.env.PORT || 5000;
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Pulse Chat server running at http://localhost:${PORT}`);
  });
}

module.exports = { app, server, io };
