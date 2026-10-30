const Message = require('../models/Message');
const User = require('../models/User');
const { verifyToken } = require('../config/jwt');

const WORKSPACE_ROOM = 'authenticated-workspace';

function setupSocket(io) {
  const activeUsers = new Map(); // socket.id -> { socketId, userId, username, status, exp }
  const expiryTimers = new Map(); // socket.id -> timer

  function getUniqueOnlineUsers() {
    const byUser = new Map();
    for (const u of activeUsers.values()) {
      if (!byUser.has(u.username)) {
        byUser.set(u.username, {
          userId: u.userId,
          username: u.username,
          status: u.status,
        });
      }
    }
    return Array.from(byUser.values());
  }

  io.on('connection', (socket) => {
    const handshakeToken = socket.handshake.auth && socket.handshake.auth.token;

    socket.on('join', (payload) => {
      // Validate that payload is a non-null object
      if (!payload || typeof payload !== 'object') {
        socket.emit('auth-error', { error: 'Join payload must be an object' });
        return;
      }

      // Require valid JWT authentication to join the workspace
      const token = payload.token || handshakeToken;
      if (!token) {
        socket.emit('auth-error', { error: 'Authentication token required to join chat room' });
        return;
      }

      let decoded;
      try {
        decoded = verifyToken(token);
      } catch (err) {
        socket.emit('auth-error', { error: 'Invalid or expired authentication token' });
        return;
      }

      // Derive user identity strictly from verified token claims
      const userId = decoded.id || decoded.sub;
      const username = (decoded.username || '').trim();
      if (!username) {
        socket.emit('auth-error', { error: 'Invalid token payload' });
        return;
      }

      // Check token expiry and schedule socket disconnection when token expires
      const expSeconds = decoded.exp;
      if (expSeconds) {
        const msUntilExpiry = (expSeconds * 1000) - Date.now();
        if (msUntilExpiry <= 0) {
          socket.emit('auth-error', { error: 'Authentication token expired' });
          socket.disconnect(true);
          return;
        }

        // Clear existing timer if any
        if (expiryTimers.has(socket.id)) {
          clearTimeout(expiryTimers.get(socket.id));
        }

        const MAX_TIMEOUT_MS = 2147483647; // 2^31 - 1 (Node.js max 32-bit timer delay)
        const armExpiryTimer = (delay) => setTimeout(() => {
          const remaining = (expSeconds * 1000) - Date.now();
          if (remaining > 0) {
            expiryTimers.set(socket.id, armExpiryTimer(Math.min(remaining, MAX_TIMEOUT_MS)));
            return;
          }
          activeUsers.delete(socket.id);
          expiryTimers.delete(socket.id);
          socket.leave(WORKSPACE_ROOM);
          io.to(WORKSPACE_ROOM).emit('users', getUniqueOnlineUsers());
          socket.emit('auth-error', { error: 'Session expired. Please log in again.' });
          socket.disconnect(true);
        }, delay);

        const timer = armExpiryTimer(Math.min(msUntilExpiry, MAX_TIMEOUT_MS));
        expiryTimers.set(socket.id, timer);
      }

      const status = typeof payload.status === 'string' ? payload.status : 'Online';
      const userObj = {
        socketId: socket.id,
        userId: userId || null,
        username,
        status,
        exp: expSeconds || null,
        joinedAt: new Date().toISOString(),
      };

      activeUsers.set(socket.id, userObj);

      // Admit successfully authenticated socket to the workspace broadcast room
      socket.join(WORKSPACE_ROOM);

      // Give every user a personal room so others can send them direct messages
      if (userId) {
        socket.join(`user:${userId}`);
      }

      // Send chat history (up to 50 recent messages) to the newly connected user
      try {
        const history = Message.getRecent(50);
        socket.emit('history', history);
      } catch (err) {
        console.error('Error fetching message history:', err);
      }

      // Broadcast updated online users only to authenticated sockets
      io.to(WORKSPACE_ROOM).emit('users', getUniqueOnlineUsers());

      // Broadcast system notice only to authenticated room members
      socket.to(WORKSPACE_ROOM).emit('system', {
        id: `sys-${Date.now()}-${socket.id}`,
        text: `${username} joined the workspace`,
        time: new Date().toISOString(),
      });
    });

    socket.on('chat-message', (data, callback) => {
      const user = activeUsers.get(socket.id);
      if (!user) {
        if (typeof callback === 'function') callback({ success: false, error: 'Unauthenticated' });
        return;
      }

      // Verify token has not expired
      if (user.exp && Date.now() >= user.exp * 1000) {
        activeUsers.delete(socket.id);
        socket.leave(WORKSPACE_ROOM);
        io.to(WORKSPACE_ROOM).emit('users', getUniqueOnlineUsers());
        socket.emit('auth-error', { error: 'Session expired. Please log in again.' });
        socket.disconnect(true);
        if (typeof callback === 'function') callback({ success: false, error: 'Session expired' });
        return;
      }

      const rawText = typeof data === 'string' ? data : (data && data.text);
      if (!rawText || typeof rawText !== 'string') {
        if (typeof callback === 'function') callback({ success: false, error: 'Invalid text' });
        return;
      }

      const text = rawText.trim();
      if (!text) {
        if (typeof callback === 'function') callback({ success: false, error: 'Empty message' });
        return;
      }

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

        // Broadcast saved message only to authenticated room members
        io.to(WORKSPACE_ROOM).emit('chat-message', msgPayload);
        if (typeof callback === 'function') {
          callback({ success: true, id: saved.id });
        }
      } catch (err) {
        console.error('Failed to save message:', err);
        socket.emit('message-error', { error: 'Failed to send message. Please try again.' });
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Database save failed' });
        }
      }
    });

    // Private 1-to-1 message: { to: <userId>, text: "..." }
    socket.on('direct-message', (data, callback) => {
      const user = activeUsers.get(socket.id);
      if (!user) {
        if (typeof callback === 'function') callback({ success: false, error: 'Unauthenticated' });
        return;
      }

      // Verify token has not expired
      if (user.exp && Date.now() >= user.exp * 1000) {
        activeUsers.delete(socket.id);
        socket.leave(WORKSPACE_ROOM);
        io.to(WORKSPACE_ROOM).emit('users', getUniqueOnlineUsers());
        socket.emit('auth-error', { error: 'Session expired. Please log in again.' });
        socket.disconnect(true);
        if (typeof callback === 'function') callback({ success: false, error: 'Session expired' });
        return;
      }

      if (!data || typeof data !== 'object') {
        if (typeof callback === 'function') callback({ success: false, error: 'Invalid payload' });
        return;
      }

      const toId = Number(data.to);
      const rawText = data.text;
      if (!rawText || typeof rawText !== 'string') {
        if (typeof callback === 'function') callback({ success: false, error: 'Invalid text' });
        return;
      }

      const text = rawText.trim();
      if (!text) {
        if (typeof callback === 'function') callback({ success: false, error: 'Empty message' });
        return;
      }

      if (!user.userId) {
        if (typeof callback === 'function') callback({ success: false, error: 'Direct messaging unavailable for this session' });
        return;
      }

      if (!Number.isInteger(toId) || toId <= 0) {
        if (typeof callback === 'function') callback({ success: false, error: 'Invalid recipient' });
        return;
      }

      if (toId === user.userId) {
        if (typeof callback === 'function') callback({ success: false, error: 'Cannot send a direct message to yourself' });
        return;
      }

      const recipient = User.findById(toId);
      if (!recipient) {
        if (typeof callback === 'function') callback({ success: false, error: 'Recipient not found' });
        return;
      }

      const sanitizedText = text.slice(0, 2000);

      try {
        // Persist the direct message
        const saved = Message.create({
          userId: user.userId,
          username: user.username,
          text: sanitizedText,
          recipientId: toId,
        });

        const msgPayload = {
          id: saved.id,
          userId: user.userId,
          username: user.username,
          recipientId: toId,
          text: saved.text,
          time: saved.created_at || new Date().toISOString(),
          from: socket.id,
        };

        // Deliver to every socket belonging to the recipient and the sender
        io.to(`user:${toId}`).to(`user:${user.userId}`).emit('direct-message', msgPayload);

        if (typeof callback === 'function') {
          callback({ success: true, id: saved.id });
        }
      } catch (err) {
        console.error('Failed to save direct message:', err);
        socket.emit('message-error', { error: 'Failed to send message. Please try again.' });
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Database save failed' });
        }
      }
    });

    socket.on('typing', (isTyping) => {
      const user = activeUsers.get(socket.id);
      if (!user) return;
      socket.to(WORKSPACE_ROOM).emit('typing', {
        username: user.username,
        isTyping: Boolean(isTyping),
      });
    });

    socket.on('disconnect', () => {
      if (expiryTimers.has(socket.id)) {
        clearTimeout(expiryTimers.get(socket.id));
        expiryTimers.delete(socket.id);
      }

      const user = activeUsers.get(socket.id);
      activeUsers.delete(socket.id);

      if (user) {
        socket.to(WORKSPACE_ROOM).emit('system', {
          id: `sys-leave-${Date.now()}`,
          text: `${user.username} left the workspace`,
          time: new Date().toISOString(),
        });
        io.to(WORKSPACE_ROOM).emit('users', getUniqueOnlineUsers());
      }
    });
  });
}

module.exports = { setupSocket };
