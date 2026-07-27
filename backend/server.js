require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const db = require('./database');
const githubService = require('./services/githubService');
const chatService = require('./services/chatService');
const eventBus = require('./services/eventBus');

const app = express();
const PORT = process.env.PORT || 5000;

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE']
  }
});
eventBus.setSocketIO(io);

app.use(cors());
app.use(express.json());

// Periodically sync GitHub issues if configured
if (githubService.isGitHubConfigured()) {
  console.log('[Server] GitHub config detected. Initiating issues sync cycle.');
  githubService.syncGitHubIssues();
  setInterval(() => {
    githubService.syncGitHubIssues();
  }, 60000);
} else {
  console.log('[Server] No GitHub credentials detected. Running in Demo Mode.');
}

// ==========================================
// REST API Endpoints
// ==========================================

// GET /api/config/status - Check backend integration configuration status
app.get('/api/config/status', (req, res) => {
  res.json({
    githubConfigured: githubService.isGitHubConfigured(),
    databaseFile: process.env.DATABASE_FILE || 'teamsync.db'
  });
});

// GET /api/users - List users
app.get('/api/users', (req, res) => {
  db.all('SELECT * FROM users', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// POST /api/users - Create/Register user account
app.post('/api/users', (req, res) => {
  const { username, display_name, email, avatar_color } = req.body;
  if (!username || !display_name) {
    return res.status(400).json({ error: 'Username and display name are required.' });
  }

  const color = avatar_color || 'var(--violet)';
  const lowerUsername = username.toLowerCase().trim();

  db.run(`
    INSERT INTO users (username, display_name, email, avatar_color)
    VALUES (?, ?, ?, ?)
  `, [lowerUsername, display_name.trim(), email || null, color], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    db.get('SELECT * FROM users WHERE id = ?', [this.lastID], (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      // Publish event
      eventBus.publish({
        event_type: 'developer:onboarded',
        event_category: 'developer',
        user_id: row.id,
        metadata: { username: row.username, display_name: row.display_name, email: row.email }
      });
      res.status(201).json(row);
    });
  });
});

// GET /api/events - Query events with filters
app.get('/api/events', (req, res) => {
  const { repo_name, branch_name, user_id, session_id, ticket_id, event_category, event_type, start_date, end_date, limit } = req.query;
  
  let query = 'SELECT * FROM events WHERE 1=1';
  const params = [];

  if (repo_name) {
    query += ' AND repo_name = ?';
    params.push(repo_name);
  }
  if (branch_name) {
    query += ' AND branch_name = ?';
    params.push(branch_name);
  }
  if (user_id) {
    query += ' AND user_id = ?';
    params.push(parseInt(user_id, 10));
  }
  if (session_id) {
    query += ' AND session_id = ?';
    params.push(parseInt(session_id, 10));
  }
  if (ticket_id) {
    query += ' AND ticket_id = ?';
    params.push(parseInt(ticket_id, 10));
  }
  if (event_category) {
    query += ' AND event_category = ?';
    params.push(event_category);
  }
  if (event_type) {
    query += ' AND event_type = ?';
    params.push(event_type);
  }
  if (start_date) {
    query += ' AND timestamp >= ?';
    params.push(start_date);
  }
  if (end_date) {
    query += ' AND timestamp <= ?';
    params.push(end_date);
  }

  query += ' ORDER BY timestamp DESC';

  const queryLimit = limit ? parseInt(limit, 10) : 50;
  query += ' LIMIT ?';
  params.push(queryLimit);

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    // Parse metadata JSON strings back to objects
    const parsed = (rows || []).map(r => ({
      ...r,
      metadata: r.metadata ? JSON.parse(r.metadata) : {}
    }));
    res.json(parsed);
  });
});

// POST /api/events - Publish an event directly from external tools / clients
app.post('/api/events', (req, res) => {
  const { event_type, event_category, event_version, correlation_id, project_id, session_id, repo_name, branch_name, user_id, ticket_id, deployment_id, metadata } = req.body;
  
  if (!event_type || !event_category) {
    return res.status(400).json({ error: 'Event type and event category are required.' });
  }

  eventBus.publish({
    event_type,
    event_category,
    event_version,
    correlation_id,
    project_id,
    session_id,
    repo_name,
    branch_name,
    user_id,
    ticket_id,
    deployment_id,
    metadata
  });

  res.status(202).json({ message: 'Event received and processing.' });
});

// GET /api/repos - List company repos
app.get('/api/repos', async (req, res) => {
  try {
    const repos = await githubService.getRepos();
    res.json(repos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/repos - Register a new repository
app.post('/api/repos', (req, res) => {
  const { name, description, github_repo } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Repository name is required.' });
  }

  const now = new Date().toISOString();
  db.run(`
    INSERT INTO repositories (name, description, github_repo, created_at)
    VALUES (?, ?, ?, ?)
  `, [name.trim(), description || '', github_repo || null, now], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    // Publish registration event
    eventBus.publish({
      event_type: 'project:registered',
      event_category: 'project',
      repo_name: name,
      metadata: { description, github_repo }
    });

    res.status(201).json({ id: this.lastID, name, description, github_repo, created_at: now });
  });
});

// DELETE /api/repos/:name - Unregister a repository
app.delete('/api/repos/:name', (req, res) => {
  const repoName = req.params.name;
  
  db.run(`DELETE FROM repositories WHERE name = ?`, [repoName], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Repository not found.' });
    }

    // Publish unregistration event
    eventBus.publish({
      event_type: 'project:unregistered',
      event_category: 'project',
      repo_name: repoName,
      metadata: { name: repoName }
    });

    res.json({ message: `Repository ${repoName} unregistered successfully.` });
  });
});


