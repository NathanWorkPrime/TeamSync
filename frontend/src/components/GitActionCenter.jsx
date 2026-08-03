import React, { useState, useEffect, useRef } from 'react';
import { 
  GitBranch, 
  GitPullRequest, 
  Terminal, 
  RefreshCw, 
  AlertTriangle,
  Monitor,
  CheckCircle,
  Clock,
  ArrowDown,
  ArrowUp,
  FolderOpen
} from 'lucide-react';

export default function GitActionCenter({ 
  repoName, 
  githubRepo, 
  status, 
  companionOnline, 
  onRefreshStatus,
  variant = 'sidebar',
  branchName = null
}) {
  const [showModal, setShowModal] = useState(false);
  const [operationLog, setOperationLog] = useState('');
  const [activeAction, setActiveAction] = useState(null); // null, 'fetching', 'pulling', 'pushing', 'syncing', 'stashing'
  const logEndRef = useRef(null);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [operationLog]);

  const handleAction = async (actionName, targetBranch = null) => {
    if (activeAction) return;
    setActiveAction(actionName);
    setOperationLog(prev => prev + `[${new Date().toLocaleTimeString()}] Initializing Git ${actionName.toUpperCase()}...\n`);

    const finalBranch = targetBranch || branchName || (status ? status.currentBranch : 'main');

    try {
      const res = await fetch('http://localhost:37845/git-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: actionName,
          repo: githubRepo || repoName,
          branch: finalBranch
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setOperationLog(prev => prev + (data.log || '') + `\n[SUCCESS] Git ${actionName} completed successfully.\n----------------------------------------\n`);
        onRefreshStatus();
      } else {
        setOperationLog(prev => prev + (data.log || '') + `\n[ERROR] Git ${actionName} failed: ${data.error || data.message || 'Unknown error'}\n----------------------------------------\n`);
      }
    } catch (err) {
      setOperationLog(prev => prev + `\n[ERROR] Connection failed: ${err.message}\n----------------------------------------\n`);
    } finally {
      setActiveAction(null);
    }
  };

  const getCleanStatusString = () => {
    if (!companionOnline) return 'Offline';
    if (!status) return 'Loading...';
    if (!status.isGit) return 'Not a Git Repo';
    if (!status.isClean) {
      const changesCount = status.modifiedFilesCount + status.untrackedFilesCount + status.stagedFilesCount;
      return `${changesCount} modification${changesCount > 1 ? 's' : ''}`;
    }
    return 'Clean';
  };

  const getStatusColor = () => {
    if (!companionOnline) return 'var(--red)';
    if (!status) return 'var(--text-dim)';
    if (!status.isGit) return 'var(--orange)';
    if (status.mergeState || status.rebaseState || status.detachedHead) return 'var(--red)';
    if (!status.isClean) return 'var(--amber)';
    return 'var(--green)';
  };

  const isStale = (timestamp) => {
    if (!timestamp) return true;
    const diff = new Date() - new Date(timestamp);
    return diff > 5 * 60 * 1000; // Older than 5 minutes
  };

  const renderChangesList = () => {
    if (!status) return null;
    const hasChanges = status.stagedFilesCount > 0 || status.modifiedFilesCount > 0 || status.untrackedFilesCount > 0;
    if (!hasChanges) {
      return (
        <div style={{ padding: '12px', fontSize: '13px', color: 'var(--text-dim)', fontStyle: 'italic', background: 'rgba(255,255,255,0.01)', borderRadius: '8px', border: '1px dashed var(--border)' }}>
          Working tree is clean. Ready to switch or push!
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '180px', overflowY: 'auto', background: 'rgba(0,0,0,0.15)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
        {status.stagedFiles.map(f => (
          <div key={f} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            <span className="mono" style={{ color: 'var(--green)' }}>{f}</span>
            <strong style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--green)' }}>staged</strong>
          </div>
        ))}
        {status.modifiedFiles.map(f => (
          <div key={f} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            <span className="mono" style={{ color: 'var(--amber)' }}>{f}</span>
            <strong style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--amber)' }}>modified</strong>
          </div>
        ))}
        {status.untrackedFiles.map(f => (
          <div key={f} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            <span className="mono" style={{ color: 'var(--text-dim)' }}>{f}</span>
            <strong style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--text-dim)' }}>untracked</strong>
          </div>
        ))}
      </div>
    );
  };

  return (
    <>
      {/* Sidebar Panel Button */}
      {variant === 'sidebar' && (
        <div 
          onClick={() => companionOnline && setShowModal(true)}
          style={{
            border: '1px solid var(--border)',
            borderRadius: '12px',
            padding: '12px 14px',
            cursor: companionOnline ? 'pointer' : 'default',
            background: 'var(--surface-2)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            marginTop: 'auto',
            transition: 'all 0.15s ease',
            opacity: companionOnline ? 1 : 0.65
          }}
          className={companionOnline ? 'sidebar-git-btn' : ''}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Local Workspace
            </span>
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: getStatusColor(),
              boxShadow: `0 0 6px ${getStatusColor()}`
            }} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <GitBranch size={15} style={{ color: 'var(--teal)' }} />
            <span className="mono" style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px' }}>
              {status?.currentBranch || 'Offline'}
            </span>
          </div>

          <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
            Status: <strong style={{ color: getStatusColor() }}>{getCleanStatusString()}</strong>
          </div>

          {status && status.isGit && (status.aheadCount > 0 || status.behindCount > 0) && (
            <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: 'var(--text-dim)' }}>
              {status.aheadCount > 0 && <span style={{ color: 'var(--teal)' }}>↑ {status.aheadCount} ahead</span>}
              {status.behindCount > 0 && <span style={{ color: 'var(--violet)' }}>↓ {status.behindCount} behind</span>}
            </div>
          )}
        </div>
      )}

      {/* Button Variant */}
      {variant === 'button' && (
        <button
          onClick={() => companionOnline && setShowModal(true)}
          className="btn-secondary"
          style={{
            padding: '8px 16px',
            fontSize: '12.5px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            cursor: companionOnline ? 'pointer' : 'default',
            opacity: companionOnline ? 1 : 0.65
          }}
          disabled={!companionOnline}
        >
          <Terminal size={14} />
          <span>Git Console</span>
        </button>
      )}

      {/* Action Center Dashboard Modal */}
      {showModal && (
        <div className="modal-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
          <div className="modal-card" style={{ width: '680px', padding: '28px', borderRadius: '14px', background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Monitor size={18} style={{ color: 'var(--teal)' }} />
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
                  Local Git Action Center
                </h3>
              </div>
              <button 
                onClick={() => setShowModal(false)}
                className="btn-secondary"
                style={{ padding: '4px 10px', fontSize: '12px' }}
              >
                Close
              </button>
            </div>

            {/* Health & Special Warnings */}
            {status && (status.mergeState || status.rebaseState || status.detachedHead || status.upstreamTrackingMissing) && (
              <div style={{ padding: '12px 16px', background: 'rgba(244,63,94,0.06)', border: '1px solid var(--red)', borderRadius: '8px', color: '#ff6b6b', fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700 }}>
                  <AlertTriangle size={15} /> Active Git Workspace Warnings
                </div>
                <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: 1.5 }}>
                  {status.detachedHead && <li><strong>Detached HEAD Warning:</strong> You are not currently on any local branch. Commits made here will not be tracking remote updates!</li>}
                  {status.mergeState && <li><strong>Merge Conflicts / In-Progress:</strong> You have conflicts or an active merge operation in progress. Please resolve in the editor.</li>}
                  {status.rebaseState && <li><strong>Rebase In-Progress:</strong> You have an active rebase operation running. Complete the rebase before pulling or merging.</li>}
                  {status.upstreamTrackingMissing && <li><strong>Missing Upstream Tracking:</strong> The current local branch does not track any remote branch. Click <strong>Push</strong> to configure origin tracking.</li>}
                </ul>
              </div>
            )}

            {/* Status Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              {/* Left Side details */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div className="card" style={{ padding: '14px 18px', minHeight: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-dim)' }}>Branch:</span>
                    <strong className="mono" style={{ color: 'var(--teal)' }}>{status?.currentBranch}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-dim)' }}>Active Remote:</span>
                    <span className="mono" style={{ fontSize: '11px', color: 'var(--text)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '180px' }} title={status?.activeRemote}>
                      {status?.activeRemote || 'origin'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-dim)' }}>Commit HEAD:</span>
                    <strong className="mono" style={{ color: 'var(--text)' }}>
                      {status?.currentCommitHash ? status.currentCommitHash.substring(0, 7) : 'unknown'}
                    </strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-dim)' }}>Status:</span>
                    <strong style={{ color: getStatusColor() }}>{getCleanStatusString()}</strong>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                    Working Tree Files
                  </span>
                  {renderChangesList()}
                </div>
              </div>

              {/* Right Side: Sync Controls */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div className="card" style={{ padding: '16px', minHeight: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '4px' }}>
                    Git Operations
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <button 
                      onClick={() => handleAction('fetch')}
                      className="btn-secondary"
                      style={{ padding: '8px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                      disabled={!!activeAction}
                    >
                      <RefreshCw size={13} className={activeAction === 'fetch' ? 'spin' : ''} />
                      <span>Fetch</span>
                    </button>
                    <button 
                      onClick={() => handleAction('pull')}
                      className="btn-secondary"
                      style={{ padding: '8px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                      disabled={!!activeAction}
                    >
                      <ArrowDown size={13} className={activeAction === 'pull' ? 'spin' : ''} />
                      <span>Pull</span>
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <button 
                      onClick={() => handleAction('push')}
                      className="btn-secondary"
                      style={{ padding: '8px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                      disabled={!!activeAction}
                    >
                      <ArrowUp size={13} className={activeAction === 'push' ? 'spin' : ''} />
                      <span>Push</span>
                    </button>
                    <button 
                      onClick={() => handleAction('sync')}
                      className="btn-primary"
                      style={{ padding: '8px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', background: 'var(--teal)', borderColor: 'var(--teal)' }}
                      disabled={!!activeAction}
                    >
                      <RefreshCw size={13} className={activeAction === 'sync' ? 'spin' : ''} />
                      <span>Smart Sync</span>
                    </button>
                  </div>

                  <button
                    onClick={() => {
                      if (window.confirm("Stash all local modifications (including untracked files) to clean the workspace?")) {
                        handleAction('stash');
                      }
                    }}
                    className="btn-secondary"
                    style={{ padding: '8px', fontSize: '12.5px', marginTop: '4px', color: 'var(--amber)', border: '1px solid rgba(245,158,11,0.2)' }}
                    disabled={!!activeAction || (status && status.isClean)}
                  >
                    Stash Changes (-u)
                  </button>
                </div>

                {/* Operation Timestamps */}
                {status && (
                  <div style={{ fontSize: '11px', color: 'var(--text-dim)', display: 'flex', flexDirection: 'column', gap: '4px', padding: '0 8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Last Fetch:</span>
                      <span>{status.lastFetch ? new Date(status.lastFetch).toLocaleTimeString() : 'never'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Last Pull:</span>
                      <span>{status.lastPull ? new Date(status.lastPull).toLocaleTimeString() : 'never'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Last Push:</span>
                      <span>{status.lastPush ? new Date(status.lastPush).toLocaleTimeString() : 'never'}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Console Log Terminal */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Terminal size={12} /> Operation Terminal Console Log
                </span>
                <button 
                  onClick={() => setOperationLog('')}
                  style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: '11px', cursor: 'pointer', textDecoration: 'underline' }}
                >
                  Clear Console
                </button>
              </div>
              
              <div style={{
                height: '140px',
                background: '#0a0f1d',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '12px 16px',
                fontFamily: 'monospace',
                fontSize: '11.5px',
                color: '#4dedea',
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                boxShadow: 'inset 0 4px 12px rgba(0,0,0,0.5)'
              }}>
                {operationLog || 'Console terminal active. Execute Git operations above to trace output.'}
                <div ref={logEndRef} />
              </div>
            </div>

          </div>
        </div>
      )}
    </>
  );
}
