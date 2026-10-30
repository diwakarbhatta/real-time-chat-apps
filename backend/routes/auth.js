const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { signToken, requireAuth } = require('../config/jwt');

const router = express.Router();
const SALT_ROUNDS = 10;
const USERNAME_RE = /^[a-zA-Z0-9_\s]{2,30}$/;

function validateCredentials(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') {
    return 'Username and password are required';
  }
  const trimmed = username.trim();
  if (trimmed.length < 2 || trimmed.length > 30) {
    return 'Username must be between 2 and 30 characters';
  }
  if (!USERNAME_RE.test(trimmed)) {
    return 'Username can only contain letters, numbers, spaces, and underscores';
  }
  if (password.length < 6) {
    return 'Password must be at least 6 characters';
  }
  return null;
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, name, email, password } = req.body || {};
  const rawName = username || name || '';
  if (typeof rawName !== 'string' || (email != null && typeof email !== 'string') || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username/name, email, and password must be valid strings' });
  }

  const chosenUsername = rawName.trim();
  const chosenEmail = email ? email.trim().toLowerCase() : null;

  const validationError = validateCredentials(chosenUsername, password);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  if (User.findByUsername(chosenUsername)) {
    return res.status(409).json({ error: 'Username is already taken' });
  }

  if (chosenEmail && User.findByEmail(chosenEmail)) {
    return res.status(409).json({ error: 'Email is already registered. Please log in.' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = User.create({
      username: chosenUsername,
      email: chosenEmail,
      passwordHash,
    });

    const token = signToken(user);
    res.status(201).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        status: user.status,
      },
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Could not create account, please try again.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, email, identifier, password } = req.body || {};
  const rawId = identifier || email || username || '';
  if (typeof rawId !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username/email and password are required strings' });
  }

  const loginId = rawId.trim();
  if (!loginId || !password) {
    return res.status(400).json({ error: 'Username/email and password are required' });
  }

  const user = User.findByIdentifier(loginId);
  if (!user) {
    return res.status(401).json({ error: 'Invalid username/email or password.' });
  }

  const matches = await bcrypt.compare(password, user.password_hash);
  if (!matches) {
    return res.status(401).json({ error: 'Invalid username/email or password.' });
  }

  const token = signToken(user);
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      status: user.status,
    },
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const user = User.findById(req.user.id || req.user.sub);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      status: user.status,
    },
  });
});

// GET /api/auth/users
router.get('/users', requireAuth, (req, res) => {
  const users = User.getAll();
  res.json({ users });
});

module.exports = router;
