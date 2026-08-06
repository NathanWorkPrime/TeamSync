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
app.enable('trust proxy');
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

// Disable API caching globally
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

// Multi-Tenancy Tenant Scoping & Authentication Middleware (Phase 1)
app.use((req, res, next) => {
  const sessionToken = req.headers['x-user-session'];
  if (sessionToken) {
    const encryption = require('./services/encryption');
    const decrypted = encryption.decrypt(sessionToken);
    if (decrypted) {
      let username = null;
      let expiresAt = null;
      try {
        const parsed = JSON.parse(decrypted);
        username = parsed.username;
        expiresAt = parsed.expiresAt;
      } catch (e) {
        // Fallback for raw legacy session tokens
        username = decrypted;
      }

      if (username) {
        if (expiresAt && expiresAt < Date.now()) {
          console.warn(`[AuthMiddleware] Session token for '${username}' has expired.`);
          return next();
        }

        db.get('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [username.trim()], (err, user) => {
          if (!err && user) {
            req.user = user;
            req.orgId = user.organization_id;
          } else {
            console.warn(`[AuthMiddleware] Session token decrypted to '${username}' but user was not found in DB.`);
          }
          next();
        });
        return;
      }
    }
  }

  // Fallback for requests without sessions (e.g. public endpoints, webhooks)
  let orgId = 1; // Default to Tech-Finity (ID: 1)
  
  const tenantHeader = req.headers['x-tenant-id'];
  if (tenantHeader) {
    const parsed = parseInt(tenantHeader, 10);
    if (!isNaN(parsed)) {
      orgId = parsed;
    }
  }
  
  const tenantQuery = req.query.organization_id;
  if (tenantQuery) {
    const parsed = parseInt(tenantQuery, 10);
    if (!isNaN(parsed)) {
      orgId = parsed;
    }
  }

  req.orgId = orgId;
  next();
});

// Periodically sync GitHub issues if configured
if (githubService.isGitHubConfigured()) {
  const syncIntervalMs = parseInt(process.env.GITHUB_SYNC_INTERVAL_MS, 10) || 15 * 60 * 1000; // default 15 minutes
  console.log(`[Server] GitHub config detected. Initiating issues sync cycle with interval of ${syncIntervalMs}ms.`);
  githubService.syncGitHubIssues();
  setInterval(() => {
    githubService.syncGitHubIssues();
  }, syncIntervalMs);
} else {
  console.log('[Server] No GitHub credentials detected. Running in Demo Mode.');
}

// Clean up stale presence telemetry (no heartbeat/activity in last 15 seconds)
setInterval(() => {
  const cutoff = new Date(Date.now() - 15000).toISOString();
  db.all(`
    SELECT user_id, repo_name, branch_name 
    FROM presence 
    WHERE COALESCE(last_heartbeat, started_at) < ?
  `, [cutoff], (err, rows) => {
    if (!err && rows && rows.length > 0) {
      rows.forEach(row => {
        db.run("DELETE FROM presence WHERE user_id = ?", [row.user_id], (deleteErr) => {
          if (!deleteErr) {
            console.log(`[Presence] Cleared stale presence for user ${row.user_id} due to inactivity`);
            broadcastPresence();
            
            eventBus.publish({
              event_type: 'presence:ended',
              event_category: 'session',
              user_id: row.user_id,
              repo_name: row.repo_name,
              branch_name: row.branch_name,
              metadata: { disconnect_reason: 'inactivity_timeout' }
            });
          }
        });
      });
    }
  });
}, 5000);

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
  db.all('SELECT id, username, display_name, email, avatar_color, github_id, organization_id FROM users', [], (err, rows) => {
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

// DELETE /api/users/:id - Delete user account
app.delete('/api/users/:id', (req, res) => {
  const userId = parseInt(req.params.id, 10);
  db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    // Publish developer offboarded event
    eventBus.publish({
      event_type: 'developer:offboarded',
      event_category: 'developer',
      user_id: userId,
      metadata: { deleted: true }
    });
    res.json({ success: true, changes: this.changes });
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

// In-memory collaborator access cache
// Key: username:github_repo
// Value: { hasAccess: boolean, expiresAt: number }
const collaboratorCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes Cache TTL

async function checkUserCollaboratorAccess(username, githubRepo, userToken) {
  const cacheKey = `${username}:${githubRepo}`;
  const now = Date.now();
  
  if (collaboratorCache.has(cacheKey)) {
    const cached = collaboratorCache.get(cacheKey);
    if (cached.expiresAt > now) {
      return cached.hasAccess;
    }
  }
  
  try {
    const token = userToken || process.env.GITHUB_PAT;
    if (!token) {
      return false;
    }
    
    // Check if the user is a collaborator on the repository
    const response = await fetch(`https://api.github.com/repos/${githubRepo}/collaborators/${username}`, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'TeamSync-App'
      }
    });
    
    if (response.status === 204) {
      collaboratorCache.set(cacheKey, { hasAccess: true, expiresAt: now + CACHE_TTL_MS });
      return true;
    } 

    if (response.status === 403) {
      const remaining = response.headers.get('x-ratelimit-remaining');
      const bodyText = await response.text().catch(() => '');
      
      const isRateLimit = (remaining === '0') || 
                          /rate limit exceeded/i.test(bodyText) || 
                          /API rate limit/i.test(bodyText);
                          
      if (isRateLimit) {
        const resetTime = response.headers.get('x-ratelimit-reset');
        const err = new Error('GitHub API rate limit exceeded');
        if (resetTime) {
          err.resetAt = parseInt(resetTime, 10);
        }
        throw err;
      }
      
      collaboratorCache.set(cacheKey, { hasAccess: false, expiresAt: now + CACHE_TTL_MS });
      return false;
    }

    if (response.status === 404) {
      collaboratorCache.set(cacheKey, { hasAccess: false, expiresAt: now + CACHE_TTL_MS });
      return false;
    }

    throw new Error(`GitHub API returned status ${response.status}`);
  } catch (err) {
    console.error(`[CollaboratorCheck] Transient error checking access for ${username} on ${githubRepo}:`, err.message);
    throw err;
  }
}

// Middleware to authorize write actions on a specific repository
async function authorizeRepoWriteAccess(req, res, next) {
  const repoName = req.params.repo || req.params.name || req.body.repo_name || req.body.repo;
  const user = req.user;

  if (!user) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  if (!repoName) {
    return res.status(400).json({ error: 'Repository parameter is missing.' });
  }

  db.get("SELECT * FROM repositories WHERE name = ?", [repoName], async (err, repo) => {
    if (err || !repo) {
      return res.status(404).json({ error: `Repository '${repoName}' not found.` });
    }

    // Organization isolation check
    if (user.organization_id && user.organization_id !== repo.organization_id) {
      return res.status(403).json({ error: 'Access denied: Repository belongs to a different organization.' });
    }

    // Local-only repos are visible and writable by everyone in the organization
    if (!repo.github_repo) {
      req.repo = repo;
      return next();
    }

    // Local bypass users (with no GitHub token) have write access
    if (!user.github_token) {
      req.repo = repo;
      return next();
    }

    // Decrypt user token for check
    const encryption = require('./services/encryption');
    const decryptedToken = encryption.decrypt(user.github_token);
    if (!decryptedToken) {
      return res.status(403).json({ error: 'Access denied: Invalid GitHub token credentials.' });
    }

    try {
      // Verify collaborator access on GitHub
      const hasAccess = await checkUserCollaboratorAccess(user.username, repo.github_repo, decryptedToken);
      if (!hasAccess) {
        return res.status(403).json({ error: `Access denied: You do not have collaborator access to repository '${repoName}' on GitHub.` });
      }
      
      req.repo = repo;
      next();
    } catch (apiErr) {
      console.error(`[Auth] Failed to verify collaborator access for write action:`, apiErr.message);
      return res.status(503).json({ 
        error: 'GitHub Verification Error', 
        message: 'Could not verify repository permissions.',
        resetAt: apiErr.resetAt
      });
    }
  });
}

function isGitHubOAuthConfigured() {
  return {
    configured: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)
  };
}

// GET /api/auth/config - Retrieve authentication features status
app.get('/api/auth/config', (req, res) => {
  res.json({
    githubOAuthEnabled: isGitHubOAuthConfigured().configured,
    allowDevMockLogin: process.env.ALLOW_DEV_MOCK_LOGIN === 'true'
  });
});

// POST /api/auth/login - Developer Bypass session generator (restricted to dev mock logins)
app.post('/api/auth/login', (req, res) => {
  if (process.env.ALLOW_DEV_MOCK_LOGIN !== 'true') {
    return res.status(403).json({ error: 'Developer bypass login is disabled in this environment.' });
  }

  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Username is required.' });
  }

  const normalized = username.toLowerCase().trim();
  db.get('SELECT id, username, display_name, email, avatar_color, organization_id, github_id, github_token FROM users WHERE LOWER(username) = LOWER(?)', [normalized], (err, user) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Security check: Never issue bypass session tokens for users with linked GitHub accounts
    if (user.github_id || user.github_token) {
      return res.status(403).json({ error: 'Cannot use developer bypass for GitHub-linked accounts.' });
    }

    const encryption = require('./services/encryption');
    const tokenPayload = JSON.stringify({
      username: user.username,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000 // 24 hour session expiration
    });
    const sessionToken = encryption.encrypt(tokenPayload);
    
    delete user.github_token; // Exclude token from response

    res.json({
      ...user,
      session_token: sessionToken
    });
  });
});