// GET /api/repos/:repo/branches - Branches for a repo
app.get('/api/repos/:repo/branches', async (req, res) => {
  const repoName = req.params.repo;
  try {
    const branches = await githubService.getBranches(repoName);
    res.json(branches);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/repos/:repo/overview - Aggregated metrics and timeline for a repository
app.get('/api/repos/:repo/overview', async (req, res) => {
  const repoName = req.params.repo;

  try {
    // 1. Get repo details
    const repoInfo = await new Promise((resolve) => {
      db.get("SELECT * FROM repositories WHERE name = ?", [repoName], (err, row) => {
        resolve(row || { name: repoName, description: 'No description provided.' });
      });
    });

    // 2. Fetch branches
    const branches = await githubService.getBranches(repoName);
    const defaultBranch = branches.find(b => b.isMain)?.name || 'main';

    // 3. Fetch active sessions (active session rooms)
    const activeSessions = await new Promise((resolve) => {
      db.all("SELECT * FROM session_rooms WHERE repo_name = ? AND status = 'active'", [repoName], (err, rows) => {
        resolve(rows || []);
      });
    });

    // 4. Fetch active presence (who is currently working on it)
    const activePresence = await new Promise((resolve) => {
      db.all(`
        SELECT p.*, u.display_name as user_name, u.avatar_color
        FROM presence p
        JOIN users u ON p.user_id = u.id
        WHERE p.repo_name = ?
      `, [repoName], (err, rows) => {
        resolve(rows || []);
      });
    });

    // 5. Fetch recent deployments
    const deployments = await new Promise((resolve) => {
      db.all(`
        SELECT d.*, u.display_name
        FROM deployments d
        LEFT JOIN users u ON d.user_id = u.id
        WHERE d.repo_name = ?
        ORDER BY d.deployed_at DESC
        LIMIT 5
      `, [repoName], (err, rows) => {
        resolve(rows || []);
      });
    });

    // 6. Fetch recent commits and correlate with database users
    const allUsers = await new Promise((resolve) => {
      db.all("SELECT id, display_name, username, avatar_color, email FROM users", [], (err, rows) => {
        resolve(rows || []);
      });
    });

    const rawCommits = await githubService.getCommits(repoName);
    const commits = rawCommits.map(c => {
      const matchedUser = allUsers.find(u => 
        (u.email && c.email && u.email.toLowerCase() === c.email.toLowerCase()) ||
        (u.display_name && c.author && u.display_name.toLowerCase() === c.author.toLowerCase()) ||
        (u.username && c.author && u.username.toLowerCase() === c.author.toLowerCase())
      );
      return {
        ...c,
        matchedUser: matchedUser ? {
          id: matchedUser.id,
          display_name: matchedUser.display_name,
          avatar_color: matchedUser.avatar_color
        } : null
      };
    });

    // Automatically update presence for very recent commits (last 1 hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    for (const c of commits) {
      if (c.matchedUser && new Date(c.date) > oneHourAgo) {
        db.run(`
          INSERT OR REPLACE INTO presence (user_id, repo_name, branch_name, session_link, started_at)
          VALUES (?, ?, ?, ?, ?)
        `, [
          c.matchedUser.id, 
          repoName, 
          defaultBranch, 
          'git-commit-activity',
          new Date(c.date).toISOString()
        ], (err) => {
          if (!err) {
            broadcastPresence();
          }
        });
      }
    }


    // 7. Fetch recent tickets
    const tickets = await new Promise((resolve) => {
      db.all(`
        SELECT t.*, u.username as assignee_username, u.display_name as assignee_display_name, u.avatar_color as assignee_avatar_color
        FROM tickets t
        LEFT JOIN users u ON t.assignee_user_id = u.id
        WHERE t.repo_or_project = ?
        ORDER BY t.updated_at DESC
        LIMIT 5
      `, [repoName], (err, rows) => {
        resolve(rows || []);
      });
    });

    // 8. Fetch recent timeline events
    const timelineEvents = await new Promise((resolve) => {
      db.all(`
        SELECT e.*, u.display_name as user_name
        FROM events e
        LEFT JOIN users u ON e.user_id = u.id
        WHERE e.repo_name = ?
        ORDER BY e.timestamp DESC
        LIMIT 10
      `, [repoName], (err, rows) => {
        if (rows) {
          resolve(rows.map(r => ({
            ...r,
            metadata: r.metadata ? JSON.parse(r.metadata) : {}
          })));
        } else {
          resolve([]);
        }
      });
    });

    // 9. Calculate Repository Health Summary
    // - Check ticket status
    const allTickets = await new Promise((resolve) => {
      db.all("SELECT status, priority FROM tickets WHERE repo_or_project = ?", [repoName], (err, rows) => {
        resolve(rows || []);
      });
    });

    const openTickets = allTickets.filter(t => t.status !== 'done');
    const urgentTickets = openTickets.filter(t => t.priority === 'urgent');
    const highTickets = openTickets.filter(t => t.priority === 'high');

    // - Check deployments success rate
    const totalDeploys = deployments.length;
    const successfulDeploys = deployments.filter(d => d.status === 'success').length;
    const deploySuccessRate = totalDeploys > 0 ? (successfulDeploys / totalDeploys) * 100 : 100;

    let score = 'A';
    let status = 'Healthy';
    const factors = [];

    factors.push(`${deploySuccessRate.toFixed(0)}% deployment success rate`);
    factors.push(`${openTickets.length} open tickets`);

    if (urgentTickets.length > 0) {
      score = 'D';
      status = 'Critical';
      factors.push(`${urgentTickets.length} urgent issue(s) unresolved`);
    } else if (highTickets.length > 3) {
      score = 'C';
      status = 'Degraded';
      factors.push(`${highTickets.length} high priority issues pending`);
    } else if (deploySuccessRate < 80) {
      score = 'C';
      status = 'Degraded';
      factors.push(`Low deployment success rate (${deploySuccessRate.toFixed(0)}%)`);
    } else if (openTickets.length > 10) {
      score = 'B';
      status = 'Healthy';
      factors.push('High backlog volume');
    } else {
      score = 'A';
      status = 'Healthy';
      factors.push('All critical metrics nominal');
    }

    const health = { score, status, factors };

    // 10. Return payload
    res.json({
      repo: repoInfo,
      defaultBranch,
      branchesCount: branches.length,
      activeSessionsCount: activeSessions.length,
      activePresenceCount: activePresence.length,
      activePresence,
      branches,
      activeSessions,
      deployments,
      commits,
      tickets,
      timeline: timelineEvents,
      health
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// GET /api/tickets - Unified ticket list (filterable)
app.get('/api/tickets', (req, res) => {
  const { source, status, priority, assignee, repo } = req.query;
  
  let query = `
    SELECT t.*, u.username as assignee_username, u.display_name as assignee_display_name, u.avatar_color as assignee_avatar_color
    FROM tickets t
    LEFT JOIN users u ON t.assignee_user_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (source) {
    query += ' AND t.source = ?';
    params.push(source);
  }
  if (status) {
    query += ' AND t.status = ?';
    params.push(status);
  }
  if (priority) {
    query += ' AND t.priority = ?';
    params.push(priority);
  }
  if (assignee) {
    query += ' AND t.assignee_user_id = ?';
    params.push(assignee);
  }
  if (repo) {
    query += ' AND t.repo_or_project = ?';
    params.push(repo);
  }

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// GET /api/tickets/:id - Single ticket detail
app.get('/api/tickets/:id', (req, res) => {
  const ticketId = req.params.id;
  db.get(`
    SELECT t.*, u.username as assignee_username, u.display_name as assignee_display_name, u.avatar_color as assignee_avatar_color
    FROM tickets t
    LEFT JOIN users u ON t.assignee_user_id = u.id
    WHERE t.id = ?
  `, [ticketId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    res.json(row);
  });
});

// POST /api/tickets - Create a ticket locally
app.post('/api/tickets', async (req, res) => {
  const { title, description, status, priority, assignee_user_id, repo_or_project, source } = req.body;
  
  const ticketSource = source || 'internal';
  const now = new Date().toISOString();
  
  db.run(`
    INSERT INTO tickets (
      source, external_id, external_url, title, description, status, priority, 
      assignee_user_id, repo_or_project, created_at, updated_at, last_change_origin
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    ticketSource,
    null, // No external id for internally created ones (unless mapped to github issue below)
    null,
    title,
    description || '',
    status || 'todo',
    priority || 'low',
    assignee_user_id || null,
    repo_or_project || null,
    now,
    now,
    'internal'
  ], async function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    const newTicketId = this.lastID;

    // If source is github and GitHub is integrated, let's create the issue on GitHub!
    if (ticketSource === 'github' && githubService.isGitHubConfigured() && repo_or_project) {
      try {
        const pat = process.env.GITHUB_PAT;
        const repo = process.env.GITHUB_REPO;
        
        // Find assignee's name if applicable
        let githubAssignee = null;
        if (assignee_user_id) {
          const user = await new Promise((resolve) => {
            db.get("SELECT username FROM users WHERE id = ?", [assignee_user_id], (err, row) => {
              resolve(row);
            });
          });
          if (user) githubAssignee = user.username;
        }

        const ghResponse = await fetch(`https://api.github.com/repos/${repo}/issues`, {
          method: 'POST',
          headers: {
            'Authorization': `token ${pat}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'User-Agent': 'TeamSync-App'
          },
          body: JSON.stringify({
            title,
            body: description || '',
            assignees: githubAssignee ? [githubAssignee] : [],
            labels: [
              priority || 'low',
              status === 'in-progress' ? 'In Progress' : status === 'review' ? 'Review' : 'Todo'
            ]
          })
        });

        if (ghResponse.ok) {
          const ghIssue = await ghResponse.json();
          // Update the ticket record with GitHub URL and ID
          db.run(`
            UPDATE tickets SET 
              external_id = ?, 
              external_url = ?,
              last_synced_at = ?
            WHERE id = ?
          `, [ghIssue.number.toString(), ghIssue.html_url, now, newTicketId]);
        }
      } catch (ghErr) {
        console.error('[Server] Failed to create issue on GitHub:', ghErr.message);
      }
    }

    // Retrieve and return the created ticket
    db.get('SELECT * FROM tickets WHERE id = ?', [newTicketId], (err, row) => {
      if (row) {
        eventBus.publish({
          event_type: 'ticket:created',
          event_category: 'ticket',
          ticket_id: row.id,
          user_id: row.assignee_user_id,
          repo_name: row.repo_or_project,
          metadata: { title: row.title, status: row.status, priority: row.priority }
        });
      }
      res.status(201).json(row);
    });
  });
});

// PATCH /api/tickets/:id - Update a ticket (status, priority, assignee)
app.patch('/api/tickets/:id', (req, res) => {
  const ticketId = req.params.id;
  const { status, priority, assignee_user_id, repo_or_project } = req.body;

  db.get('SELECT * FROM tickets WHERE id = ?', [ticketId], async (err, ticket) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const updates = [];
    const params = [];
    const now = new Date().toISOString();

    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status);
    }
    if (priority !== undefined) {
      updates.push('priority = ?');
      params.push(priority);
    }
    if (assignee_user_id !== undefined) {
      updates.push('assignee_user_id = ?');
      params.push(assignee_user_id);
    }
    if (repo_or_project !== undefined) {
      updates.push('repo_or_project = ?');
      params.push(repo_or_project);
    }

    if (updates.length === 0) {
      return res.json(ticket);
    }

    updates.push('updated_at = ?');
    params.push(now);
    
    // Set change origin to internal
    updates.push("last_change_origin = 'internal'");
    
    params.push(ticketId);

    db.run(`
      UPDATE tickets 
      SET ${updates.join(', ')} 
      WHERE id = ?
    `, params, async function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // Trigger sync logic
      if (ticket.source === 'github' && ticket.external_id) {
        // Trigger GitHub issue update
        const githubUpdates = {};
        if (status) githubUpdates.status = status;
        if (priority) githubUpdates.priority = priority;
        githubService.updateGitHubIssue(ticket.external_id, githubUpdates);
      } else if (ticket.source !== 'github' && ticket.source !== 'internal') {
        // Outbound Sync to custom client app
        // 1. Get Integration record
        db.get('SELECT * FROM integrations WHERE source_key = ?', [ticket.source], async (err, integration) => {
          if (!err && integration && integration.outbound_callback_url) {
            console.log(`[Outbound Sync] Dispatching updates for ticket ${ticket.external_id} to ${integration.display_name}`);
            try {
              const callbackResponse = await fetch(integration.outbound_callback_url, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${integration.outbound_api_key}`
                },
                body: JSON.stringify({
                  external_id: ticket.external_id,
                  status: status || ticket.status,
                  priority: priority || ticket.priority,
                  assignee_id: assignee_user_id || ticket.assignee_user_id
                })
              });
              
              if (callbackResponse.ok) {
                console.log(`[Outbound Sync] Outbound sync successful for ticket ${ticket.external_id}`);
              } else {
                console.error(`[Outbound Sync] Callback returned status ${callbackResponse.status}`);
              }
            } catch (syncErr) {
              console.error(`[Outbound Sync] Error during callback fetch:`, syncErr.message);
            }
          }
        });
      }

      // Return updated ticket
      db.get(`
        SELECT t.*, u.username as assignee_username, u.display_name as assignee_display_name, u.avatar_color as assignee_avatar_color
        FROM tickets t
        LEFT JOIN users u ON t.assignee_user_id = u.id
        WHERE t.id = ?
      `, [ticketId], (err, row) => {
        if (row) {
          if (assignee_user_id !== undefined && assignee_user_id !== ticket.assignee_user_id) {
            eventBus.publish({
              event_type: 'ticket:assigned',
              event_category: 'ticket',
              ticket_id: row.id,
              user_id: row.assignee_user_id,
              repo_name: row.repo_or_project,
              metadata: { title: row.title, assignee_name: row.assignee_display_name }
            });
          }
          if (status !== undefined && status !== ticket.status) {
            eventBus.publish({
              event_type: 'ticket:status_changed',
              event_category: 'ticket',
              ticket_id: row.id,
              user_id: row.assignee_user_id,
              repo_name: row.repo_or_project,
              metadata: { title: row.title, old_status: ticket.status, new_status: row.status }
            });
          }
        }
        res.json(row);
      });
    });
  });
});

