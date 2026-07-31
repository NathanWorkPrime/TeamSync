const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, 'teamsync.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening DB:', err.message);
    process.exit(1);
  }
  console.log('Connected to SQLite database at:', dbPath);
});

db.serialize(() => {
  const tables = [
    'presence',
    'session_rooms',
    'chat_messages',
    'tickets',
    'integrations',
    'tasks',
    'documentation',
    'repositories',
    'users',
    'deployments',
    'changelog_entries',
    'events'
  ];

  console.log('Dropping tables...');
  tables.forEach(table => {
    db.run(`DROP TABLE IF EXISTS ${table}`, (err) => {
      if (err) console.error(`Error dropping table ${table}:`, err.message);
      else console.log(`Dropped table: ${table}`);
    });
  });
});

db.close((err) => {
  if (err) {
    console.error('Error closing DB:', err.message);
    process.exit(1);
  }
  console.log('Database tables cleared successfully.');
  process.exit(0);
});
