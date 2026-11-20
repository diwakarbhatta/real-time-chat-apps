const express = require('express');
const Message = require('../models/Message');
const User = require('../models/User');
const { requireAuth } = require('../config/jwt');

const router = express.Router();

function normalizeMessageItem(m) {
  if (!m) return m;
  return {
    ...m,
    userId: m.user_id,
    recipientId: m.recipient_id,
    time: m.created_at,
  };
}

// GET /api/messages            — shared general-room history
// GET /api/messages?peer=<id>  — direct-message history with that user
router.get('/', requireAuth, (req, res) => {
  const meId = req.user.id || req.user.sub;

  if (req.query.peer !== undefined) {
    const peerId = Number(req.query.peer);
    if (!Number.isInteger(peerId) || peerId <= 0) {
      return res.status(400).json({ error: 'Invalid peer id' });
    }
    if (peerId === meId) {
      return res.status(400).json({ error: 'Cannot retrieve a conversation with yourself' });
    }
    const peer = User.findById(peerId);
    if (!peer) {
      return res.status(404).json({ error: 'User not found' });
    }
    const rawMessages = Message.getDirectMessages(meId, peerId, 100);
    return res.json({
      messages: rawMessages.map(normalizeMessageItem),
      peer: { id: peer.id, username: peer.username, email: peer.email },
    });
  }

  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const rawMessages = Message.getRecent(limit);
  res.json({ messages: rawMessages.map(normalizeMessageItem) });
});

module.exports = router;
