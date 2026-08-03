import React, { useState, useEffect } from 'react';
import { 
  AlertTriangle, 
  GitPullRequest, 
  GitMerge, 
  History, 
  FileText, 
  CheckCircle, 
  XCircle,
  GitBranch,
  RefreshCw,
  Plus,
  ArrowRight,
  User,
  Activity,
  Terminal,
  Server,
  AlertCircle,
  Lock
} from 'lucide-react';

export default function BranchMap({ 
  branches, 
  onWorkOnBranch, 
  activePresence, 
  currentUser, 
  repoName, 
  githubRepo,
  loading
}) {
  const getHeaders = (extraHeaders = {}) => {
    const cached = localStorage.getItem('teamsync_current_user');
    let token = '';
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.session_token) token = parsed.session_token;
      } catch (e) {}
    }
    const headers = { ...extraHeaders };
    if (token) {
      headers['X-User-Session'] = token;
    }
    return headers;
  };

  const [selectedBranch, setSelectedBranch] = useState(branches[0]?.name || null);
  const [isMergeSidebarOpen, setIsMergeSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('history'); // 'history', 'changelog'

  const [cloneStates, setCloneStates] = useState({}); // { [branchName]: { status, errorMsg } }
  const [pullStates, setPullStates] = useState({}); // { [branchName]: { status, errorMsg } }
  const [pushStates, setPushStates] = useState({}); // { [branchName]: { status, errorMsg } }
  const [mergeStates, setMergeStates] = useState({}); // { [branchName]: { status, conflictedFiles, errorMsg, target } }
  
  const [historyEvents, setHistoryEvents] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  
  const [changelogItems, setChangelogItems] = useState([]);
  const [changelogLoading, setChangelogLoading] = useState(false);
  const [newChangelogContent, setNewChangelogContent] = useState('');
  const [isSavingChangelog, setIsSavingChangelog] = useState(false);
  const [mergeTarget, setMergeTarget] = useState('');
  const [showCreateBranchModal, setShowCreateBranchModal] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [baseBranchName, setBaseBranchName] = useState('development');
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [createBranchError, setCreateBranchError] = useState(null);

  // Compare branch API states
  const [compareData, setCompareData] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState(null);

  // Pull Request states
  const [prDetails, setPrDetails] = useState(null);
  const [prLoading, setPrLoading] = useState(false);
  const [prApproving, setPrApproving] = useState(false);
  const [prCreating, setPrCreating] = useState(false);

  // Branch Protection states
  const [protectionSettings, setProtectionSettings] = useState(null);
  const [protectionLoading, setProtectionLoading] = useState(false);
  const [protectionSaving, setProtectionSaving] = useState(false);
  const [protectionError, setProtectionError] = useState(null);

  const fetchBranchProtection = async (branchName) => {
    if (!branchName || !repoName) return;
    setProtectionLoading(true);
    setProtectionError(null);
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(repoName)}/branches/${encodeURIComponent(branchName)}/protection`, {
        headers: getHeaders()
      });
      if (!res.ok) {
        throw new Error('Failed to fetch branch protection settings');
      }
      const data = await res.json();
      setProtectionSettings(data);
    } catch (err) {
      console.error('[BranchMap] Error fetching branch protection:', err);
      setProtectionError(err.message);
    } finally {
      setProtectionLoading(false);
    }
  };

  const handleSaveProtection = async (e) => {
    e.preventDefault();
    if (!selectedBranch || !repoName) return;
    setProtectionSaving(true);
    setProtectionError(null);
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(repoName)}/branches/${encodeURIComponent(selectedBranch)}/protection`, {
        method: 'PUT',
        headers: getHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(protectionSettings)
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to update branch protection settings');
      }
      const updated = await res.json();
      setProtectionSettings(updated);
      alert('Branch protection settings updated successfully!');
    } catch (err) {
      console.error('[BranchMap] Error saving branch protection:', err);
      setProtectionError(err.message);
    } finally {
      setProtectionSaving(false);
    }
  };

  const selectedBranchData = branches.find(b => b.name === selectedBranch);
  const sourceBranch = selectedBranch;

  // Set default base branch based on available branches list
  useEffect(() => {
    const hasDev = branches.some(b => b.name === 'development');
    if (hasDev) {
      setBaseBranchName('development');
    } else if (branches.length > 0) {
      setBaseBranchName(branches.find(b => b.isMain)?.name || branches[0].name);
    }
  }, [branches]);

  // Default selection fallback if branch list updates
  useEffect(() => {
    if (branches.length > 0 && (!selectedBranch || !branches.some(b => b.name === selectedBranch))) {
      setSelectedBranch(branches[0].name);
    }
  }, [branches]);

  // Fetch History logs
  const fetchHistory = async (branchName) => {
    if (!branchName) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/repos/${repoName}/branches/${branchName}/history`, {
        headers: getHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setHistoryEvents(data);
      }
    } catch (e) {
      console.error('Error fetching branch history:', e);
    } finally {
      setHistoryLoading(false);
    }
  };

  // Fetch Changelog logs
  const fetchChangelog = async (branchName) => {
    if (!branchName) return;
    setChangelogLoading(true);
    try {
      const res = await fetch(`/api/rooms/${repoName}/${branchName}/deployments`, {
        headers: getHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        const deploymentsWithChangelog = (data || []).filter(d => d.status === 'success' && d.changelog);
        setChangelogItems(deploymentsWithChangelog);
      }
    } catch (e) {
      console.error('Error fetching branch changelog:', e);
    } finally {
      setChangelogLoading(false);
    }
  };

  // Pull history/changelog when selected branch or tab changes
  useEffect(() => {
    if (selectedBranch) {
      if (activeTab === 'history') {
        fetchHistory(selectedBranch);
      } else if (activeTab === 'changelog') {
        fetchChangelog(selectedBranch);
      } else if (activeTab === 'protection') {
        fetchBranchProtection(selectedBranch);
      }
    }
  }, [selectedBranch, activeTab]);

  // Comparison Fetch Effect Hook
  useEffect(() => {
    if (!sourceBranch || !mergeTarget) {
      setCompareData(null);
      return;
    }
    
    let isMounted = true;
    const fetchComparison = async () => {
      setCompareLoading(true);
      setCompareError(null);
      try {
        const res = await fetch(`/api/repos/${repoName}/compare?base=${mergeTarget}&head=${sourceBranch}`, {
          headers: getHeaders()
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Comparison failed with status ${res.status}`);
        }
        const data = await res.json();
        if (isMounted) {
          setCompareData(data);
        }
      } catch (err) {
        if (isMounted) {
          setCompareError(err.message);
        }
      } finally {
        if (isMounted) {
          setCompareLoading(false);
        }
      }
    };

    fetchComparison();
    return () => {
      isMounted = false;
    };
  }, [sourceBranch, mergeTarget, repoName]);

  const handleOpenFile = async (filePath) => {
    try {
      await fetch('http://localhost:37845/open-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: githubRepo || repoName,
          filePath
        })
      });
    } catch (err) {
      console.error('[BranchMap] Failed to open file:', err);
    }
  };

  const handleMerge = async (sourceBranch, targetBranch) => {
    if (!targetBranch) return;
    setMergeStates(prev => ({
      ...prev,
      [sourceBranch]: { status: 'loading' }
    }));

    try {
      const res = await fetch('http://localhost:37845/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: githubRepo || repoName,
          sourceBranch,
          targetBranch
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to merge branches.');
      }

      if (data.conflicts) {
        setMergeStates(prev => ({
          ...prev,
          [sourceBranch]: { 
            status: 'conflict', 
            conflictedFiles: data.conflictedFiles || []
          }
        }));
      } else {
        setMergeStates(prev => ({
          ...prev,
          [sourceBranch]: { 
            status: 'success',
            target: targetBranch
          }
        }));
        
        setTimeout(() => {
          setMergeStates(prev => ({
            ...prev,
            [sourceBranch]: { status: 'idle' }
          }));
        }, 5000);

        // Reload local page context
        window.location.reload();
      }
    } catch (err) {
      console.error('[BranchMap] Merge failed:', err);
      setMergeStates(prev => ({
        ...prev,
        [sourceBranch]: { status: 'error', errorMsg: err.message }
      }));
    }
  };

  const handleGetLocal = async (branchName) => {
    setCloneStates(prev => ({
      ...prev,
      [branchName]: { status: 'loading' }
    }));

    try {
      const res = await fetch('http://localhost:37845/clone-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: githubRepo || repoName,
          branch: branchName
        })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to clone/update repository.');
      }

      setCloneStates(prev => ({
        ...prev,
        [branchName]: { status: 'success' }
      }));

      // Publish event to the central event bus
      try {
        await fetch('/api/events', {
          method: 'POST',
          headers: getHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            event_type: 'repo:synced',
            event_category: 'project',
            repo_name: repoName,
            branch_name: branchName,
            user_id: currentUser?.id || 1,
            metadata: { action: 'get_local', branch: branchName }
          })
        });
      } catch (eventErr) {
        console.error('[BranchMap] Failed to publish sync event:', eventErr);
      }

      setTimeout(() => {
        setCloneStates(prev => ({
          ...prev,
          [branchName]: { status: 'idle' }
        }));
      }, 5000);

      // Refresh view
      window.location.reload();

    } catch (err) {
      console.error('[BranchMap] Get Local failed:', err);
      setCloneStates(prev => ({
        ...prev,
        [branchName]: { status: 'error', errorMsg: err.message }
      }));
    }
  };

  const handlePull = async (branchName) => {
    setPullStates(prev => ({
      ...prev,
      [branchName]: { status: 'loading' }
    }));

    try {
      const res = await fetch('http://localhost:37845/pull-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: githubRepo || repoName,
          branch: branchName
        })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to pull repository updates.');
      }

      setPullStates(prev => ({
        ...prev,
        [branchName]: { status: 'success' }
      }));

      // Publish event to the central event bus
      try {
        await fetch('/api/events', {
          method: 'POST',
          headers: getHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            event_type: 'repo:pulled',
            event_category: 'project',
            repo_name: repoName,
            branch_name: branchName,
            user_id: currentUser?.id || 1,
            metadata: { action: 'pull', branch: branchName }
          })
        });
      } catch (e) {}

      setTimeout(() => {
        setPullStates(prev => ({
          ...prev,
          [branchName]: { status: 'idle' }
        }));
      }, 5000);

      window.location.reload();

    } catch (err) {
      console.error('[BranchMap] Pull failed:', err);
      setPullStates(prev => ({
        ...prev,
        [branchName]: { status: 'error', errorMsg: err.message }
      }));
    }
  };

  const handlePush = async (branchName) => {
    setPushStates(prev => ({
      ...prev,
      [branchName]: { status: 'loading' }
    }));

    try {
      const res = await fetch('http://localhost:37845/push-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: githubRepo || repoName,
          branch: branchName
        })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to push repository commits.');
      }

      setPushStates(prev => ({
        ...prev,
        [branchName]: { status: 'success' }
      }));

      // Publish event to the central event bus
      try {
        await fetch('/api/events', {
          method: 'POST',
          headers: getHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            event_type: 'repo:pushed',
            event_category: 'project',
            repo_name: repoName,
            branch_name: branchName,
            user_id: currentUser?.id || 1,
            metadata: { action: 'push', branch: branchName }
          })
        });
      } catch (e) {}

      setTimeout(() => {
        setPushStates(prev => ({
          ...prev,
          [branchName]: { status: 'idle' }
        }));
      }, 5000);

      window.location.reload();

    } catch (err) {
      console.error('[BranchMap] Push failed:', err);
      setPushStates(prev => ({
        ...prev,
        [branchName]: { status: 'error', errorMsg: err.message }
      }));
    }
  };

  const fetchPrDetails = async () => {
    if (!selectedBranchData?.pr?.number) return;
    setPrLoading(true);
    try {
      const res = await fetch(`/api/repos/${repoName}/pulls/${selectedBranchData.pr.number}`, {
        headers: getHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setPrDetails(data);
      }
    } catch (err) {
      console.error('[BranchMap] Failed to fetch PR details:', err);
    } finally {
      setPrLoading(false);
    }
  };

  // Fetch PR details when Merge Center is open and a PR is active
  useEffect(() => {
    if (isMergeSidebarOpen && selectedBranchData?.pr?.number) {
      fetchPrDetails();
    } else {
      setPrDetails(null);
    }
  }, [isMergeSidebarOpen, selectedBranchData, mergeTarget]);

  const handleCreatePr = async () => {
    if (!sourceBranch || !mergeTarget) return;
    setPrCreating(true);
    try {
      const res = await fetch(`/api/repos/${repoName}/pulls`, {
        method: 'POST',
        headers: getHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          sourceBranch,
          targetBranch: mergeTarget,
          title: `Merge ${sourceBranch} into ${mergeTarget}`,
          body: 'Created via TeamSync Merge Center.'
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create PR');
      }
      
      // Force reload to sync branches and retrieve new PR
      window.location.reload();
    } catch (err) {
      console.error('[BranchMap] Create PR failed:', err);
      alert(err.message);
    } finally {
      setPrCreating(false);
    }
  };

  const handleApprovePr = async () => {
    if (!selectedBranchData?.pr?.number) return;
    setPrApproving(true);
    try {
      const res = await fetch(`/api/repos/${repoName}/pulls/${selectedBranchData.pr.number}/approve`, {
        method: 'POST',
        headers: getHeaders()
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to approve PR');
      }
      alert(data.message || 'PR approved.');
      fetchPrDetails();
    } catch (err) {
      console.error('[BranchMap] Approve PR failed:', err);
      alert(err.message);
    } finally {
      setPrApproving(false);
    }
  };

  const handleMergePr = async () => {
    if (!selectedBranchData?.pr?.number) return;
    setMergeStates(prev => ({
      ...prev,
      [sourceBranch]: { status: 'loading' }
    }));
    try {
      const res = await fetch(`/api/repos/${repoName}/pulls/${selectedBranchData.pr.number}/merge`, {
        method: 'POST',
        headers: getHeaders()
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to merge PR');
      }
      setMergeStates(prev => ({
        ...prev,
        [sourceBranch]: { status: 'success', target: mergeTarget }
      }));
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (err) {
      console.error('[BranchMap] Merge PR failed:', err);
      setMergeStates(prev => ({
        ...prev,
        [sourceBranch]: { status: 'error', errorMsg: err.message }
      }));
    }
  };

  const handleAddChangelogEntry = async (e) => {
    e.preventDefault();
    if (!newChangelogContent.trim() || !selectedBranch) return;
    setIsSavingChangelog(true);
    try {
      const res = await fetch(`/api/repos/${repoName}/branches/${selectedBranch}/changelog`, {
        method: 'POST',
        headers: getHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          content: newChangelogContent,
          author_user_id: currentUser?.id || 1
        })
      });
      if (res.ok) {
        setNewChangelogContent('');
        await fetchChangelog(selectedBranch);
      }
    } catch (err) {
      console.error('Error saving changelog entry:', err);
    } finally {
      setIsSavingChangelog(false);
    }
  };

  const handleCreateBranchSubmit = async (e) => {
    e.preventDefault();
    if (!newBranchName.trim()) return;
    setIsCreatingBranch(true);
    setCreateBranchError(null);
    try {
      const res = await fetch(`/api/repos/${repoName}/branches`, {
        method: 'POST',
        headers: getHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          branch_name: newBranchName.trim(),
          base_branch: baseBranchName
        })
      });
      if (res.ok) {
        setNewBranchName('');
        setShowCreateBranchModal(false);
        window.location.reload();
      } else {
        const errData = await res.json();
        setCreateBranchError(errData.error || 'Failed to create branch.');
      }
    } catch (err) {
      setCreateBranchError(err.message || 'An error occurred.');
    } finally {
      setIsCreatingBranch(false);
    }
  };

  const isCurrentUserOnBranch = (branchName) => {
    return activePresence.some(
      p => p.user_id === currentUser.id && p.branch_name === branchName
    );
  };

  const getBranchCollaborators = (branchName) => {
    return activePresence.filter(p => p.branch_name === branchName && p.user_id !== currentUser.id);
  };

  const renderChangelogMarkdown = (text) => {
    if (!text) return null;
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    html = html.replace(/^### (.*$)/gim, '<h4 style="font-size:12px;font-weight:700;color:var(--teal);margin-bottom:4px;margin-top:8px;">$1</h4>');
    html = html.replace(/^\* (.*$)/gim, '<li style="margin-left:10px;list-style-type:disc;font-size:11px;color:#e1e4ea;margin-bottom:2px;">$1</li>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/`(.*?)`/g, '<code style="background:rgba(0,0,0,0.2);padding:1px 3px;border-radius:3px;font-family:monospace;font-size:10px;">$1</code>');
    
    html = html.split('\n').map(p => {
      if (p.trim().startsWith('<h') || p.trim().startsWith('<li')) return p;
      if (!p.trim()) return '';
      return `<p style="margin-bottom:4px;color:var(--text);font-size:11.5px;">${p}</p>`;
    }).join('\n');

    return <div dangerouslySetInnerHTML={{ __html: html }} style={{ padding: '8px', background: 'rgba(0,0,0,0.15)', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '6px' }} />;
  };

  // Get current user presence details
  const userPresence = activePresence.find(p => p.user_id === currentUser.id && p.repo_name === repoName);
  
  const parseJSONSafe = (val) => {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    try {
      return JSON.parse(val) || [];
    } catch (e) {
      return [];
    }
  };

  const localStagedFiles = userPresence ? parseJSONSafe(userPresence.staged_files) : [];
  const localModifiedFiles = userPresence ? parseJSONSafe(userPresence.modified_files) : [];
  const localConflictedFiles = userPresence ? parseJSONSafe(userPresence.conflicted_files) : [];

  // Calculate discrepancies
  const discrepancies = [];
  branches.forEach(b => {
    if (b.remoteStatus === 'local-only') {
      discrepancies.push(`Branch '${b.name}' exists locally but is missing on GitHub remote.`);
    }
    if (b.remoteStatus === 'remote-only') {
      discrepancies.push(`Branch '${b.name}' exists on GitHub remote but is not checked out locally.`);
    }
    if (b.pullStatus === 'ahead') {
      discrepancies.push(`Branch '${b.name}' has ${b.localAhead} local commits not pushed to GitHub origin.`);
    }
    if (b.pullStatus === 'behind') {
      discrepancies.push(`Branch '${b.name}' is behind GitHub origin by ${b.localBehind} commits. Pull recommended.`);
    }
    if (b.pullStatus === 'diverged') {
      discrepancies.push(`Branch '${b.name}' has diverged from GitHub remote. Rebase/merge required.`);
    }
  });

  // Calculate Health Status Indicators
  const isAuthValid = githubRepo ? branches.some(b => b.remoteStatus !== 'local-only') : true;
  const isWorkspaceClean = localModifiedFiles.length === 0 && localConflictedFiles.length === 0;

  // Build the hierarchical tree
  const buildBranchTree = (list) => {
    const nodes = {};
    list.forEach(b => {
      nodes[b.name] = { ...b, children: [] };
    });

    const roots = [];
    list.forEach(b => {
      const parentName = b.parent;
      if (parentName && nodes[parentName]) {
        nodes[parentName].children.push(nodes[b.name]);
      } else {
        roots.push(nodes[b.name]);
      }
    });
    return roots;
  };

  const branchTreeRoots = buildBranchTree(branches);

  // Recursive Tree Node Renderer
  const renderTreeNode = (node, depth = 0) => {
    const isSelected = selectedBranch === node.name;
    const isCurrent = node.isCurrent;
    const collaborators = node.riders || [];
    
    let purposeColor = 'var(--text-dim)';
    let purposeLabel = 'Branch';
    if (node.isMain) {
      purposeColor = 'var(--green)';
      purposeLabel = 'Production';
    } else if (node.purpose === 'development') {
      purposeColor = 'var(--teal)';
      purposeLabel = 'Develop';
    } else if (node.purpose === 'uat') {
      purposeColor = 'var(--violet)';
      purposeLabel = 'UAT';
    } else if (node.purpose === 'feature') {
      purposeColor = 'var(--teal)';
      purposeLabel = 'Feature';
    } else if (node.purpose === 'bugfix') {
      purposeColor = 'var(--amber)';
      purposeLabel = 'Bugfix';
    } else if (node.purpose === 'hotfix') {
      purposeColor = 'var(--red)';
      purposeLabel = 'Hotfix';
    } else if (node.purpose === 'release') {
      purposeColor = 'var(--orange)';
      purposeLabel = 'Release';
    }

    return (
      <div key={node.name} style={{ marginLeft: depth > 0 ? '24px' : '0px', position: 'relative' }}>
        {/* Left branch line connector */}
        {depth > 0 && (
          <div style={{
            position: 'absolute',
            left: '-16px',
            top: '0px',
            bottom: node.children.length > 0 ? '0px' : '22px',
            width: '2px',
            background: 'var(--border)'
          }} />
        )}
        {depth > 0 && (
          <div style={{
            position: 'absolute',
            left: '-16px',
            top: '22px',
            width: '12px',
            height: '2px',
            background: 'var(--border)'
          }} />
        )}

        <div
          onClick={() => {
            setSelectedBranch(node.name);
          }}
          style={{
            background: isSelected ? 'var(--surface-2)' : 'var(--surface)',
            border: isSelected 
              ? '1px solid var(--teal)' 
              : isCurrent 
                ? '1px solid rgba(77, 238, 234, 0.3)' 
                : '1px solid var(--border)',
            borderRadius: '12px',
            padding: '14px 18px',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            marginBottom: '10px',
            boxShadow: isSelected ? '0 4px 12px rgba(77,238,234,0.06)' : 'none'
          }}
          className="branch-node-card"
        >
          {/* Top Line */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <GitBranch size={16} style={{ color: purposeColor }} />
              <span className="mono" style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>
                {node.name}
              </span>
              {node.isProtected && (
                <Lock 
                  size={12} 
                  style={{ color: 'var(--teal)' }} 
                  title="Branch protection active: pull request and review required" 
                />
              )}
              {isCurrent && (
                <span style={{
                  fontSize: '8.5px',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  color: 'var(--teal)',
                  background: 'var(--teal-glow)',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  border: '1px solid rgba(77, 238, 234, 0.2)'
                }}>
                  CURRENT
                </span>
              )}
            </div>
            
            {/* Purpose & Sync Status Badges */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '9px', fontWeight: 600, color: 'var(--text-dim)', background: 'var(--surface-2)', padding: '2px 8px', borderRadius: '12px' }}>
                {purposeLabel}
              </span>
              
              {node.remoteStatus === 'local-only' && (
                <span style={{ fontSize: '9px', fontWeight: 600, color: 'var(--orange)', background: 'rgba(245,158,11,0.08)', padding: '2px 8px', borderRadius: '12px', border: '1px solid rgba(245,158,11,0.2)' }}>
                  Local Only
                </span>
              )}
              {node.remoteStatus === 'remote-only' && (
                <span style={{ fontSize: '9px', fontWeight: 600, color: 'var(--text-dim)', background: 'var(--surface-3)', padding: '2px 8px', borderRadius: '12px' }}>
                  Remote Only
                </span>
              )}
              {node.remoteStatus === 'synced' && node.pullStatus === 'ahead' && (
                <span style={{ fontSize: '9px', fontWeight: 600, color: 'var(--teal)', background: 'var(--teal-glow)', padding: '2px 8px', borderRadius: '12px', border: '1px solid rgba(77, 238, 234, 0.15)' }} title={`${node.localAhead} commits ahead of remote`}>
                  ↑ {node.localAhead}
                </span>
              )}
              {node.remoteStatus === 'synced' && node.pullStatus === 'behind' && (
                <span style={{ fontSize: '9px', fontWeight: 600, color: 'var(--violet)', background: 'rgba(139,92,246,0.08)', padding: '2px 8px', borderRadius: '12px', border: '1px solid rgba(139,92,246,0.15)' }} title={`${node.localBehind} commits behind remote`}>
                  ↓ {node.localBehind}
                </span>
              )}
            </div>
          </div>

          {/* Commit Message & Author info */}
          {node.commit && (
            <div style={{ fontSize: '11.5px', color: 'var(--text-dim)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              <span style={{ color: 'var(--text-dim)', fontWeight: 600 }}>{node.commit.author}:</span> {node.commit.message}
            </div>
          )}

          {/* Collaborator Avatars */}
          {collaborators.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
              <span style={{ fontSize: '10.5px', color: 'var(--text-dim)' }}>Active:</span>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {collaborators.map((c, idx) => (
                  <div
                    key={c.id}
                    title={`${c.name} is working on this`}
                    style={{
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      backgroundColor: c.avatar_color || 'var(--teal)',
                      color: 'rgba(15,23,42,0.85)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '8.5px',
                      fontWeight: 800,
                      border: '1.5px solid var(--surface)',
                      marginLeft: idx > 0 ? '-6px' : '0',
                      zIndex: 10 - idx
                    }}
                  >
                    {c.name ? c.name[0].toUpperCase() : 'U'}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Child branches */}
        {node.children.length > 0 && (
          <div style={{ marginTop: '4px' }}>
            {node.children.map(child => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (loading && branches.length === 0) {
    return <BranchMapSkeleton />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: '24px', flexGrow: 1, height: '100%', minHeight: '520px', position: 'relative' }}>
      
      {/* 1. Repository Health & Synchronization Header Card */}
      <div className="panel" style={{ margin: 0, padding: '20px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px' }}>
        <div style={{ display: 'flex', justifySelf: 'stretch', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
              Repository Status & Synchronization Health
            </h3>
            <p style={{ color: 'var(--text-dim)', fontSize: '12.5px', margin: '4px 0 0 0' }}>
              GitHub Remote: <strong style={{ color: 'var(--text)' }}>{githubRepo || 'Local-only workspace'}</strong>
            </p>
          </div>
          
          {/* Status Badges */}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: 'var(--text-dim)', background: 'var(--surface-2)', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: githubRepo ? (isAuthValid ? 'var(--green)' : 'var(--red)') : 'var(--text-dim)' }} />
              <span>Authentication: {githubRepo ? (isAuthValid ? 'Connected to GitHub' : 'GitHub Connection Unavailable') : 'Local Workspace Only'}</span>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: 'var(--text-dim)', background: 'var(--surface-2)', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: isWorkspaceClean ? 'var(--green)' : 'var(--amber)' }} />
              <span>Workspace: {isWorkspaceClean ? 'Clean' : 'Modified'}</span>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: 'var(--text-dim)', background: 'var(--surface-2)', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: discrepancies.length === 0 ? 'var(--green)' : 'var(--amber)' }} />
              <span>Sync: {discrepancies.length === 0 ? 'Fully Synchronized' : `${discrepancies.length} Discrepancies`}</span>
            </div>
          </div>
        </div>

        {/* Discrepancies Alerts List */}
        {discrepancies.length > 0 && (
          <div style={{ marginTop: '16px', background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.15)', borderRadius: '8px', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertCircle size={15} />
              <span>GitHub / Local Repository Discrepancies Detected:</span>
            </div>
            <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {discrepancies.map((d, idx) => (
                <li key={idx} style={{ fontSize: '12px', color: 'var(--text-dim)' }}>{d}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* 2. Branches Page content (Branches List + Details Panel) */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: '360px 1fr', 
        gap: '24px', 
        flexGrow: 1,
        transition: 'margin-right 0.3s ease',
        marginRight: isMergeSidebarOpen ? '380px' : '0px'
      }}>
        {/* Left Panel: Hierarchical Branches list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%', minHeight: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <h4 style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: 0 }}>
              Repository Branch Hierarchy
            </h4>
            <button
              onClick={() => setShowCreateBranchModal(true)}
              className="btn-primary"
              style={{ padding: '4px 10px', fontSize: '11px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}
            >
              <Plus size={12} /> New Branch
            </button>
          </div>
          
          {branches.length === 0 ? (
            <div style={{ padding: '24px', color: 'var(--text-dim)', textAlign: 'center', fontSize: '13.5px', background: 'var(--surface)', borderRadius: '12px', border: '1px solid var(--border)' }}>
              No branches found.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', overflowY: 'auto', flexGrow: 1, paddingRight: '4px' }}>
              {branchTreeRoots.map(root => renderTreeNode(root, 0))}
            </div>
          )}
        </div>

        {/* Right Panel: Selected Branch Details & SOP Progress Tracker */}
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {selectedBranchData ? (
            <div className="panel" style={{ margin: 0, flexGrow: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              {/* Header Area */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <h3 className="mono" style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
                      {selectedBranchData.name}
                    </h3>
                    {selectedBranchData.isProtected && (
                      <span 
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: '10.5px',
                          fontWeight: 700,
                          color: 'var(--teal)',
                          background: 'var(--teal-glow)',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          border: '1px solid rgba(77, 238, 234, 0.2)'
                        }}
                        title="Branch protection rules are active for this branch on GitHub."
                      >
                        <Lock size={10} /> Protected
                      </span>
                    )}
                    {isCurrentUserOnBranch(selectedBranchData.name) && (
                      <span className="pulse-dot" title="You are in this room session" style={{ width: '8px', height: '8px' }}></span>
                    )}
                  </div>
                  <div style={{ fontSize: '12.5px', color: 'var(--text-dim)', marginTop: '4px' }}>
                    Parent Branch: <strong className="mono" style={{ color: 'var(--teal)' }}>{selectedBranchData.parent || 'none (root)'}</strong>
                  </div>
                </div>
                
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button 
                    className="btn-primary"
                    style={{ padding: '8px 16px', fontSize: '12.5px', background: 'var(--teal-glow)', color: 'var(--teal)', border: '1px solid var(--teal)' }}
                    onClick={() => {
                      setMergeTarget(selectedBranchData.parent || 'development');
                      setIsMergeSidebarOpen(true);
                    }}
                  >
                    <GitMerge size={13} style={{ marginRight: '6px' }} />
                    Merge Center
                  </button>

                  {!selectedBranchData.isMain && (
                    <button 
                      className={`work-btn ${isCurrentUserOnBranch(selectedBranchData.name) ? 'joined' : ''}`}
                      style={{ padding: '8px 16px', fontSize: '12.5px' }}
                      onClick={() => onWorkOnBranch(selectedBranchData.name, isCurrentUserOnBranch(selectedBranchData.name))}
                    >
                      {isCurrentUserOnBranch(selectedBranchData.name) ? 'In session' : 'Work on this'}
                    </button>
                  )}
                  
                  {(() => {
                    const state = cloneStates[selectedBranchData.name] || { status: 'idle' };
                    const pullState = pullStates[selectedBranchData.name] || { status: 'idle' };
                    const pushState = pushStates[selectedBranchData.name] || { status: 'idle' };
                    let btnText = 'Sync with GitHub';
                    let btnStyle = { padding: '8px 16px', fontSize: '12.5px' };
                    
                    if (selectedBranchData.localAhead > 0 || selectedBranchData.localBehind > 0) {
                      const aheadText = selectedBranchData.localAhead > 0 ? `${selectedBranchData.localAhead} ahead` : '';
                      const behindText = selectedBranchData.localBehind > 0 ? `${selectedBranchData.localBehind} behind` : '';
                      const counts = [aheadText, behindText].filter(Boolean).join(', ');
                      btnText = `Sync Workspace (${counts})`;
                    }
                    
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' }}>
                        {/* Primary Sync Workspace Button */}
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button 
                            className={`local-btn ${state.status === 'loading' ? 'loading' : state.status === 'success' ? 'success' : state.status === 'error' ? 'error' : ''}`}
                            style={{ ...btnStyle, flexGrow: 1 }}
                            onClick={() => handleGetLocal(selectedBranchData.name)}
                            disabled={state.status === 'loading' || pullState.status === 'loading' || pushState.status === 'loading'}
                            title="Sync Workspace (Combined): Pull remote changes then Push local commits."
                          >
                            {state.status === 'loading' && <RefreshCw size={12} className="spin" style={{ marginRight: '6px' }} />}
                            {state.status === 'success' && <span style={{ marginRight: '4px' }}>✓</span>}
                            {state.status === 'error' && <span style={{ marginRight: '4px' }}>⚠</span>}
                            {btnText}
                          </button>
                        </div>
                        
                        {/* Sub-actions Pull/Push for finer control */}
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            className={`local-btn ${pullState.status === 'loading' ? 'loading' : pullState.status === 'success' ? 'success' : pullState.status === 'error' ? 'error' : ''}`}
                            style={{ padding: '6px 12px', fontSize: '11.5px', background: 'var(--surface-3)', color: 'var(--text)', border: '1px solid var(--border)', flexGrow: 1 }}
                            onClick={() => handlePull(selectedBranchData.name)}
                            disabled={state.status === 'loading' || pullState.status === 'loading' || pushState.status === 'loading'}
                            title="Pull: Fetch and pull remote changes into local files only."
                          >
                            {pullState.status === 'loading' && <RefreshCw size={11} className="spin" style={{ marginRight: '4px' }} />}
                            {pullState.status === 'success' && <span style={{ marginRight: '4px', color: 'var(--green)' }}>✓</span>}
                            {pullState.status === 'error' && <span style={{ marginRight: '4px', color: 'var(--red)' }}>⚠</span>}
                            Pull Remote
                          </button>
                          
                          <button
                            className={`local-btn ${pushState.status === 'loading' ? 'loading' : pushState.status === 'success' ? 'success' : pushState.status === 'error' ? 'error' : ''}`}
                            style={{ padding: '6px 12px', fontSize: '11.5px', background: 'var(--surface-3)', color: 'var(--text)', border: '1px solid var(--border)', flexGrow: 1 }}
                            onClick={() => handlePush(selectedBranchData.name)}
                            disabled={state.status === 'loading' || pullState.status === 'loading' || pushState.status === 'loading'}
                            title="Push: Push local commits to remote without pulling first."
                          >
                            {pushState.status === 'loading' && <RefreshCw size={11} className="spin" style={{ marginRight: '4px' }} />}
                            {pushState.status === 'success' && <span style={{ marginRight: '4px', color: 'var(--green)' }}>✓</span>}
                            {pushState.status === 'error' && <span style={{ marginRight: '4px', color: 'var(--red)' }}>⚠</span>}
                            Push Commits
                          </button>
                        </div>

                        {/* Error messages if any */}
                        {state.status === 'error' && state.errorMsg && (
                          <div style={{ color: 'var(--red)', fontSize: '11px', maxWidth: '300px', textAlign: 'right', whiteSpace: 'normal', wordBreak: 'break-word', marginTop: '2px' }}>
                            {state.errorMsg}
                          </div>
                        )}
                        {pullState.status === 'error' && pullState.errorMsg && (
                          <div style={{ color: 'var(--red)', fontSize: '11px', maxWidth: '300px', textAlign: 'right', whiteSpace: 'normal', wordBreak: 'break-word', marginTop: '2px' }}>
                            Pull failed: {pullState.errorMsg}
                          </div>
                        )}
                        {pushState.status === 'error' && pushState.errorMsg && (
                          <div style={{ color: 'var(--red)', fontSize: '11px', maxWidth: '300px', textAlign: 'right', whiteSpace: 'normal', wordBreak: 'break-word', marginTop: '2px' }}>
                            Push failed: {pushState.errorMsg}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* SOP Stepper Progress Tracker */}
              <div style={{ padding: '16px', background: 'rgba(0,0,0,0.1)', borderRadius: '10px', border: '1px solid var(--border)' }}>
                <h4 style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', margin: '0 0 16px 0', letterSpacing: '0.5px' }}>
                  Standard Operating Procedure (SOP) Stepper
                </h4>
                
                {/* Stepper Vertical Flow */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', position: 'relative', paddingLeft: '8px' }}>
                  
                  {/* Vertical linking line */}
                  <div style={{ position: 'absolute', left: '21px', top: '12px', bottom: '12px', width: '2px', background: 'var(--border)', zIndex: 1 }} />
                  
                  {/* Step 1: Branch Created */}
                  <div style={{ display: 'flex', gap: '16px', zIndex: 2 }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--green)', color: 'var(--bg)', display: 'flex', alignItems: 'center', justifySelf: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 800 }}>✓</div>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>1. Branch Diverged</div>
                      <div style={{ fontSize: '11.5px', color: 'var(--text-dim)', marginTop: '2px' }}>
                        Diverged off base <code className="mono">{selectedBranchData.parent || 'main'}</code>. Author: {selectedBranchData.author}
                      </div>
                    </div>
                  </div>

                  {/* Step 2: Checkout Branch */}
                  <div style={{ display: 'flex', gap: '16px', zIndex: 2 }}>
                    <div style={{ 
                      width: '28px', 
                      height: '28px', 
                      borderRadius: '50%', 
                      background: selectedBranchData.isCurrent ? 'var(--green)' : 'var(--amber)', 
                      color: 'var(--bg)', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      fontSize: '12px', 
                      fontWeight: 800 
                    }}>
                      {selectedBranchData.isCurrent ? '✓' : '2'}
                    </div>
                    <div style={{ flexGrow: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>2. Checkout Branch</span>
                        {!selectedBranchData.isCurrent && (
                          <button 
                            className="btn-primary" 
                            style={{ padding: '3px 8px', fontSize: '10.5px', borderRadius: '4px' }}
                            onClick={() => handleGetLocal(selectedBranchData.name)}
                          >
                            Checkout locally
                          </button>
                        )}
                      </div>
                      <div style={{ fontSize: '11.5px', color: 'var(--text-dim)', marginTop: '2px' }}>
                        {selectedBranchData.isCurrent 
                          ? 'Branch is currently active in local VS Code workspace.' 
                          : 'Not checked out locally. Click checkout to switch local repository.'}
                      </div>
                    </div>
                  </div>

                  {/* Step 3: Workspace Changes */}
                  <div style={{ display: 'flex', gap: '16px', zIndex: 2 }}>
                    <div style={{ 
                      width: '28px', 
                      height: '28px', 
                      borderRadius: '50%', 
                      background: !selectedBranchData.isCurrent 
                        ? 'var(--surface-3)' 
                        : isWorkspaceClean 
                          ? 'var(--green)' 
                          : 'var(--amber)', 
                      color: 'var(--bg)', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      fontSize: '12px', 
                      fontWeight: 800 
                    }}>
                      {!selectedBranchData.isCurrent ? '3' : isWorkspaceClean ? '✓' : '⚠'}
                    </div>
                    <div style={{ flexGrow: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>3. Workspace coding changes</div>
                      <div style={{ fontSize: '11.5px', color: 'var(--text-dim)', marginTop: '2px' }}>
                        {!selectedBranchData.isCurrent 
                          ? 'Checkout branch to track workspace modifications.' 
                          : isWorkspaceClean 
                            ? 'Local workspace is clean. Ready to push/merge.' 
                            : `${localModifiedFiles.length + localStagedFiles.length} modified/staged files found: ${[...localStagedFiles, ...localModifiedFiles].join(', ')}`}
                      </div>
                    </div>
                  </div>

                  {/* Step 4: Sync & Push Branch */}
                  <div style={{ display: 'flex', gap: '16px', zIndex: 2 }}>
                    <div style={{ 
                      width: '28px', 
                      height: '28px', 
                      borderRadius: '50%', 
                      background: selectedBranchData.remoteStatus === 'synced' && selectedBranchData.pullStatus === 'in-sync'
                        ? 'var(--green)'
                        : selectedBranchData.remoteStatus === 'local-only' || selectedBranchData.pullStatus === 'ahead'
                          ? 'var(--amber)'
                          : 'var(--surface-3)',
                      color: 'var(--bg)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '12px',
                      fontWeight: 800
                    }}>
                      {selectedBranchData.remoteStatus === 'synced' && selectedBranchData.pullStatus === 'in-sync' ? '✓' : '4'}
                    </div>
                    <div style={{ flexGrow: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>4. Pushed & Sync with Remote</span>
                        {selectedBranchData.pullStatus === 'ahead' && (
                          <button 
                            className="btn-primary" 
                            style={{ padding: '3px 8px', fontSize: '10.5px', borderRadius: '4px' }}
                            onClick={() => handleGetLocal(selectedBranchData.name)}
                          >
                            Push Commits
                          </button>
                        )}
                      </div>
                      <div style={{ fontSize: '11.5px', color: 'var(--text-dim)', marginTop: '2px' }}>
                        {selectedBranchData.remoteStatus === 'local-only' 
                          ? 'Branch exists local-only. Click Sync to publish branch to GitHub.' 
                          : selectedBranchData.pullStatus === 'ahead' 
                            ? `Local branch is ahead of GitHub origin by ${selectedBranchData.localAhead} commits.` 
                            : selectedBranchData.pullStatus === 'behind'
                              ? `Local branch is behind GitHub origin by ${selectedBranchData.localBehind} commits. Pull required.`
                              : 'Branch is in sync with GitHub remote origin.'}
                      </div>
                    </div>
                  </div>

                  {/* Step 5: Open Merge Request */}
                  <div style={{ display: 'flex', gap: '16px', zIndex: 2 }}>
                    <div style={{ 
                      width: '28px', 
                      height: '28px', 
                      borderRadius: '50%', 
                      background: selectedBranchData.pr ? 'var(--green)' : 'var(--surface-3)', 
                      color: 'var(--bg)', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      fontSize: '12px', 
                      fontWeight: 800 
                    }}>
                      {selectedBranchData.pr ? '✓' : '5'}
                    </div>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>5. GitHub Pull Request Status</div>
                      <div style={{ fontSize: '11.5px', color: 'var(--text-dim)', marginTop: '2px' }}>
                        {selectedBranchData.pr 
                          ? `PR #${selectedBranchData.pr.number} is ${selectedBranchData.pr.status}: "${selectedBranchData.pr.title}"` 
                          : 'No active GitHub pull request opened for this branch.'}
                      </div>
                    </div>
                  </div>

                  {/* Step 6: Merge & Push Merge Commit */}
                  <div style={{ display: 'flex', gap: '16px', zIndex: 2 }}>
                    <div style={{ 
                      width: '28px', 
                      height: '28px', 
                      borderRadius: '50%', 
                      background: selectedBranchData.isMain || selectedBranchData.pr?.status === 'merged' ? 'var(--green)' : 'var(--surface-3)', 
                      color: 'var(--bg)', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      fontSize: '12px', 
                      fontWeight: 800 
                    }}>
                      {selectedBranchData.isMain || selectedBranchData.pr?.status === 'merged' ? '✓' : '6'}
                    </div>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>6. Merge Commit Pushed</div>
                      <div style={{ fontSize: '11.5px', color: 'var(--text-dim)', marginTop: '2px' }}>
                        {selectedBranchData.isMain 
                          ? 'Main branch root.' 
                          : selectedBranchData.pr?.status === 'merged' 
                            ? 'Merge commit successfully pushed and synced to GitHub remote.' 
                            : 'Branch has unmerged changes. Trigger Merge Center once coding is complete.'}
                      </div>
                    </div>
                  </div>

                  {/* Step 7: Deployment */}
                  <div style={{ display: 'flex', gap: '16px', zIndex: 2 }}>
                    <div style={{ 
                      width: '28px', 
                      height: '28px', 
                      borderRadius: '50%', 
                      background: selectedBranchData.deployment?.status === 'success' ? 'var(--green)' : 'var(--surface-3)', 
                      color: 'var(--bg)', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      fontSize: '12px', 
                      fontWeight: 800 
                    }}>
                      {selectedBranchData.deployment?.status === 'success' ? '✓' : '7'}
                    </div>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>7. Deploy Release Instance</div>
                      <div style={{ fontSize: '11.5px', color: 'var(--text-dim)', marginTop: '2px' }}>
                        {selectedBranchData.deployment?.status === 'success' 
                          ? `Branch successfully deployed on ${new Date(selectedBranchData.deployment.deployed_at).toLocaleString()}` 
                          : 'No active deployment record.'}
                      </div>
                    </div>
                  </div>

                </div>
              </div>

              {/* Sub-Tabs Bar (History & Changelog) */}
              <div style={{ display: 'flex', gap: '24px', borderBottom: '1px solid var(--border)' }}>
                {[
                  { id: 'history', label: 'History Logs', icon: <History size={14} /> },
                  { id: 'changelog', label: 'Changelog Entries', icon: <FileText size={14} /> },
                  { id: 'protection', label: 'Branch Protection', icon: <Lock size={14} /> }
                ].map(t => {
                  const isActive = activeTab === t.id;
                  return (
                    <div
                      key={t.id}
                      onClick={() => setActiveTab(t.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '12px 4px',
                        cursor: 'pointer',
                        fontSize: '13.5px',
                        fontWeight: isActive ? 600 : 500,
                        color: isActive ? 'var(--teal)' : 'var(--text-dim)',
                        borderBottom: '2px solid',
                        borderColor: isActive ? 'var(--teal)' : 'transparent',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      {t.icon}
                      <span>{t.label}</span>
                    </div>
                  );
                })}
              </div>

              {/* Details Content Box */}
              <div style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto' }}>
                
                {/* HISTORY TAB CONTENT */}
                {activeTab === 'history' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '8px 0' }}>
                    {historyLoading ? (
                      <div style={{ color: 'var(--text-dim)', fontSize: '13px' }}>Loading branch history logs...</div>
                    ) : historyEvents.length === 0 ? (
                      <div style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontSize: '13px' }}>
                        No merge or deployment logs found for this branch.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {historyEvents.map((evt, idx) => {
                          const isMerge = evt.event_type === 'git:merge_success';
                          const isDeploySuccess = evt.event_type === 'deploy:success';
                          
                          return (
                            <div 
                              key={idx} 
                              className="panel" 
                              style={{ 
                                margin: 0, 
                                padding: '12px 16px', 
                                background: isMerge ? 'var(--teal-glow)' : isDeploySuccess ? 'var(--green-glow)' : 'rgba(248,113,113,0.1)', 
                                border: '1px solid',
                                borderColor: isMerge ? 'var(--teal)' : isDeploySuccess ? 'var(--green)' : 'var(--red)',
                                borderRadius: '10px' 
                              }}
                            >
                              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                {isMerge ? (
                                  <GitMerge size={14} style={{ color: 'var(--teal)' }} />
                                ) : (
                                  <Server size={14} style={{ color: 'var(--green)' }} />
                                )}
                                <div style={{ flexGrow: 1 }}>
                                  <div style={{ fontSize: '12.5px', color: 'var(--text)' }}>
                                    {isMerge ? (
                                      <span>Merged branch <strong className="mono">{evt.metadata.source_branch}</strong> into <strong className="mono">{evt.metadata.target_branch}</strong></span>
                                    ) : (
                                      <span>Successfully deployed commit <code className="mono">{evt.commit_hash?.substring(0, 7)}</code></span>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', fontSize: '11px', color: 'var(--text-dim)' }}>
                                    <span>Triggered by: {evt.user_name || evt.display_name || 'System'}</span>
                                    <span>{new Date(evt.timestamp || evt.deployed_at).toLocaleString()}</span>
                                  </div>
                                  
                                  {/* Changelog text snippet */}
                                  {evt.changelog && renderChangelogMarkdown(evt.changelog)}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* CHANGELOG TAB CONTENT */}
                {activeTab === 'changelog' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '8px 0' }}>
                    
                    {/* Add manual changelog entry form */}
                    <form onSubmit={handleAddChangelogEntry} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                      <textarea
                        className="form-control"
                        rows={2}
                        placeholder="Add manual changelog notes (e.g. fixed layout spacing, API changes)..."
                        value={newChangelogContent}
                        onChange={(e) => setNewChangelogContent(e.target.value)}
                        style={{ fontSize: '12.5px', padding: '8px 12px', flexGrow: 1, resize: 'none' }}
                        required
                      />
                      <button 
                        type="submit" 
                        className="btn-primary" 
                        disabled={isSavingChangelog || !newChangelogContent.trim()}
                        style={{ padding: '10px 16px', fontSize: '12.5px', whiteSpace: 'nowrap' }}
                      >
                        {isSavingChangelog ? 'Saving...' : 'Add Entry'}
                      </button>
                    </form>

                    {changelogLoading ? (
                      <div style={{ color: 'var(--text-dim)', fontSize: '13px' }}>Loading changelogs...</div>
                    ) : changelogItems.length === 0 ? (
                      <div style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontSize: '13px', textAlign: 'center', padding: '16px 0' }}>
                        No changelog records logged yet. Add a manual entry or deploy this branch to generate one.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {changelogItems.map((item, idx) => (
                          <div key={idx} className="panel" style={{ margin: 0, padding: '16px', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '8px', marginBottom: '10px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span className="mono" style={{ fontSize: '12px', color: 'var(--teal)', background: 'var(--teal-glow)', padding: '2px 6px', borderRadius: '4px' }}>
                                  {item.commit_hash.substring(0, 7)}
                                </span>
                                <span style={{ fontSize: '12.5px', fontWeight: 600 }}>Deploy Instance</span>
                              </div>
                              <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                                {new Date(item.deployed_at).toLocaleString()}
                              </span>
                            </div>
                            
                            {/* Changelog contents */}
                            {renderChangelogMarkdown(item.changelog)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* BRANCH PROTECTION TAB CONTENT */}
                {activeTab === 'protection' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px 0' }}>
                    {protectionLoading ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-dim)', fontSize: '13px' }}>
                        <RefreshCw size={14} className="spin" />
                        <span>Loading branch protection settings...</span>
                      </div>
                    ) : protectionError ? (
                      <div style={{ color: 'var(--red)', background: 'rgba(248,113,113,0.06)', border: '1px solid var(--red)', borderRadius: '8px', padding: '12px 16px', fontSize: '13px' }}>
                        <strong>Error:</strong> {protectionError}
                      </div>
                    ) : protectionSettings ? (
                      <form onSubmit={handleSaveProtection} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        
                        {/* Protection State Alert Card */}
                        <div style={{ 
                          padding: '16px', 
                          borderRadius: '10px', 
                          border: '1px solid',
                          borderColor: protectionSettings.isProtected ? 'var(--teal)' : 'var(--border)',
                          background: protectionSettings.isProtected ? 'rgba(20,184,166,0.04)' : 'var(--surface-2)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px'
                        }}>
                          <Lock size={20} style={{ color: protectionSettings.isProtected ? 'var(--teal)' : 'var(--text-dim)' }} />
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <span style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text)' }}>
                              Branch is {protectionSettings.isProtected ? 'Protected' : 'Unprotected'}
                            </span>
                            <span style={{ fontSize: '11.5px', color: 'var(--text-dim)' }}>
                              {protectionSettings.isProtected 
                                ? 'GitHub branch protection policies are currently active.' 
                                : 'Direct pushes are allowed and pull request reviews are not enforced.'}
                            </span>
                          </div>
                        </div>

                        {/* Enable protection toggle */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <input
                            type="checkbox"
                            id="enable-protection"
                            checked={protectionSettings.isProtected}
                            onChange={(e) => setProtectionSettings({
                              ...protectionSettings,
                              isProtected: e.target.checked
                            })}
                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                          />
                          <label htmlFor="enable-protection" style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text)', cursor: 'pointer' }}>
                            Enable GitHub Branch Protection rules
                          </label>
                        </div>

                        {/* Extra settings shown if protection is checked */}
                        {protectionSettings.isProtected && (
                          <div style={{ 
                            marginLeft: '26px', 
                            paddingLeft: '16px', 
                            borderLeft: '2px solid var(--border)', 
                            display: 'flex', 
                            flexDirection: 'column', 
                            gap: '16px' 
                          }}>
                            
                            {/* Required approving review count dropdown */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                                Required Approving PR Reviews
                              </label>
                              <select
                                className="form-control"
                                value={protectionSettings.requiredApprovals}
                                onChange={(e) => setProtectionSettings({
                                  ...protectionSettings,
                                  requiredApprovals: parseInt(e.target.value, 10)
                                })}
                                style={{ maxWidth: '200px', fontSize: '13px', padding: '6px 12px' }}
                              >
                                {[1, 2, 3, 4, 5, 6].map(n => (
                                  <option key={n} value={n}>{n} {n === 1 ? 'review' : 'reviews'}</option>
                                ))}
                              </select>
                              <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                                Merging is blocked unless the Pull Request has at least this many approvals.
                              </span>
                            </div>

                            {/* Enforce Admins checkbox */}
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                              <input
                                type="checkbox"
                                id="enforce-admins"
                                checked={protectionSettings.enforceAdmins}
                                onChange={(e) => setProtectionSettings({
                                  ...protectionSettings,
                                  enforceAdmins: e.target.checked
                                })}
                                style={{ marginTop: '3px', cursor: 'pointer' }}
                              />
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <label htmlFor="enforce-admins" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', cursor: 'pointer' }}>
                                  Enforce protection settings for administrators
                                </label>
                                <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                                  Admins and owners must also follow the branch protection rules.
                                </span>
                              </div>
                            </div>

                            {/* Dismiss Stale Reviews checkbox */}
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                              <input
                                type="checkbox"
                                id="dismiss-stale-reviews"
                                checked={protectionSettings.dismissStaleReviews}
                                onChange={(e) => setProtectionSettings({
                                  ...protectionSettings,
                                  dismissStaleReviews: e.target.checked
                                })}
                                style={{ marginTop: '3px', cursor: 'pointer' }}
                              />
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <label htmlFor="dismiss-stale-reviews" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', cursor: 'pointer' }}>
                                  Dismiss stale pull request approvals when new commits are pushed
                                </label>
                                <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                                  Any approving review is automatically dismissed when code changes are added.
                                </span>
                              </div>
                            </div>

                          </div>
                        )}

                        {/* Submit Button */}
                        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px', display: 'flex', gap: '12px' }}>
                          <button
                            type="submit"
                            className="btn-primary"
                            disabled={protectionSaving}
                            style={{ padding: '8px 20px', fontSize: '13px' }}
                          >
                            {protectionSaving ? 'Saving Settings...' : 'Save Protection Settings'}
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => fetchBranchProtection(selectedBranch)}
                            disabled={protectionSaving}
                            style={{ padding: '8px 16px', fontSize: '13px' }}
                          >
                            Reset
                          </button>
                        </div>

                      </form>
                    ) : (
                      <div style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontSize: '13px' }}>
                        No protection settings available.
                      </div>
                    )}
                  </div>
                )}

              </div>

            </div>
          ) : (
            <div className="panel" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px', color: 'var(--text-dim)' }}>
              <GitBranch size={40} style={{ opacity: 0.3, marginBottom: '12px' }} />
              <span>Select a branch to view detailed SOP stepper and history</span>
            </div>
          )}
        </div>

      </div>

      {/* 3. Right-hand Sidebar Drawer (Merge Center & Compare Panel) */}
      <div 
        style={{
          position: 'fixed',
          top: '64px',
          right: 0,
          bottom: 0,
          width: '380px',
          background: 'var(--surface)',
          borderLeft: '1px solid var(--border)',
          boxShadow: 'var(--sidebar-shadow)',
          zIndex: 100,
          transform: isMergeSidebarOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.3s ease',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0
        }}
      >
        {/* Sidebar Header */}
        <div style={{ padding: '20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <GitMerge size={16} style={{ color: 'var(--teal)' }} />
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
              Merge Center
            </h3>
          </div>
          <button 
            onClick={() => setIsMergeSidebarOpen(false)}
            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: '18px', cursor: 'pointer' }}
          >
            ×
          </button>
        </div>

        {/* Sidebar Content */}
        <div style={{ flexGrow: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Target Branch selection */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
              Target Parent Branch
            </label>
            <select
              className="form-control"
              value={mergeTarget}
              onChange={(e) => setMergeTarget(e.target.value)}
              style={{ fontSize: '13px', padding: '8px 12px' }}
            >
              <option value="">-- Select Target Branch --</option>
              {branches.map(b => (
                <option key={b.name} value={b.name}>{b.name}</option>
              ))}
            </select>
          </div>

          {/* Merge Flow Visualizer */}
          {sourceBranch && mergeTarget && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', background: 'var(--surface-2)', borderRadius: '8px', border: '1px solid var(--border)', justifyContent: 'center' }}>
              <span className="mono" style={{ fontSize: '12px', color: 'var(--teal)', fontWeight: 600 }}>{sourceBranch}</span>
              <ArrowRight size={14} style={{ color: 'var(--text-dim)' }} />
              <span className="mono" style={{ fontSize: '12px', color: 'var(--green)', fontWeight: 600 }}>{mergeTarget}</span>
            </div>
          )}

          {/* Merge Status alerts */}
          {sourceBranch && mergeTarget && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              
              {/* Compare status loading */}
              {compareLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-dim)', fontSize: '12.5px' }}>
                  <RefreshCw size={14} className="spin" />
                  <span>Checking for merge conflicts...</span>
                </div>
              )}

              {/* Compare status success */}
              {!compareLoading && compareData && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {compareData.hasConflicts ? (
                    <div style={{ color: 'var(--red)', background: 'rgba(248,113,113,0.06)', border: '1px solid var(--red)', borderRadius: '8px', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 700 }}>⚠️ Merge Conflict Warning</span>
                      <span style={{ fontSize: '12px' }}>Automatic merging is blocked by conflicts in:</span>
                      <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '11.5px' }}>
                        {compareData.files.filter(f => f.status === 'conflict').map(f => (
                          <li key={f.filename} className="mono">{f.filename}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div style={{ color: 'var(--green)', background: 'rgba(16,185,129,0.06)', border: '1px solid var(--green)', borderRadius: '8px', padding: '12px 16px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <CheckCircle size={15} />
                      <span>Branches can be merged cleanly.</span>
                    </div>
                  )}

                  {/* Commits list to be merged */}
                  <div>
                    <h5 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '8px' }}>
                      Commits to merge ({compareData.commits.length})
                    </h5>
                    {compareData.commits.length === 0 ? (
                      <div style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontSize: '12px' }}>No new commits to merge.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '160px', overflowY: 'auto' }}>
                        {compareData.commits.map(c => (
                          <div key={c.hash} style={{ padding: '6px 10px', background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '11.5px' }}>
                            <div style={{ fontWeight: 600, color: 'var(--text)' }} className="mono">{c.hash.substring(0, 7)}</div>
                            <div style={{ color: 'var(--text-dim)', marginTop: '2px' }}>{c.message}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* PR Management Section */}
          {sourceBranch && mergeTarget && (
            <div style={{ padding: '14px', background: 'var(--surface-2)', borderRadius: '8px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                <GitPullRequest size={14} style={{ color: 'var(--teal)' }} />
                <span>GitHub Pull Request status</span>
              </div>
              
              {prLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-dim)', fontSize: '12.5px' }}>
                  <RefreshCw size={14} className="spin" />
                  <span>Loading Pull Request info...</span>
                </div>
              ) : prDetails ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ fontSize: '13px', color: 'var(--text)' }}>
                    <strong>PR #{prDetails.pr.number}:</strong>{' '}
                    <a href={prDetails.pr.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--teal)', textDecoration: 'underline' }}>
                      {prDetails.pr.title}
                    </a>
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                    <span style={{ 
                      padding: '2px 6px', 
                      borderRadius: '4px', 
                      background: prDetails.pr.status === 'open' ? 'rgba(16,185,129,0.1)' : 'rgba(156,163,175,0.1)',
                      color: prDetails.pr.status === 'open' ? 'var(--green)' : 'var(--text-dim)',
                      fontWeight: 600
                    }}>
                      {prDetails.pr.status.toUpperCase()}
                    </span>
                    <span style={{ color: 'var(--text-dim)' }}>
                      • {prDetails.isApproved ? `Approved (${prDetails.approvalsCount} reviews)` : 'Review required'}
                    </span>
                  </div>

                  {prDetails.isSimulatedApproved && (
                    <div style={{ fontSize: '11px', color: 'var(--amber)', background: 'rgba(245,158,11,0.06)', padding: '6px 8px', borderRadius: '4px', border: '1px solid rgba(245,158,11,0.2)' }}>
                      ℹ️ Simulated approval active for single-user testing/demo.
                    </div>
                  )}

                  {prDetails.pr.status === 'open' && !prDetails.isApproved && (
                    <button
                      className="btn-primary"
                      style={{ padding: '6px 12px', fontSize: '12px', background: 'var(--amber-glow)', color: 'var(--amber)', border: '1px solid var(--amber)' }}
                      onClick={handleApprovePr}
                      disabled={prApproving}
                    >
                      {prApproving ? 'Approving...' : 'Approve Pull Request (Submit Review)'}
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
                    No active Pull Request exists from <code className="mono">{sourceBranch}</code> to <code className="mono">{mergeTarget}</code>.
                  </div>
                  <button
                    className="btn-primary"
                    style={{ padding: '8px 12px', fontSize: '12.5px', background: 'var(--teal-glow)', color: 'var(--teal)', border: '1px solid var(--teal)' }}
                    onClick={handleCreatePr}
                    disabled={prCreating}
                  >
                    {prCreating ? 'Creating PR...' : 'Create GitHub Pull Request'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Trigger Merge Button */}
          {(() => {
            const hasPr = !!selectedBranchData?.pr;
            const isApproved = prDetails?.isApproved;
            const isLoading = mergeStates[sourceBranch]?.status === 'loading';
            
            if (hasPr) {
              return (
                <button 
                  className="btn-primary" 
                  style={{ width: '100%', padding: '12px', fontSize: '13px', marginTop: 'auto', background: isApproved ? 'var(--teal)' : 'var(--surface-3)', border: isApproved ? 'none' : '1px solid var(--border)' }}
                  onClick={handleMergePr}
                  disabled={!mergeTarget || isLoading || !isApproved || (compareData && compareData.hasConflicts)}
                >
                  {isLoading ? 'Merging Pull Request...' : 'Merge Pull Request (GitHub)'}
                </button>
              );
            }
            
            return (
              <button 
                className="btn-primary" 
                style={{ width: '100%', padding: '12px', fontSize: '13px', marginTop: 'auto' }}
                onClick={() => handleMerge(sourceBranch, mergeTarget)}
                disabled={!mergeTarget || isLoading || (compareData && compareData.hasConflicts)}
              >
                {isLoading ? 'Merging & Pushing...' : 'Merge & Push Commit (Direct)'}
              </button>
            );
          })()}

          {/* Merge states logs */}
          {(() => {
            const ms = mergeStates[sourceBranch];
            if (!ms) return null;
            if (ms.status === 'conflict') {
              return (
                <div style={{ color: 'var(--red)', fontSize: '12px', padding: '10px 14px', background: 'rgba(248,113,113,0.06)', border: '1px solid var(--red)', borderRadius: '6px' }}>
                  <strong>Conflict:</strong> Merge failed. Open Antigravity to resolve conflicts in files:
                  <ul style={{ margin: '4px 0 0 0', paddingLeft: '14px' }}>
                    {ms.conflictedFiles.map(f => (
                      <li key={f} className="mono" style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => handleOpenFile(f)}>{f}</li>
                    ))}
                  </ul>
                </div>
              );
            }
            if (ms.status === 'error') {
              return (
                <div style={{ color: 'var(--red)', fontSize: '12px', padding: '10px 14px', background: 'rgba(248,113,113,0.06)', border: '1px solid var(--red)', borderRadius: '6px' }}>
                  <strong>Error:</strong> {ms.errorMsg}
                </div>
              );
            }
            return null;
          })()}

        </div>
      </div>

      {/* 4. Create Branch Modal */}
      {showCreateBranchModal && (
        <div className="modal-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-card" style={{ width: '420px', padding: '24px', borderRadius: '14px', background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)', margin: 0 }}>Create Feature Branch</h3>
              <button 
                type="button" 
                style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: '18px', cursor: 'pointer' }}
                onClick={() => {
                  setShowCreateBranchModal(false);
                  setCreateBranchError(null);
                }}
              >
                ×
              </button>
            </div>
            
            <form onSubmit={handleCreateBranchSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="form-group">
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Branch Name</label>
                <input 
                  type="text" 
                  className="form-control"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="e.g. feature/auth-fix"
                  style={{ fontSize: '13px', padding: '10px' }}
                  required
                />
              </div>

              <div className="form-group">
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Base Branch</label>
                <select 
                  className="form-control"
                  value={baseBranchName}
                  onChange={(e) => setBaseBranchName(e.target.value)}
                  style={{ fontSize: '13px', padding: '10px' }}
                >
                  {branches.map(b => (
                    <option key={b.name} value={b.name}>{b.name}</option>
                  ))}
                </select>
                <div style={{ fontSize: '11px', color: 'var(--orange)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span>⚠️</span>
                  <span>Branching off stable main/development is recommended to prevent branch-off-branch conflicts.</span>
                </div>
              </div>

              {createBranchError && (
                <div style={{ color: 'var(--red)', fontSize: '12px', padding: '8px 12px', background: 'rgba(248,113,113,0.1)', border: '1px solid var(--red)', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px' }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                  <span>{createBranchError}</span>
                </div>
              )}

              <div className="modal-actions" style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
                <button 
                  type="button" 
                  className="btn-secondary" 
                  onClick={() => {
                    setShowCreateBranchModal(false);
                    setCreateBranchError(null);
                  }}
                  style={{ padding: '8px 16px', fontSize: '13px' }}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn-primary" 
                  disabled={isCreatingBranch || !newBranchName.trim()}
                  style={{ padding: '8px 16px', fontSize: '13px' }}
                >
                  {isCreatingBranch ? 'Creating...' : 'Create Branch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const BranchMapSkeleton = () => (
  <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: '24px', flexGrow: 1, height: '100%', minHeight: '520px' }}>
    {/* Sync Header Panel */}
    <div className="panel" style={{ margin: 0, padding: '20px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px' }}>
      <div style={{ display: 'flex', justifySelf: 'stretch', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="skeleton" style={{ height: '16px', width: '260px', borderRadius: '4px', marginBottom: '8px' }} />
          <div className="skeleton" style={{ height: '12px', width: '180px', borderRadius: '4px' }} />
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <div className="skeleton" style={{ height: '28px', width: '140px', borderRadius: '8px' }} />
          <div className="skeleton" style={{ height: '28px', width: '110px', borderRadius: '8px' }} />
        </div>
      </div>
    </div>

    {/* Tree & Details Grid */}
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '24px', flexGrow: 1, minHeight: 0 }}>
      {/* Sidebar Tree Skeleton */}
      <div className="panel" style={{ margin: 0, padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div className="skeleton" style={{ height: '16px', width: '100px', borderRadius: '4px' }} />
          <div className="skeleton" style={{ height: '20px', width: '80px', borderRadius: '6px' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {[1, 2, 3, 4].map(n => (
            <div key={n} style={{ display: 'flex', gap: '8px', alignItems: 'center', paddingLeft: `${(n - 1) * 12}px` }}>
              <div className="skeleton" style={{ height: '12px', width: '12px', borderRadius: '3px' }} />
              <div className="skeleton" style={{ height: '14px', width: '100px', borderRadius: '4px' }} />
            </div>
          ))}
        </div>
      </div>
      {/* Details Card Skeleton */}
      <div className="panel" style={{ margin: 0, padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div className="skeleton" style={{ height: '20px', width: '180px', borderRadius: '4px' }} />
            <div className="skeleton" style={{ height: '12px', width: '120px', borderRadius: '4px' }} />
          </div>
          <div className="skeleton" style={{ height: '36px', width: '110px', borderRadius: '6px' }} />
        </div>
        <div className="skeleton" style={{ height: '80px', width: '100%', borderRadius: '8px' }} />
        <div className="skeleton" style={{ height: '120px', width: '100%', borderRadius: '8px' }} />
      </div>
    </div>
  </div>
);

