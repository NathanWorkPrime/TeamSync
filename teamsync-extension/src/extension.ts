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

  const app = express();
  const PORT = 37845;

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || /^http:\/\/localhost(:\d+)?$/.test(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Blocked by CORS policy'));
      }
    }
  }));

  app.use(express.json());

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
        sessionLink = await executeOCTCommand('share');
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
        console.warn('[TeamSync Companion] Failed to run real OCT join command:', cmdErr.message);
        
        if (octActive) {
          throw new Error(`Real Eclipse OCT session join failed: ${cmdErr.message}`);
        }

        if (context.extensionMode === vscode.ExtensionMode.Development || context.extensionMode === vscode.ExtensionMode.Test) {
          vscode.window.showWarningMessage(`TeamSync (Dev Mode Fallback): Real OCT join command failed. Mocking join successfully.`);
        } else {
          throw new Error('Eclipse OCT extension is not installed or not active. Please install the Open Collaboration Tools extension to join sessions.');
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
    const { repo, branch } = req.body;

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

      // Map 'TeamSync' to local 'TeamDash' folder if it exists
      if (repoBasename === 'TeamSync' && !fs.existsSync(targetDir)) {
        const altDir = path.join(baseDir, 'TeamDash');
        if (fs.existsSync(altDir)) {
          targetDir = altDir;
        }
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

        vscode.window.showInformationMessage(`TeamSync: Updating local repository at ${targetDir}...`);
        actionTaken = 'updated';

        await runCmd(`git fetch origin`, targetDir);
        await gitCheckoutAndSync(targetDir, branch);
        try {
          await runCmd(`git pull origin ${branch}`, targetDir);
        } catch (pullErr: any) {
          console.warn('[TeamSync Companion] git pull failed:', pullErr.message);
        }
      }

      currentRepo = repo;
      currentBranch = branch;

      vscode.window.showInformationMessage(
        `TeamSync: Successfully ${actionTaken} ${repoBasename} (${branch})!`,
        'Open in Antigravity'
      ).then(async (selection) => {
        if (selection === 'Open in Antigravity') {
          const uri = vscode.Uri.file(targetDir);
          await vscode.commands.executeCommand('vscode.openFolder', uri, {
            forceNewWindow: true
          });
        }
      });

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

  // Start Companion Server
  try {
    serverInstance = app.listen(PORT, () => {
      console.log(`[TeamSync Companion] Local HTTP server listening on http://localhost:${PORT}`);
    });
  } catch (err: any) {
    console.error('Failed to start companion server:', err.message);
  }

  // Background Telemetry Heartbeat Loop
  const sendHeartbeat = async () => {
    try {
      let activeFile = '';
      let stagedFiles: string[] = [];
      let modifiedFiles: string[] = [];
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
        const gitStatusOutput = await queryGit('status -s', rootPath);

        if (gitStatusOutput) {
          const lines = gitStatusOutput.split('\n');
          for (const line of lines) {
            const code = line.substring(0, 2);
            const filePath = line.substring(3).trim();
            if (code.startsWith('M') || code.startsWith('A') || code.startsWith('D')) {
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
        current_ticket: currentTicket,
        last_activity: activeFile ? 'editing' : 'idle'
      };

      await sendPostRequest(`${teamSyncServerUrl}/api/presence/heartbeat`, heartbeatPayload);
    } catch (err: any) {
      console.warn('[TeamSync Companion] Heartbeat send failed:', err.message);
    }
  };

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
