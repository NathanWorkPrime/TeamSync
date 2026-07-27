const db = require('../database');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// Simulated mock branches for fallback
const MOCK_BRANCHES = {
  'Shift_Software': [
    { name: 'main', meta: 'Protected branch', isMain: true, riders: [] },
    { name: 'development', meta: 'Active branch', isMain: false, riders: [{ id: 2, username: 'sarah', name: 'Sarah', avatar_color: 'var(--violet)' }] },
    { name: 'uat', meta: 'Active branch', isMain: false, riders: [{ id: 3, username: 'david', name: 'David', avatar_color: 'var(--amber)' }] },
    { name: 'live', meta: 'Active branch', isMain: false, riders: [{ id: 4, username: 'tom', name: 'Tom', avatar_color: 'var(--red)' }] }
  ]
};

const MOCK_REPOS = [
  { name: 'Shift_Software', description: 'Real-time development collaboration platform.', activeCount: 3, riders: ['SJ', 'DK', 'TL'] }
];

/**
 * Checks if GitHub integration is active
 */
function isGitHubConfigured() {
  const pat = process.env.GITHUB_PAT;
  const repo = process.env.GITHUB_REPO;
  return !!(pat && pat.trim() !== '' && repo && repo.trim() !== '');
}

/**
 * Helper to execute database runs as promises
 */
function dbRun(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

/**
 * Helper to execute local git commands
 */
function executeGitCommand(cmd) {
  const projectRoot = path.resolve(__dirname, '../../');
  return new Promise((resolve) => {
    exec(cmd, { cwd: projectRoot }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: stderr || error.message });
      } else {
        resolve({ success: true, stdout });
      }
    });
  });
}

/**
 * Fetch branches for a repository
 */
