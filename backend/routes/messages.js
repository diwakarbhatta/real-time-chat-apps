const express = require('express');
const Message = require('../models/Message');
const { requireAuth } = require('../config/jwt');

const router = express.Router();

// GET /api/messages
router.get('/', requireAuth, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const messages = Message.getRecent(limit);
  res.json({ messages });
});

module.exports = router;