// GET /api/integrations - List integrations (admin)
app.get('/api/integrations', (req, res) => {
  db.all('SELECT id, source_key, display_name, outbound_callback_url, created_at FROM integrations', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// POST /api/integrations - Register integration
app.post('/api/integrations', (req, res) => {
  const { source_key, display_name, outbound_callback_url } = req.body;
  const inboundSecret = 'sec_' + Math.random().toString(36).substring(2, 15);
  const outboundKey = 'key_' + Math.random().toString(36).substring(2, 15);
  const now = new Date().toISOString();

  db.run(`
    INSERT INTO integrations (source_key, display_name, inbound_webhook_secret, outbound_callback_url, outbound_api_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [source_key, display_name, inboundSecret, outbound_callback_url, outboundKey, now], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.status(201).json({
      id: this.lastID,
      source_key,
      display_name,
      inbound_webhook_secret: inboundSecret,
      outbound_callback_url,
      outbound_api_key: outboundKey,
      created_at: now
    });
  });
});

// POST /api/integrations/:source_key/tickets - Inbound Webhook
app.post('/api/integrations/:source_key/tickets', (req, res) => {
  const sourceKey = req.params.source_key;
  const { external_id, title, description, status, priority, assignee_email, external_url } = req.body;
  const now = new Date().toISOString();

  // 1. Verify source key and secret signature if active (simulated validation for mock)
  db.get('SELECT * FROM integrations WHERE source_key = ?', [sourceKey], (err, integration) => {
    if (err || !integration) {
      return res.status(404).json({ error: 'Integration source not registered' });
    }

    // 2. Find assignee user by email or username if possible
    db.get('SELECT id FROM users WHERE username = ? OR display_name = ?', [assignee_email, assignee_email], (err, user) => {
      const assigneeUserId = user ? user.id : null;

      // 3. Check loop prevention / existing ticket
      db.get('SELECT id FROM tickets WHERE source = ? AND external_id = ?', [sourceKey, external_id], (err, ticket) => {
        if (ticket) {
          // Update
          db.run(`
            UPDATE tickets SET 
              title = ?, description = ?, status = ?, priority = ?, 
              assignee_user_id = ?, external_url = ?, updated_at = ?, last_change_origin = 'external'
            WHERE id = ?
          `, [title, description, status, priority, assigneeUserId, external_url, now, ticket.id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Ticket updated successfully', id: ticket.id });
          });
        } else {
          // Insert
          db.run(`
            INSERT INTO tickets (
              source, external_id, external_url, title, description, status, priority, 
              assignee_user_id, repo_or_project, created_at, updated_at, last_change_origin
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'external')
          `, [sourceKey, external_id, external_url, title, description || '', status || 'todo', priority || 'low', assigneeUserId, null, now, now], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.status(201).json({ message: 'Ticket created successfully', id: this.lastID });
          });
        }
      });
    });
  });
});

// GET /api/me/today - Aggregate developer hub summary (assigned tickets, active workspace, recent activity)
app.get('/api/me/today', (req, res) => {
  const currentUserId = req.query.user_id ? parseInt(req.query.user_id, 10) : 1;
  
  db.serialize(() => {
    // 1. Get assigned tickets
    db.all(`
      SELECT t.*, u.username as assignee_username, u.display_name as assignee_display_name, u.avatar_color as assignee_avatar_color
      FROM tickets t
      LEFT JOIN users u ON t.assignee_user_id = u.id
      WHERE t.assignee_user_id = ? AND t.status != 'done'
      ORDER BY 
        CASE t.priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
          ELSE 5
        END
    `, [currentUserId], (err, tickets) => {
      if (err) return res.status(500).json({ error: err.message });

      // 2. Get active presence list (excluding 'You' if desired, but we want all active team members)
      db.all(`
        SELECT p.*, u.display_name as user_name, u.avatar_color
        FROM presence p
        JOIN users u ON p.user_id = u.id
        WHERE p.user_id != ?
      `, [currentUserId], (err, activePresence) => {
        if (err) return res.status(500).json({ error: err.message });

        // 3. Query real deployments
        db.all(`
          SELECT d.*, u.display_name
          FROM deployments d
          LEFT JOIN users u ON d.user_id = u.id
          ORDER BY d.deployed_at DESC
          LIMIT 5
        `, [], (err, deployments) => {
          const realDeployments = (deployments || []).map(d => ({
            name: d.display_name || 'System',
            action: `deployed (${d.status})`,
            target: d.commit_hash ? d.commit_hash.substring(0, 7) : d.branch_name,
            branch: d.branch_name,
            time: 'Just now'
          }));

          const mockActivity = [
            { name: 'David', action: 'merged', target: 'feature/about-page', branch: 'development', time: '1h ago' },
            { name: 'Sarah', action: 'opened ticket', target: 'Fix nav on mobile', branch: '', time: '2h ago' },
            { name: 'Tom', action: 'started a session on', target: 'mobile-app', branch: '', time: '3h ago' },
            { name: 'System', action: 'moved ticket', target: 'Add newsletter signup', branch: 'Review', time: 'Yesterday' }
          ];

          const activity = [...realDeployments, ...mockActivity].slice(0, 6);

          res.json({
            tickets: tickets || [],
            activeCount: activePresence.length,
            activePresence: activePresence || [],
            activity: activity
          });
        });
      });
    });
  });
});

// GET /api/presence - Live presence list
app.get('/api/presence', (req, res) => {
  db.all(`
    SELECT p.*, u.username, u.display_name, u.avatar_color
    FROM presence p
    JOIN users u ON p.user_id = u.id
  `, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// POST /api/presence - Set active presence
app.post('/api/presence', (req, res) => {
  const { user_id, repo_name, branch_name, session_link } = req.body;
  const userId = user_id || 1; // Default to 'You'
  const startedAt = new Date().toISOString();

  db.run(`
    INSERT OR REPLACE INTO presence (user_id, repo_name, branch_name, session_link, started_at)
    VALUES (?, ?, ?, ?, ?)
  `, [userId, repo_name, branch_name, session_link || '', startedAt], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    // Broadcast updated presence list
    broadcastPresence();

    // Publish event
    eventBus.publish({
      event_type: 'presence:started',
      event_category: 'session',
      user_id: userId,
      repo_name: repo_name,
      branch_name: branch_name,
      metadata: { session_link: session_link }
    });

    // Log to activity feed live
    db.get("SELECT display_name FROM users WHERE id = ?", [userId], (err, userRow) => {
      if (!err && userRow) {
        const activityItem = {
          name: userRow.display_name,
          action: 'started a session on',
          target: repo_name,
          branch: branch_name,
          time: 'Just now'
        };
        io.emit('activity:new', activityItem);
      }
    });

    res.json({ success: true, message: 'Presence updated successfully' });
  });
});

// POST /api/presence/heartbeat - Heartbeat telemetry from companion extension/ide
app.post('/api/presence/heartbeat', (req, res) => {
  const { 
    user_id, 
    repo_name, 
    branch_name, 
    session_link, 
    active_file, 
    staged_files, 
    modified_files, 
    current_ticket, 
    last_activity 
  } = req.body;

  const userId = user_id || 1;

  db.get("SELECT started_at FROM presence WHERE user_id = ?", [userId], (err, row) => {
    const startedAt = row ? row.started_at : new Date().toISOString();

    db.run(`
      INSERT OR REPLACE INTO presence (
        user_id, repo_name, branch_name, session_link, started_at,
        active_file, staged_files, modified_files, current_ticket, last_activity
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      userId,
      repo_name || null,
      branch_name || null,
      session_link || '',
      startedAt,
      active_file || null,
      staged_files ? JSON.stringify(staged_files) : null,
      modified_files ? JSON.stringify(modified_files) : null,
      current_ticket || null,
      last_activity || null
    ], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      broadcastPresence();

      // Publish event to the central bus
      eventBus.publish({
        event_type: 'presence:heartbeat',
        event_category: 'developer',
        user_id: userId,
        repo_name: repo_name,
        branch_name: branch_name,
        metadata: {
          active_file: active_file || null,
          staged_files_count: staged_files ? staged_files.length : 0,
          modified_files_count: modified_files ? modified_files.length : 0,
          current_ticket: current_ticket || null,
          last_activity: last_activity || null
        }
      });

      res.json({ success: true, message: 'Heartbeat registered successfully' });
    });
  });
});


