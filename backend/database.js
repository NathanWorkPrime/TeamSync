require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, process.env.DATABASE_FILE || 'teamsync.db');
const usePostgres = !!process.env.DATABASE_URL;

let db;

if (usePostgres) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  const convertQuery = (sql) => {
    let count = 1;
    let newSql = sql.replace(/\?/g, () => `$${count++}`);
    
    if (newSql.toUpperCase().includes('INSERT OR IGNORE')) {
      newSql = newSql.replace(/INSERT OR IGNORE/i, 'INSERT');
      if (newSql.includes('users')) {
        newSql += ' ON CONFLICT (username) DO NOTHING';
      } else if (newSql.includes('repositories')) {
        newSql += ' ON CONFLICT (name) DO NOTHING';
      } else if (newSql.includes('integrations')) {
        newSql += ' ON CONFLICT (source_key) DO NOTHING';
      }
    }
    
    newSql = newSql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
    
    if (newSql.trim().toUpperCase().startsWith('INSERT')) {
      if (!newSql.toUpperCase().includes('RETURNING')) {
        newSql += ' RETURNING id';
      }
    }

    return newSql;
  };

  class PostgresDbWrapper {
    constructor() {
      console.log('Connected to PostgreSQL Database at:', process.env.DATABASE_URL.split('@')[1] || 'remote-host');
      // Schema will be initialized by initializeSchema callback triggered below
    }

    run(sql, params, callback) {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      const newSql = convertQuery(sql);
      pool.query(newSql, params || [])
        .then(res => {
          if (callback) {
            const lastID = res.rows[0]?.id || null;
            const context = {
              lastID: lastID,
              changes: res.rowCount
            };
            callback.call(context, null);
          }
        })
        .catch(err => {
          if (callback) {
            callback(err);
          } else {
            console.error('Postgres run error:', err.message, 'SQL:', newSql);
          }
        });
      return this;
    }

    get(sql, params, callback) {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      const newSql = convertQuery(sql);
      pool.query(newSql, params || [])
        .then(res => {
          if (callback) {
            callback(null, res.rows[0] || null);
          }
        })
        .catch(err => {
          if (callback) {
            callback(err);
          } else {
            console.error('Postgres get error:', err.message, 'SQL:', newSql);
          }
        });
      return this;
    }

    all(sql, params, callback) {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      const newSql = convertQuery(sql);
      pool.query(newSql, params || [])
        .then(res => {
          if (callback) {
            callback(null, res.rows || []);
          }
        })
        .catch(err => {
          if (callback) {
            callback(err);
          } else {
            console.error('Postgres all error:', err.message, 'SQL:', newSql);
          }
        });
      return this;
    }

    exec(sql, callback) {
      const newSql = convertQuery(sql);
      pool.query(newSql)
        .then(() => {
          if (callback) callback(null);
        })
        .catch(err => {
          if (callback) callback(err);
        });
      return this;
    }

    serialize(callback) {
      callback();
      return this;
    }

    prepare(sql) {
      const dbInstance = this;
      return {
        run: function(...args) {
          let params = args;
          let callback = null;
          if (typeof args[args.length - 1] === 'function') {
            callback = args[args.length - 1];
            params = args.slice(0, args.length - 1);
          }
          if (params.length === 1 && Array.isArray(params[0])) {
            params = params[0];
          }
          dbInstance.run(sql, params, callback);
          return this;
        },
        finalize: function() {}
      };
    }
  }

  db = new PostgresDbWrapper();
  // Trigger schema setup
  setTimeout(() => {
    initializeSchema();
  }, 50);

} else {
  // Ensure db directory exists
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('Error opening database:', err.message);
    } else {
      console.log('Connected to the SQLite database at:', dbPath);
      initializeSchema();
    }
  });
}

