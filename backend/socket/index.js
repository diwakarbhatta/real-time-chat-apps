const Message = require('../models/Message');
const User = require('../models/User');
const { verifyToken } = require('../config/jwt');

const WORKSPACE_ROOM = 'authenticated-workspace';
const MAX_MESSAGE_LENGTH = 2000;
const ALLOWED_REACTIONS = ['👍','❤️','😂','😮','😢','🔥','🎉','👀','💯','🙏'];

function setupSocket(io) {
  const activeUsers = new Map(); // socket.id -> { socketId, userId, username, status, exp }
  const expiryTimers = new Map(); // socket.id -> timer

  function getUniqueOnlineUsers() {
    const byUser = new Map();
    for (const u of activeUsers.values()) {
      if (!byUser.has(u.userId || u.username)) {
        byUser.set(u.userId || u.username, {
          userId: u.userId,
          username: u.username,
          status: u.status,
          lastSeen: null, // online now
        });
      }
    }
    return Array.from(byUser.values());
  }

  function broadcastUsers() {
    io.to(WORKSPACE_ROOM).emit('users', getUniqueOnlineUsers());
  }

  function requireUser(socket, callback) {
    const user = activeUsers.get(socket.id);
    if (!user) {
      if (typeof callback === 'function') callback({ success: false, error: 'Unauthenticated' });
      return null;
    }
    if (user.exp && Date.now() >= user.exp * 1000) {
      activeUsers.delete(socket.id);
      socket.leave(WORKSPACE_ROOM);
      broadcastUsers();
      socket.emit('auth-error', { error: 'Session expired. Please log in again.' });
      socket.disconnect(true);
      if (typeof callback === 'function') callback({ success: false, error: 'Session expired' });
      return null;
    }
    return user;
  }

  io.on('connection', (socket) => {
    const handshakeToken = socket.handshake.auth && socket.handshake.auth.token;

    socket.on('join', (payload) => {
      if (!payload || typeof payload !== 'object') {
        socket.emit('auth-error', { error: 'Join payload must be an object' });
        return;
      }

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

      const userId = decoded.id || decoded.sub;
      const username = (decoded.username || '').trim();
      if (!username) {
        socket.emit('auth-error', { error: 'Invalid token payload' });
        return;
      }

      const expSeconds = decoded.exp;
      if (expSeconds) {
        const msUntilExpiry = (expSeconds * 1000) - Date.now();
        if (msUntilExpiry <= 0) {
          socket.emit('auth-error', { error: 'Authentication token expired' });
          socket.disconnect(true);
          return;
        }

        if (expiryTimers.has(socket.id)) {
          clearTimeout(expiryTimers.get(socket.id));
        }

        const MAX_TIMEOUT_MS = 2147483647;
        const armExpiryTimer = (delay) => setTimeout(() => {
          const remaining = (expSeconds * 1000) - Date.now();
          if (remaining > 0) {
            expiryTimers.set(socket.id, armExpiryTimer(Math.min(remaining, MAX_TIMEOUT_MS)));
            return;
          }
          if (userId) User.updateLastSeen(userId);
          activeUsers.delete(socket.id);
          expiryTimers.delete(socket.id);
          socket.leave(WORKSPACE_ROOM);
          broadcastUsers();
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
      socket.join(WORKSPACE_ROOM);
      if (userId) {
        socket.join(`user:${userId}`);
        User.updateLastSeen(userId);
      }

      try {
        const history = Message.getRecent(50);
        socket.emit('history', history);
      } catch (err) {
        console.error('Error fetching message history:', err);
      }

      broadcastUsers();

      socket.to(WORKSPACE_ROOM).emit('system', {
        id: `sys-${Date.now()}-${socket.id}`,
        text: `${username} joined the workspace`,
        time: new Date().toISOString(),
      });
    });

    // ── Room message ──────────────────────────────────────────────────────
    socket.on('chat-message', (data, callback) => {
      const user = requireUser(socket, callback);
      if (!user) return;

      const rawText = typeof data === 'string' ? data : (data && data.text);
      const replyToId = data && data.replyToId ? Number(data.replyToId) : null;

      if (!rawText || typeof rawText !== 'string') {
        if (typeof callback === 'function') callback({ success: false, error: 'Invalid text' });
        return;
      }

      const text = rawText.trim();
      if (!text) {
        if (typeof callback === 'function') callback({ success: false, error: 'Empty message' });
        return;
      }

      if (text.length > MAX_MESSAGE_LENGTH) {
        if (typeof callback === 'function') callback({ success: false, error: `Message exceeds ${MAX_MESSAGE_LENGTH} chars` });
        return;
      }

      try {
        const saved = Message.create({
          userId: user.userId,
          username: user.username,
          text,
          replyToId: (replyToId && Number.isInteger(replyToId) && replyToId > 0) ? replyToId : null,
        });

        const msgPayload = { ...saved, userId: saved.user_id, time: saved.created_at, from: socket.id };
        io.to(WORKSPACE_ROOM).emit('chat-message', msgPayload);
        if (typeof callback === 'function') callback({ success: true, id: saved.id });
      } catch (err) {
        console.error('Failed to save message:', err);
        if (typeof callback === 'function') callback({ success: false, error: 'Database save failed' });
      }
    });

    // ── Direct message ────────────────────────────────────────────────────
    socket.on('direct-message', (data, callback) => {
      const user = requireUser(socket, callback);
      if (!user) return;

      if (!data || typeof data !== 'object') {
        if (typeof callback === 'function') callback({ success: false, error: 'Invalid payload' });
        return;
      }

      const toId = Number(data.to);
      const rawText = data.text;
      const replyToId = data.replyToId ? Number(data.replyToId) : null;

      if (!rawText || typeof rawText !== 'string') {
        if (typeof callback === 'function') callback({ success: false, error: 'Invalid text' });
        return;
      }

      const text = rawText.trim();
      if (!text) {
        if (typeof callback === 'function') callback({ success: false, error: 'Empty message' });
        return;
      }

      if (text.length > MAX_MESSAGE_LENGTH) {
        if (typeof callback === 'function') callback({ success: false, error: `Message exceeds ${MAX_MESSAGE_LENGTH} chars` });
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

      try {
        const saved = Message.create({
          userId: user.userId,
          username: user.username,
          text,
          recipientId: toId,
          replyToId: (replyToId && Number.isInteger(replyToId) && replyToId > 0) ? replyToId : null,
        });

        const msgPayload = { ...saved, userId: saved.user_id, recipientId: saved.recipient_id, time: saved.created_at, from: socket.id };
        io.to(`user:${toId}`).to(`user:${user.userId}`).emit('direct-message', msgPayload);
        if (typeof callback === 'function') callback({ success: true, id: saved.id });
      } catch (err) {
        console.error('Failed to save direct message:', err);
        if (typeof callback === 'function') callback({ success: false, error: 'Database save failed' });
      }
    });

    // ── Edit message ──────────────────────────────────────────────────────
    socket.on('edit-message', (data, callback) => {
      const user = requireUser(socket, callback);
      if (!user) return;

      const msgId = Number(data && data.id);
      const newText = (data && typeof data.text === 'string') ? data.text.trim() : '';

      if (!msgId || !newText) {
        if (typeof callback === 'function') callback({ success: false, error: 'Invalid id or text' });
        return;
      }
      if (newText.length > MAX_MESSAGE_LENGTH) {
        if (typeof callback === 'function') callback({ success: false, error: 'Message too long' });
        return;
      }

      const updated = Message.edit(msgId, user.userId, newText);
      if (updated === false) {
        if (typeof callback === 'function') callback({ success: false, error: 'Not authorized to edit this message' });
        return;
      }
      if (!updated) {
        if (typeof callback === 'function') callback({ success: false, error: 'Message not found or already deleted' });
        return;
      }

      const payload = { ...updated, userId: updated.user_id, time: updated.created_at };
      // Broadcast edit to room or the DM participants
      if (updated.recipient_id) {
        io.to(`user:${updated.recipient_id}`).to(`user:${user.userId}`).emit('message-edited', payload);
      } else {
        io.to(WORKSPACE_ROOM).emit('message-edited', payload);
      }
      if (typeof callback === 'function') callback({ success: true });
    });

    // ── Delete message ────────────────────────────────────────────────────
    socket.on('delete-message', (data, callback) => {
      const user = requireUser(socket, callback);
      if (!user) return;

      const msgId = Number(data && data.id);
      if (!msgId) {
        if (typeof callback === 'function') callback({ success: false, error: 'Invalid id' });
        return;
      }

      const deleted = Message.delete(msgId, user.userId);
      if (deleted === false) {
        if (typeof callback === 'function') callback({ success: false, error: 'Not authorized to delete this message' });
        return;
      }
      if (!deleted) {
        if (typeof callback === 'function') callback({ success: false, error: 'Message not found' });
        return;
      }

      const payload = { id: msgId, deleted: 1, text: '[Message deleted]' };
      if (deleted.recipient_id) {
        io.to(`user:${deleted.recipient_id}`).to(`user:${user.userId}`).emit('message-deleted', payload);
      } else {
        io.to(WORKSPACE_ROOM).emit('message-deleted', payload);
      }
      if (typeof callback === 'function') callback({ success: true });
    });

    // ── Reaction toggle ───────────────────────────────────────────────────
    socket.on('react', (data, callback) => {
      const user = requireUser(socket, callback);
      if (!user) return;

      const msgId = Number(data && data.id);
      const emoji = data && data.emoji;

      if (!msgId || !emoji || !ALLOWED_REACTIONS.includes(emoji)) {
        if (typeof callback === 'function') callback({ success: false, error: 'Invalid reaction' });
        return;
      }
      if (!user.userId) {
        if (typeof callback === 'function') callback({ success: false, error: 'Must be logged in to react' });
        return;
      }

      const msg = Message.getById(msgId);
      if (!msg) {
        if (typeof callback === 'function') callback({ success: false, error: 'Message not found' });
        return;
      }

      const reactions = Message.addReaction(msgId, user.userId, emoji);
      const payload = { id: msgId, reactions };

      if (msg.recipient_id) {
        io.to(`user:${msg.recipient_id}`).to(`user:${msg.user_id}`).emit('reaction-updated', payload);
      } else {
        io.to(WORKSPACE_ROOM).emit('reaction-updated', payload);
      }
      if (typeof callback === 'function') callback({ success: true, reactions });
    });

    // ── Read receipt ──────────────────────────────────────────────────────
    socket.on('mark-read', (data) => {
      const user = activeUsers.get(socket.id);
      if (!user || !user.userId) return;

      const msgIds = Array.isArray(data) ? data : (data && data.ids ? data.ids : [data && data.id].filter(Boolean));
      for (const id of msgIds) {
        const msgId = Number(id);
        if (msgId > 0) {
          Message.markRead(msgId, user.userId);
        }
      }

      // Notify sender(s) that messages were read
      const readPayload = { readBy: user.userId, username: user.username, ids: msgIds.map(Number).filter(Boolean) };
      socket.to(WORKSPACE_ROOM).emit('read-receipt', readPayload);
    });

    // ── Typing ────────────────────────────────────────────────────────────
    socket.on('typing', (isTyping) => {
      const user = activeUsers.get(socket.id);
      if (!user) return;
      socket.to(WORKSPACE_ROOM).emit('typing', {
        username: user.username,
        isTyping: Boolean(isTyping),
      });
    });

    // ── Disconnect ────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      if (expiryTimers.has(socket.id)) {
        clearTimeout(expiryTimers.get(socket.id));
        expiryTimers.delete(socket.id);
      }

      const user = activeUsers.get(socket.id);
      activeUsers.delete(socket.id);

      if (user) {
        if (user.userId) User.updateLastSeen(user.userId);

        socket.to(WORKSPACE_ROOM).emit('system', {
          id: `sys-leave-${Date.now()}`,
          text: `${user.username} left the workspace`,
          time: new Date().toISOString(),
        });
        // Emit presence update with last_seen for the disconnected user
        io.to(WORKSPACE_ROOM).emit('user-offline', {
          userId: user.userId,
          username: user.username,
          lastSeen: new Date().toISOString(),
        });
        broadcastUsers();
      }
    });
  });
}

module.exports = { setupSocket };