// DELETE /api/presence/:user_id - Clear presence
app.delete('/api/presence/:user_id', (req, res) => {
  const userId = req.params.user_id || 1; // Default to 'You'

  db.get('SELECT repo_name, branch_name FROM presence WHERE user_id = ?', [userId], (err, presenceRow) => {
    if (err || !presenceRow) {
      // Just run normal delete if no presence found
      db.run('DELETE FROM presence WHERE user_id = ?', [userId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        broadcastPresence();
        return res.json({ success: true, message: 'Presence cleared successfully' });
      });
      return;
    }

    const { repo_name, branch_name } = presenceRow;

    db.run('DELETE FROM presence WHERE user_id = ?', [userId], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      eventBus.publish({
        event_type: 'presence:ended',
        event_category: 'session',
        user_id: parseInt(userId, 10),
        repo_name: repo_name,
        branch_name: branch_name,
        metadata: { reason: 'manual_delete' }
      });

      // Check if there are any remaining active users on this branch
      db.get('SELECT COUNT(*) as count FROM presence WHERE repo_name = ? AND branch_name = ?', [repo_name, branch_name], (err, countRow) => {
        if (!err && countRow && countRow.count === 0) {
          // No users left on this branch! Mark the session room as stale.
          db.run("UPDATE session_rooms SET status = 'stale' WHERE repo_name = ? AND branch_name = ? AND status = 'active'", [repo_name, branch_name], function(err) {
            if (!err) {
              console.log(`[Server] Session room for ${repo_name}/${branch_name} marked as stale.`);
              io.emit('activity:new', {
                name: 'System',
                action: 'marked session room stale (last user left)',
                target: repo_name,
                branch: branch_name,
                time: 'Just now'
              });
            }
          });
        }
      });

      // Broadcast updated presence list
      broadcastPresence();
      res.json({ success: true, message: 'Presence cleared successfully' });
    });
  });
});