// GET /api/auth/github - Redirect to GitHub OAuth authorize screen
app.get('/api/auth/github', (req, res) => {
  const origin = req.query.origin || req.headers.referer || 'http://localhost:5173';
  const clientStatus = isGitHubOAuthConfigured();
  
  if (!clientStatus.configured) {
    if (process.env.ALLOW_DEV_MOCK_LOGIN === 'true') {
      console.log('[OAuth] GITHUB_CLIENT_ID/SECRET not configured. Redirecting with Developer Bypass (Sandbox Mode).');
      const encryption = require('./services/encryption');
      const tokenPayload = JSON.stringify({
        username: 'you',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000 // 24 hour session expiration
      });
      const sessionToken = encryption.encrypt(tokenPayload);
      return res.redirect(`${origin}/?username=you&session_token=${encodeURIComponent(sessionToken)}`);
    } else {
      console.error('[OAuth] GitHub OAuth is not configured and Developer Bypass is disabled.');
      return res.redirect(`${origin}/?error=oauth_not_configured`);
    }
  }
  
  const callbackUrl = process.env.GITHUB_CALLBACK_URL || `${req.protocol}://${req.headers.host}/api/auth/github/callback`;
  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=repo,user&state=${encodeURIComponent(origin)}`;
  
  res.redirect(githubAuthUrl);
});

function validateAndCleanDisplayName(name, fallback) {
  if (!name || typeof name !== 'string') {
    return fallback;
  }
  const cleaned = name.trim().replace(/\s+/g, ' ');
  if (cleaned.length === 0 || cleaned.length > 60) {
    return fallback;
  }
  const nameRegex = /^[\p{L}\s\-'\.]+$/u;
  if (!nameRegex.test(cleaned)) {
    return fallback;
  }
  return cleaned;
}

// GET /api/auth/github/callback - Handle OAuth redirect and code exchange
app.get('/api/auth/github/callback', async (req, res) => {
  const { code, state: origin } = req.query;
  const redirectOrigin = origin || 'http://localhost:5173';
  
  if (!code) {
    return res.redirect(`${redirectOrigin}/?error=no_code_provided`);
  }
  
  try {
    const callbackUrl = process.env.GITHUB_CALLBACK_URL || `${req.protocol}://${req.headers.host}/api/auth/github/callback`;
    
    // Exchange OAuth code for an access token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: callbackUrl
      })
    });
    
    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) {
      console.error('[OAuth] Failed to retrieve access token:', tokenData);
      return res.redirect(`${redirectOrigin}/?error=token_exchange_failed`);
    }
    
    const accessToken = tokenData.access_token;
    
    // Fetch user profile from GitHub API
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `token ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'TeamSync-App'
      }
    });
    
    const profile = await userResponse.json();
    if (!profile.login) {
      console.error('[OAuth] Failed to retrieve user profile:', profile);
      return res.redirect(`${redirectOrigin}/?error=profile_fetch_failed`);
    }
    
    const encryption = require('./services/encryption');
    const encryptedToken = encryption.encrypt(accessToken);
    
    const githubId = profile.id.toString();
    const username = profile.login.toLowerCase();
    const displayName = validateAndCleanDisplayName(profile.name, profile.login);
    const email = profile.email || null;
    const avatarColor = 'var(--teal)'; // Unique color for GitHub OAuth accounts
    
    db.get('SELECT * FROM users WHERE github_id = ? OR username = ?', [githubId, username], (err, existingUser) => {
      // Evict in-memory collaborator cache for this user on new login
      for (const [key] of collaboratorCache.entries()) {
        if (key.startsWith(`${username}:`)) {
          collaboratorCache.delete(key);
        }
      }
      
      const tokenPayload = JSON.stringify({
        username: username,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000 // 24 hour session expiration
      });
      const sessionToken = encryption.encrypt(tokenPayload);
      if (existingUser) {
        db.run(
          'UPDATE users SET github_id = ?, github_token = ?, email = ? WHERE id = ?',
          [githubId, encryptedToken, email || existingUser.email, existingUser.id],
          (updateErr) => {
            if (updateErr) console.error('[OAuth] Database update error:', updateErr.message);
            res.redirect(`${redirectOrigin}/?username=${username}&session_token=${encodeURIComponent(sessionToken)}`);
          }
        );
      } else {
        db.run(
          'INSERT INTO users (username, display_name, email, avatar_color, github_id, github_token) VALUES (?, ?, ?, ?, ?, ?)',
          [username, displayName, email, avatarColor, githubId, encryptedToken],
          function(insertErr) {
            if (insertErr) {
              console.error('[OAuth] Database insert error:', insertErr.message);
              return res.redirect(`${redirectOrigin}/?error=db_insert_failed`);
            }
            // Publish onboarding event
            eventBus.publish({
              event_type: 'developer:onboarded',
              event_category: 'developer',
              user_id: this.lastID,
              metadata: { username, display_name: displayName, email, source: 'github_oauth' }
            });
            res.redirect(`${redirectOrigin}/?username=${username}&session_token=${encodeURIComponent(sessionToken)}`);
          }
        );
      }
    });
  } catch (err) {
    console.error('[OAuth] Callback error:', err.message);
    res.redirect(`${redirectOrigin}/?error=internal_auth_error`);
  }
});

// GET /api/repos - List company repos, filtered by collaborator status
app.get('/api/repos', async (req, res) => {
  try {
    const repos = await githubService.getRepos();
    const user = req.user;
    
    if (!user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    
    // Local fallback users see everything
    if (!user.github_token) {
      return res.json(repos);
    }
    
    const encryption = require('./services/encryption');
    const decryptedToken = encryption.decrypt(user.github_token);
    
    if (!decryptedToken) {
      return res.json(repos);
    }
    
    // Filter repos by collaborator access on GitHub
    const filteredRepos = [];
    let checkFailed = false;
    let failureReason = '';
    let resetAt = null;
    
    for (const repo of repos) {
      if (!repo.github_repo) {
        filteredRepos.push(repo); // Local-only repos visible to everyone
        continue;
      }
      
      try {
        const hasAccess = await checkUserCollaboratorAccess(user.username, repo.github_repo, decryptedToken);
        if (hasAccess) {
          filteredRepos.push(repo);
        }
      } catch (err) {
        checkFailed = true;
        failureReason = err.message;
        if (err.resetAt) {
          resetAt = err.resetAt;
        }
        break;
      }
    }
    
    if (checkFailed) {
      return res.status(503).json({
        error: 'GitHub Access Verification Error',
        message: `Could not verify collaborator access on GitHub: ${failureReason}. Please check your connection or reload the page.`,
        resetAt: resetAt
      });
    }
    
    res.json(filteredRepos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/repos - Register a new repository
app.post('/api/repos', (req, res) => {
  const { name, description, github_repo, allow_sandbox_deploy, branch_strategy, local_path } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Repository name is required.' });
  }

  const fs = require('fs');
  const path = require('path');
  const appRoot = path.resolve(__dirname, '../'); // e.g. C:\var\www\teamsync
  const parentDir = path.resolve(__dirname, '../../'); // e.g. C:\var\www
  
  const resolvedPath = local_path && local_path.trim() !== ''
    ? path.resolve(local_path.trim())
    : (name.trim() === 'TeamSync' ? appRoot : path.join(parentDir, name.trim()));

  if (!fs.existsSync(resolvedPath)) {
    return res.status(400).json({
      error: `The repository directory was not found on the server at: "${resolvedPath}". Please ensure the repository is cloned on the server first, or specify the path explicitly in Advanced Settings.`
    });
  }

  const crypto = require('crypto');
  const shareCode = 'TS-' + crypto.randomBytes(3).toString('hex').toUpperCase();

  const now = new Date().toISOString();
  db.run(`
    INSERT INTO repositories (name, description, github_repo, allow_sandbox_deploy, branch_strategy, created_at, organization_id, share_code, local_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [name.trim(), description || '', github_repo || null, allow_sandbox_deploy ? 1 : 0, branch_strategy || 'main-only', now, req.orgId || 1, shareCode, resolvedPath], async function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    const dbId = this.lastID;

    // Update in-memory paths cache
    githubService.repoPathsCache.set(name.trim(), resolvedPath);

    // Publish registration event
    eventBus.publish({
      event_type: 'project:registered',
      event_category: 'project',
      repo_name: name,
      metadata: { description, github_repo, allow_sandbox_deploy, branch_strategy, share_code: shareCode, local_path: resolvedPath }
    });

    try {
      console.log(`[Server] Initializing Git/GitHub workspace repository for project: ${name}`);
      await githubService.initializeRepository(name.trim(), github_repo, description, branch_strategy || 'main-only');
      res.status(201).json({ id: dbId, name, description, github_repo, created_at: now, share_code: shareCode, local_path: resolvedPath });
    } catch (gitErr) {
      console.error(`[Server] Git/GitHub initialization failed for repository ${name}:`, gitErr.message);
      
      // Roll back database insert on Git/GitHub initialization failure
      db.run("DELETE FROM repositories WHERE id = ?", [dbId], (deleteErr) => {
        if (deleteErr) {
          console.error(`[Server] Failed to roll back database row for repository ID ${dbId}:`, deleteErr.message);
        } else {
          console.log(`[Server] Successfully rolled back database row for repository ID ${dbId}`);
        }
      });

      // Remove from paths cache
      githubService.repoPathsCache.delete(name.trim());

      res.status(500).json({ 
        error: `Git/GitHub initialization failed for repository "${name}": ${gitErr.message}`
      });
    }
  });
});

