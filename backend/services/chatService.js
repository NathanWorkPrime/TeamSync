const db = require('../database');

/**
 * Get message history for a specific repository and branch room
 */
function getMessages(repoName, branchName) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT m.*, u.username, u.display_name, u.avatar_color
      FROM chat_messages m
      JOIN users u ON m.user_id = u.id
      WHERE m.repo_name = ? AND m.branch_name = ?
      ORDER BY m.id ASC
    `, [repoName, branchName], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

/**
 * Save a new chat message to database
 */
function saveMessage(repoName, branchName, userId, message) {
  const sentAt = new Date().toISOString();
  return new Promise((resolve, reject) => {
    db.run(`
      INSERT INTO chat_messages (repo_name, branch_name, user_id, message, sent_at)
      VALUES (?, ?, ?, ?, ?)
    `, [repoName, branchName, userId, message, sentAt], function(err) {
      if (err) {
        reject(err);
        return;
      }
      
      const messageId = this.lastID;
      // Fetch the newly created message with user context
      db.get(`
        SELECT m.*, u.username, u.display_name, u.avatar_color
        FROM chat_messages m
        JOIN users u ON m.user_id = u.id
        WHERE m.id = ?
      `, [messageId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  });
}

module.exports = {
  getMessages,
  saveMessage
};