// GET /api/session-rooms/active - Get active session room for a branch
app.get('/api/session-rooms/active', (req, res) => {
  const { repo, branch } = req.query;
  if (!repo || !branch) {
    return res.status(400).json({ error: 'Repository name and branch name are required.' });
  }

  db.get(`
    SELECT r.*, u.display_name as creator_display_name, u.avatar_color as creator_avatar_color
    FROM session_rooms r
    LEFT JOIN users u ON r.created_by_user_id = u.id
    WHERE r.repo_name = ? AND r.branch_name = ? AND r.status = 'active'
    ORDER BY r.id DESC LIMIT 1
  `, [repo, branch], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(row || null);
  });
});

// POST /api/session-rooms - Register a new active session room
app.post('/api/session-rooms', (req, res) => {
  const { repo_name, branch_name, oct_room_id, session_link, created_by_user_id } = req.body;
  if (!repo_name || !branch_name || !oct_room_id || !session_link) {
    return res.status(400).json({ error: 'All fields (repo_name, branch_name, oct_room_id, session_link) are required.' });
  }

  const now = new Date().toISOString();
  db.run(`
    INSERT INTO session_rooms (repo_name, branch_name, oct_room_id, session_link, created_by_user_id, created_at, status)
    VALUES (?, ?, ?, ?, ?, ?, 'active')
  `, [repo_name, branch_name, oct_room_id, session_link, created_by_user_id || null, now], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    db.get('SELECT * FROM session_rooms WHERE id = ?', [this.lastID], (err, row) => {
      if (row) {
        eventBus.publish({
          event_type: 'session:created',
          event_category: 'session',
          session_id: row.id,
          repo_name: row.repo_name,
          branch_name: row.branch_name,
          user_id: row.created_by_user_id,
          metadata: { oct_room_id: row.oct_room_id, session_link: row.session_link }
        });
      }
      res.status(201).json(row);
    });
  });
});

