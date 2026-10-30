const db = require('../config/db');

class User {
  static create(usernameOrObj, passwordHashArg, emailArg) {
    let username, passwordHash, email;
    if (typeof usernameOrObj === 'object' && usernameOrObj !== null) {
      username = usernameOrObj.username;
      passwordHash = usernameOrObj.passwordHash || usernameOrObj.password_hash;
      email = usernameOrObj.email;
    } else {
      username = usernameOrObj;
      passwordHash = passwordHashArg;
      email = emailArg || null;
    }

    const stmt = db.prepare(`
      INSERT INTO users (username, email, password_hash, status)
      VALUES (?, ?, ?, 'Online')
    `);

    const result = stmt.run(username, email, passwordHash);
    return {
      id: Number(result.lastInsertRowid),
      username,
      email,
      status: 'Online',
    };
  }

  static findByUsername(username) {
    if (!username) return null;
    const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
    return stmt.get(username) || null;
  }

  static findByEmail(email) {
    if (!email) return null;
    const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
    return stmt.get(email) || null;
  }

  static findById(id) {
    if (!id) return null;
    const stmt = db.prepare('SELECT id, username, email, status, created_at FROM users WHERE id = ?');
    return stmt.get(id) || null;
  }

  static findByIdentifier(identifier) {
    if (!identifier) return null;
    const stmt = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?');
    return stmt.get(identifier, identifier) || null;
  }

  static updateStatus(id, status) {
    const stmt = db.prepare('UPDATE users SET status = ? WHERE id = ?');
    stmt.run(status, id);
  }

  static getAll() {
    const stmt = db.prepare('SELECT id, username, email, status, created_at FROM users ORDER BY username ASC');
    return stmt.all();
  }
}

module.exports = User;
