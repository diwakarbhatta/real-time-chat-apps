const db = require('../config/db');

class Message {
  static create({ userId, username, text }) {
    const stmt = db.prepare(`
      INSERT INTO messages (user_id, username, text)
      VALUES (?, ?, ?)
    `);

    const result = stmt.run(userId || null, username, text);
    const id = Number(result.lastInsertRowid);

    const getStmt = db.prepare('SELECT id, user_id, username, text, created_at FROM messages WHERE id = ?');
    return getStmt.get(id);
  }

  static getRecent(limit = 50) {
    const stmt = db.prepare(`
      SELECT id, user_id, username, text, created_at
      FROM (
        SELECT id, user_id, username, text, created_at
        FROM messages
        ORDER BY id DESC
        LIMIT ?
      )
      ORDER BY id ASC
    `);

    return stmt.all(limit);
  }
}

module.exports = Message;