// GET /api/rooms/:repo/:branch/messages - Get chat message history
app.get('/api/rooms/:repo/:branch/messages', async (req, res) => {
  const { repo, branch } = req.params;
  try {
    const messages = await chatService.getMessages(repo, branch);
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/rooms/:repo/:branch/deployments - Get deployment history
app.get('/api/rooms/:repo/:branch/deployments', (req, res) => {
  const { repo, branch } = req.params;
  db.all(`
    SELECT d.*, u.display_name, u.avatar_color
    FROM deployments d
    LEFT JOIN users u ON d.user_id = u.id
    WHERE d.repo_name = ? AND d.branch_name = ?
    ORDER BY d.deployed_at DESC
  `, [repo, branch], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
  });
});

// GET /api/deployments - Get global deployment history
app.get('/api/deployments', (req, res) => {
  db.all(`
    SELECT d.*, u.display_name, u.avatar_color
    FROM deployments d
    LEFT JOIN users u ON d.user_id = u.id
    ORDER BY d.deployed_at DESC
    LIMIT 10
  `, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows || []);
  });
});


// POST /api/deployments - Register a new deployment and broadcast it
app.post('/api/deployments', (req, res) => {
  const { repo_name, branch_name, user_id, commit_hash, status } = req.body;
  if (!repo_name || !branch_name) {
    return res.status(400).json({ error: 'Repository name and branch name are required.' });
  }

  const deployedAt = new Date().toISOString();
  
  db.run(`
    INSERT INTO deployments (repo_name, branch_name, user_id, commit_hash, status, deployed_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [repo_name, branch_name, user_id || null, commit_hash || null, status || 'success', deployedAt], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    const newDeployId = this.lastID;
    
    // Retrieve and enrich the created deployment to broadcast/return
    db.get(`
      SELECT d.*, u.display_name, u.avatar_color
      FROM deployments d
      LEFT JOIN users u ON d.user_id = u.id
      WHERE d.id = ?
    `, [newDeployId], (err, row) => {
      if (row) {
        // Broadcast via Socket.io to the room
        io.to(`${repo_name}/${branch_name}`).emit('room:deploy', row);

        // Publish event to the bus
        eventBus.publish({
          event_type: `deploy:${row.status || 'success'}`,
          event_category: 'deployment',
          deployment_id: row.id,
          user_id: row.user_id,
          repo_name: row.repo_name,
          branch_name: row.branch_name,
          metadata: { commit_hash: row.commit_hash, status: row.status || 'success', display_name: row.display_name }
        });
      }
      res.status(201).json(row || { id: newDeployId });
    });
  });
});

// GET /api/docs - Query documents
app.get('/api/docs', (req, res) => {
  const { repo_name, ticket_id, session_id, scope, doc_type, search } = req.query;
  
  let query = `
    SELECT d.*, u.display_name as creator_name, t.title as ticket_title 
    FROM documentation d 
    LEFT JOIN users u ON d.created_by_user_id = u.id 
    LEFT JOIN tickets t ON d.ticket_id = t.id 
    WHERE 1=1
  `;
  const params = [];
  
  if (repo_name) {
    query += ' AND d.repo_name = ?';
    params.push(repo_name);
  }
  if (ticket_id) {
    query += ' AND d.ticket_id = ?';
    params.push(parseInt(ticket_id, 10));
  }
  if (session_id) {
    query += ' AND d.session_id = ?';
    params.push(parseInt(session_id, 10));
  }
  if (scope) {
    query += ' AND d.scope = ?';
    params.push(scope);
  }
  if (doc_type) {
    query += ' AND d.doc_type = ?';
    params.push(doc_type);
  }
  if (search) {
    query += ' AND (d.title LIKE ? OR d.content LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  
  query += ' ORDER BY d.updated_at DESC';
  
  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// POST /api/docs - Create document
app.post('/api/docs', (req, res) => {
  const { title, content, scope, repo_name, ticket_id, session_id, doc_type, created_by_user_id } = req.body;
  if (!title || !scope) {
    return res.status(400).json({ error: 'Title and scope are required.' });
  }
  
  const now = new Date().toISOString();
  db.run(`
    INSERT INTO documentation (title, content, scope, repo_name, ticket_id, session_id, doc_type, created_by_user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    title,
    content || '',
    scope,
    repo_name || null,
    ticket_id ? parseInt(ticket_id, 10) : null,
    session_id ? parseInt(session_id, 10) : null,
    doc_type || 'notes',
    created_by_user_id || 1,
    now,
    now
  ], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    const docId = this.lastID;

    // Publish document creation event
    eventBus.publish({
      event_type: 'document:created',
      event_category: 'documentation',
      repo_name,
      user_id: created_by_user_id || 1,
      ticket_id: ticket_id || null,
      session_id: session_id || null,
      metadata: { title, scope, doc_type }
    });

    res.status(201).json({ id: docId, title, content, scope, repo_name, ticket_id, session_id, doc_type, created_by_user_id, created_at: now, updated_at: now });
  });
});