async function getBranches(repoName) {
  // 1. Fetch repo details from DB
  const repoRow = await new Promise((resolve) => {
    db.get("SELECT * FROM repositories WHERE name = ?", [repoName], (err, row) => {
      resolve(row);
    });
  });

  let branches = [];

  // 2. Fetch from GitHub if configured and connected
  if (repoRow && repoRow.github_repo && isGitHubConfigured()) {
    const pat = process.env.GITHUB_PAT;
    try {
      const response = await fetch(`https://api.github.com/repos/${repoRow.github_repo}/branches`, {
        headers: {
          'Authorization': `token ${pat}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'TeamSync-App'
        }
      });

      if (response.ok) {
        const ghBranches = await response.json();
        branches = ghBranches.map(b => {
          const isMain = b.name === 'main' || b.name === 'master';
          const meta = isMain ? 'Protected branch' : 'Active branch';
          return { name: b.name, isMain, meta };
        });
      } else {
        console.error(`[GitHub Service] GitHub branches fetch returned status ${response.status}`);
      }
    } catch (error) {
      console.error(`[GitHub Service] Error fetching GitHub branches for ${repoName}:`, error.message);
    }
  }

  // 3. Fallback to local git if no branches fetched yet, and it's local repository
  if (branches.length === 0 && (repoName === 'TeamSync' || repoName === 'TeamDash' || !repoRow?.github_repo)) {
    const gitResult = await executeGitCommand('git branch -a');
    let branchesList = [];
    if (gitResult.success && gitResult.stdout.trim() !== '') {
      const lines = gitResult.stdout.split('\n');
      lines.forEach(line => {
        let clean = line.replace(/^\*/, '').trim();
        if (clean.startsWith('remotes/origin/')) {
          clean = clean.replace('remotes/origin/', '');
        }
        if (clean.includes('->') || clean === 'HEAD' || clean === '') return;
        if (!branchesList.includes(clean)) {
          branchesList.push(clean);
        }
      });
    }

    if (branchesList.length === 0) {
      branchesList = ['master'];
    }

    branches = branchesList.map(name => {
      const isMain = name === 'master' || name === 'main';
      const meta = isMain ? 'Protected branch' : 'Active branch';
      return { name, isMain, meta };
    });
  }

  // 4. Fallback to hardcoded mock branches if still empty
  if (branches.length === 0) {
    branches = MOCK_BRANCHES[repoName] || [
      { name: 'main', meta: 'Main branch (Fallback)', isMain: true }
    ];
  }

  // 4.5. Fetch pull requests from GitHub if configured
  let prs = [];
  if (repoRow && repoRow.github_repo && isGitHubConfigured()) {
    const pat = process.env.GITHUB_PAT;
    try {
      const response = await fetch(`https://api.github.com/repos/${repoRow.github_repo}/pulls?state=all`, {
        headers: {
          'Authorization': `token ${pat}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'TeamSync-App'
        }
      });
      if (response.ok) {
        prs = await response.json();
      }
    } catch (err) {
      console.warn(`[GitHub Service] Failed to fetch PRs for ${repoName}:`, err.message);
    }
  }

  // Map PR status to each branch
  branches = branches.map(b => {
    let pr = null;
    
    // Check live GitHub PR
    if (prs.length > 0) {
      const matchedPr = prs.find(p => p.head.ref === b.name);
      if (matchedPr) {
        pr = {
          status: matchedPr.merged_at ? 'merged' : matchedPr.state, // 'open', 'closed', 'merged'
          number: matchedPr.number,
          title: matchedPr.title,
          url: matchedPr.html_url
        };
      }
    }

    // Fallback Mock PR for local repo / demo mode
    if (!pr && !b.isMain) {
      if (b.name === 'development' || b.name.includes('development') || b.name.includes('chat')) {
        pr = {
          status: 'open',
          number: 14,
          title: 'feat: add real-time websocket coordination layer',
          url: 'https://github.com/Tech-Finity/TeamSync/pull/14'
        };
      } else if (b.name === 'uat' || b.name.includes('db') || b.name.includes('migration')) {
        pr = {
          status: 'merged',
          number: 10,
          title: 'feat: add SQLite persistence layer for events & docs',
          url: 'https://github.com/Tech-Finity/TeamSync/pull/10'
        };
      } else if (b.name === 'live') {
        pr = {
          status: 'merged',
          number: 8,
          title: 'chore: boilerplate setup and structural layout',
          url: 'https://github.com/Tech-Finity/TeamSync/pull/8'
        };
      }
    }

    return {
      ...b,
      pr
    };
  });

  // 5. Enrich branch info from DB presence table (who is riding/in session)
  return await Promise.all(branches.map(async (b) => {
    const riders = await new Promise((resolve) => {
      db.all(`
        SELECT u.id, u.username, u.display_name as name, u.avatar_color 
        FROM presence p
        JOIN users u ON p.user_id = u.id
        WHERE p.repo_name = ? AND p.branch_name = ?
      `, [repoName, b.name], (err, rows) => {
        if (err) resolve([]);
        else resolve(rows || []);
      });
    });

    return {
      ...b,
      riders
    };
  }));
}

/**
 * Fetch list of repositories
 */
async function getRepos() {
  // 1. Fetch repositories from local SQLite database
  const reposFromDb = await new Promise((resolve) => {
    db.all("SELECT * FROM repositories", [], (err, rows) => {
      resolve(rows || []);
    });
  });

  const pat = process.env.GITHUB_PAT;

  // 2. Map and enrich repositories
  return await Promise.all(reposFromDb.map(async (repo) => {
    let description = repo.description;
    
    // If it's a GitHub repo and config is active, we can fetch live metadata
    if (repo.github_repo && isGitHubConfigured()) {
      try {
        const response = await fetch(`https://api.github.com/repos/${repo.github_repo}`, {
          headers: {
            'Authorization': `token ${pat}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'TeamSync-App'
          }
        });
        if (response.ok) {
          const ghData = await response.json();
          description = ghData.description || description;
        }
      } catch (err) {
        console.warn(`[GitHub Service] Failed to fetch live repo description for ${repo.name}:`, err.message);
      }
    }

    // 3. Find active presence riders
    const riders = await new Promise((resolve) => {
      db.all(`
        SELECT u.display_name
        FROM presence p
        JOIN users u ON p.user_id = u.id
        WHERE p.repo_name = ?
      `, [repo.name], (err, rows) => {
        if (err || !rows) resolve([]);
        else resolve(rows.map(row => row.display_name.split(' ').map(n => n[0]).join('').toUpperCase()));
      });
    });

    return {
      name: repo.name,
      description: description || 'No description provided.',
      activeCount: riders.length,
      riders
    };
  }));
}

/**
 * Sync GitHub issues to local SQLite database cache
 */
async function syncGitHubIssues() {
  if (!isGitHubConfigured()) {
    console.log('[GitHub Service] Demo Mode: Skipping live GitHub sync');
    return;
  }

  const pat = process.env.GITHUB_PAT;
  const repo = process.env.GITHUB_REPO; // format: owner/repo
  console.log(`[GitHub Service] Starting issues sync for ${repo}...`);

  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/issues?state=all&per_page=100`, {
      headers: {
        'Authorization': `token ${pat}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'TeamSync-App'
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub API returned status ${response.status}`);
    }

    const issues = await response.json();
    const now = new Date().toISOString();

    for (const issue of issues) {
      // Skip pull requests
      if (issue.pull_request) continue;

      const externalId = issue.number.toString();
      const externalUrl = issue.html_url;
      const title = issue.title;
      const description = issue.body || '';
      
      // Parse status from state and labels
      let status = 'todo';
      if (issue.state === 'closed') {
        status = 'done';
      } else {
        const labelNames = issue.labels.map(l => l.name.toLowerCase());
        if (labelNames.includes('in progress') || labelNames.includes('in-progress')) {
          status = 'in-progress';
        } else if (labelNames.includes('review')) {
          status = 'review';
        }
      }

      // Parse priority from labels
      let priority = 'low';
      const labelNames = issue.labels.map(l => l.name.toLowerCase());
      if (labelNames.includes('urgent')) priority = 'urgent';
      else if (labelNames.includes('high')) priority = 'high';
      else if (labelNames.includes('medium') || labelNames.includes('med')) priority = 'medium';

      // Find or map assignee (mock mapping for our demo users based on GitHub login)
      let assigneeUserId = null;
      if (issue.assignee) {
        const ghUser = issue.assignee.login.toLowerCase();
        // Simple mapping rule for seed users
        if (ghUser.includes('sarah')) assigneeUserId = 2;
        else if (ghUser.includes('david')) assigneeUserId = 3;
        else if (ghUser.includes('tom')) assigneeUserId = 4;
        else assigneeUserId = 1; // Default to 'You' (JM)
      }

      const repoName = repo.split('/')[1];

      // Upsert ticket
      await new Promise((resolve, reject) => {
        db.get("SELECT id, last_change_origin FROM tickets WHERE source = 'github' AND external_id = ?", [externalId], async (err, row) => {
          if (err) {
            reject(err);
            return;
          }

          if (row) {
            // Check if we originated the change, to prevent loops
            if (row.last_change_origin === 'internal') {
              // Reset flag for next sync, but do not overwrite local database values if local is ahead
              await dbRun(
                "UPDATE tickets SET last_change_origin = 'external', last_synced_at = ? WHERE id = ?",
                [now, row.id]
              );
            } else {
              // Update all columns from GitHub
              await dbRun(`
                UPDATE tickets SET 
                  title = ?, description = ?, status = ?, priority = ?, 
                  assignee_user_id = ?, repo_or_project = ?, updated_at = ?, last_synced_at = ?, last_change_origin = 'external'
                WHERE id = ?
              `, [title, description, status, priority, assigneeUserId, repoName, issue.updated_at, now, row.id]);
            }
          } else {
            // Insert new ticket
            await dbRun(`
              INSERT INTO tickets (
                source, external_id, external_url, title, description, status, priority, 
                assignee_user_id, repo_or_project, created_at, updated_at, last_synced_at, last_change_origin
              ) VALUES ('github', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'external')
            `, [externalId, externalUrl, title, description, status, priority, assigneeUserId, repoName, issue.created_at, issue.updated_at, now]);
          }
          resolve();
        });
      });
    }

    console.log(`[GitHub Service] Sync completed. Synced ${issues.length} items.`);
  } catch (error) {
    console.error('[GitHub Service] Sync issues failed:', error.message);
  }
}

/**
 * Update issue status/priority/assignee back to GitHub
 */
async function updateGitHubIssue(externalId, updates) {
  if (!isGitHubConfigured()) {
    console.log(`[GitHub Service] Demo Mode: Simulated GitHub write for issue #${externalId}`);
    return;
  }

  const pat = process.env.GITHUB_PAT;
  const repo = process.env.GITHUB_REPO;

  try {
    // 1. Get the current issue labels from GitHub first
    const issueResponse = await fetch(`https://api.github.com/repos/${repo}/issues/${externalId}`, {
      headers: {
        'Authorization': `token ${pat}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'TeamSync-App'
      }
    });

    if (!issueResponse.ok) {
      throw new Error(`Failed to fetch issue before update: status ${issueResponse.status}`);
    }

    const issue = await issueResponse.json();
    let currentLabels = issue.labels.map(l => l.name);

    // 2. Adjust labels based on new status and priority
    if (updates.status) {
      // Remove other status labels
      currentLabels = currentLabels.filter(name => 
        !['todo', 'in progress', 'in-progress', 'review'].includes(name.toLowerCase())
      );
      // Add new status label (normalized display)
      if (updates.status === 'in-progress') currentLabels.push('In Progress');
      else if (updates.status === 'review') currentLabels.push('Review');
      else if (updates.status === 'todo') currentLabels.push('Todo');
    }

    if (updates.priority) {
      // Remove other priority labels
      currentLabels = currentLabels.filter(name => 
        !['low', 'medium', 'high', 'urgent'].includes(name.toLowerCase())
      );
      // Add new priority label (capitalized)
      const capitalizedPrio = updates.priority.charAt(0).toUpperCase() + updates.priority.slice(1);
      currentLabels.push(capitalizedPrio);
    }

    // Prepare payload
    const payload = {};
    if (updates.title) payload.title = updates.title;
    if (updates.description) payload.body = updates.description;
    
    // Status mapped to closed/open state
    if (updates.status) {
      payload.state = updates.status === 'done' ? 'closed' : 'open';
    }

    payload.labels = currentLabels;

    // Call update endpoint
    const patchResponse = await fetch(`https://api.github.com/repos/${repo}/issues/${externalId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `token ${pat}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'TeamSync-App'
      },
      body: JSON.stringify(payload)
    });

    if (!patchResponse.ok) {
      throw new Error(`GitHub issue update returned status ${patchResponse.status}`);
    }

    console.log(`[GitHub Service] Successfully updated GitHub issue #${externalId}`);
  } catch (error) {
    console.error(`[GitHub Service] Failed to update GitHub issue #${externalId}:`, error.message);
  }
}

/**
 * Fetch commits for a repository (live from GitHub or local Git, with mock fallback)
 */
async function getCommits(repoName) {
  const repoRow = await new Promise((resolve) => {
    db.get("SELECT * FROM repositories WHERE name = ?", [repoName], (err, row) => {
      resolve(row);
    });
  });

  // 1. Fetch from GitHub if configured
  if (repoRow && repoRow.github_repo && isGitHubConfigured()) {
    const pat = process.env.GITHUB_PAT;
    try {
      const response = await fetch(`https://api.github.com/repos/${repoRow.github_repo}/commits?per_page=10`, {
        headers: {
          'Authorization': `token ${pat}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'TeamSync-App'
        }
      });
      if (response.ok) {
        const ghCommits = await response.json();
        return ghCommits.map(c => ({
          hash: c.sha,
          message: c.commit.message,
          author: c.commit.author.name,
          email: c.commit.author.email,
          date: c.commit.author.date
        }));
      }
    } catch (err) {
      console.error(`[GitHub Service] Error fetching commits for ${repoName}:`, err.message);
    }
  }

  // 2. Fallback to local git
  if (repoName === 'TeamSync' || repoName === 'TeamDash' || !repoRow?.github_repo) {
    const gitResult = await executeGitCommand('git log -n 10 --pretty=format:"%H|%s|%an|%ae|%ad" --date=iso');
    if (gitResult.success && gitResult.stdout.trim() !== '') {
      const lines = gitResult.stdout.trim().split('\n');
      return lines.map(line => {
        const parts = line.split('|');
        if (parts.length < 5) return null;
        return {
          hash: parts[0],
          message: parts[1],
          author: parts[2],
          email: parts[3],
          date: parts[4]
        };
      }).filter(Boolean);
    }
  }

  // 3. Fallback to mock commits
  const mockDate = new Date();
  return [
    {
      hash: '5f9c1b48d21b4a8e3d6f1a8c0d5e2a9b3c4d5e6f',
      message: 'refactor: move socket authentication to event module',
      author: 'You',
      email: 'you@company.com',
      date: new Date(mockDate.getTime() - 3600000).toISOString()
    },
    {
      hash: '3d9f2a8c1b4e5d6f7a8b9c0d1e2f3a4b5c6d7e8f',
      message: 'feat: add persistent sqlite database schema',
      author: 'Sarah',
      email: 'sarah@company.com',
      date: new Date(mockDate.getTime() - 10800000).toISOString()
    },
    {
      hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
      message: 'chore: initial setup and repository boilerplate',
      author: 'David',
      email: 'david@company.com',
      date: new Date(mockDate.getTime() - 86400000).toISOString()
    }
  ];
}

module.exports = {
  isGitHubConfigured,
  getRepos,
  getBranches,
  getCommits,
  syncGitHubIssues,
  updateGitHubIssue
};
