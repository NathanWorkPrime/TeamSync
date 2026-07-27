const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, process.env.DATABASE_FILE || 'teamsync.db');

// Ensure db directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to the SQLite database at:', dbPath);
    initializeSchema();
  }
});

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
      if (!err) {
        db.run("ALTER TABLE users ADD COLUMN email TEXT", (alterErr) => {
          // Ignore if column already exists
        });
      }
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
    addPresenceColumn('current_ticket');
    addPresenceColumn('last_activity');

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
        created_at TEXT
      )
    `);

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

    // Create Indexes for event queries optimization
    db.run(`CREATE INDEX IF NOT EXISTS idx_events_repo_branch ON events(repo_name, branch_name)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)`);

    // Seed initial users if table is empty
    db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
      if (row && row.count === 0) {
        console.log("Seeding users...");
        const stmt = db.prepare("INSERT INTO users (username, display_name, email, avatar_color) VALUES (?, ?, ?, ?)");
        stmt.run("you", "You", "you@company.com", "var(--violet)");
        stmt.run("sarah", "Sarah", "sarah@company.com", "var(--violet)");
        stmt.run("david", "David", "david@company.com", "var(--amber)");
        stmt.run("tom", "Tom", "tom@company.com", "var(--red)");
        stmt.finalize();
        
        // Seed presence info corresponding to mock state
        db.serialize(() => {
          db.run("INSERT OR REPLACE INTO presence (user_id, repo_name, branch_name, session_link, started_at) VALUES (2, 'Shift_Software', 'development', 'oct://join/TS-4K9-XZQ2', ?)", [new Date(Date.now() - 32 * 60000).toISOString()]);
          db.run("INSERT OR REPLACE INTO presence (user_id, repo_name, branch_name, session_link, started_at) VALUES (3, 'Shift_Software', 'uat', '', ?)", [new Date(Date.now() - 40 * 60000).toISOString()]);
          db.run("INSERT OR REPLACE INTO presence (user_id, repo_name, branch_name, session_link, started_at) VALUES (4, 'Shift_Software', 'live', 'oct://join/TS-MOB-APP', ?)", [new Date(Date.now() - 180 * 60000).toISOString()]);

          // Seed active session rooms to match initial presence
          db.run("INSERT INTO session_rooms (repo_name, branch_name, oct_room_id, session_link, created_by_user_id, created_at, status) VALUES ('Shift_Software', 'development', 'TS-4K9-XZQ2', 'oct://join/TS-4K9-XZQ2', 2, ?, 'active')", [new Date().toISOString()]);
          db.run("INSERT INTO session_rooms (repo_name, branch_name, oct_room_id, session_link, created_by_user_id, created_at, status) VALUES ('Shift_Software', 'live', 'TS-MOB-APP', 'oct://join/TS-MOB-APP', 4, ?, 'active')", [new Date().toISOString()]);
        });
      }
    });

    // Seed initial tickets if table is empty
    db.get("SELECT COUNT(*) as count FROM tickets", (err, row) => {
      if (row && row.count === 0) {
        console.log("Seeding tickets...");
        const stmt = db.prepare(`
          INSERT INTO tickets (
            source, external_id, external_url, title, description, status, priority, 
            assignee_user_id, repo_or_project, created_at, updated_at, last_synced_at, last_change_origin
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'external')
        `);
        const now = new Date().toISOString();

        // 1. Fix broken contact form validation (assigned to You)
        stmt.run("github", "101", "https://github.com/Tech-Finity/Shift_Software/issues/101", 
                 "Fix broken contact form validation", "Form submissions fail on Safari 15 due to missing regex support.", 
                 "todo", "urgent", 1, "Shift_Software", now, now, now);

        // 2. Add favicon set for all sizes (unassigned)
        stmt.run("github", "102", "https://github.com/Tech-Finity/Shift_Software/issues/102", 
                 "Add favicon set for all sizes", "Ensure we cover Apple touch icon and Android high res icons.", 
                 "todo", "low", null, "Shift_Software", now, now, now);

        // 3. Update pricing table copy (assigned to You)
        stmt.run("github", "103", "https://github.com/Tech-Finity/Shift_Software/issues/103", 
                 "Update pricing table copy", "Change Enterprise tier pricing to Contact Sales.", 
                 "in-progress", "medium", 1, "Shift_Software", now, now, now);

        // 4. Rebuild about page hero section (assigned to David)
        stmt.run("github", "104", "https://github.com/Tech-Finity/Shift_Software/issues/104", 
                 "Rebuild about page hero section", "Use the new grid design system layout for better typography scaling.", 
                 "in-progress", "high", 3, "Shift_Software", now, now, now);

        // 5. Add newsletter signup block (assigned to Sarah)
        stmt.run("github", "105", "https://github.com/Tech-Finity/Shift_Software/issues/105", 
                 "Add newsletter signup block", "Integrate with Mailchimp API and handle double opt-in.", 
                 "review", "medium", 2, "Shift_Software", now, now, now);

        // 6. Fix nav spacing on tablet (assigned to David)
        stmt.run("github", "106", "https://github.com/Tech-Finity/Shift_Software/issues/106", 
                 "Fix nav spacing on tablet", "Reduce horizontal padding to 16px below 1024px viewport width.", 
                 "done", "low", 3, "Shift_Software", now, now, now);

        stmt.finalize();
      }
    });

    // Seed sample integration
    db.get("SELECT COUNT(*) as count FROM integrations", (err, row) => {
      if (row && row.count === 0) {
        console.log("Seeding integrations...");
        db.run(`
          INSERT INTO integrations (source_key, display_name, inbound_webhook_secret, outbound_callback_url, outbound_api_key, created_at)
          VALUES ('client-app-alpha', 'Client App Alpha', 'secret_alpha_123', 'http://localhost:8080/webhooks/tickets', 'key_alpha_123', ?)
        `, [new Date().toISOString()]);
      }
    });

    // Seed mock chat messages
    db.get("SELECT COUNT(*) as count FROM chat_messages", (err, row) => {
      if (row && row.count === 0) {
        console.log("Seeding chat messages...");
        const stmt = db.prepare(`
          INSERT INTO chat_messages (repo_name, branch_name, user_id, message, sent_at)
          VALUES (?, ?, ?, ?, ?)
        `);
        const todayStr = new Date().toISOString().split('T')[0];
        
        // Sarah's message
        stmt.run('Shift_Software', 'development', 2, 'Starting on the form validation, will push in ~20', `${todayStr}T09:04:00.000Z`);
        // David's message
        stmt.run('Shift_Software', 'development', 3, "Cool, I'll leave the shared header alone then", `${todayStr}T09:06:00.000Z`);
        
        stmt.finalize();
      }
    });

    // Seed initial repositories
    db.get("SELECT COUNT(*) as count FROM repositories", (err, row) => {
      if (row && row.count === 0) {
        console.log("Seeding repositories...");
        const stmt = db.prepare("INSERT INTO repositories (name, description, github_repo, created_at) VALUES (?, ?, ?, ?)");
        const now = new Date().toISOString();
        stmt.run("TeamSync", "Operational control centre for software development (local workspace).", null, now);
        stmt.run("Shift_Software", "Real-time development collaboration platform.", "Tech-Finity/Shift_Software", now);
        stmt.finalize();
      }
    });

    // Seed initial documentation
    db.get("SELECT COUNT(*) as count FROM documentation", (err, row) => {
      if (row && row.count === 0) {
        console.log("Seeding documentation...");
        const stmt = db.prepare(`
          INSERT INTO documentation (title, content, scope, repo_name, ticket_id, session_id, doc_type, created_by_user_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const now = new Date().toISOString();
        
        // 1. Project level ADR
        stmt.run(
          "ADR 001: SQLite for Local Event Store",
          "# ADR 001: SQLite for Local Event Store\n\n## Status\nApproved\n\n## Context\nWe need a low-latency, persistent event store for our local development dashboard. The event store must survive server restarts and require zero complex infrastructure setup for developers.\n\n## Decision\nWe choose SQLite as the persistent database engine. It stores data in a single local file, is extremely fast for reads, and supports complex relational query filters.\n\n## Consequences\nNo external database server (like Postgres) needs to be running. However, SQLite is not suitable for high write concurrency in multi-instance production environments, which fits our local dev operations centre scope perfectly.",
          "project", "TeamSync", null, null, "adr", 1, now, now
        );

        // 2. Project level Setup Guide
        stmt.run(
          "Setup Guide: Local Dev Server",
          "# TeamSync Local Setup Guide\n\nTo start developing on TeamSync locally, follow these steps:\n\n1. Run `npm install` in the root.\n2. Start backend and frontend simultaneously with `npm run dev`.\n3. Make sure VS Code is running with the `teamsync-extension` installed to enable local Git branch switching and session hosting.",
          "project", "TeamSync", null, null, "notes", 1, now, now
        );

        // 3. Ticket level Doc
        stmt.run(
          "Requirements: Update pricing table copy",
          "# Requirements for Ticket 103: Update pricing table copy\n\nChange the Enterprise tier price from '$99/mo' to 'Contact Sales' in the pricing component. Ensure the CTA button changes from 'Buy Now' to 'Talk to Sales' which opens the email contact form.",
          "ticket", "Shift_Software", 3, null, "requirements", 2, now, now
        );

        // 4. Session level Notes
        stmt.run(
          "Session Notes: Debugging safari regex bug",
          "# Session Notes: Safari 15 Regex Bug\n\nWe tracked down the safari validation bug. Safari 15 does not support lookbehind assertions in regular expressions (\`?<= \`). We need to rewrite the regex in \`contactForm.js\` to use standard grouping instead of lookbehind.",
          "session", "Shift_Software", null, 1, "notes", 3, now, now
        );

        stmt.finalize();
      }
    });
  });
}

module.exports = db;
