import React, { useState } from 'react';
import { Plus, AlertTriangle, RefreshCw, FolderPlus } from 'lucide-react';

export default function Projects({ repos, reposError, onSelectRepo, onRegisterSuccess, onRetry }) {
  const [activeTab, setActiveTab] = useState('register');
  const [shareCode, setShareCode] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [githubRepo, setGithubRepo] = useState('');
  const [branchStrategy, setBranchStrategy] = useState('main-only');
  const [allowSandboxDeploy, setAllowSandboxDeploy] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          github_repo: githubRepo.trim() || null,
          branch_strategy: branchStrategy,
          allow_sandbox_deploy: allowSandboxDeploy
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to register repository.');
      }

      if (data.warning) {
        // If there is a warning (e.g. Git/GitHub setup warning), show it
        alert(`Warning: ${data.warning}`);
      }

      setName('');
      setDescription('');
      setGithubRepo('');
      setBranchStrategy('main-only');
      setAllowSandboxDeploy(false);
      setShowModal(false);
      
      if (onRegisterSuccess) {
        onRegisterSuccess();
      }
    } catch (err) {
      console.error('[Projects] Registration error:', err);
      setError(err.message || 'An error occurred during registration.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinSubmit = async (e) => {
    e.preventDefault();
    if (!shareCode.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const cached = localStorage.getItem('teamsync_current_user');
      let activeUser = null;
      if (cached) {
        try { activeUser = JSON.parse(cached); } catch (e) {}
      }
      const headers = { 'Content-Type': 'application/json' };
      if (activeUser && activeUser.username) {
        headers['X-User-Username'] = activeUser.username;
      }

      const res = await fetch('/api/repos/join', {
        method: 'POST',
        headers,
        body: JSON.stringify({ share_code: shareCode.trim() })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to join project.');
      }

      setShareCode('');
      setShowModal(false);
      
      if (onRegisterSuccess) {
        onRegisterSuccess();
      }
    } catch (err) {
      console.error('[Projects] Join project error:', err);
      setError(err.message || 'An error occurred while joining the project.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="view">
      <div className="page-header-card">
        <div style={{ display: 'flex', justifySelf: 'stretch', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <div className="page-header-title-area">
            <div className="page-header-title">Engineering Project Repositories</div>
            <div className="page-header-desc">
              {repos.length} repositories registered · {repos.reduce((acc, r) => acc + (r.activeCount || 0), 0)} people currently active
            </div>
          </div>
          <button 
            onClick={() => { setShowModal(true); setActiveTab('register'); }} 
            className="btn-primary" 
            style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', padding: '8px 16px', fontSize: '13px' }}
          >
            <Plus size={16} /> Register or Join Project
          </button>
        </div>
      </div>

      {reposError && (
        <div className="alert-card" style={{
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          borderRadius: '10px',
          padding: '16px 20px',
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          color: 'var(--red)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <AlertTriangle size={18} />
            <span style={{ fontSize: '13px', fontWeight: 500 }}>{reposError}</span>
          </div>
          {onRetry && (
            <button 
              onClick={onRetry} 
              className="btn-secondary" 
              style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--red)', borderColor: 'var(--red)' }}
            >
              <RefreshCw size={13} className="retry-icon" />
              Retry Verification
            </button>
          )}
        </div>
      )}
      
      <div className="grid">
        {repos.map((repo) => (
          <div 
            key={repo.name} 
            className={`card ${repo.activeCount > 0 ? 'active-session-glow' : ''}`} 
            onClick={() => onSelectRepo(repo.name)}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div className="card-title">{repo.name}</div>
                  {repo.share_code && (
                    <span 
                      className="mono" 
                      title="Share code - click to copy"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(repo.share_code);
                        alert(`Copied share code: ${repo.share_code}`);
                      }}
                      style={{ 
                        fontSize: '10px', 
                        color: 'var(--teal)', 
                        background: 'var(--teal-glow)', 
                        border: '1px solid rgba(77, 238, 234, 0.2)',
                        padding: '2px 6px', 
                        borderRadius: '4px',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {repo.share_code}
                    </span>
                  )}
                </div>
                <div className="card-desc" style={{ marginBottom: '12px' }}>{repo.description}</div>
                
                {/* Real-time stats */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '12.5px', color: 'var(--text-dim)', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                  <div>
                    Tasks: <strong style={{ color: 'var(--text)' }}>{repo.openTasksCount || 0} open</strong>
                  </div>
                  {repo.lastDeployment && (
                    <div>
                      Last Deploy: <strong style={{ color: repo.lastDeployment.status === 'success' ? 'var(--green)' : 'var(--red)' }}>
                        {repo.lastDeployment.status} ({repo.lastDeployment.branch_name})
                      </strong>
                    </div>
                  )}
                </div>
              </div>

              {/* Active sessions list */}
              {repo.activeSessions && repo.activeSessions.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ fontSize: '10.5px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Active Sessions
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {repo.activeSessions.map((s, idx) => (
                      <span 
                        key={idx} 
                        className="mono" 
                        style={{ 
                          fontSize: '10.5px', 
                          color: 'var(--teal)', 
                          background: 'var(--teal-glow)', 
                          padding: '3px 8px', 
                          borderRadius: '4px', 
                          border: '1px solid rgba(77,238,234,0.15)' 
                        }}
                      >
                        {s.branch_name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            <div className="pulse-row" style={{ marginTop: 'auto', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div className={`pulse-dot ${repo.activeCount > 0 ? '' : 'idle'}`}></div>
                <div className={`pulse-label ${repo.activeCount > 0 ? '' : 'idle'}`} style={{ fontSize: '12px', fontWeight: 600 }}>
                  {repo.activeCount > 0 ? `${repo.activeCount} active now` : 'No one active'}
                </div>
              </div>
              
              {repo.riders && repo.riders.length > 0 && (
                <div className="stack" style={{ marginLeft: 'auto' }}>
                  {repo.riders.map((r, idx) => (
                    <div 
                      key={idx} 
                      className="avatar" 
                      style={{ 
                        backgroundColor: r === 'SJ' || r === 'JM' ? 'var(--violet)' : r === 'DK' ? 'var(--amber)' : 'var(--red)',
                        color: 'rgba(15, 23, 42, 0.85)',
                        zIndex: 5 - idx
                      }}
                    >
                      {r}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Register Repository Modal */}
      {showModal && (
        <div className="modal-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-card" style={{ width: '450px', padding: '24px', borderRadius: '14px', background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FolderPlus size={18} style={{ color: 'var(--teal)' }} />
                <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
                  {activeTab === 'register' ? 'Register New Repository' : 'Join Existing Project'}
                </h3>
              </div>
              <button 
                type="button" 
                style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: '18px', cursor: 'pointer' }}
                onClick={() => {
                  setShowModal(false);
                  setError(null);
                }}
              >
                ×
              </button>
            </div>

            {/* Tab Switched Header */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '16px' }}>
              <button
                type="button"
                onClick={() => { setActiveTab('register'); setError(null); }}
                style={{
                  flex: 1,
                  padding: '8px',
                  background: 'none',
                  border: 'none',
                  borderBottom: activeTab === 'register' ? '2px solid var(--teal)' : 'none',
                  color: activeTab === 'register' ? 'var(--teal)' : 'var(--text-dim)',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: 'pointer'
                }}
              >
                Register New
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('join'); setError(null); }}
                style={{
                  flex: 1,
                  padding: '8px',
                  background: 'none',
                  border: 'none',
                  borderBottom: activeTab === 'join' ? '2px solid var(--teal)' : 'none',
                  color: activeTab === 'join' ? 'var(--teal)' : 'var(--text-dim)',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: 'pointer'
                }}
              >
                Join Existing
              </button>
            </div>
            
            {activeTab === 'register' ? (
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="form-group">
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Repository Name</label>
                  <input 
                    type="text" 
                    className="form-control"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. MySuperApp"
                    style={{ fontSize: '13px', padding: '10px' }}
                    required
                  />
                </div>

                <div className="form-group">
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Description</label>
                  <textarea 
                    className="form-control"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="A brief description of this engineering codebase..."
                    style={{ fontSize: '13px', padding: '10px', resize: 'none' }}
                    rows={3}
                  />
                </div>

                <div className="form-group">
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>GitHub Repository (Optional)</label>
                  <input 
                    type="text" 
                    className="form-control"
                    value={githubRepo}
                    onChange={(e) => setGithubRepo(e.target.value)}
                    placeholder="e.g. Tech-Finity/MySuperApp"
                    style={{ fontSize: '13px', padding: '10px' }}
                  />
                  <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '4px' }}>
                    If provided, TeamSync will attempt to create the GitHub repository, set up remote origin, and push initial files.
                  </div>
                </div>

                <div className="form-group">
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Initial Branch Strategy</label>
                  <select 
                    className="form-control"
                    value={branchStrategy}
                    onChange={(e) => setBranchStrategy(e.target.value)}
                    style={{ fontSize: '13px', padding: '10px', backgroundColor: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '8px', color: '#ffffff', width: '100%', outline: 'none' }}
                  >
                    <option value="main-only">Main branch only (e.g. main/master)</option>
                    <option value="main-develop">Main + Develop strategy (main + develop branches)</option>
                  </select>
                </div>

                <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
                  <input 
                    type="checkbox"
                    id="allowSandboxDeploy"
                    checked={allowSandboxDeploy}
                    onChange={(e) => setAllowSandboxDeploy(e.target.checked)}
                    style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--teal)' }}
                  />
                  <label htmlFor="allowSandboxDeploy" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', cursor: 'pointer', userSelect: 'none' }}>
                    Allow Sandbox Local Deploy (port 5001)
                  </label>
                </div>

                {error && (
                  <div style={{ color: 'var(--red)', fontSize: '12px', padding: '8px 12px', background: 'rgba(248,113,113,0.1)', border: '1px solid var(--red)', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px' }}>
                    <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                    <span>{error}</span>
                  </div>
                )}

                <div className="modal-actions" style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
                  <button 
                    type="button" 
                    className="btn-secondary" 
                    onClick={() => {
                      setShowModal(false);
                      setError(null);
                    }}
                    style={{ padding: '8px 16px', fontSize: '13px' }}
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    className="btn-primary" 
                    disabled={isLoading || !name.trim()}
                    style={{ padding: '8px 16px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    {isLoading ? (
                      <>
                        <RefreshCw size={13} className="spin" />
                        <span>Initializing...</span>
                      </>
                    ) : (
                      <span>Register Repository</span>
                    )}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleJoinSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="form-group">
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Project Share Code</label>
                  <input 
                    type="text" 
                    className="form-control"
                    value={shareCode}
                    onChange={(e) => setShareCode(e.target.value)}
                    placeholder="e.g. TS-A1B2C3"
                    style={{ fontSize: '13px', padding: '10px' }}
                    required
                  />
                  <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '6px', lineHeight: '1.4' }}>
                    <strong>Note:</strong> Joining a project scopes it to your current dashboard, but does not grant you permissions on GitHub. You must be added as a collaborator to the GitHub repository separately by an owner.
                  </div>
                </div>

                {error && (
                  <div style={{ color: 'var(--red)', fontSize: '12px', padding: '8px 12px', background: 'rgba(248,113,113,0.1)', border: '1px solid var(--red)', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px' }}>
                    <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                    <span>{error}</span>
                  </div>
                )}

                <div className="modal-actions" style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
                  <button 
                    type="button" 
                    className="btn-secondary" 
                    onClick={() => {
                      setShowModal(false);
                      setError(null);
                    }}
                    style={{ padding: '8px 16px', fontSize: '13px' }}
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    className="btn-primary" 
                    disabled={isLoading || !shareCode.trim()}
                    style={{ padding: '8px 16px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    {isLoading ? (
                      <>
                        <RefreshCw size={13} className="spin" />
                        <span>Joining...</span>
                      </>
                    ) : (
                      <span>Join Project</span>
                    )}
                  </button>
                </div>
            </form>
          )}
          </div>
        </div>
      )}
    </div>
  );
}
