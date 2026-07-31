import React from 'react';

export default function Topbar({ activeView, onViewChange, currentUser }) {
  return (
    <div className="topbar">
      <div className="brand" style={{ cursor: 'pointer' }} onClick={() => onViewChange('home')}>
        <div className="brand-mark">&gt;_</div>
        <div className="brand-name">TeamSync</div>
      </div>
      
      <div className="tabs">
        <div 
          className={`tab ${activeView === 'home' ? 'active' : ''}`} 
          onClick={() => onViewChange('home')}
        >
          Home
        </div>
        <div 
          className={`tab ${activeView === 'projects' || activeView === 'repo' ? 'active' : ''}`} 
          onClick={() => onViewChange('projects')}
        >
          Projects
        </div>
        <div 
          className={`tab ${activeView === 'session' ? 'active' : ''}`} 
          onClick={() => onViewChange('session')}
        >
          Session
        </div>
        <div 
          className={`tab ${activeView === 'integrations' ? 'active' : ''}`} 
          onClick={() => onViewChange('integrations')}
        >
          Integrations
        </div>
      </div>

      <div className="who" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div className="avatar" style={{ backgroundColor: currentUser?.avatar_color || '#9D8CFF', color: '#0C1116' }}>
          {currentUser?.display_name ? currentUser.display_name.split(' ').map(n => n[0]).join('').toUpperCase() : 'JM'}
        </div>
        <span>{currentUser?.display_name || 'You'}</span>
        <button 
          onClick={() => {
            if (window.confirm("Logout of TeamSync?")) {
              onViewChange('logout');
            }
          }}
          style={{
            background: 'rgba(255, 85, 85, 0.1)',
            border: '1px solid var(--red)',
            color: 'var(--red)',
            padding: '4px 10px',
            borderRadius: '6px',
            fontSize: '11px',
            cursor: 'pointer',
            fontWeight: 700,
            transition: 'all 0.15s ease'
          }}
          className="logout-btn"
          title="Sign out of TeamSync"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