// POST /api/repos/join - Join an existing project using share code
app.post('/api/repos/join', (req, res) => {
  const { share_code } = req.body;
  const user = req.user;

  if (!share_code) {
    return res.status(400).json({ error: 'Share code is required.' });
  }
  if (!user) {
    return res.status(401).json({ error: 'User context is required.' });
  }

  const lookupCode = share_code.trim().toUpperCase();

  // 1. Look up repository by share_code
  db.get("SELECT * FROM repositories WHERE share_code = ?", [lookupCode], (err, repo) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!repo) {
      return res.status(404).json({ error: 'Invalid share code. Repository not found.' });
    }

    // 2. Organization isolation checks
    if (user.organization_id && user.organization_id !== repo.organization_id) {
      return res.status(403).json({ error: 'Cannot join a project belonging to a different organization.' });
    }

    // 3. Link the user to the organization if they are not yet associated
    if (!user.organization_id) {
      db.run("UPDATE users SET organization_id = ? WHERE id = ?", [repo.organization_id, user.id], (updateErr) => {
        if (updateErr) {
          return res.status(500).json({ error: updateErr.message });
        }
        return res.json({ success: true, repository: repo, message: 'Successfully joined project and organization.' });
      });
    } else {
      // User already in the same organization
      return res.json({ success: true, repository: repo, message: 'Successfully verified repository access.' });
    }
  });
});

