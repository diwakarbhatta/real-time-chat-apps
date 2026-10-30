const Message = require('../models/Message');
const User = require('../models/User');
const { verifyToken } = require('../config/jwt');

function setupSocket(io) {
  const activeUsers = new Map(); // socket.id -> { socketId, userId, username, email, status }

  function getUniqueOnlineUsers() {
    const byUser = new Map();
    for (const u of activeUsers.values()) {
      if (!byUser.has(u.username)) {
        byUser.set(u.username, u);
      }
    }
    return Array.from(byUser.values());
  }

  io.on('connection', (socket) => {
    // Optional token in handshake auth
    let authUser = null;
    const handshakeToken = socket.handshake.auth && socket.handshake.auth.token;
    if (handshakeToken) {
      try {
        authUser = verifyToken(handshakeToken);
      } catch (err) {
        // Handshake token invalid or expired, client can re-join
      }
    }

    socket.on('join', (payload = {}) => {
      let username = payload.username;
      let userId = payload.userId;
      let email = payload.email;
      let status = payload.status || 'Online';

      // Check if payload includes a JWT token
      if (payload.token) {
        try {
          const decoded = verifyToken(payload.token);
          userId = decoded.id || decoded.sub;
          username = decoded.username || username;
          email = decoded.email || email;
        } catch (e) {
          // Token expired or invalid, will use provided username
        }
      } else if (authUser) {
        userId = authUser.id || authUser.sub;
        username = authUser.username;
        email = authUser.email;
      }

      username = (username || 'Guest').trim();
      const userObj = {
        socketId: socket.id,
        userId: userId || null,
        username,
        email: email || null,
        status,
        joinedAt: new Date().toISOString(),
      };

      activeUsers.set(socket.id, userObj);

      // Send chat history (up to 50 recent messages) to the newly connected user
      try {
        const history = Message.getRecent(50);
        socket.emit('history', history);
      } catch (err) {
        console.error('Error fetching message history:', err);
      }

      // Broadcast updated online users
      io.emit('users', getUniqueOnlineUsers());

      // Broadcast system notice
      socket.broadcast.emit('system', {
        id: `sys-${Date.now()}-${socket.id}`,
        text: `${username} joined the workspace`,
        time: new Date().toISOString(),
      });
    });

    socket.on('chat-message', (data) => {
      const user = activeUsers.get(socket.id);
      if (!user) return;

      const rawText = typeof data === 'string' ? data : (data && data.text);
      if (!rawText || typeof rawText !== 'string') return;

      const text = rawText.trim();
      if (!text) return;

      const sanitizedText = text.slice(0, 2000);

      try {
        // Persist message to SQLite
        const saved = Message.create({
          userId: user.userId,
          username: user.username,
          text: sanitizedText,
        });

        const msgPayload = {
          id: saved.id,
          userId: user.userId,
          username: user.username,
          text: saved.text,
          time: saved.created_at || new Date().toISOString(),
          from: socket.id,
        };

        io.emit('chat-message', msgPayload);
      } catch (err) {
        console.error('Failed to save message:', err);
        // Fallback: emit even if db save fails
        io.emit('chat-message', {
          id: `${Date.now()}-${socket.id}`,
          userId: user.userId,
          username: user.username,
          text: sanitizedText,
          time: new Date().toISOString(),
          from: socket.id,
        });
      }
    });

    socket.on('typing', (isTyping) => {
      const user = activeUsers.get(socket.id);
      if (!user) return;
      socket.broadcast.emit('typing', {
        username: user.username,
        isTyping: Boolean(isTyping),
      });
    });

    socket.on('disconnect', () => {
      const user = activeUsers.get(socket.id);
      activeUsers.delete(socket.id);

      if (user) {
        socket.broadcast.emit('system', {
          id: `sys-leave-${Date.now()}`,
          text: `${user.username} left the workspace`,
          time: new Date().toISOString(),
        });
        io.emit('users', getUniqueOnlineUsers());
      }
    });
  });
}

module.exports = { setupSocket };