function initializeSchema() {
  db.serialize(() => {
    // Create Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        display_name TEXT,
        email TEXT,
        avatar_color TEXT
      )
    `, (err) => {
        db.run("ALTER TABLE users ADD COLUMN email TEXT", (alterErr) => {
          // Ignore if column already exists
        });
        db.run("ALTER TABLE users ADD COLUMN github_id TEXT", (alterErr) => {
          // Ignore if column already exists
        });
        db.run("ALTER TABLE users ADD COLUMN github_token TEXT", (alterErr) => {
          // Ignore if column already exists
        });
    });

    // Create Tickets table
    db.run(`
      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT,
        external_id TEXT,
        external_url TEXT,
        title TEXT,
        description TEXT,
        status TEXT,
        priority TEXT,
        assignee_user_id INTEGER,
        repo_or_project TEXT,
        created_at TEXT,
        updated_at TEXT,
        last_synced_at TEXT,
        last_change_origin TEXT,
        FOREIGN KEY (assignee_user_id) REFERENCES users(id)
      )
    `);

    // Create Integrations table
    db.run(`
      CREATE TABLE IF NOT EXISTS integrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_key TEXT UNIQUE,
        display_name TEXT,
        inbound_webhook_secret TEXT,
        outbound_callback_url TEXT,
        outbound_api_key TEXT,
        created_at TEXT
      )
    `);

    // Create Presence table
    db.run(`
      CREATE TABLE IF NOT EXISTS presence (
        user_id INTEGER PRIMARY KEY,
        repo_name TEXT,
        branch_name TEXT,
        session_link TEXT,
        started_at TEXT,
        active_file TEXT,
        staged_files TEXT,
        modified_files TEXT,
        conflicted_files TEXT,
        current_ticket TEXT,
        last_activity TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Add telemetry columns dynamically if table already exists
    const addPresenceColumn = (colName) => {
      db.run(`ALTER TABLE presence ADD COLUMN ${colName} TEXT`, (err) => {
        // Safe to ignore if column already exists
      });
    };
    addPresenceColumn('active_file');
    addPresenceColumn('staged_files');
    addPresenceColumn('modified_files');
    addPresenceColumn('conflicted_files');
    addPresenceColumn('current_ticket');
    addPresenceColumn('last_activity');
    addPresenceColumn('last_heartbeat');

    // Create Chat Messages table
    db.run(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_name TEXT,
        branch_name TEXT,
        user_id INTEGER,
        message TEXT,
        sent_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Create Session Rooms table
    db.run(`
      CREATE TABLE IF NOT EXISTS session_rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_name TEXT,
        branch_name TEXT,
        oct_room_id TEXT,
        session_link TEXT,
        created_by_user_id INTEGER,
        created_at TEXT,
        closed_at TEXT,
        status TEXT DEFAULT 'active'
      )
    `);

    // Create Deployments table
    db.run(`
      CREATE TABLE IF NOT EXISTS deployments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_name TEXT,
        branch_name TEXT,
        user_id INTEGER,
        commit_hash TEXT,
        status TEXT,
        deployed_at TEXT,
        changelog TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Create Events table
    db.run(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        event_category TEXT NOT NULL,
        event_version TEXT DEFAULT '1.0',
        timestamp TEXT NOT NULL,
        correlation_id TEXT,
        project_id INTEGER,
        session_id INTEGER,
        repo_name TEXT,
        branch_name TEXT,
        user_id INTEGER,
        ticket_id INTEGER,
        deployment_id INTEGER,
        metadata TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (ticket_id) REFERENCES tickets(id),
        FOREIGN KEY (session_id) REFERENCES session_rooms(id)
      )
    `);

    // Create Repositories table
    db.run(`
      CREATE TABLE IF NOT EXISTS repositories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        description TEXT,
        github_repo TEXT,
        allow_sandbox_deploy INTEGER DEFAULT 0,
        branch_strategy TEXT DEFAULT 'main-only',
        created_at TEXT
      )
    `);

    // Migrate existing table if needed by adding allow_sandbox_deploy column
    db.run("ALTER TABLE repositories ADD COLUMN allow_sandbox_deploy INTEGER DEFAULT 0", (err) => {
      // Ignore if column already exists
    });

    db.run("ALTER TABLE repositories ADD COLUMN branch_strategy TEXT DEFAULT 'main-only'", (err) => {
      // Ignore if column already exists
    });

    // Migrate session_rooms table if needed by adding closed_at column
    db.run("ALTER TABLE session_rooms ADD COLUMN closed_at TEXT", (err) => {
      // Ignore if column already exists
    });

    // Migrate deployments table if needed by adding changelog column
    db.run("ALTER TABLE deployments ADD COLUMN changelog TEXT", (err) => {
      // Ignore if column already exists
    });

    // Run startup updates to enforce correct values for TeamSync and Shift_Software
    db.run("UPDATE repositories SET github_repo = 'NathanWorkPrime/TeamSync', allow_sandbox_deploy = 1 WHERE name = 'TeamSync'");
    db.run("UPDATE repositories SET allow_sandbox_deploy = 0 WHERE name = 'Shift_Software'");

    // Create Documentation table
    db.run(`
      CREATE TABLE IF NOT EXISTS documentation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT,
        scope TEXT NOT NULL,
        repo_name TEXT,
        ticket_id INTEGER,
        session_id INTEGER,
        doc_type TEXT,
        created_by_user_id INTEGER,
        created_at TEXT,
        updated_at TEXT,
        FOREIGN KEY (created_by_user_id) REFERENCES users(id),
        FOREIGN KEY (ticket_id) REFERENCES tickets(id),
        FOREIGN KEY (session_id) REFERENCES session_rooms(id)
      )
    `);

    // Create Tasks table
    db.run(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_name TEXT,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'todo',
        priority TEXT DEFAULT 'medium',
        assignee_user_id INTEGER,
        created_at TEXT,
        updated_at TEXT,
        FOREIGN KEY (assignee_user_id) REFERENCES users(id)
      )
    `);

    // Create Changelog table
    db.run(`
      CREATE TABLE IF NOT EXISTS changelog_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_name TEXT NOT NULL,
        branch_name TEXT NOT NULL,
        content TEXT NOT NULL,
        author_user_id INTEGER,
        created_at TEXT,
        FOREIGN KEY (author_user_id) REFERENCES users(id)
      )
    `);

    // Create Indexes for event queries optimization
    db.run(`CREATE INDEX IF NOT EXISTS idx_events_repo_branch ON events(repo_name, branch_name)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)`);

    // Seed initial users if not skipped
    const skipSeed = process.env.SKIP_SEED && process.env.SKIP_SEED.trim().toLowerCase() === 'true';
    if (!skipSeed) {
      db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
        if (row && row.count === 0) {
          console.log("Seeding users...");
          const stmt = db.prepare("INSERT INTO users (username, display_name, email, avatar_color) VALUES (?, ?, ?, ?)");
          stmt.run("you", "You", "you@company.com", "var(--violet)");
          stmt.run("sarah", "Sarah", "sarah@company.com", "var(--violet)");
          stmt.run("david", "David", "david@company.com", "var(--amber)");
          stmt.run("tom", "Tom", "tom@company.com", "var(--red)");
          stmt.finalize();
        }
      });
    } else {
      console.log("[Database] SKIP_SEED=true detected. Skipping user database seeding.");
    }

    // Always seed core repositories on startup if they don't exist
    db.get("SELECT COUNT(*) as count FROM repositories", (err, row) => {
      if (row && row.count === 0) {
        console.log("Seeding core repositories...");
        const stmt = db.prepare("INSERT INTO repositories (name, description, github_repo, allow_sandbox_deploy, created_at) VALUES (?, ?, ?, ?, ?)");
        const now = new Date().toISOString();
        stmt.run("TeamSync", "Operational control centre for software development.", "NathanWorkPrime/TeamSync", 1, now);
        stmt.run("Shift_Software", "Real-time development collaboration platform.", "Tech-Finity/Shift_Software", 0, now);
        stmt.finalize();
      }
    });
  });
}

module.exports = db;
