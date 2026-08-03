"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const http = __importStar(require("http"));
let serverInstance = null;
let telemetryTimer = null;
let gitAPI = null;
// Telemetry configuration states
let currentUserId = 1; // Default
let currentUsername = 'You';
let teamSyncServerUrl = 'http://localhost:5000';
let currentRepo = '';
let currentBranch = '';
let currentSessionLink = '';
let activeStatusBarItem = null;
// Helper to make HTTP POST requests with zero dependencies
function sendPostRequest(urlStr, body) {
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
                res.on('data', () => { });
                res.on('end', () => resolve());
            });
            req.on('error', (err) => reject(err));
            req.write(postData);
            req.end();
        }
        catch (err) {
            reject(err);
        }
    });
}
// Git query helper
function queryGit(cmd, cwd) {
    return new Promise((resolve) => {
        (0, child_process_1.exec)(cmd, { cwd }, (err, stdout) => {
            resolve(err ? '' : stdout.trim());
        });
    });
}
function activate(context) {
    console.log('TeamSync Companion Extension is now active!');
    const updateServerUrl = () => {
        const configUrl = vscode.workspace.getConfiguration('teamsync').get('serverUrl');
        if (configUrl) {
            teamSyncServerUrl = configUrl.trim();
        }
    };
    updateServerUrl();
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('teamsync.serverUrl')) {
            updateServerUrl();
        }
    }));
    // Initialize Git extension API integration
    try {
        const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
        gitAPI = gitExtension?.getAPI(1);
        console.log('[TeamSync Companion] Git Extension API successfully loaded');
    }
    catch (err) {
        console.warn('[TeamSync Companion] Failed to initialize Git extension API:', err.message);
    }
    const runCmd = (cmd, cwd) => {
        return new Promise((resolve, reject) => {
            (0, child_process_1.exec)(cmd, { cwd }, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(stderr || error.message));
                }
                else {
                    resolve({ stdout, stderr });
                }
            });
        });
    };
    const gitCheckoutAndSync = async (dir, targetBranch) => {
        try {
            await runCmd(`git checkout ${targetBranch}`, dir);
        }
        catch (checkoutErr) {
            try {
                await runCmd(`git checkout -b ${targetBranch}`, dir);
            }
            catch (createErr) {
                throw new Error(`Failed to checkout or create branch ${targetBranch}: ${createErr.message}`);
            }
        }
    };
    const monitoredRepos = new Set();
    const monitorRepository = (repo) => {
        const rootPath = repo.rootUri.fsPath;
        if (monitoredRepos.has(rootPath))
            return;
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
                }
                catch (err) {
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
                }
                catch (err) {
                    console.warn('[TeamSync Companion] Failed to query or post commit event:', err.message);
                }
            }
            // 3. Detect Merge Conflicts
            if (currentConflictsCount !== lastConflictsCount) {
                lastConflictsCount = currentConflictsCount;
                // Trigger immediate heartbeat to update presence
                sendHeartbeat();
                if (currentConflictsCount > 0) {
                    const filesList = currentConflicts.map((c) => path.basename(c.uri.fsPath)).join(', ');
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
                                conflicted_files: currentConflicts.map((c) => path.relative(rootPath, c.uri.fsPath).replace(/\\/g, '/'))
                            }
                        });
                    }
                    catch (err) {
                        console.warn('[TeamSync Companion] Failed to post conflict event:', err.message);
                    }
                }
            }
        };
        const sub = repo.state.onDidChange(handleGitStateChange);
        context.subscriptions.push(sub);
    };
    if (gitAPI) {
        gitAPI.repositories.forEach((repo) => monitorRepository(repo));
        const openSub = gitAPI.onDidOpenRepository((repo) => {
            monitorRepository(repo);
        });
        context.subscriptions.push(openSub);
    }
    const app = (0, express_1.default)();
    const PORT = 37845;
    app.use((0, cors_1.default)({
        origin: (origin, callback) => {
            if (!origin || /^http:\/\/localhost(:\d+)?$/.test(origin) || origin === 'https://102.130.122.57:8080') {
                callback(null, true);
            }
            else {
                callback(new Error('Blocked by CORS policy'));
            }
        }
    }));
    app.use(express_1.default.json());
    // GET /detect-repo-status - Check local repository status
    app.get('/detect-repo-status', async (req, res) => {
        const repo = req.query.repo;
        const branch = req.query.branch;
        if (!repo) {
            res.status(400).json({ error: 'Repository name is required.' });
            return;
        }
        try {
            // Resolve path
            const stateKey = `repo-path:${repo}`;
            let baseDir = context.globalState.get(stateKey);
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
                const activeDashFolder = workspaceFolders?.find(f => path.basename(f.uri.fsPath) === 'TeamDash' || path.basename(f.uri.fsPath) === 'TeamSync');
                if (activeDashFolder) {
                    targetDir = activeDashFolder.uri.fsPath;
                }
                else {
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
            }
            catch (e) { }
            let isClean = true;
            try {
                const statusOut = await runCmd('git status --porcelain', targetDir);
                isClean = statusOut.stdout.trim() === '';
            }
            catch (e) { }
            res.json({
                exists: true,
                isGit: true,
                path: targetDir,
                currentBranch,
                isClean,
                hasUncommittedChanges: !isClean
            });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // GET /commands - Inspect registered IDE commands
    app.get('/commands', async (req, res) => {
        try {
            const allCommands = await vscode.commands.getCommands(true);
            const filtered = allCommands.filter(c => c.includes('oct') || c.includes('collab') || c.includes('share') || c.includes('session') || c.includes('room'));
            res.json({ commands: filtered });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // GET /debug-state - Debug paths and workspace folders
    app.get('/debug-state', (req, res) => {
        const folders = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) || [];
        const stateKey = `repo-path:${currentRepo || 'TeamSync'}`;
        const cachedBaseDir = context.globalState.get(stateKey) || null;
        res.json({
            folders,
            currentRepo,
            currentBranch,
            cachedBaseDir,
            stateKey
        });
    });
    // POST /configure - Configure extension details from browser UI
    app.post('/configure', (req, res) => {
        const { user_id, username, repo, branch, session_link, server_url } = req.body;
        if (user_id)
            currentUserId = parseInt(user_id, 10);
        if (username)
            currentUsername = username;
        if (repo)
            currentRepo = repo;
        if (branch)
            currentBranch = branch;
        if (session_link)
            currentSessionLink = session_link;
        if (server_url)
            teamSyncServerUrl = server_url;
        console.log(`[TeamSync Companion] Configured: user_id=${currentUserId}, repo=${currentRepo}, branch=${currentBranch}`);
        res.json({ success: true, message: 'Extension successfully configured' });
    });
    // Dynamic command finder and executor for Eclipse OCT VS Code extension
    async function executeOCTCommand(action, param) {
        const allCommands = await vscode.commands.getCommands(true);
        let targetCommand = '';
        if (action === 'share') {
            targetCommand = allCommands.includes('oct.createRoom') ? 'oct.createRoom' : (allCommands.find(c => c === 'oct.share' ||
                c === 'oct.startSession' ||
                (c.startsWith('oct.') && (c.includes('share') || c.includes('create') || c.includes('start')))) || '');
        }
        else if (action === 'join') {
            targetCommand = allCommands.includes('oct.joinRoom') ? 'oct.joinRoom' : (allCommands.find(c => c === 'oct.join' ||
                c === 'oct.joinSession' ||
                (c.startsWith('oct.') && (c.includes('join') || c.includes('connect')))) || '');
        }
        else if (action === 'leave') {
            targetCommand = allCommands.includes('oct.leaveRoom') ? 'oct.leaveRoom' : (allCommands.find(c => c === 'oct.leave' ||
                c === 'oct.disconnect' ||
                c === 'oct.endSession' ||
                (c.startsWith('oct.') && (c.includes('leave') || c.includes('disconnect') || c.includes('end') || c.includes('close')))) || '');
        }
        if (!targetCommand) {
            throw new Error(`Could not find appropriate Eclipse OCT command for action: ${action}. Make sure the Open Collaboration Tools extension is installed.`);
        }
        console.log(`[TeamSync Companion] Executing OCT command: ${targetCommand} with param:`, param);
        const result = await vscode.commands.executeCommand(targetCommand, param);
        return result || '';
    }
    // Check if the real Eclipse OCT extension is installed
    async function isRealOCTActive() {
        const allCommands = await vscode.commands.getCommands(true);
        const hasRealOCTCommands = allCommands.some(c => c.startsWith('oct.') || c.startsWith('collaboration.'));
        const hasRealOCTExtension = vscode.extensions.all.some(ext => ext.id.toLowerCase().includes('open-collaboration-tools') ||
            ext.id.toLowerCase().includes('eclipse-oct'));
        return hasRealOCTCommands || hasRealOCTExtension;
    }
    // POST /start-session
    app.post('/start-session', async (req, res) => {
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
                            }
                            else if (/^[a-zA-Z0-9_-]{20,30}$/.test(clipboardText)) {
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
                    }
                    else {
                        throw new Error('Failed to capture Eclipse OCT session link from clipboard.');
                    }
                }
            }
            catch (cmdErr) {
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
                }
                else {
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
        }
        catch (err) {
            vscode.window.showErrorMessage(`TeamSync: Failed to start session: ${err.message}`);
            res.status(500).json({ error: err.message });
        }
    });
    // POST /join-session
    app.post('/join-session', async (req, res) => {
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
            }
            catch (cmdErr) {
                console.warn('[TeamSync Companion] Failed to join with full link, trying room ID extraction:', cmdErr.message);
                try {
                    const roomId = session_link.split('/').pop() || session_link;
                    await executeOCTCommand('join', roomId);
                }
                catch (innerErr) {
                    console.warn('[TeamSync Companion] Failed to run real OCT join command:', innerErr.message);
                    if (octActive) {
                        throw new Error(`Real Eclipse OCT session join failed: ${innerErr.message}`);
                    }
                    if (context.extensionMode === vscode.ExtensionMode.Development || context.extensionMode === vscode.ExtensionMode.Test) {
                        vscode.window.showWarningMessage(`TeamSync (Dev Mode Fallback): Real OCT join command failed. Mocking join successfully.`);
                    }
                    else {
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
        }
        catch (err) {
            vscode.window.showErrorMessage(`TeamSync: Failed to join session: ${err.message}`);
            res.status(500).json({ error: err.message });
        }
    });
    // POST /leave-session
    app.post('/leave-session', async (req, res) => {
        try {
            vscode.window.showInformationMessage(`TeamSync: Leaving collaboration session...`);
            try {
                await executeOCTCommand('leave');
            }
            catch (cmdErr) {
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
        }
        catch (err) {
            vscode.window.showErrorMessage(`TeamSync: Failed to leave session: ${err.message}`);
            res.status(500).json({ error: err.message });
        }
    });
    // POST /clone-repo
    app.post('/clone-repo', async (req, res) => {
        const { repo, branch, stash } = req.body;
        if (!repo || !branch) {
            res.status(400).json({ error: 'Repository name and branch name are required.' });
            return;
        }
        try {
            // 1. Check Git binary presence
            await new Promise((resolve, reject) => {
                (0, child_process_1.exec)('git --version', (error) => {
                    if (error) {
                        reject(new Error('Git is not installed or not in system PATH.'));
                    }
                    else {
                        resolve();
                    }
                });
            });
            // 2. Resolve target root directory automatically without prompting if inside workspace parent
            const stateKey = `repo-path:${repo}`;
            let baseDir = context.globalState.get(stateKey);
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
                }
                else {
                    const options = {
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
                const activeDashFolder = workspaceFolders?.find(f => path.basename(f.uri.fsPath) === 'TeamDash' || path.basename(f.uri.fsPath) === 'TeamSync');
                if (activeDashFolder) {
                    targetDir = activeDashFolder.uri.fsPath;
                }
                else {
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
            }
            else {
                if (!fs.existsSync(path.join(targetDir, '.git'))) {
                    await context.globalState.update(stateKey, undefined);
                    throw new Error(`Directory ${targetDir} exists but is not a Git repository. Target directory setting reset.`);
                }
                // Get currently checked out branch
                let currentBranchName = '';
                try {
                    const branchOut = await runCmd('git rev-parse --abbrev-ref HEAD', targetDir);
                    currentBranchName = branchOut.stdout.trim();
                }
                catch (e) { }
                let isClean = true;
                try {
                    const statusOut = await runCmd('git status --porcelain', targetDir);
                    isClean = statusOut.stdout.trim() === '';
                }
                catch (e) { }
                if (currentBranchName === branch && isClean) {
                    // Already on correct branch and clean, just open it!
                    actionTaken = 'opened';
                    vscode.window.showInformationMessage(`TeamSync: Opening existing workspace at ${targetDir}...`);
                }
                else {
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
                    }
                    catch (pullErr) {
                        console.warn('[TeamSync Companion] git pull failed:', pullErr.message);
                        throw new Error(`Git pull failed: ${pullErr.message}`);
                    }
                    try {
                        await runCmd(`git push origin ${branch}`, targetDir);
                    }
                    catch (pushErr) {
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
            vscode.window.showInformationMessage(`TeamSync: Successfully opened ${repoBasename} (${branch}) locally!`);
            // Automatically launch TeamSync browser application
            vscode.env.openExternal(vscode.Uri.parse('http://localhost:5173/'));
            res.json({
                success: true,
                path: targetDir,
                message: `Repository successfully ${actionTaken}.`
            });
        }
        catch (err) {
            vscode.window.showErrorMessage(`TeamSync: Failed to clone/update repository: ${err.message}`);
            res.status(500).json({ error: err.message });
        }
    });
    // POST /pull-repo
    app.post('/pull-repo', async (req, res) => {
        const { repo, branch } = req.body;
        if (!repo || !branch) {
            res.status(400).json({ error: 'Repository name and branch name are required.' });
            return;
        }
        try {
            const stateKey = `repo-path:${repo}`;
            let baseDir = context.globalState.get(stateKey);
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
                const activeDashFolder = workspaceFolders.find(f => path.basename(f.uri.fsPath) === 'TeamDash' || path.basename(f.uri.fsPath) === 'TeamSync');
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
        }
        catch (err) {
            vscode.window.showErrorMessage(`TeamSync: Pull failed: ${err.message}`);
            res.status(500).json({ error: err.message });
        }
    });
    // POST /push-repo
    app.post('/push-repo', async (req, res) => {
        const { repo, branch } = req.body;
        if (!repo || !branch) {
            res.status(400).json({ error: 'Repository name and branch name are required.' });
            return;
        }
        try {
            const stateKey = `repo-path:${repo}`;
            let baseDir = context.globalState.get(stateKey);
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
                const activeDashFolder = workspaceFolders.find(f => path.basename(f.uri.fsPath) === 'TeamDash' || path.basename(f.uri.fsPath) === 'TeamSync');
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
        }
        catch (err) {
            vscode.window.showErrorMessage(`TeamSync: Push failed: ${err.message}`);
            res.status(500).json({ error: err.message });
        }
    });
    // POST /merge
    app.post('/merge', async (req, res) => {
        const { repo, sourceBranch, targetBranch } = req.body;
        if (!repo || !sourceBranch || !targetBranch) {
            res.status(400).json({ error: 'Repository name, source branch, and target branch are required.' });
            return;
        }
        try {
            // 1. Resolve repository folder path
            const stateKey = `repo-path:${repo}`;
            let baseDir = context.globalState.get(stateKey);
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
                const activeDashFolder = workspaceFolders.find(f => path.basename(f.uri.fsPath) === 'TeamDash' || path.basename(f.uri.fsPath) === 'TeamSync');
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
            }
            catch (fetchErr) {
                console.warn('[TeamSync Companion] fetch failed before merge:', fetchErr);
            }
            // 3. Checkout and pull target branch, and pull source branch if possible
            await gitCheckoutAndSync(targetDir, targetBranch);
            try {
                await runCmd(`git pull origin ${targetBranch}`, targetDir);
            }
            catch (pullErr) {
                console.warn(`[TeamSync Companion] Pull failed for target ${targetBranch}:`, pullErr.message);
            }
            try {
                // Pull source branch updates to ensure we merge the latest code
                await runCmd(`git checkout ${sourceBranch}`, targetDir);
                await runCmd(`git pull origin ${sourceBranch}`, targetDir);
                await runCmd(`git checkout ${targetBranch}`, targetDir);
            }
            catch (srcPullErr) {
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
                }
                catch (evtErr) { }
                res.json({
                    success: true,
                    message: `Successfully merged ${sourceBranch} into ${targetBranch} and pushed to GitHub.`
                });
            }
            catch (mergeErr) {
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
                    }
                    catch (evtErr) { }
                    res.json({
                        success: false,
                        conflicts: true,
                        conflictedFiles,
                        message: `Merge conflict occurred. Please resolve in Antigravity.`
                    });
                }
                else {
                    // Other merge failure
                    res.status(500).json({ error: mergeErr.message });
                }
            }
        }
        catch (err) {
            vscode.window.showErrorMessage(`TeamSync: Merge failed: ${err.message}`);
            res.status(500).json({ error: err.message });
        }
    });
    // GET /diff - Compare local working directory against a target branch or HEAD
    app.get('/diff', async (req, res) => {
        const { repo, branch } = req.query;
        if (!repo) {
            res.status(400).json({ error: 'Repository name is required.' });
            return;
        }
        try {
            const stateKey = `repo-path:${repo}`;
            let baseDir = context.globalState.get(stateKey);
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
                const activeDashFolder = workspaceFolders.find(f => path.basename(f.uri.fsPath) === 'TeamDash' || path.basename(f.uri.fsPath) === 'TeamSync');
                if (activeDashFolder) {
                    targetDir = activeDashFolder.uri.fsPath;
                }
            }
            if (!fs.existsSync(targetDir)) {
                res.status(404).json({ error: `Repository directory not found at ${targetDir}.` });
                return;
            }
            const compareTarget = branch ? branch : '';
            let diffOutput = '';
            try {
                if (compareTarget) {
                    diffOutput = await new Promise((resolve, reject) => {
                        (0, child_process_1.exec)(`git diff ${compareTarget}`, { cwd: targetDir }, (err, stdout, stderr) => {
                            if (err)
                                reject(new Error(stderr || err.message));
                            else
                                resolve(stdout.trim());
                        });
                    });
                }
                else {
                    const unstaged = await new Promise((resolve, reject) => {
                        (0, child_process_1.exec)('git diff', { cwd: targetDir }, (err, stdout, stderr) => {
                            if (err)
                                reject(new Error(stderr || err.message));
                            else
                                resolve(stdout.trim());
                        });
                    });
                    const staged = await new Promise((resolve, reject) => {
                        (0, child_process_1.exec)('git diff --cached', { cwd: targetDir }, (err, stdout, stderr) => {
                            if (err)
                                reject(new Error(stderr || err.message));
                            else
                                resolve(stdout.trim());
                        });
                    });
                    diffOutput = (unstaged + '\n' + staged).trim();
                }
                res.json({
                    success: true,
                    diff: diffOutput,
                    compareTarget: compareTarget || 'Working Tree'
                });
            }
            catch (gitErr) {
                console.warn('[TeamSync Companion] git diff failed:', gitErr.message);
                res.status(500).json({ error: `Git diff failed: ${gitErr.message}` });
            }
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // POST /open-file
    app.post('/open-file', async (req, res) => {
        const { repo, filePath } = req.body;
        if (!repo || !filePath) {
            res.status(400).json({ error: 'Repository name and file path are required.' });
            return;
        }
        try {
            const stateKey = `repo-path:${repo}`;
            let baseDir = context.globalState.get(stateKey);
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
                const activeDashFolder = workspaceFolders.find(f => path.basename(f.uri.fsPath) === 'TeamDash' || path.basename(f.uri.fsPath) === 'TeamSync');
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
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // Start Companion Server
    try {
        serverInstance = app.listen(PORT, () => {
            console.log(`[TeamSync Companion] Local HTTP server listening on http://localhost:${PORT}`);
        });
    }
    catch (err) {
        console.error('Failed to start companion server:', err.message);
    }
    // Background Telemetry Heartbeat Loop
    async function sendHeartbeat() {
        try {
            let activeFile = '';
            let stagedFiles = [];
            let modifiedFiles = [];
            let conflictedFiles = [];
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
                    const activeRepo = gitAPI.repositories.find((r) => r.rootUri.fsPath.toLowerCase() === rootPath.toLowerCase());
                    if (activeRepo && activeRepo.state.mergeConflicts) {
                        conflictedFiles = activeRepo.state.mergeConflicts.map((c) => path.relative(rootPath, c.uri.fsPath).replace(/\\/g, '/'));
                    }
                }
                const gitStatusOutput = await queryGit('status -s', rootPath);
                if (gitStatusOutput) {
                    const lines = gitStatusOutput.split('\n');
                    for (const line of lines) {
                        if (line.length < 3)
                            continue;
                        const code = line.substring(0, 2);
                        const filePath = line.substring(3).trim();
                        if (code === 'DD' || code === 'AA' || code.includes('U')) {
                            if (!conflictedFiles.includes(filePath)) {
                                conflictedFiles.push(filePath);
                            }
                        }
                        else if (code.startsWith('M') || code.startsWith('A') || code.startsWith('D')) {
                            stagedFiles.push(filePath);
                        }
                        else if (code.trim() !== '') {
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
        }
        catch (err) {
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
function deactivate() {
    if (serverInstance) {
        serverInstance.close(() => {
            console.log('[TeamSync Companion] Local HTTP server closed.');
        });
    }
    if (telemetryTimer) {
        clearInterval(telemetryTimer);
    }
}
//# sourceMappingURL=extension.js.map