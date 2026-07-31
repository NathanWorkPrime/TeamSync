import React from 'react';

export default function Projects({ repos, onSelectRepo }) {
  return (
    <div className="view">
      <div className="page-header-card">
        <div className="page-header-title-area">
          <div className="page-header-title">Engineering Project Repositories</div>
          <div className="page-header-desc">
            {repos.length} repositories registered · {repos.reduce((acc, r) => acc + (r.activeCount || 0), 0)} people currently active
          </div>
        </div>
      </div>
      
      <div className="grid">
        {repos.map((repo) => (
          <div 
            key={repo.name} 
            className="card" 
            onClick={() => onSelectRepo(repo.name)}
          >
            <div>
              <div className="card-title">{repo.name}</div>
              <div className="card-desc">{repo.description}</div>
            </div>
            
            <div className="pulse-row">
              <div className={`pulse-dot ${repo.activeCount > 0 ? '' : 'idle'}`}></div>
              <div className={`pulse-label ${repo.activeCount > 0 ? '' : 'idle'}`}>
                {repo.activeCount > 0 ? `${repo.activeCount} working now` : 'No one active'}
              </div>
              
              {repo.riders && repo.riders.length > 0 && (
                <div className="stack">
                  {repo.riders.map((r, idx) => (
                    <div 
                      key={idx} 
                      className="avatar" 
                      style={{ 
                        backgroundColor: r === 'SJ' || r === 'JM' ? 'var(--violet)' : r === 'DK' ? 'var(--amber)' : 'var(--red)',
                        color: '#0C1116',
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
    </div>
  );
}
