const db = require('../config/db');

class Message {
  // recipientId is null for general-room messages, or a user id for direct messages
  static create({ userId, username, text, recipientId, replyToId }) {
    const stmt = db.prepare(`
      INSERT INTO messages (user_id, username, text, recipient_id, reply_to_id)
      VALUES (?, ?, ?, ?, ?)
    `);

    const result = stmt.run(userId || null, username, text, recipientId || null, replyToId || null);
    const id = Number(result.lastInsertRowid);

    return Message.getById(id);
  }

  static getById(id) {
    const stmt = db.prepare(`
      SELECT m.id, m.user_id, m.username, m.text, m.recipient_id, m.reply_to_id,
             m.edited_at, m.deleted, m.created_at,
             rm.id AS reply_msg_id, rm.username AS reply_username,
             rm.text AS reply_text, rm.deleted AS reply_deleted
      FROM messages m
      LEFT JOIN messages rm ON rm.id = m.reply_to_id
      WHERE m.id = ?
    `);
    const row = stmt.get(id);
    if (!row) return null;
    return Message._attachReactions(Message._format(row));
  }

  // Attach reactions summary to a formatted message
  static _attachReactions(msg) {
    if (!msg) return msg;
    const reactRows = db.prepare(`
      SELECT emoji, COUNT(*) as count, GROUP_CONCAT(user_id) as user_ids
      FROM reactions WHERE message_id = ? GROUP BY emoji
    `).all(msg.id);
    msg.reactions = {};
    for (const r of reactRows) {
      msg.reactions[r.emoji] = {
        count: r.count,
        userIds: r.user_ids ? r.user_ids.split(',').map(Number) : [],
      };
    }
    return msg;
  }

  static _format(row) {
    const msg = {
      id: row.id,
      user_id: row.user_id,
      username: row.username,
      text: row.deleted ? '[Message deleted]' : row.text,
      recipient_id: row.recipient_id,
      reply_to_id: row.reply_to_id,
      edited_at: row.edited_at || null,
      deleted: row.deleted ? 1 : 0,
      created_at: row.created_at,
      reactions: {},
    };
    if (row.reply_msg_id) {
      msg.replyTo = {
        id: row.reply_msg_id,
        username: row.reply_username,
        text: row.reply_deleted ? '[Message deleted]' : (row.reply_text || ''),
      };
    }
    return msg;
  }

  // Recent messages from the shared general room only
  static getRecent(limit = 50) {
    const stmt = db.prepare(`
      SELECT m.id, m.user_id, m.username, m.text, m.recipient_id, m.reply_to_id,
             m.edited_at, m.deleted, m.created_at,
             rm.id AS reply_msg_id, rm.username AS reply_username,
             rm.text AS reply_text, rm.deleted AS reply_deleted
      FROM (
        SELECT id FROM messages WHERE recipient_id IS NULL ORDER BY id DESC LIMIT ?
      ) sub
      JOIN messages m ON m.id = sub.id
      LEFT JOIN messages rm ON rm.id = m.reply_to_id
      ORDER BY m.id ASC
    `);
    return stmt.all(limit).map(row => Message._attachReactions(Message._format(row)));
  }

  // Conversation between two users (both directions), oldest first
  static getDirectMessages(userAId, userBId, limit = 100) {
    const stmt = db.prepare(`
      SELECT m.id, m.user_id, m.username, m.text, m.recipient_id, m.reply_to_id,
             m.edited_at, m.deleted, m.created_at,
             rm.id AS reply_msg_id, rm.username AS reply_username,
             rm.text AS reply_text, rm.deleted AS reply_deleted
      FROM (
        SELECT id FROM messages
        WHERE (user_id = ? AND recipient_id = ?)
           OR (user_id = ? AND recipient_id = ?)
        ORDER BY id DESC LIMIT ?
      ) sub
      JOIN messages m ON m.id = sub.id
      LEFT JOIN messages rm ON rm.id = m.reply_to_id
      ORDER BY m.id ASC
    `);
    return stmt.all(userAId, userBId, userBId, userAId, limit)
      .map(row => Message._attachReactions(Message._format(row)));
  }

  // Edit a message (only by owner, non-deleted)
  static edit(id, userId, newText) {
    const msg = db.prepare('SELECT id, user_id, deleted FROM messages WHERE id = ?').get(id);
    if (!msg) return null;
    if (msg.user_id !== userId) return false; // not owner
    if (msg.deleted) return null;
    db.prepare(`
      UPDATE messages SET text = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(newText, id);
    return Message.getById(id);
  }

  // Soft-delete a message (only by owner)
  static delete(id, userId) {
    const msg = db.prepare('SELECT id, user_id, deleted FROM messages WHERE id = ?').get(id);
    if (!msg) return null;
    if (msg.user_id !== userId) return false;
    if (msg.deleted) return null;
    db.prepare(`UPDATE messages SET deleted = 1, text = '[Message deleted]' WHERE id = ?`).run(id);
    return Message.getById(id);
  }

  // === Reactions ===
  static addReaction(messageId, userId, emoji) {
    try {
      db.prepare(`
        INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)
      `).run(messageId, userId, emoji);
    } catch {
      // already reacted — treat as toggle (remove)
      db.prepare(`DELETE FROM reactions WHERE message_id=? AND user_id=? AND emoji=?`).run(messageId, userId, emoji);
    }
    return Message._getReactionSummary(messageId);
  }

  static _getReactionSummary(messageId) {
    const rows = db.prepare(`
      SELECT emoji, COUNT(*) as count, GROUP_CONCAT(user_id) as user_ids
      FROM reactions WHERE message_id = ? GROUP BY emoji
    `).all(messageId);
    const result = {};
    for (const r of rows) {
      result[r.emoji] = {
        count: r.count,
        userIds: r.user_ids ? r.user_ids.split(',').map(Number) : [],
      };
    }
    return result;
  }

  // === Read Receipts ===
  static markRead(messageId, userId) {
    try {
      db.prepare(`
        INSERT OR IGNORE INTO read_receipts (message_id, user_id) VALUES (?, ?)
      `).run(messageId, userId);
    } catch {}
  }

  static getReadBy(messageId) {
    const rows = db.prepare(`
      SELECT rr.user_id, u.username, rr.read_at
      FROM read_receipts rr
      LEFT JOIN users u ON u.id = rr.user_id
      WHERE rr.message_id = ?
    `).all(messageId);
    return rows;
  }
}

module.exports = Message;

