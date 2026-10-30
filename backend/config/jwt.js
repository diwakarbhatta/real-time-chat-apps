const jwt = require('jsonwebtoken');

const rawSecret = process.env.JWT_SECRET;
if (!rawSecret || typeof rawSecret !== 'string' || !rawSecret.trim()) {
  throw new Error('Fatal: JWT_SECRET environment variable is required. Please set JWT_SECRET in your .env file or environment.');
}

const JWT_SECRET = rawSecret.trim();
if (JWT_SECRET === 'your-secure-random-jwt-secret-here' || JWT_SECRET.length < 32) {
  throw new Error('Fatal: JWT_SECRET must be a unique, secure secret of at least 32 characters (cannot use example placeholders).');
}
const JWT_EXPIRES_IN = '7d';

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      id: user.id,
      username: user.username,
      email: user.email,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing authentication token' });

  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { signToken, verifyToken, requireAuth, JWT_SECRET };
