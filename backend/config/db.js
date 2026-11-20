const path = require('path');
const fs = require('fs');
let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (err) {
  console.error('\n❌ Node.js >= 22.13.0 is required for built-in node:sqlite storage.');
  console.error(`Current Node version: ${process.version}`);
  console.error('Please upgrade Node.js to >= 22.13.0: https://nodejs.org/\n');
  throw new Error(`Node.js >= 22.13.0 required for node:sqlite (current: ${process.version})`);
}

const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'pulse_chat.sqlite');
const db = new DatabaseSync(dbPath);

// Enable WAL mode and foreign keys for performance and integrity
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    email TEXT UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    status TEXT DEFAULT 'Online',
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT NOT NULL,
    text TEXT NOT NULL,
    recipient_id INTEGER,
    reply_to_id INTEGER,
    edited_at DATETIME,
    deleted INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY(recipient_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(reply_to_id) REFERENCES messages(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    emoji TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id, user_id, emoji),
    FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS read_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id, user_id),
    FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Incremental migrations — safe to re-run (each catches "already exists")
const migrations = [
  `ALTER TABLE messages ADD COLUMN recipient_id INTEGER`,
  `ALTER TABLE messages ADD COLUMN reply_to_id INTEGER`,
  `ALTER TABLE messages ADD COLUMN edited_at DATETIME`,
  `ALTER TABLE messages ADD COLUMN deleted INTEGER DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN last_seen DATETIME`,
];
for (const sql of migrations) {
  try { db.exec(sql); } catch { /* column already exists */ }
}

module.exports = db;