// PATCH /api/docs/:id - Update document
app.patch('/api/docs/:id', (req, res) => {
  const docId = req.params.id;
  const { title, content, doc_type } = req.body;
  
  const updates = [];
  const params = [];
  
  if (title !== undefined) {
    updates.push('title = ?');
    params.push(title);
  }
  if (content !== undefined) {
    updates.push('content = ?');
    params.push(content);
  }
  if (doc_type !== undefined) {
    updates.push('doc_type = ?');
    params.push(doc_type);
  }
  
  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update.' });
  }
  
  const now = new Date().toISOString();
  updates.push('updated_at = ?');
  params.push(now);
  
  params.push(docId);
  
  db.run(`
    UPDATE documentation
    SET ${updates.join(', ')}
    WHERE id = ?
  `, params, function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    // Retrieve doc info to publish event
    db.get("SELECT * FROM documentation WHERE id = ?", [docId], (err, row) => {
      if (row) {
        eventBus.publish({
          event_type: 'document:updated',
          event_category: 'documentation',
          repo_name: row.repo_name,
          ticket_id: row.ticket_id,
          session_id: row.session_id,
          metadata: { title: row.title, doc_type: row.doc_type }
        });
      }
      res.json(row || { message: 'Document updated successfully' });
    });
  });
});

// DELETE /api/docs/:id - Delete document
app.delete('/api/docs/:id', (req, res) => {
  const docId = req.params.id;
  
  db.get("SELECT * FROM documentation WHERE id = ?", [docId], (err, doc) => {
    if (err || !doc) return res.status(404).json({ error: 'Document not found' });
    
    db.run("DELETE FROM documentation WHERE id = ?", [docId], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      
      eventBus.publish({
        event_type: 'document:deleted',
        event_category: 'documentation',
        repo_name: doc.repo_name,
        metadata: { title: doc.title }
      });
      
      res.json({ message: 'Document deleted successfully.' });
    });
  });
});

