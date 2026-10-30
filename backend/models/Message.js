const db = require('../config/db');

class Message {
  // recipientId is null for general-room messages, or a user id for direct messages
  static create({ userId, username, text, recipientId }) {
    const stmt = db.prepare(`
      INSERT INTO messages (user_id, username, text, recipient_id)
      VALUES (?, ?, ?, ?)
    `);

    const result = stmt.run(userId || null, username, text, recipientId || null);
    const id = Number(result.lastInsertRowid);

    const getStmt = db.prepare(
      'SELECT id, user_id, username, text, recipient_id, created_at FROM messages WHERE id = ?'
    );
    return getStmt.get(id);
  }

  // Recent messages from the shared general room only
  static getRecent(limit = 50) {
    const stmt = db.prepare(`
      SELECT id, user_id, username, text, recipient_id, created_at
      FROM (
        SELECT id, user_id, username, text, recipient_id, created_at
        FROM messages
        WHERE recipient_id IS NULL
        ORDER BY id DESC
        LIMIT ?
      )
      ORDER BY id ASC
    `);

    return stmt.all(limit);
  }

  // Conversation between two users (both directions), oldest first
  static getDirectMessages(userAId, userBId, limit = 100) {
    const stmt = db.prepare(`
      SELECT id, user_id, username, text, recipient_id, created_at
      FROM (
        SELECT id, user_id, username, text, recipient_id, created_at
        FROM messages
        WHERE (user_id = ? AND recipient_id = ?)
           OR (user_id = ? AND recipient_id = ?)
        ORDER BY id DESC
        LIMIT ?
      )
      ORDER BY id ASC
    `);

    return stmt.all(userAId, userBId, userBId, userAId, limit);
  }
}

module.exports = Message;
