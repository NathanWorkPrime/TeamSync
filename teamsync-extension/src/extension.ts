import * as vscode from 'vscode';
import express from 'express';
import cors from 'cors';
import { Server } from 'http';
import { exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';

let serverInstance: Server | null = null;
let telemetryTimer: NodeJS.Timeout | null = null;
let gitAPI: any = null;

// Telemetry configuration states
let currentUserId: number = 1; // Default
let currentUsername: string = 'You';
let teamSyncServerUrl: string = 'http://localhost:5000';
let currentRepo: string = '';
let currentBranch: string = '';
let currentSessionLink: string = '';
let activeStatusBarItem: vscode.StatusBarItem | null = null;

// Helper to make HTTP POST requests with zero dependencies
function sendPostRequest(urlStr: string, body: any): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlStr);
      const postData = JSON.stringify(body);
      const options = {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = http.request(options, (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve());
      });

      req.on('error', (err) => reject(err));
      req.write(postData);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

// Git query helper
function queryGit(cmd: string, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    exec(cmd, { cwd }, (err, stdout) => {
      resolve(err ? '' : stdout.trim());
    });
  });
}

export function activate(context: vscode.ExtensionContext) {
  console.log('TeamSync Companion Extension is now active!');

  const updateServerUrl = () => {
    const configUrl = vscode.workspace.getConfiguration('teamsync').get<string>('serverUrl');
    if (configUrl) {
      teamSyncServerUrl = configUrl.trim();
    }
  };
  updateServerUrl();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('teamsync.serverUrl')) {
        updateServerUrl();
      }
    })
  );

  // Initialize Git extension API integration
  try {
    const gitExtension = vscode.extensions.getExtension<any>('vscode.git')?.exports;
    gitAPI = gitExtension?.getAPI(1);
    console.log('[TeamSync Companion] Git Extension API successfully loaded');
  } catch (err: any) {
    console.warn('[TeamSync Companion] Failed to initialize Git extension API:', err.message);
  }

  const runCmd = (cmd: string, cwd: string): Promise<{ stdout: string; stderr: string }> => {
    return new Promise((resolve, reject) => {
      exec(cmd, { cwd }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  };

  const gitCheckoutAndSync = async (dir: string, targetBranch: string) => {
    try {
      await runCmd(`git checkout ${targetBranch}`, dir);
    } catch (checkoutErr) {
      try {
        await runCmd(`git checkout -b ${targetBranch}`, dir);
      } catch (createErr: any) {
        throw new Error(`Failed to checkout or create branch ${targetBranch}: ${createErr.message}`);
      }
    }
  };

  const monitoredRepos = new Set<string>();

  const monitorRepository = (repo: any) => {
    const rootPath = repo.rootUri.fsPath;
    if (monitoredRepos.has(rootPath)) return;
    monitoredRepos.add(rootPath);

    console.log(`[TeamSync Companion] Monitoring git repository: ${rootPath}`);

    let lastCommitHash = repo.state.HEAD?.commit || '';
    let lastBranchName = repo.state.HEAD?.name || '';
    let lastConflictsCount = repo.state.mergeConflicts?.length || 0;

    const handleGitStateChange = async () => {
      const currentCommit = repo.state.HEAD?.commit || '';
      const currentBranch = repo.state.HEAD?.name || '';
      const currentConflicts = repo.state.mergeConflicts || [];
      const currentConflictsCount = currentConflicts.length;

      // 1. Detect Branch Switch
      if (currentBranch && currentBranch !== lastBranchName) {
        console.log(`[TeamSync Companion] Branch switch detected: ${lastBranchName} -> ${currentBranch}`);
        const oldBranch = lastBranchName;
        lastBranchName = currentBranch;

        // Trigger immediate heartbeat to update presence
        sendHeartbeat();

        // Send branch switch event
        try {
          const repoName = path.basename(rootPath);
          await sendPostRequest(`${teamSyncServerUrl}/api/events`, {
            event_type: 'git:branch_switch',
            event_category: 'developer',
            repo_name: currentRepo || repoName,
            branch_name: currentBranch,
            user_id: currentUserId,
            metadata: {
              previous_branch: oldBranch,
              new_branch: currentBranch
            }
          });
        } catch (err: any) {
          console.warn('[TeamSync Companion] Failed to post branch switch event:', err.message);
        }
      }

      // 2. Detect New Commit
      if (currentCommit && currentCommit !== lastCommitHash) {
        console.log(`[TeamSync Companion] New commit detected: ${currentCommit}`);
        lastCommitHash = currentCommit;

        try {
          const repoName = path.basename(rootPath);
          const commitDetailsRaw = await queryGit(`git show ${currentCommit} --pretty=format:"%H|%s|%an|%ae|%ad" --no-patch`, rootPath);
          
          if (commitDetailsRaw) {
            const parts = commitDetailsRaw.trim().split('\n')[0].split('|');
            if (parts.length >= 5) {
              const hash = parts[0];
              const message = parts[1];
              const author = parts[2];
              const email = parts[3];
              const date = parts[4];

              const changedFilesRaw = await queryGit(`git diff-tree --no-commit-id --name-only -r ${currentCommit}`, rootPath);
              const changedFiles = changedFilesRaw ? changedFilesRaw.trim().split('\n').filter(Boolean) : [];

              await sendPostRequest(`${teamSyncServerUrl}/api/events`, {
                event_type: 'git:commit',
                event_category: 'developer',
                repo_name: currentRepo || repoName,
                branch_name: currentBranch || 'main',
                user_id: currentUserId,
                metadata: {
                  hash,
                  message,
                  author,
                  email,
                  date,
                  changed_files: changedFiles
                }
              });
            }
          }
        } catch (err: any) {
          console.warn('[TeamSync Companion] Failed to query or post commit event:', err.message);
        }
      }

      // 3. Detect Merge Conflicts
      if (currentConflictsCount !== lastConflictsCount) {
        lastConflictsCount = currentConflictsCount;
        
        // Trigger immediate heartbeat to update presence
        sendHeartbeat();

        if (currentConflictsCount > 0) {
          const filesList = currentConflicts.map((c: any) => path.basename(c.uri.fsPath)).join(', ');
          vscode.window.showWarningMessage(`TeamSync Alert: Merge conflicts detected in: ${filesList}. Please resolve before merging.`);

          try {
            const repoName = path.basename(rootPath);
            await sendPostRequest(`${teamSyncServerUrl}/api/events`, {
              event_type: 'git:conflict',
              event_category: 'developer',
              repo_name: currentRepo || repoName,
              branch_name: currentBranch || 'main',
              user_id: currentUserId,
              metadata: {
                conflict_count: currentConflictsCount,
                conflicted_files: currentConflicts.map((c: any) => path.relative(rootPath, c.uri.fsPath).replace(/\\/g, '/'))
              }
            });
          } catch (err: any) {
            console.warn('[TeamSync Companion] Failed to post conflict event:', err.message);
          }
        }
      }
    };

    const sub = repo.state.onDidChange(handleGitStateChange);
    context.subscriptions.push(sub);
  };

  if (gitAPI) {
    gitAPI.repositories.forEach((repo: any) => monitorRepository(repo));
    const openSub = gitAPI.onDidOpenRepository((repo: any) => {
      monitorRepository(repo);
    });
    context.subscriptions.push(openSub);
  }

  const app = express();
  const PORT = 37845;

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || /^http:\/\/localhost(:\d+)?$/.test(origin) || origin === 'https://102.130.122.57:8080') {
        callback(null, true);
      } else {
        callback(new Error('Blocked by CORS policy'));
      }
    }
  }));

  app.use(express.json());

  // GET /detect-repo-status - Check local repository status
  app.get('/detect-repo-status', async (req: express.Request, res: express.Response) => {
    const repo = req.query.repo as string;
    const branch = req.query.branch as string;

    if (!repo) {
      res.status(400).json({ error: 'Repository name is required.' });
      return;
    }

    try {
      // Resolve path
      const stateKey = `repo-path:${repo}`;
      let baseDir = context.globalState.get<string>(stateKey);

      if (!baseDir) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          const rootPath = workspaceFolders[0].uri.fsPath;
          const parentPath = path.dirname(rootPath);
          if (fs.existsSync(parentPath)) {
            baseDir = parentPath;
          }
        }
      }

      if (!baseDir) {
        const parentPath = path.resolve(__dirname, '../../../');
        if (fs.existsSync(parentPath) && fs.existsSync(path.join(parentPath, 'TeamDash'))) {
          baseDir = parentPath;
        }
      }

      if (!baseDir) {
        res.json({ exists: false, message: 'No base path configured' });
        return;
      }

      const repoBasename = repo.split('/').pop() || repo;
      let targetDir = path.join(baseDir, repoBasename);

      // Map 'TeamSync' to local 'TeamDash' folder if it exists
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (repoBasename === 'TeamSync') {
        const activeDashFolder = workspaceFolders?.find(f => 
          path.basename(f.uri.fsPath) === 'TeamDash' || path.basename(f.uri.fsPath) === 'TeamSync'
        );
        if (activeDashFolder) {
          targetDir = activeDashFolder.uri.fsPath;
        } else {
          const altDir = path.join(baseDir, 'TeamDash');
          if (fs.existsSync(altDir)) {
            targetDir = altDir;
          }
        }
      }

      if (!fs.existsSync(targetDir)) {
        res.json({ exists: false });
        return;
      }

      if (!fs.existsSync(path.join(targetDir, '.git'))) {
        res.json({ exists: true, isGit: false, path: targetDir });
        return;
      }

      let currentBranch = '';
      try {
        const branchOut = await runCmd('git rev-parse --abbrev-ref HEAD', targetDir);
        currentBranch = branchOut.stdout.trim();
      } catch (e) {}

      let isClean = true;
      try {
        const statusOut = await runCmd('git status --porcelain', targetDir);
        isClean = statusOut.stdout.trim() === '';
      } catch (e) {}

      res.json({
        exists: true,
        isGit: true,
        path: targetDir,
        currentBranch,
        isClean,
        hasUncommittedChanges: !isClean
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /git-status - Get comprehensive local git status
  app.get('/git-status', async (req: express.Request, res: express.Response) => {
    const repo = req.query.repo as string;

    if (!repo) {
      res.status(400).json({ error: 'Repository name is required.' });
      return;
    }

    try {
      // Resolve path
      const stateKey = `repo-path:${repo}`;
      let baseDir = context.globalState.get<string>(stateKey);

      if (!baseDir) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          const rootPath = workspaceFolders[0].uri.fsPath;
          const parentPath = path.dirname(rootPath);
          if (fs.existsSync(parentPath)) {
            baseDir = parentPath;
          }
        }
      }

      if (!baseDir) {
        const parentPath = path.resolve(__dirname, '../../../');
        if (fs.existsSync(parentPath) && fs.existsSync(path.join(parentPath, 'TeamDash'))) {
          baseDir = parentPath;
        }
      }

      if (!baseDir) {
        res.json({ exists: false, message: 'No base path configured' });
        return;
      }

      const repoBasename = repo.split('/').pop() || repo;
      let targetDir = path.join(baseDir, repoBasename);

      // Map 'TeamSync' to local 'TeamDash' folder if it exists
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (repoBasename === 'TeamSync') {
        const activeDashFolder = workspaceFolders?.find(f => 
          path.basename(f.uri.fsPath) === 'TeamDash' || path.basename(f.uri.fsPath) === 'TeamSync'
        );
        if (activeDashFolder) {
          targetDir = activeDashFolder.uri.fsPath;
        } else {
          const altDir = path.join(baseDir, 'TeamDash');
          if (fs.existsSync(altDir)) {
            targetDir = altDir;
          }
        }
      }

      if (!fs.existsSync(targetDir)) {
        res.json({ exists: false });
        return;
      }

      if (!fs.existsSync(path.join(targetDir, '.git'))) {
        res.json({ exists: true, isGit: false, path: targetDir });
        return;
      }

      // Check Git stats
      let currentBranch = '';
      try {
        const branchOut = await runCmd('git rev-parse --abbrev-ref HEAD', targetDir);
        currentBranch = branchOut.stdout.trim();
      } catch (e) {}

      let currentCommitHash = '';
      let currentCommitMessage = '';
      try {
        const logRes = await runCmd('git log -1 --format=%H%n%s', targetDir);
        const logParts = logRes.stdout.trim().split('\n');
        currentCommitHash = logParts[0] || '';
        currentCommitMessage = logParts[1] || '';
      } catch (e) {}

      let activeRemote = '';
      try {
        const remoteRes = await runCmd('git remote get-url origin', targetDir);
        activeRemote = remoteRes.stdout.trim();
      } catch (e) {}

      // Working Tree Status (staged, modified, untracked)
      let stagedFiles: string[] = [];
      let modifiedFiles: string[] = [];
      let untrackedFiles: string[] = [];
      let isClean = true;

      try {
        const statusOut = await runCmd('git status --porcelain', targetDir);
        const lines = statusOut.stdout.split('\n');
        for (const line of lines) {
          if (line.length < 3) continue;
          const status = line.slice(0, 2);
          const file = line.slice(3).trim();
          isClean = false;

          if (status === '??') {
            untrackedFiles.push(file);
          } else {
            if (status[0] !== ' ' && status[0] !== '?') {
              stagedFiles.push(file);
            }
            if (status[1] !== ' ' && status[1] !== '?') {
              modifiedFiles.push(file);
            }
          }
        }
      } catch (e) {}

      // Ahead/Behind count and upstream tracking status
      let aheadCount = 0;
      let behindCount = 0;
      let upstreamTrackingMissing = false;
      try {
        const revRes = await runCmd('git rev-list --left-right --count HEAD...@{u}', targetDir);
        const parts = revRes.stdout.trim().split(/\s+/);
        if (parts.length >= 2) {
          aheadCount = parseInt(parts[0], 10) || 0;
          behindCount = parseInt(parts[1], 10) || 0;
        }
      } catch (e: any) {
        if (e.message.includes('no upstream') || e.message.includes('no tracking info') || e.message.includes('fatal:')) {
          upstreamTrackingMissing = true;
        }
      }

      // Detached head check
      let detachedHead = false;
      try {
        const headRes = await runCmd('git symbolic-ref -q HEAD', targetDir);
        if (headRes.stdout.trim() === '') {
          detachedHead = true;
        }
      } catch (e) {
        detachedHead = true;
      }

      // Repo Health: check for active states (merge, rebase, cherry-pick)
      const mergeState = fs.existsSync(path.join(targetDir, '.git', 'MERGE_HEAD'));
      const rebaseState = fs.existsSync(path.join(targetDir, '.git', 'rebase-merge')) || fs.existsSync(path.join(targetDir, '.git', 'rebase-apply'));
      const cherryPickState = fs.existsSync(path.join(targetDir, '.git', 'CHERRY_PICK_HEAD'));
      const revertState = fs.existsSync(path.join(targetDir, '.git', 'REVERT_HEAD'));

      // Branches list
      let localBranches: string[] = [];
      let remoteBranches: string[] = [];
      try {
        const branchesRes = await runCmd('git branch -a --format=%(refname:short)', targetDir);
        const lines = branchesRes.stdout.split('\n');
        for (let line of lines) {
          line = line.trim();
          if (!line) continue;
          if (line.startsWith('remotes/')) {
            const cleanRemote = line.replace('remotes/', '');
            if (!cleanRemote.includes('HEAD')) {
              remoteBranches.push(cleanRemote);
            }
          } else {
            localBranches.push(line);
          }
        }
      } catch (e) {}

      // Retrieve timestamps from VS Code globalState
      const fetchKey = `last-fetch:${repo}`;
      const pullKey = `last-pull:${repo}`;
      const pushKey = `last-push:${repo}`;

      const lastFetch = context.globalState.get<string>(fetchKey) || '';
      const lastPull = context.globalState.get<string>(pullKey) || '';
      const lastPush = context.globalState.get<string>(pushKey) || '';

      res.json({
        exists: true,
        isGit: true,
        path: targetDir,
        currentBranch,
        currentCommitHash,
        currentCommitMessage,
        activeRemote,
        isClean,
        stagedFilesCount: stagedFiles.length,
        stagedFiles,
        modifiedFilesCount: modifiedFiles.length,
        modifiedFiles,
        untrackedFilesCount: untrackedFiles.length,
        untrackedFiles,
        aheadCount,
        behindCount,
        upstreamTrackingMissing,
        detachedHead,
        mergeState,
        rebaseState,
        cherryPickState,
        revertState,
        localBranches,
        remoteBranches,
        lastFetch,
        lastPull,
        lastPush
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /git-action - Execute Git operations on local workspace
  app.post('/git-action', async (req: express.Request, res: express.Response) => {
    const { action, repo, branch, force, localOnly, remoteOnly } = req.body;

    if (!repo || !action) {
      res.status(400).json({ error: 'Repository name and Git action are required.' });
      return;
    }

    try {
      // Resolve path
      const stateKey = `repo-path:${repo}`;
      let baseDir = context.globalState.get<string>(stateKey);

      if (!baseDir) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          const rootPath = workspaceFolders[0].uri.fsPath;
          const parentPath = path.dirname(rootPath);
          if (fs.existsSync(parentPath)) {
            baseDir = parentPath;
          }
        }
      }

      if (!baseDir) {
        const parentPath = path.resolve(__dirname, '../../../');
        if (fs.existsSync(parentPath) && fs.existsSync(path.join(parentPath, 'TeamDash'))) {
          baseDir = parentPath;
        }
      }

      if (!baseDir) {
        res.status(400).json({ error: 'Repository local directory not configured.' });
        return;
      }

      const repoBasename = repo.split('/').pop() || repo;
      let targetDir = path.join(baseDir, repoBasename);

      // Map 'TeamSync' to local 'TeamDash' folder if it exists
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (repoBasename === 'TeamSync') {
        const activeDashFolder = workspaceFolders?.find(f => 
          path.basename(f.uri.fsPath) === 'TeamDash' || path.basename(f.uri.fsPath) === 'TeamSync'
        );
        if (activeDashFolder) {
          targetDir = activeDashFolder.uri.fsPath;
        } else {
          const altDir = path.join(baseDir, 'TeamDash');
          if (fs.existsSync(altDir)) {
            targetDir = altDir;
          }
        }
      }

      if (!fs.existsSync(targetDir) || !fs.existsSync(path.join(targetDir, '.git'))) {
        res.status(404).json({ error: 'Local Git repository not found.' });
        return;
      }

      let log = '';
      const runLogCmd = async (cmd: string) => {
        log += `> ${cmd}\n`;
        const resOut = await runCmd(cmd, targetDir);
        if (resOut.stdout) log += `${resOut.stdout}\n`;
        if (resOut.stderr) log += `${resOut.stderr}\n`;
        return resOut;
      };

      const fetchKey = `last-fetch:${repo}`;
      const pullKey = `last-pull:${repo}`;
      const pushKey = `last-push:${repo}`;

      if (action === 'fetch') {
        await runLogCmd('git fetch origin');
        await context.globalState.update(fetchKey, new Date().toISOString());
        res.json({ success: true, log, message: 'Successfully fetched remote repository updates.' });
        return;
      } 
      
      if (action === 'pull') {
        const targetBranch = branch || 'main';
        await runLogCmd('git fetch origin');
        await gitCheckoutAndSync(targetDir, targetBranch);
        await runLogCmd(`git pull origin ${targetBranch}`);
        await context.globalState.update(pullKey, new Date().toISOString());
        res.json({ success: true, log, message: `Successfully pulled latest changes on ${targetBranch}.` });
        return;
      } 
      
      if (action === 'push') {
        const targetBranch = branch || 'main';
        await gitCheckoutAndSync(targetDir, targetBranch);
        
        // Check if remote upstream tracking exists
        let hasUpstream = false;
        try {
          const trackingRes = await runCmd(`git rev-parse --abbrev-ref ${targetBranch}@{u}`, targetDir);
          if (trackingRes.stdout.trim()) hasUpstream = true;
        } catch (e) {}

        if (hasUpstream) {
          await runLogCmd(`git push origin ${targetBranch}`);
        } else {
          await runLogCmd(`git push -u origin ${targetBranch}`);
        }
        await context.globalState.update(pushKey, new Date().toISOString());
        res.json({ success: true, log, message: `Successfully pushed commits to origin/${targetBranch}.` });
        return;
      } 
      
      if (action === 'sync') {
        const targetBranch = branch || 'main';
        await runLogCmd('git fetch origin');
        await context.globalState.update(fetchKey, new Date().toISOString());
        
        // Checkout target branch
        await gitCheckoutAndSync(targetDir, targetBranch);

        // Check if ahead/behind
        let aheadCount = 0;
        let behindCount = 0;
        let hasUpstream = false;
        try {
          const revRes = await runCmd(`git rev-list --left-right --count HEAD...origin/${targetBranch}`, targetDir);
          const parts = revRes.stdout.trim().split(/\s+/);
          if (parts.length >= 2) {
            aheadCount = parseInt(parts[0], 10) || 0;
            behindCount = parseInt(parts[1], 10) || 0;
          }
          hasUpstream = true;
        } catch (e) {}

        if (behindCount > 0) {
          await runLogCmd(`git pull origin ${targetBranch}`);
          await context.globalState.update(pullKey, new Date().toISOString());
        } else {
          log += `Already up-to-date with remote branch (0 commits behind).\n`;
        }

        if (aheadCount > 0 || !hasUpstream) {
          if (hasUpstream) {
            await runLogCmd(`git push origin ${targetBranch}`);
          } else {
            await runLogCmd(`git push -u origin ${targetBranch}`);
          }
          await context.globalState.update(pushKey, new Date().toISOString());
        } else {
          log += `Already up-to-date with remote branch (0 commits ahead).\n`;
        }

        res.json({ success: true, log, message: `Successfully synchronized ${targetBranch} with remote.` });
        return;
      } 
      
      if (action === 'stash') {
        await runLogCmd('git stash -u');
        res.json({ success: true, log, message: 'Successfully stashed local modifications (including untracked files).' });
        return;
      } 
      
      if (action === 'delete-branch') {
        const targetBranch = branch;
        if (!targetBranch) {
          res.status(400).json({ error: 'Branch name is required for deletion.' });
          return;
        }

        // Detect currently checked out branch
        let currentBranchName = '';
        try {
          const branchOut = await runCmd('git rev-parse --abbrev-ref HEAD', targetDir);
          currentBranchName = branchOut.stdout.trim();
        } catch (e) {}

        if (targetBranch === currentBranchName) {
          res.status(400).json({ error: 'Cannot delete the currently checked-out branch.' });
          return;
        }

        let localSuccess = false;
        let remoteSuccess = false;

        if (!remoteOnly) {
          try {
            // Try standard delete
            const delCmd = force ? `git branch -D ${targetBranch}` : `git branch -d ${targetBranch}`;
            await runLogCmd(delCmd);
            localSuccess = true;
          } catch (delErr: any) {
            if (delErr.message.includes('not fully merged')) {
              res.json({
                success: false,
                requiresForce: true,
                message: `Branch ${targetBranch} is not fully merged. Force delete required.`,
                log
              });
              return;
            }
            throw delErr;
          }
        }

        if (remoteOnly || (!localOnly && localSuccess)) {
          try {
            await runLogCmd(`git push origin --delete ${targetBranch}`);
            remoteSuccess = true;
          } catch (remoteErr: any) {
            console.warn(`[TeamSync Companion] Remote branch deletion failed:`, remoteErr.message);
            log += `Remote deletion failed: ${remoteErr.message}\n`;
          }
        }

        res.json({
          success: true,
          log,
          localSuccess,
          remoteSuccess,
          message: `Branch ${targetBranch} deleted successfully.`
        });
        return;
      }

      res.status(400).json({ error: `Unknown Git action: ${action}` });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /commands - Inspect registered IDE commands
  app.get('/commands', async (req: express.Request, res: express.Response) => {
    try {
      const allCommands = await vscode.commands.getCommands(true);
      const filtered = allCommands.filter(c => c.includes('oct') || c.includes('collab') || c.includes('share') || c.includes('session') || c.includes('room'));
      res.json({ commands: filtered });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /debug-state - Debug paths and workspace folders
  app.get('/debug-state', (req: express.Request, res: express.Response) => {
    const folders = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) || [];
    const stateKey = `repo-path:${currentRepo || 'TeamSync'}`;
    const cachedBaseDir = context.globalState.get<string>(stateKey) || null;
    res.json({
      folders,
      currentRepo,
      currentBranch,
      cachedBaseDir,
      stateKey
    });
  });

  // POST /configure - Configure extension details from browser UI
  app.post('/configure', (req: express.Request, res: express.Response) => {
    const { user_id, username, repo, branch, session_link, server_url } = req.body;
    if (user_id) currentUserId = parseInt(user_id, 10);
    if (username) currentUsername = username;
    if (repo) currentRepo = repo;
    if (branch) currentBranch = branch;
    if (session_link) currentSessionLink = session_link;
    if (server_url) teamSyncServerUrl = server_url;

    console.log(`[TeamSync Companion] Configured: user_id=${currentUserId}, repo=${currentRepo}, branch=${currentBranch}`);
    res.json({ success: true, message: 'Extension successfully configured' });
  });

  // Dynamic command finder and executor for Eclipse OCT VS Code extension
  async function executeOCTCommand(action: 'share' | 'join' | 'leave', param?: any): Promise<string> {
    const allCommands = await vscode.commands.getCommands(true);
    let targetCommand = '';
    if (action === 'share') {
      targetCommand = allCommands.includes('oct.createRoom') ? 'oct.createRoom' : (allCommands.find(c => 
        c === 'oct.share' || 
        c === 'oct.startSession' || 
        (c.startsWith('oct.') && (c.includes('share') || c.includes('create') || c.includes('start')))
      ) || '');
    } else if (action === 'join') {
      targetCommand = allCommands.includes('oct.joinRoom') ? 'oct.joinRoom' : (allCommands.find(c => 
        c === 'oct.join' || 
        c === 'oct.joinSession' || 
        (c.startsWith('oct.') && (c.includes('join') || c.includes('connect')))
      ) || '');
    } else if (action === 'leave') {
      targetCommand = allCommands.includes('oct.leaveRoom') ? 'oct.leaveRoom' : (allCommands.find(c => 
        c === 'oct.leave' || 
        c === 'oct.disconnect' || 
        c === 'oct.endSession' || 
        (c.startsWith('oct.') && (c.includes('leave') || c.includes('disconnect') || c.includes('end') || c.includes('close')))
      ) || '');
    }

    if (!targetCommand) {
      throw new Error(`Could not find appropriate Eclipse OCT command for action: ${action}. Make sure the Open Collaboration Tools extension is installed.`);
    }

    console.log(`[TeamSync Companion] Executing OCT command: ${targetCommand} with param:`, param);
    const result = await vscode.commands.executeCommand<any>(targetCommand, param);
    return result || '';
  }

  // Check if the real Eclipse OCT extension is installed
  async function isRealOCTActive(): Promise<boolean> {
    const allCommands = await vscode.commands.getCommands(true);
    const hasRealOCTCommands = allCommands.some(c => c.startsWith('oct.') || c.startsWith('collaboration.'));
    const hasRealOCTExtension = vscode.extensions.all.some(ext => 
      ext.id.toLowerCase().includes('open-collaboration-tools') || 
      ext.id.toLowerCase().includes('eclipse-oct')
    );
    return hasRealOCTCommands || hasRealOCTExtension;
  }

  // POST /start-session
  app.post('/start-session', async (req: express.Request, res: express.Response) => {
    const { repo, branch } = req.body;

    if (!repo || !branch) {
      res.status(400).json({ error: 'Repository name and branch name are required.' });
      return;
    }

    try {
      vscode.window.showInformationMessage(`TeamSync: Starting collaboration session for ${repo} / ${branch}...`);

      let sessionLink = '';
      const octActive = await isRealOCTActive();

      try {
        const cmdResult = await executeOCTCommand('share');
        sessionLink = cmdResult || '';
        
        // If the command returned empty, check the clipboard for the generated room token
        if (!sessionLink) {
          console.log('[TeamSync Companion] Command returned empty. Polling clipboard for session link/token...');
          for (let i = 0; i < 6; i++) { // Poll 6 times (3 seconds total)
            await new Promise(resolve => setTimeout(resolve, 500));
            const clipboardText = (await vscode.env.clipboard.readText() || '').trim();
            if (clipboardText) {
              if (clipboardText.startsWith('oct://') || clipboardText.startsWith('http://') || clipboardText.startsWith('https://')) {
                sessionLink = clipboardText;
                break;
              } else if (/^[a-zA-Z0-9_-]{20,30}$/.test(clipboardText)) {
                sessionLink = `oct://join/${clipboardText}`;
                break;
              }
            }
          }
        }

        // If still empty, trigger fallback or throw error
        if (!sessionLink) {
          if (context.extensionMode === vscode.ExtensionMode.Development || context.extensionMode === vscode.ExtensionMode.Test) {
            const randomCode = Math.random().toString(36).substring(2, 6).toUpperCase() + 
                               '-' + 
                               Math.random().toString(36).substring(2, 6).toUpperCase();
            sessionLink = `oct://join/TS-${randomCode}`;
            vscode.window.showWarningMessage(`TeamSync (Dev Mode Fallback): No session link captured. Using mock: ${sessionLink}`);
          } else {
            throw new Error('Failed to capture Eclipse OCT session link from clipboard.');
          }
        }
      } catch (cmdErr: any) {
        console.warn('[TeamSync Companion] Failed to run real OCT command:', cmdErr.message);
        
        if (octActive) {
          throw new Error(`Real Eclipse OCT session creation failed: ${cmdErr.message}`);
        }

        if (context.extensionMode === vscode.ExtensionMode.Development || context.extensionMode === vscode.ExtensionMode.Test) {
          const randomCode = Math.random().toString(36).substring(2, 6).toUpperCase() + 
                             '-' + 
                             Math.random().toString(36).substring(2, 6).toUpperCase();
          sessionLink = `oct://join/TS-${randomCode}`;
          vscode.window.showWarningMessage(`TeamSync (Dev Mode Fallback): Real OCT command failed. Using mock: ${sessionLink}`);
        } else {
          throw new Error('Eclipse OCT extension is not installed or not active. Please install the Open Collaboration Tools extension to host sessions.');
        }
      }

      currentRepo = repo;
      currentBranch = branch;
      currentSessionLink = sessionLink;

      // Update VS Code Status Bar
      if (activeStatusBarItem) {
        activeStatusBarItem.hide();
        activeStatusBarItem.dispose();
      }
      activeStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
      activeStatusBarItem.text = `$(broadcast) Active Room: ${branch}`;
      activeStatusBarItem.tooltip = `In TeamSync Session at ${sessionLink}`;
      activeStatusBarItem.show();
      context.subscriptions.push(activeStatusBarItem);

      vscode.window.showInformationMessage(`TeamSync: Session created! Join code: ${sessionLink}`);

      res.json({
        success: true,
        link: sessionLink,
        message: 'OCT session successfully created.'
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`TeamSync: Failed to start session: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /join-session
  app.post('/join-session', async (req: express.Request, res: express.Response) => {
    const { repo, branch, room_id, session_link } = req.body;

    if (!repo || !branch || !session_link) {
      res.status(400).json({ error: 'Repository name, branch name, and session_link are required.' });
      return;
    }

    try {
      vscode.window.showInformationMessage(`TeamSync: Joining existing session for ${repo} / ${branch}...`);

      const octActive = await isRealOCTActive();

      try {
        await executeOCTCommand('join', session_link);
      } catch (cmdErr: any) {
        console.warn('[TeamSync Companion] Failed to join with full link, trying room ID extraction:', cmdErr.message);
        try {
          const roomId = session_link.split('/').pop() || session_link;
          await executeOCTCommand('join', roomId);
        } catch (innerErr: any) {
          console.warn('[TeamSync Companion] Failed to run real OCT join command:', innerErr.message);
          
          if (octActive) {
            throw new Error(`Real Eclipse OCT session join failed: ${innerErr.message}`);
          }

          if (context.extensionMode === vscode.ExtensionMode.Development || context.extensionMode === vscode.ExtensionMode.Test) {
            vscode.window.showWarningMessage(`TeamSync (Dev Mode Fallback): Real OCT join command failed. Mocking join successfully.`);
          } else {
            throw new Error('Eclipse OCT extension is not installed or not active. Please install the Open Collaboration Tools extension to join sessions.');
          }
        }
      }

      currentRepo = repo;
      currentBranch = branch;
      currentSessionLink = session_link;

      // Update VS Code Status Bar
      if (activeStatusBarItem) {
        activeStatusBarItem.hide();
        activeStatusBarItem.dispose();
      }
      activeStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
      activeStatusBarItem.text = `$(broadcast) Active Room: ${branch}`;
      activeStatusBarItem.tooltip = `Joined TeamSync Session at ${session_link}`;
      activeStatusBarItem.show();
      context.subscriptions.push(activeStatusBarItem);

      vscode.window.showInformationMessage(`TeamSync: Successfully joined session: ${session_link}`);

      res.json({
        success: true,
        link: session_link,
        message: 'OCT session successfully joined.'
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`TeamSync: Failed to join session: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /leave-session
  app.post('/leave-session', async (req: express.Request, res: express.Response) => {
    try {
      vscode.window.showInformationMessage(`TeamSync: Leaving collaboration session...`);

      try {
        await executeOCTCommand('leave');
      } catch (cmdErr: any) {
        console.warn('[TeamSync Companion] Failed to run real OCT leave command:', cmdErr.message);
      }

      currentRepo = '';
      currentBranch = '';
      currentSessionLink = '';

      if (activeStatusBarItem) {
        activeStatusBarItem.hide();
        activeStatusBarItem.dispose();
        activeStatusBarItem = null;
      }

      res.json({
        success: true,
        message: 'OCT session successfully left.'
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`TeamSync: Failed to leave session: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /clone-repo
  app.post('/clone-repo', async (req: express.Request, res: express.Response) => {
    const { repo, branch, stash } = req.body;

    if (!repo || !branch) {
      res.status(400).json({ error: 'Repository name and branch name are required.' });
      return;
    }

    try {
      // 1. Check Git binary presence
      await new Promise<void>((resolve, reject) => {
        exec('git --version', (error) => {
          if (error) {
            reject(new Error('Git is not installed or not in system PATH.'));
          } else {
            resolve();
          }
        });
      });

      // 2. Resolve target root directory automatically without prompting if inside workspace parent
      const stateKey = `repo-path:${repo}`;
      let baseDir = context.globalState.get<string>(stateKey);

      if (!baseDir) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          const rootPath = workspaceFolders[0].uri.fsPath;
          const parentPath = path.dirname(rootPath);
          if (fs.existsSync(parentPath)) {
            baseDir = parentPath;
            await context.globalState.update(stateKey, baseDir);
          }
        }
      }

      if (!baseDir) {
        const parentPath = path.resolve(__dirname, '../../../');
        if (fs.existsSync(parentPath) && fs.existsSync(path.join(parentPath, 'TeamDash'))) {
          baseDir = parentPath;
          await context.globalState.update(stateKey, baseDir);
        } else {
          const options: vscode.OpenDialogOptions = {
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select Clone Location'
          };
          const folderUri = await vscode.window.showOpenDialog(options);
          if (!folderUri || folderUri.length === 0) {
            res.status(400).json({ error: 'Clone operation cancelled by user: No directory selected.' });
            return;
          }
          baseDir = folderUri[0].fsPath;
          await context.globalState.update(stateKey, baseDir);
        }
      }

      const repoBasename = repo.split('/').pop() || repo;
      let targetDir = path.join(baseDir, repoBasename);

      // Map 'TeamSync' to local 'TeamDash' folder if it exists or is the active workspace
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (repoBasename === 'TeamSync') {
        const activeDashFolder = workspaceFolders?.find(f => 
          path.basename(f.uri.fsPath) === 'TeamDash' || path.basename(f.uri.fsPath) === 'TeamSync'
        );
        if (activeDashFolder) {
          targetDir = activeDashFolder.uri.fsPath;
        } else {
          const altDir = path.join(baseDir, 'TeamDash');
          if (fs.existsSync(altDir)) {
            targetDir = altDir;
          }
        }
      }

      let actionTaken = '';

      if (!fs.existsSync(targetDir)) {
        vscode.window.showInformationMessage(`TeamSync: Cloning ${repo} into ${baseDir}...`);
        actionTaken = 'cloned';
        const cloneUrl = `https://github.com/${repo}.git`;
        await runCmd(`git clone ${cloneUrl}`, baseDir);
        await gitCheckoutAndSync(targetDir, branch);
      } else {
        if (!fs.existsSync(path.join(targetDir, '.git'))) {
          await context.globalState.update(stateKey, undefined);
          throw new Error(`Directory ${targetDir} exists but is not a Git repository. Target directory setting reset.`);
        }

        // Get currently checked out branch
        let currentBranchName = '';
        try {
          const branchOut = await runCmd('git rev-parse --abbrev-ref HEAD', targetDir);
          currentBranchName = branchOut.stdout.trim();
        } catch (e) {}

        let isClean = true;
        try {
          const statusOut = await runCmd('git status --porcelain', targetDir);
          isClean = statusOut.stdout.trim() === '';
        } catch (e) {}

        if (currentBranchName === branch && isClean) {
          // Already on correct branch and clean, just open it!
          actionTaken = 'opened';
          vscode.window.showInformationMessage(`TeamSync: Opening existing workspace at ${targetDir}...`);
        } else {
          vscode.window.showInformationMessage(`TeamSync: Updating local repository at ${targetDir}...`);
          actionTaken = 'updated';

          await runCmd(`git fetch origin`, targetDir);

          // Handle stashing if requested and dirty
          if (!isClean && stash === true) {
            vscode.window.showInformationMessage(`TeamSync: Stashing uncommitted changes in ${repoBasename}...`);
            await runCmd('git stash', targetDir);
          }

          await gitCheckoutAndSync(targetDir, branch);
          try {
            await runCmd(`git pull origin ${branch}`, targetDir);
          } catch (pullErr: any) {
            console.warn('[TeamSync Companion] git pull failed:', pullErr.message);
            throw new Error(`Git pull failed: ${pullErr.message}`);
          }
          try {
            await runCmd(`git push origin ${branch}`, targetDir);
          } catch (pushErr: any) {
            console.warn('[TeamSync Companion] git push failed:', pushErr.message);
            throw new Error(`Git push failed: ${pushErr.message}`);
          }
        }
      }

      currentRepo = repo;
      currentBranch = branch;

      // Automatically open the folder in VS Code
      const uri = vscode.Uri.file(targetDir);
      await vscode.commands.executeCommand('vscode.openFolder', uri, {
        forceNewWindow: true
      });

      vscode.window.showInformationMessage(
        `TeamSync: Successfully opened ${repoBasename} (${branch}) locally!`
      );

      // Automatically launch TeamSync browser application
      vscode.env.openExternal(vscode.Uri.parse('http://localhost:5173/'));

      res.json({
        success: true,
        path: targetDir,
        message: `Repository successfully ${actionTaken}.`
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`TeamSync: Failed to clone/update repository: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /pull-repo
  app.post('/pull-repo', async (req: express.Request, res: express.Response) => {
    const { repo, branch } = req.body;

    if (!repo || !branch) {
      res.status(400).json({ error: 'Repository name and branch name are required.' });
      return;
    }

    try {
      const stateKey = `repo-path:${repo}`;
      let baseDir = context.globalState.get<string>(stateKey);

      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!baseDir && workspaceFolders && workspaceFolders.length > 0) {
        baseDir = path.dirname(workspaceFolders[0].uri.fsPath);
      }
      if (!baseDir) {
        baseDir = path.resolve(__dirname, '../../../');
      }

      const repoBasename = repo.split('/').pop() || repo;
      let targetDir = path.join(baseDir, repoBasename);

      if (repoBasename === 'TeamSync' && workspaceFolders) {
        const activeDashFolder = workspaceFolders.find(f => 
          path.basename(f.uri.fsPath) === 'TeamDash' || path.basename(f.uri.fsPath) === 'TeamSync'
        );
        if (activeDashFolder) {
          targetDir = activeDashFolder.uri.fsPath;
        }
      }

      if (!fs.existsSync(targetDir)) {
        res.status(404).json({ error: `Repository directory not found at ${targetDir}.` });
        return;
      }

      vscode.window.showInformationMessage(`TeamSync: Pulling changes for origin/${branch}...`);
      await runCmd(`git fetch origin`, targetDir);
      await gitCheckoutAndSync(targetDir, branch);
      await runCmd(`git pull origin ${branch}`, targetDir);

      res.json({
        success: true,
        message: `Successfully pulled changes from origin/${branch}.`
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`TeamSync: Pull failed: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /push-repo
  app.post('/push-repo', async (req: express.Request, res: express.Response) => {
    const { repo, branch } = req.body;

    if (!repo || !branch) {
      res.status(400).json({ error: 'Repository name and branch name are required.' });
      return;
    }

    try {
      const stateKey = `repo-path:${repo}`;
      let baseDir = context.globalState.get<string>(stateKey);

      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!baseDir && workspaceFolders && workspaceFolders.length > 0) {
        baseDir = path.dirname(workspaceFolders[0].uri.fsPath);
      }
      if (!baseDir) {
        baseDir = path.resolve(__dirname, '../../../');
      }

      const repoBasename = repo.split('/').pop() || repo;
      let targetDir = path.join(baseDir, repoBasename);

      if (repoBasename === 'TeamSync' && workspaceFolders) {
        const activeDashFolder = workspaceFolders.find(f => 
          path.basename(f.uri.fsPath) === 'TeamDash' || path.basename(f.uri.fsPath) === 'TeamSync'
        );
        if (activeDashFolder) {
          targetDir = activeDashFolder.uri.fsPath;
        }
      }

      if (!fs.existsSync(targetDir)) {
        res.status(404).json({ error: `Repository directory not found at ${targetDir}.` });
        return;
      }

      vscode.window.showInformationMessage(`TeamSync: Pushing local commits to origin/${branch}...`);
      await gitCheckoutAndSync(targetDir, branch);
      await runCmd(`git push origin ${branch}`, targetDir);

      res.json({
        success: true,
        message: `Successfully pushed commits to origin/${branch}.`
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`TeamSync: Push failed: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /merge
  app.post('/merge', async (req: express.Request, res: express.Response) => {
    const { repo, sourceBranch, targetBranch } = req.body;

    if (!repo || !sourceBranch || !targetBranch) {
      res.status(400).json({ error: 'Repository name, source branch, and target branch are required.' });
      return;
    }

    try {
      // 1. Resolve repository folder path
      const stateKey = `repo-path:${repo}`;
      let baseDir = context.globalState.get<string>(stateKey);

      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!baseDir && workspaceFolders && workspaceFolders.length > 0) {
        baseDir = path.dirname(workspaceFolders[0].uri.fsPath);
      }
      if (!baseDir) {
        baseDir = path.resolve(__dirname, '../../../');
      }

      const repoBasename = repo.split('/').pop() || repo;
      let targetDir = path.join(baseDir, repoBasename);

      // Map 'TeamSync' to local 'TeamDash' folder if it exists or is the active workspace
      if (repoBasename === 'TeamSync' && workspaceFolders) {
        const activeDashFolder = workspaceFolders.find(f => 
          path.basename(f.uri.fsPath) === 'TeamDash' || path.basename(f.uri.fsPath) === 'TeamSync'
        );
        if (activeDashFolder) {
          targetDir = activeDashFolder.uri.fsPath;
        }
      }

      if (!fs.existsSync(targetDir)) {
        res.status(404).json({ error: `Repository directory not found at ${targetDir}.` });
        return;
      }

      // 2. Fetch latest changes first to make sure branches are up to date
      try {
        await runCmd('git fetch origin', targetDir);
      } catch (fetchErr) {
        console.warn('[TeamSync Companion] fetch failed before merge:', fetchErr);
      }

      // 3. Checkout and pull target branch, and pull source branch if possible
      await gitCheckoutAndSync(targetDir, targetBranch);
      try {
        await runCmd(`git pull origin ${targetBranch}`, targetDir);
      } catch (pullErr: any) {
        console.warn(`[TeamSync Companion] Pull failed for target ${targetBranch}:`, pullErr.message);
      }

      try {
        // Pull source branch updates to ensure we merge the latest code
        await runCmd(`git checkout ${sourceBranch}`, targetDir);
        await runCmd(`git pull origin ${sourceBranch}`, targetDir);
        await runCmd(`git checkout ${targetBranch}`, targetDir);
      } catch (srcPullErr: any) {
        console.warn(`[TeamSync Companion] Pull failed for source ${sourceBranch}:`, srcPullErr.message);
        // Fall back to switching back to target branch
        await gitCheckoutAndSync(targetDir, targetBranch);
      }

      // 4. Perform local merge
      try {
        await runCmd(`git merge ${sourceBranch}`, targetDir);
        
        // 4.5. Push the merge commit to remote and verify success
        vscode.window.showInformationMessage(`TeamSync: Pushing merge commit to origin/${targetBranch}...`);
        await runCmd(`git push origin ${targetBranch}`, targetDir);
        
        // Post event to backend
        try {
          await sendPostRequest(`${teamSyncServerUrl}/api/events`, {
            event_type: 'git:merge_success',
            event_category: 'project',
            repo_name: repo,
            branch_name: targetBranch,
            user_id: currentUserId,
            metadata: { source_branch: sourceBranch, target_branch: targetBranch }
          });
        } catch (evtErr) {}

        res.json({
          success: true,
          message: `Successfully merged ${sourceBranch} into ${targetBranch} and pushed to GitHub.`
        });
      } catch (mergeErr: any) {
        // Check for merge conflicts using git diff
        const diffRes = await runCmd('git diff --name-only --diff-filter=U', targetDir).catch(() => ({ stdout: '' }));
        const conflictedFiles = diffRes.stdout.split('\n').map(x => x.trim()).filter(Boolean);

        if (conflictedFiles.length > 0) {
          // Post conflict event to backend
          try {
            await sendPostRequest(`${teamSyncServerUrl}/api/events`, {
              event_type: 'git:conflict',
              event_category: 'developer',
              repo_name: repo,
              branch_name: targetBranch,
              user_id: currentUserId,
              metadata: { conflicted_files: conflictedFiles, target_branch: targetBranch, source_branch: sourceBranch }
            });

            // Also update user presence with conflict list
            await sendPostRequest(`${teamSyncServerUrl}/api/presence/heartbeat`, {
              user_id: currentUserId,
              repo_name: repo,
              branch_name: targetBranch,
              conflicted_files: conflictedFiles,
              last_activity: 'resolving_conflict'
            });
          } catch (evtErr) {}

          res.json({
            success: false,
            conflicts: true,
            conflictedFiles,
            message: `Merge conflict occurred. Please resolve in Antigravity.`
          });
        } else {
          // Other merge failure
          res.status(500).json({ error: mergeErr.message });
        }
      }

    } catch (err: any) {
      vscode.window.showErrorMessage(`TeamSync: Merge failed: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /git-commit - Stage and commit files
  app.post('/git-commit', async (req: express.Request, res: express.Response) => {
    const { repo, message, files } = req.body;
    let log = '';

    if (!repo || !message || !files || !Array.isArray(files) || files.length === 0) {
      res.status(400).json({ error: 'Repository name, commit message, and non-empty files array are required.' });
      return;
    }

    try {
      // 1. Resolve repository folder path
      const stateKey = `repo-path:${repo}`;
      let baseDir = context.globalState.get<string>(stateKey);

      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!baseDir && workspaceFolders && workspaceFolders.length > 0) {
        baseDir = path.dirname(workspaceFolders[0].uri.fsPath);
      }
      if (!baseDir) {
        baseDir = path.resolve(__dirname, '../../../');
      }

      const repoBasename = repo.split('/').pop() || repo;
      let targetDir = path.join(baseDir, repoBasename);

      // Map 'TeamSync' to local 'TeamDash' folder if it exists or is the active workspace
      if (repoBasename === 'TeamSync' && workspaceFolders) {
        const activeDashFolder = workspaceFolders.find(f => 
          path.basename(f.uri.fsPath) === 'TeamDash' || path.basename(f.uri.fsPath) === 'TeamSync'
        );
        if (activeDashFolder) {
          targetDir = activeDashFolder.uri.fsPath;
        }
      }

      if (!fs.existsSync(targetDir)) {
        res.status(404).json({ error: `Repository directory not found at ${targetDir}.` });
        return;
      }

      const runLogCmd = async (cmd: string) => {
        log += `> ${cmd}\n`;
        const resOut = await runCmd(cmd, targetDir);
        if (resOut.stdout) log += `${resOut.stdout}\n`;
        if (resOut.stderr) log += `${resOut.stderr}\n`;
        return resOut;
      };

      // 2. Stage the specified files
      for (const file of files) {
        await runLogCmd(`git add "${file}"`);
      }

      // 3. Commit the staged changes
      const safeMessage = message.replace(/"/g, '\\"');
      await runLogCmd(`git commit -m "${safeMessage}"`);

      res.json({
        success: true,
        log,
        message: 'Successfully committed files to the local repository.'
      });

    } catch (err: any) {
      vscode.window.showErrorMessage(`TeamSync: Commit failed: ${err.message}`);
      res.status(500).json({ error: err.message, log });
    }
  });

  // GET /diff - Compare local working directory against a target branch or HEAD
  app.get('/diff', async (req: express.Request, res: express.Response) => {
    const { repo, branch } = req.query;

    if (!repo) {
      res.status(400).json({ error: 'Repository name is required.' });
      return;
    }

    try {
      const stateKey = `repo-path:${repo}`;
      let baseDir = context.globalState.get<string>(stateKey);

      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!baseDir && workspaceFolders && workspaceFolders.length > 0) {
        baseDir = path.dirname(workspaceFolders[0].uri.fsPath);
      }
      if (!baseDir) {
        baseDir = path.resolve(__dirname, '../../../');
      }

      const repoBasename = (repo as string).split('/').pop() || (repo as string);
      let targetDir = path.join(baseDir, repoBasename);

      if (repoBasename === 'TeamSync' && workspaceFolders) {
        const activeDashFolder = workspaceFolders.find(f => 
          path.basename(f.uri.fsPath) === 'TeamDash' || path.basename(f.uri.fsPath) === 'TeamSync'
        );
        if (activeDashFolder) {
          targetDir = activeDashFolder.uri.fsPath;
        }
      }

      if (!fs.existsSync(targetDir)) {
        res.status(404).json({ error: `Repository directory not found at ${targetDir}.` });
        return;
      }

      const compareTarget = branch ? (branch as string) : '';
      let diffOutput = '';
      try {
        if (compareTarget) {
          diffOutput = await new Promise<string>((resolve, reject) => {
            exec(`git diff ${compareTarget}`, { cwd: targetDir }, (err, stdout, stderr) => {
              if (err) reject(new Error(stderr || err.message));
              else resolve(stdout.trim());
            });
          });
        } else {
          const unstaged = await new Promise<string>((resolve, reject) => {
            exec('git diff', { cwd: targetDir }, (err, stdout, stderr) => {
              if (err) reject(new Error(stderr || err.message));
              else resolve(stdout.trim());
            });
          });
          const staged = await new Promise<string>((resolve, reject) => {
            exec('git diff --cached', { cwd: targetDir }, (err, stdout, stderr) => {
              if (err) reject(new Error(stderr || err.message));
              else resolve(stdout.trim());
            });
          });
          diffOutput = (unstaged + '\n' + staged).trim();
        }
        res.json({
          success: true,
          diff: diffOutput,
          compareTarget: compareTarget || 'Working Tree'
        });
      } catch (gitErr: any) {
        console.warn('[TeamSync Companion] git diff failed:', gitErr.message);
        res.status(500).json({ error: `Git diff failed: ${gitErr.message}` });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /open-file
  app.post('/open-file', async (req: express.Request, res: express.Response) => {
    const { repo, filePath } = req.body;

    if (!repo || !filePath) {
      res.status(400).json({ error: 'Repository name and file path are required.' });
      return;
    }

    try {
      const stateKey = `repo-path:${repo}`;
      let baseDir = context.globalState.get<string>(stateKey);

      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!baseDir && workspaceFolders && workspaceFolders.length > 0) {
        baseDir = path.dirname(workspaceFolders[0].uri.fsPath);
      }
      if (!baseDir) {
        baseDir = path.resolve(__dirname, '../../../');
      }

      const repoBasename = repo.split('/').pop() || repo;
      let targetDir = path.join(baseDir, repoBasename);

      if (repoBasename === 'TeamSync' && workspaceFolders) {
        const activeDashFolder = workspaceFolders.find(f => 
          path.basename(f.uri.fsPath) === 'TeamDash' || path.basename(f.uri.fsPath) === 'TeamSync'
        );
        if (activeDashFolder) {
          targetDir = activeDashFolder.uri.fsPath;
        }
      }

      const fullPath = path.resolve(targetDir, filePath);
      if (!fs.existsSync(fullPath)) {
        res.status(404).json({ error: `File not found at ${fullPath}` });
        return;
      }

      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
      await vscode.window.showTextDocument(doc);

      res.json({ success: true, message: `Opened file ${filePath} in Antigravity.` });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Start Companion Server
  try {
    serverInstance = app.listen(PORT, () => {
      console.log(`[TeamSync Companion] Local HTTP server listening on http://localhost:${PORT}`);
    });
  } catch (err: any) {
    console.error('Failed to start companion server:', err.message);
  }

  // Background Telemetry Heartbeat Loop
  async function sendHeartbeat() {
    try {
      let activeFile = '';
      let stagedFiles: string[] = [];
      let modifiedFiles: string[] = [];
      let conflictedFiles: string[] = [];
      let detectedBranch = '';
      let detectedRepo = '';

      // 1. Detect Workspace and Active Editor File
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders && workspaceFolders.length > 0) {
        const rootPath = workspaceFolders[0].uri.fsPath;
        detectedRepo = path.basename(rootPath);

        // Detect current file relative to workspace
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && activeEditor.document.uri.scheme === 'file') {
          activeFile = path.relative(rootPath, activeEditor.document.uri.fsPath).replace(/\\/g, '/');
        }

        // 2. Scan Git Status
        detectedBranch = await queryGit('branch --show-current', rootPath);

        // Retrieve conflicts using VS Code Git API if available
        if (gitAPI) {
          const activeRepo = gitAPI.repositories.find((r: any) => r.rootUri.fsPath.toLowerCase() === rootPath.toLowerCase());
          if (activeRepo && activeRepo.state.mergeConflicts) {
            conflictedFiles = activeRepo.state.mergeConflicts.map((c: any) => 
              path.relative(rootPath, c.uri.fsPath).replace(/\\/g, '/')
            );
          }
        }

        const gitStatusOutput = await queryGit('status -s', rootPath);
        if (gitStatusOutput) {
          const lines = gitStatusOutput.split('\n');
          for (const line of lines) {
            if (line.length < 3) continue;
            const code = line.substring(0, 2);
            const filePath = line.substring(3).trim();
            if (code === 'DD' || code === 'AA' || code.includes('U')) {
              if (!conflictedFiles.includes(filePath)) {
                conflictedFiles.push(filePath);
              }
            } else if (code.startsWith('M') || code.startsWith('A') || code.startsWith('D')) {
              stagedFiles.push(filePath);
            } else if (code.trim() !== '') {
              modifiedFiles.push(filePath);
            }
          }
        }
      }

      // Fallbacks
      const repoName = currentRepo || detectedRepo || 'TeamSync';
      const branchName = currentBranch || detectedBranch || 'main';

      // Parse ticket from branch name
      const ticketRegex = /(TS-\d+|[a-zA-Z]+-\d+)/i;
      const match = branchName.match(ticketRegex);
      const currentTicket = match ? match[1].toUpperCase() : null;

      const heartbeatPayload = {
        user_id: currentUserId,
        repo_name: repoName,
        branch_name: branchName,
        session_link: currentSessionLink || '',
        active_file: activeFile || null,
        staged_files: stagedFiles,
        modified_files: modifiedFiles,
        conflicted_files: conflictedFiles,
        current_ticket: currentTicket,
        last_activity: activeFile ? 'editing' : 'idle'
      };

      await sendPostRequest(`${teamSyncServerUrl}/api/presence/heartbeat`, heartbeatPayload);
    } catch (err: any) {
      console.warn('[TeamSync Companion] Heartbeat send failed:', err.message);
    }
  }

  // Run heartbeat immediately on startup and every 5 seconds
  sendHeartbeat();
  telemetryTimer = setInterval(sendHeartbeat, 5000);

  // Register manual status check command
  const disposable = vscode.commands.registerCommand('teamsync.checkStatus', () => {
    vscode.window.showInformationMessage('TeamSync Companion Server is active on port 37845.');
    sendHeartbeat();
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {
  if (serverInstance) {
    serverInstance.close(() => {
      console.log('[TeamSync Companion] Local HTTP server closed.');
    });
  }
  if (telemetryTimer) {
    clearInterval(telemetryTimer);
  }
}