// GET /api/repos/:repo/files - Get file tree for a repository (live local scan or mock)
app.get('/api/repos/:repo/files', (req, res) => {
  const repoName = req.params.repo;
  const fs = require('fs');
  const path = require('path');

  if (repoName === 'TeamSync' || repoName === 'TeamDash') {
    try {
      const projectRoot = path.resolve(__dirname, '../');
      
      const buildFileTree = (dirPath, rootPath) => {
        const name = path.basename(dirPath);
        const relPath = path.relative(rootPath, dirPath).replace(/\\/g, '/');
        
        const stats = fs.statSync(dirPath);
        if (!stats.isDirectory()) {
          return { name, path: relPath, isDir: false };
        }

        const children = [];
        const files = fs.readdirSync(dirPath);
        const ignored = ['node_modules', '.git', '.github', 'dist', 'out', 'build', '.DS_Store', 'teamsync-extension-1.0.0.vsix'];

        for (const f of files) {
          if (ignored.includes(f)) continue;
          const childPath = path.join(dirPath, f);
          try {
            const childNode = buildFileTree(childPath, rootPath);
            children.push(childNode);
          } catch (err) {
            // ignore inaccessible files
          }
        }

        children.sort((a, b) => {
          if (a.isDir && !b.isDir) return -1;
          if (!a.isDir && b.isDir) return 1;
          return a.name.localeCompare(b.name);
        });

        return {
          name: name || 'root',
          path: relPath,
          isDir: true,
          children
        };
      };

      const tree = buildFileTree(projectRoot, projectRoot);
      res.json(tree);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else {
    // Return mock file tree for other repositories
    const mockTree = {
      name: repoName,
      path: '',
      isDir: true,
      children: [
        {
          name: 'src',
          path: 'src',
          isDir: true,
          children: [
            { name: 'App.js', path: 'src/App.js', isDir: false },
            { name: 'index.js', path: 'src/index.js', isDir: false },
            { name: 'styles.css', path: 'src/styles.css', isDir: false },
            {
              name: 'components',
              path: 'src/components',
              isDir: true,
              children: [
                { name: 'Button.js', path: 'src/components/Button.js', isDir: false },
                { name: 'contactForm.js', path: 'src/components/contactForm.js', isDir: false },
                { name: 'Header.js', path: 'src/components/Header.js', isDir: false }
              ]
            }
          ]
        },
        { name: 'package.json', path: 'package.json', isDir: false },
        { name: 'README.md', path: 'README.md', isDir: false }
      ]
    };
    res.json(mockTree);
  }
});

// Helper to broadcast presence
const broadcastPresence = () => {
  db.all(`
    SELECT p.*, u.username, u.display_name, u.avatar_color
    FROM presence p
    JOIN users u ON p.user_id = u.id
  `, [], (err, rows) => {
    if (!err && rows) {
      io.emit('presence:update', rows);
    }
  });
};

const socketUserMap = new Map(); // socket.id -> user_id

// Socket.io Real-time handlers
io.on('connection', (socket) => {
  console.log('[Socket] Client connected:', socket.id);

  socket.on('user:authenticate', ({ user_id }) => {
    socketUserMap.set(socket.id, user_id);
    console.log(`[Socket] Authenticated user ${user_id} on socket ${socket.id}`);
    
    // Publish a session join event locally
    eventBus.publish({
      event_type: 'developer:online',
      event_category: 'developer',
      user_id: user_id,
      metadata: { socket_id: socket.id }
    });
  });

  socket.on('room:join', ({ repo, branch }) => {
    const roomName = `${repo}/${branch}`;
    socket.join(roomName);
    console.log(`[Socket] Client ${socket.id} joined room: ${roomName}`);
  });

  socket.on('room:message', async (data) => {
    const { repo, branch, user_id, message } = data;
    try {
      const savedMsg = await chatService.saveMessage(repo, branch, user_id, message);
      const roomName = `${repo}/${branch}`;
      io.to(roomName).emit('team:message', savedMsg);
      
      // Publish chat event to bus
      eventBus.publish({
        event_type: 'chat:message',
        event_category: 'session',
        user_id: user_id,
        repo_name: repo,
        branch_name: branch,
        metadata: { message: message.substring(0, 100) }
      });
    } catch (err) {
      console.error('[Socket] Error saving chat message:', err.message);
    }
  });

  socket.on('disconnect', () => {
    console.log('[Socket] Client disconnected:', socket.id);
    const userId = socketUserMap.get(socket.id);
    if (userId) {
      // Find what room they were in to publish session leave event
      db.get("SELECT repo_name, branch_name FROM presence WHERE user_id = ?", [userId], (err, pRow) => {
        if (pRow) {
          eventBus.publish({
            event_type: 'presence:ended',
            event_category: 'session',
            user_id: userId,
            repo_name: pRow.repo_name,
            branch_name: pRow.branch_name,
            metadata: { disconnect_reason: 'socket_drop' }
          });
        }
        
        db.run("DELETE FROM presence WHERE user_id = ?", [userId], (err) => {
          if (!err) {
            console.log(`[Socket] Cleared presence on disconnect for user ${userId}`);
            broadcastPresence();
          }
        });
      });
      socketUserMap.delete(socket.id);
    }
  });
});

// Serve static assets from frontend build in production
const path = require('path');
const frontendDistPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendDistPath));

app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDistPath, 'index.html'), (err) => {
    if (err) {
      res.status(404).send('Frontend static assets are not built. Please compile the React client.');
    }
  });
});

// Start Express + WebSocket Server
server.listen(PORT, () => {
  console.log(`[Server] TeamSync API + WebSocket running on http://localhost:${PORT}`);
});
