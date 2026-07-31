import React, { useState } from 'react';

export default function BranchMap({ branches, onWorkOnBranch, activePresence, currentUser, repoName }) {
  const [cloneStates, setCloneStates] = useState({}); // { [branchName]: { status, errorMsg } }

  // Check if current user is active on a given branch
  const isCurrentUserOnBranch = (branchName) => {
    return activePresence.some(
      p => p.user_id === currentUser.id && p.branch_name === branchName
    );
  };

  // Get other users on a branch
  const getBranchCollaborators = (branchName) => {
    return activePresence.filter(p => p.branch_name === branchName);
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
          repo: repoName,
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
          headers: { 'Content-Type': 'application/json' },
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

      // Revert back to idle after a few seconds
      setTimeout(() => {
        setCloneStates(prev => ({
          ...prev,
          [branchName]: { status: 'idle' }
        }));
      }, 5000);

    } catch (err) {
      console.error('[BranchMap] Get Local failed:', err);
      setCloneStates(prev => ({
        ...prev,
        [branchName]: { status: 'error', errorMsg: err.message }
      }));
    }
  };

  return (
    <div className="map-wrap">
      {branches.length === 0 ? (
        <div style={{ padding: '20px 0', color: 'var(--text-dim)', textAlign: 'center', fontSize: '14px' }}>
          No branches found.
        </div>
      ) : (
        branches.map((b) => {
          const isJoined = isCurrentUserOnBranch(b.name);
          const collaborators = getBranchCollaborators(b.name);
          const state = cloneStates[b.name] || { status: 'idle' };

          return (
            <div key={b.name} className="branch-line">
              <div className={`branch-node ${b.isMain ? 'main' : ''} ${collaborators.length > 0 ? 'active-session' : ''}`}>
                {b.isMain ? '>' : '○'}
              </div>
              <div className="branch-info">
                <div className="branch-name">{b.name}</div>
                <div className="branch-meta" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>{b.meta}</span>
                  {b.pr && (
                    <a 
                      href={b.pr.url} 
                      target="_blank" 
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        fontSize: '9px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        textDecoration: 'none',
                        color: b.pr.status === 'open' ? 'var(--amber)' : b.pr.status === 'merged' ? 'var(--green)' : 'var(--red)',
                        background: b.pr.status === 'open' ? 'rgba(255,184,108,0.1)' : b.pr.status === 'merged' ? 'var(--green-glow)' : 'rgba(255,85,85,0.1)',
                        padding: '1px 5px',
                        borderRadius: '4px',
                        border: `1px solid ${b.pr.status === 'open' ? 'var(--amber)' : b.pr.status === 'merged' ? 'var(--green)' : 'var(--red)'}`,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '2px'
                      }}
                      title={b.pr.title}
                    >
                      PR #{b.pr.number} ({b.pr.status}) ↗
                    </a>
                  )}
                </div>
              </div>
              
              {collaborators.length > 0 && (
                <div className="branch-collaborators">
                  {collaborators.map((r) => (
                    <div key={r.user_id} className="collaborator" title={`${r.display_name || r.username} is active here`}>
                      <div 
                        className="avatar" 
                        style={{ backgroundColor: r.avatar_color || 'var(--violet)', color: '#0C1116' }}
                      >
                        {r.display_name ? r.display_name.split(' ').map(n => n[0]).join('').toUpperCase() : 'U'}
                      </div>
                      <span>{r.display_name || r.username}</span>
                    </div>
                  ))}
                </div>
              )}
              
              {!b.isMain && (
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button 
                    className={`work-btn ${isJoined ? 'joined' : ''}`}
                    onClick={() => onWorkOnBranch(b.name, isJoined)}
                  >
                    {isJoined ? 'In session' : 'Work on this'}
                  </button>
                  
                  {(() => {
                    let btnText = 'Sync Workspace';
                    let btnClass = 'local-btn';
                    
                    if (state.status === 'loading') {
                      btnText = 'Syncing...';
                      btnClass += ' loading';
                    } else if (state.status === 'success') {
                      btnText = 'Synced';
                      btnClass += ' success';
                    } else if (state.status === 'error') {
                      btnText = 'Error';
                      btnClass += ' error';
                    }
                    
                    return (
                      <button 
                        className={btnClass}
                        onClick={() => handleGetLocal(b.name)}
                        disabled={state.status === 'loading'}
                        title={state.status === 'error' ? state.errorMsg : 'Clone and open branch locally'}
                      >
                        {state.status === 'loading' && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ marginRight: '6px', animation: 'spin 1s linear infinite' }}>
                            <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8" />
                          </svg>
                        )}
                        {state.status === 'success' && (
                          <span style={{ marginRight: '4px' }}>✓</span>
                        )}
                        {state.status === 'error' && (
                          <span style={{ marginRight: '4px' }}>⚠</span>
                        )}
                        {btnText}
                      </button>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