// DELETE /api/repos/:name - Unregister a repository
app.delete('/api/repos/:name', authorizeRepoWriteAccess, (req, res) => {
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

// GET /api/repos/:repo/compare - Compare base and head branches
app.get('/api/repos/:repo/compare', async (req, res) => {
  const repoName = req.params.repo;
  const { base, head } = req.query;

  if (!base || !head) {
    return res.status(400).json({ error: 'Base and head branches are required.' });
  }

  try {
    const comparison = await githubService.compareBranches(repoName, base, head);
    res.json(comparison);
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
        if (row) {
          row.allow_sandbox_deploy = row.allow_sandbox_deploy === 1;
        }
        resolve(row || { name: repoName, description: 'No description provided.', allow_sandbox_deploy: false });
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

    const branchName = req.query.branch;
    const rawCommits = await githubService.getCommits(repoName, branchName);
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

    if (totalDeploys > 0) {
      factors.push(`${deploySuccessRate.toFixed(0)}% deployment success rate`);
    } else {
      factors.push('No deployments recorded yet');
    }
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
    db.get('SELECT id FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(display_name) = LOWER(?)', [assignee_email, assignee_email], (err, user) => {
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

          const activity = realDeployments;

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
    INSERT OR REPLACE INTO presence (user_id, repo_name, branch_name, session_link, started_at, last_heartbeat)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [userId, repo_name, branch_name, session_link || '', startedAt, startedAt], function(err) {
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
    conflicted_files,
    current_ticket, 
    last_activity 
  } = req.body;

  const userId = user_id || 1;

  db.get("SELECT started_at FROM presence WHERE user_id = ?", [userId], (err, row) => {
    const startedAt = row ? row.started_at : new Date().toISOString();

    const now = new Date().toISOString();
    db.run(`
      INSERT OR REPLACE INTO presence (
        user_id, repo_name, branch_name, session_link, started_at,
        active_file, staged_files, modified_files, conflicted_files, current_ticket, last_activity, last_heartbeat
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      userId,
      repo_name || null,
      branch_name || null,
      session_link || '',
      startedAt,
      active_file || null,
      staged_files ? JSON.stringify(staged_files) : null,
      modified_files ? JSON.stringify(modified_files) : null,
      conflicted_files ? JSON.stringify(conflicted_files) : null,
      current_ticket || null,
      last_activity || null,
      now
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
          conflicted_files_count: conflicted_files ? conflicted_files.length : 0,
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
          const closedAt = new Date().toISOString();
          db.run("UPDATE session_rooms SET status = 'stale', closed_at = ? WHERE repo_name = ? AND branch_name = ? AND status = 'active'", [closedAt, repo_name, branch_name], function(err) {
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

// POST /api/session-rooms/:id/close - Close active session room (host-only)
app.post('/api/session-rooms/:id/close', (req, res) => {
  const roomId = req.params.id;
  const { user_id } = req.body;
  
  db.get('SELECT * FROM session_rooms WHERE id = ?', [roomId], (err, room) => {
    if (err || !room) {
      return res.status(404).json({ error: 'Session room not found.' });
    }
    
    if (room.created_by_user_id && room.created_by_user_id !== parseInt(user_id, 10)) {
      return res.status(403).json({ error: 'Only the host can close the session.' });
    }
    
    // Close the room
    const closedAt = new Date().toISOString();
    db.run("UPDATE session_rooms SET status = 'stale', closed_at = ? WHERE id = ?", [closedAt, roomId], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      
      // Clear presence for all users in this repo and branch
      db.run("DELETE FROM presence WHERE repo_name = ? AND branch_name = ?", [room.repo_name, room.branch_name], (err) => {
        if (err) console.error('[Server] Failed to clear presence on close:', err.message);
        
        // Add system message
        const now = new Date().toISOString();
        db.run(`
          INSERT INTO chat_messages (repo_name, branch_name, user_id, message, sent_at)
          VALUES (?, ?, NULL, ?, ?)
        `, [room.repo_name, room.branch_name, 'The host has ended this collaboration session.', now], (chatErr) => {
          
          // Broadcast to socket room
          io.to(`${room.repo_name}/${room.branch_name}`).emit('room:closed', {
            repo: room.repo_name,
            branch: room.branch_name
          });
          
          // Publish presence ended events
          eventBus.publish({
            event_type: 'session:ended',
            event_category: 'session',
            session_id: room.id,
            repo_name: room.repo_name,
            branch_name: room.branch_name,
            user_id: parseInt(user_id, 10),
            metadata: { reason: 'host_closed' }
          });
          
          broadcastPresence();
          res.json({ success: true, message: 'Session closed successfully.' });
        });
      });
    });
  });
});

// GET /api/repos/:repo/sessions - Get enriched session rooms history
app.get('/api/repos/:repo/sessions', async (req, res) => {
  const repoName = req.params.repo;
  
  try {
    const sessions = await new Promise((resolve, reject) => {
      db.all(`
        SELECT s.*, u.username as creator_username, u.display_name as creator_display_name, u.avatar_color as creator_avatar_color
        FROM session_rooms s
        LEFT JOIN users u ON s.created_by_user_id = u.id
        WHERE s.repo_name = ?
        ORDER BY s.id DESC
      `, [repoName], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    const enrichedSessions = [];
    for (const session of sessions) {
      const startTime = session.created_at;
      const endTime = session.closed_at || new Date().toISOString();

      const changelogs = await new Promise((resolve) => {
        db.all(`
          SELECT c.*, u.display_name as author_display_name, u.avatar_color as author_avatar_color
          FROM changelog_entries c
          LEFT JOIN users u ON c.author_user_id = u.id
          WHERE c.repo_name = ? AND c.branch_name = ? AND c.created_at >= ? AND c.created_at <= ?
        `, [repoName, session.branch_name, startTime, endTime], (err, rows) => {
          resolve(rows || []);
        });
      });

      const deployments = await new Promise((resolve) => {
        db.all(`
          SELECT d.*, u.display_name as user_display_name, u.avatar_color as user_avatar_color
          FROM deployments d
          LEFT JOIN users u ON d.user_id = u.id
          WHERE d.repo_name = ? AND d.branch_name = ? AND d.deployed_at >= ? AND d.deployed_at <= ?
        `, [repoName, session.branch_name, startTime, endTime], (err, rows) => {
          resolve(rows || []);
        });
      });

      enrichedSessions.push({
        ...session,
        changelogs,
        deployments
      });
    }

    res.json(enrichedSessions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
    res.json(rows || []);
  });
});

// GET /api/repos/:repo/deployments - Get global deployments for a repository
app.get('/api/repos/:repo/deployments', (req, res) => {
  const repoName = req.params.repo;
  db.all(`
    SELECT d.*, u.display_name, u.avatar_color
    FROM deployments d
    LEFT JOIN users u ON d.user_id = u.id
    WHERE d.repo_name = ?
    ORDER BY d.deployed_at DESC
  `, [repoName], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows || []);
  });
});

// POST /api/repos/:repo/branches - Create a new branch
app.post('/api/repos/:repo/branches', authorizeRepoWriteAccess, async (req, res) => {
  const repoName = req.params.repo;
  const { branch_name, base_branch } = req.body;

  if (!branch_name) {
    return res.status(400).json({ error: 'Branch name is required.' });
  }

  const result = await githubService.createBranch(repoName, branch_name, base_branch || 'development');
  if (result.success) {
    // Add event
    eventBus.publish({
      event_type: 'git:branch_created',
      event_category: 'source-control',
      repo_name: repoName,
      branch_name: branch_name,
      metadata: { base_branch: base_branch || 'development', message: result.message }
    });
    
    // Add event to timeline/events table
    const now = new Date().toISOString();
    db.run(`
      INSERT INTO events (event_type, event_category, timestamp, repo_name, branch_name, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `, ['git:branch_created', 'source-control', now, repoName, branch_name, JSON.stringify({ base_branch: base_branch || 'development' })]);
    
    res.json({ success: true, message: result.message });
  } else {
    res.status(500).json({ error: result.error });
  }
});

// GET /api/repos/:repo/deploy/status - Check if port 5001 is listening locally
app.get('/api/repos/:repo/deploy/status', (req, res) => {
  const net = require('net');
  const checkPort = 5001;
  const client = new net.Socket();
  
  client.setTimeout(1000);
  
  client.once('connect', () => {
    client.destroy();
    res.json({ status: 'online', url: `http://localhost:${checkPort}/` });
  });
  
  client.once('timeout', () => {
    client.destroy();
    res.json({ status: 'offline' });
  });
  
  client.once('error', () => {
    client.destroy();
    res.json({ status: 'offline' });
  });
  
  client.connect(checkPort, '127.0.0.1');
});

// POST /api/repos/:repo/deploy - Perform local Node deployment on port 5001
app.post('/api/repos/:repo/deploy', authorizeRepoWriteAccess, async (req, res) => {
  const repoName = req.params.repo;
  const { branch_name, user_id, commit_hash } = req.body;

  // 1. Kill any existing process on port 5001 in Windows
  const cp = require('child_process');
  try {
    const stdout = cp.execSync('netstat -ano | findstr :5001').toString();
    const lines = stdout.split('\n');
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && parseInt(pid, 10) > 0) {
        cp.execSync(`taskkill /PID ${pid} /F`);
      }
    }
  } catch (e) {}

  // 1b. Checkout target commit hash if provided (e.g. for rollbacks)
  if (commit_hash) {
    try {
      console.log(`[Deploy] Performing git checkout to target commit ${commit_hash} for sandbox...`);
      const checkoutRes = await githubService.executeGitCommand(`git checkout ${commit_hash}`, repoName);
      if (!checkoutRes.success) {
        console.error('[Deploy] Git checkout failed:', checkoutRes.error);
        return res.status(500).json({ error: `Git checkout failed: ${checkoutRes.error}` });
      }
    } catch (checkoutErr) {
      console.error('[Deploy] Git checkout failed:', checkoutErr.message);
      return res.status(500).json({ error: `Git checkout failed: ${checkoutErr.message}` });
    }
  }

  // 2. Spawn a new background child process
  try {
    const { spawn } = require('child_process');
    const path = require('path');
    
    const env = { 
      ...process.env, 
      PORT: '5001', 
      DATABASE_FILE: 'teamsync-deploy.db'
    };
    
    // Spawn server.js inside backend directory
    const child = spawn('node', ['server.js'], {
      cwd: __dirname,
      env,
      detached: true,
      stdio: 'ignore'
    });
    
    child.unref();

    // 3. Resolve SHAs and generate changelog
    const resolvedSha = await githubService.resolveCommitSha(repoName, branch_name || 'main', commit_hash || 'HEAD');
    
    const prevDeploy = await new Promise((resolve) => {
      db.get(`
        SELECT commit_hash FROM deployments 
        WHERE repo_name = ? AND branch_name = ? AND status = 'success'
        ORDER BY deployed_at DESC LIMIT 1
      `, [repoName, branch_name || 'main'], (err, row) => {
        resolve(row);
      });
    });
    
    const prevSha = prevDeploy ? prevDeploy.commit_hash : null;
    const changelog = await githubService.generateChangelog(repoName, prevSha, resolvedSha, branch_name || 'main');

    // 4. Save deployment record in DB
    const deployedAt = new Date().toISOString();
    const userVal = user_id || 1; // Default to 'You'
    const statusVal = 'success';
    
    db.run(`
      INSERT INTO deployments (repo_name, branch_name, user_id, commit_hash, status, deployed_at, changelog)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [repoName, branch_name || 'main', userVal, resolvedSha, statusVal, deployedAt, changelog], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      const newDeployId = this.lastID;
      
      db.get(`
        SELECT d.*, u.display_name, u.avatar_color
        FROM deployments d
        LEFT JOIN users u ON d.user_id = u.id
        WHERE d.id = ?
      `, [newDeployId], (err, row) => {
        // Publish event to event bus
        eventBus.publish({
          event_type: 'deploy:success',
          event_category: 'deployment',
          deployment_id: newDeployId,
          user_id: userVal,
          repo_name: repoName,
          branch_name: branch_name || 'main',
          metadata: { commit_hash: resolvedSha, status: statusVal, changelog }
        });
        
        res.json({ success: true, deployment: row || { id: newDeployId } });
      });
    });

  } catch (err) {
    console.error('Failed to spawn deployment process:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/repos/:repo/pulls - Create Pull Request on GitHub
app.post('/api/repos/:repo/pulls', authorizeRepoWriteAccess, async (req, res) => {
  const repoName = req.params.repo;
  const { sourceBranch, targetBranch, title, body } = req.body;
  try {
    const result = await githubService.createPullRequest(repoName, sourceBranch, targetBranch, title, body);
    res.json(result);
  } catch (err) {
    console.error('[Server] Create PR failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/repos/:repo/pulls/:number - Fetch Pull Request details from GitHub
app.get('/api/repos/:repo/pulls/:number', async (req, res) => {
  const repoName = req.params.repo;
  const prNumber = parseInt(req.params.number, 10);
  try {
    const result = await githubService.getPullRequestDetails(repoName, prNumber);
    res.json(result);
  } catch (err) {
    console.error('[Server] Fetch PR details failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/repos/:repo/pulls/:number/approve - Approve Pull Request (GitHub or Simulated)
app.post('/api/repos/:repo/pulls/:number/approve', authorizeRepoWriteAccess, async (req, res) => {
  const repoName = req.params.repo;
  const prNumber = parseInt(req.params.number, 10);
  try {
    const result = await githubService.approvePullRequest(repoName, prNumber);
    res.json(result);
  } catch (err) {
    console.error('[Server] Approve PR failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/repos/:repo/pulls/:number/merge - Merge Pull Request on GitHub
app.post('/api/repos/:repo/pulls/:number/merge', authorizeRepoWriteAccess, async (req, res) => {
  const repoName = req.params.repo;
  const prNumber = parseInt(req.params.number, 10);
  try {
    const result = await githubService.mergePullRequest(repoName, prNumber);
    
    // Fetch PR details to publish merge success event
    let prDetails = { head: { ref: 'unknown' }, base: { ref: 'master' } };
    try {
      const pat = process.env.GITHUB_PAT;
      const repoRow = await new Promise((resolve) => {
        db.get("SELECT * FROM repositories WHERE name = ?", [repoName], (err, row) => resolve(row));
      });
      const prRes = await fetch(`https://api.github.com/repos/${repoRow.github_repo}/pulls/${prNumber}`, {
        headers: {
          'Authorization': `token ${pat}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'TeamSync-App'
        }
      });
      if (prRes.ok) {
        prDetails = await prRes.json();
      }
    } catch (e) {}

    eventBus.publish({
      event_type: 'git:merge_success',
      event_category: 'project',
      repo_name: repoName,
      branch_name: prDetails.base.ref || 'master',
      user_id: 1, // Default user
      metadata: { 
        source_branch: prDetails.head.ref || 'unknown', 
        target_branch: prDetails.base.ref || 'master',
        pr_number: prNumber
      }
    });

    res.json(result);
  } catch (err) {
    console.error('[Server] Merge PR failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/repos/:repo/branches/:branch/protection - Fetch branch protection settings
app.get('/api/repos/:repo/branches/:branch/protection', async (req, res) => {
  const repoName = req.params.repo;
  const branchName = req.params.branch;
  try {
    const result = await githubService.getBranchProtection(repoName, branchName);
    res.json(result);
  } catch (err) {
    console.error('[Server] Fetch branch protection failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/repos/:repo/branches/:branch/protection - Update branch protection settings
app.put('/api/repos/:repo/branches/:branch/protection', async (req, res) => {
  const repoName = req.params.repo;
  const branchName = req.params.branch;
  const settings = req.body;
  try {
    const result = await githubService.updateBranchProtection(repoName, branchName, settings);
    res.json(result);
  } catch (err) {
    console.error('[Server] Update branch protection failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/repos/:repo/branches/:branch/history - Interleaved merge & deploy history
app.get('/api/repos/:repo/branches/:branch/history', (req, res) => {
  const { repo, branch } = req.params;
  const searchPattern = `%"source_branch":"${branch}"%`;
  
  db.all(`
    SELECT e.*, u.display_name as user_name, u.avatar_color as user_avatar_color
    FROM events e
    LEFT JOIN users u ON e.user_id = u.id
    WHERE e.repo_name = ? 
      AND (
        e.branch_name = ? 
        OR (e.event_type = 'git:merge_success' AND e.metadata LIKE ?)
      )
      AND e.event_type IN ('git:merge_success', 'deploy:success', 'deploy:failed')
    ORDER BY e.timestamp DESC
  `, [repo, branch, searchPattern], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    const parsedRows = (rows || []).map(r => {
      let meta = {};
      try {
        meta = JSON.parse(r.metadata || '{}');
      } catch (e) {}
      return { ...r, metadata: meta };
    });
    
    res.json(parsedRows);
  });
});

// GET /api/repos/:repo/branches/:branch/changelog - Combined commits + manual entries
app.get('/api/repos/:repo/branches/:branch/changelog', (req, res) => {
  const { repo, branch } = req.params;
  
  db.all(`
    SELECT e.id, 'commit' as type, e.timestamp, u.display_name as author_name, u.avatar_color as author_avatar_color, e.metadata
    FROM events e
    LEFT JOIN users u ON e.user_id = u.id
    WHERE e.repo_name = ? AND e.branch_name = ? AND e.event_type = 'git:commit'
  `, [repo, branch], (err, commitRows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    db.all(`
      SELECT c.id, 'manual' as type, c.created_at as timestamp, u.display_name as author_name, u.avatar_color as author_avatar_color, c.content as message
      FROM changelog_entries c
      LEFT JOIN users u ON c.author_user_id = u.id
      WHERE c.repo_name = ? AND c.branch_name = ?
    `, [repo, branch], (err, manualRows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      const combined = [];
      
      (commitRows || []).forEach(r => {
        let meta = {};
        try {
          meta = JSON.parse(r.metadata || '{}');
        } catch (e) {}
        combined.push({
          id: `commit_${r.id}`,
          type: 'commit',
          timestamp: r.timestamp,
          author: meta.author || r.author_name || 'Developer',
          avatar_color: r.author_avatar_color || 'var(--teal)',
          message: meta.message || 'New commit',
          hash: meta.hash
        });
      });
      
      (manualRows || []).forEach(r => {
        combined.push({
          id: `manual_${r.id}`,
          type: 'manual',
          timestamp: r.timestamp,
          author: r.author_name || 'Developer',
          avatar_color: r.author_avatar_color || 'var(--violet)',
          message: r.message
        });
      });
      
      combined.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      res.json(combined);
    });
  });
});

// POST /api/repos/:repo/branches/:branch/changelog - Post a manual changelog entry
app.post('/api/repos/:repo/branches/:branch/changelog', authorizeRepoWriteAccess, (req, res) => {
  const { repo, branch } = req.params;
  const { content, author_user_id } = req.body;
  
  if (!content) {
    return res.status(400).json({ error: 'Content is required.' });
  }
  
  const now = new Date().toISOString();
  db.run(`
    INSERT INTO changelog_entries (repo_name, branch_name, content, author_user_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `, [repo, branch, content, author_user_id || 1, now], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    const entryId = this.lastID;
    
    db.get(`
      SELECT c.id, 'manual' as type, c.created_at as timestamp, u.display_name as author_name, u.avatar_color as author_avatar_color, c.content as message
      FROM changelog_entries c
      LEFT JOIN users u ON c.author_user_id = u.id
      WHERE c.id = ?
    `, [entryId], (err, row) => {
      if (row) {
        eventBus.publish({
          event_type: 'changelog:created',
          event_category: 'project',
          repo_name: repo,
          branch_name: branch,
          user_id: author_user_id || 1,
          metadata: { message: content }
        });
      }
      res.status(201).json(row || { id: entryId });
    });
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
app.post('/api/deployments', authorizeRepoWriteAccess, async (req, res) => {
  const { repo_name, branch_name, user_id, commit_hash, status, is_rollback } = req.body;
  if (!repo_name || !branch_name) {
    return res.status(400).json({ error: 'Repository name and branch name are required.' });
  }

  // 1. Resolve SHAs and generate changelog
  const resolvedSha = await githubService.resolveCommitSha(repo_name, branch_name, commit_hash || 'HEAD');
  
  const prevDeploy = await new Promise((resolve) => {
    db.get(`
      SELECT commit_hash FROM deployments 
      WHERE repo_name = ? AND branch_name = ? AND status = 'success'
      ORDER BY deployed_at DESC LIMIT 1
    `, [repo_name, branch_name], (err, row) => {
      resolve(row);
    });
  });
  
  const prevSha = prevDeploy ? prevDeploy.commit_hash : null;
  let changelog = await githubService.generateChangelog(repo_name, prevSha, resolvedSha, branch_name);
  if (is_rollback) {
    changelog = `### 🔄 Rollback to ${resolvedSha.substring(0, 7)}\n\n*Reverting environment state to prior version.*\n\n---\n\n` + changelog;
  }

  // 2. Save deployment record in DB
  const deployedAt = new Date().toISOString();
  
  db.run(`
    INSERT INTO deployments (repo_name, branch_name, user_id, commit_hash, status, deployed_at, changelog)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [repo_name, branch_name, user_id || null, resolvedSha, status || 'success', deployedAt, changelog], function(err) {
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
          metadata: { commit_hash: resolvedSha, status: row.status || 'success', changelog }
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

// GET /api/repos/:repo/tasks - Get tasks for a repository
app.get('/api/repos/:repo/tasks', (req, res) => {
  const repoName = req.params.repo;
  db.all(`
    SELECT t.*, u.display_name as assignee_name, u.avatar_color as assignee_avatar_color
    FROM tasks t
    LEFT JOIN users u ON t.assignee_user_id = u.id
    WHERE t.repo_name = ?
    ORDER BY t.id DESC
  `, [repoName], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows || []);
  });
});

// POST /api/repos/:repo/tasks - Create a new task
app.post('/api/repos/:repo/tasks', authorizeRepoWriteAccess, (req, res) => {
  const repoName = req.params.repo;
  const { title, description, status, priority, assignee_user_id } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Task title is required.' });
  }

  const now = new Date().toISOString();
  db.run(`
    INSERT INTO tasks (repo_name, title, description, status, priority, assignee_user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    repoName,
    title,
    description || '',
    status || 'todo',
    priority || 'medium',
    assignee_user_id || null,
    now,
    now
  ], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    const taskId = this.lastID;

    // Publish event
    eventBus.publish({
      event_type: 'ticket:created',
      event_category: 'ticket',
      repo_name: repoName,
      metadata: { title, priority, status }
    });

    db.get(`
      SELECT t.*, u.display_name as assignee_name, u.avatar_color as assignee_avatar_color
      FROM tasks t
      LEFT JOIN users u ON t.assignee_user_id = u.id
      WHERE t.id = ?
    `, [taskId], (err, row) => {
      res.status(201).json(row || { id: taskId });
    });
  });
});

// PATCH /api/tasks/:id - Update an existing task
app.patch('/api/tasks/:id', (req, res) => {
  const taskId = req.params.id;
  const { status, assignee_user_id, priority, description, title } = req.body;

  const updates = [];
  const params = [];

  if (status !== undefined) {
    updates.push('status = ?');
    params.push(status);
  }
  if (assignee_user_id !== undefined) {
    updates.push('assignee_user_id = ?');
    params.push(assignee_user_id);
  }
  if (priority !== undefined) {
    updates.push('priority = ?');
    params.push(priority);
  }
  if (description !== undefined) {
    updates.push('description = ?');
    params.push(description);
  }
  if (title !== undefined) {
    updates.push('title = ?');
    params.push(title);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update.' });
  }

  const now = new Date().toISOString();
  updates.push('updated_at = ?');
  params.push(now);

  params.push(taskId);

  db.run(`
    UPDATE tasks
    SET ${updates.join(', ')}
    WHERE id = ?
  `, params, function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    db.get(`
      SELECT t.*, u.display_name as assignee_name, u.avatar_color as assignee_avatar_color
      FROM tasks t
      LEFT JOIN users u ON t.assignee_user_id = u.id
      WHERE t.id = ?
    `, [taskId], (err, row) => {
      if (row) {
        eventBus.publish({
          event_type: 'ticket:updated',
          event_category: 'ticket',
          repo_name: row.repo_name,
          metadata: { title: row.title, status: row.status }
        });
      }
      res.json(row || { message: 'Task updated successfully' });
    });
  });
});

// DELETE /api/tasks/:id - Delete a task
app.delete('/api/tasks/:id', (req, res) => {
  const taskId = req.params.id;
  db.run('DELETE FROM tasks WHERE id = ?', [taskId], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, message: 'Task deleted successfully' });
  });
});

// GET /api/repos/:repo/files - Get file tree for a repository (live local scan)
app.get('/api/repos/:repo/files', (req, res) => {
  const repoName = req.params.repo;
  const fs = require('fs');
  const path = require('path');

  try {
    const projectRoot = githubService.getRepoPath(repoName);
    
    if (!fs.existsSync(projectRoot)) {
      return res.status(404).json({ error: `Local repository folder for '${repoName}' not found or unavailable.` });
    }

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

  socket.on('session:request_join', ({ roomId, userId, username }) => {
    db.get('SELECT created_by_user_id, repo_name, branch_name FROM session_rooms WHERE id = ?', [roomId], (err, room) => {
      if (err || !room) {
        socket.emit('session:join_response', { approve: false, error: 'Room not found.' });
        return;
      }
      
      const hostId = room.created_by_user_id;
      if (!hostId || hostId === userId) {
        socket.emit('session:join_response', { approve: true });
        return;
      }
      
      const requestId = socket.id;
      let hostSocketFound = false;
      for (const [sid, uid] of socketUserMap.entries()) {
        if (uid === hostId) {
          io.to(sid).emit('session:join_request', {
            requestId,
            userId,
            username,
            roomId,
            repoName: room.repo_name,
            branchName: room.branch_name
          });
          hostSocketFound = true;
        }
      }
      
      if (!hostSocketFound) {
        socket.emit('session:join_response', { approve: false, error: 'Host is offline.' });
      } else {
        console.log(`[Socket] Sent join request from user ${userId} (${username}) to host ${hostId}`);
      }
    });
  });

  socket.on('session:respond_join', ({ requestId, approve }) => {
    io.to(requestId).emit('session:join_response', { approve });
    console.log(`[Socket] Host responded to join request ${requestId}: approve = ${approve}`);
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

// Start Express + WebSocket Server after database cache is loaded
(async () => {
  try {
    // 1. Wait for database schema connection & migration to finish
    await db.ready;
    console.log('[Server] Database schema and migrations are ready.');

    // 2. Load the repository paths cache
    await githubService.loadRepoPathsCache();
    console.log('[Server] Successfully loaded repository paths cache.');
  } catch (cacheErr) {
    console.error('[Server] CRITICAL: Failed to load repository paths cache on startup:', cacheErr.message);
    process.exit(1);
  }

  server.listen(PORT, () => {
    console.log(`[Server] TeamSync API + WebSocket running on http://localhost:${PORT}`);
  });
})();
