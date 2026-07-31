import React from 'react';
import { Sun, Moon } from 'lucide-react';

export default function Topbar({ activeView, onViewChange, currentUser, theme, onThemeToggle }) {
  return (
    <div className="topbar">
      <div className="brand" style={{ cursor: 'pointer' }} onClick={() => onViewChange('projects')}>
        <div className="brand-mark">&gt;_</div>
        <div className="brand-name">TeamSync</div>
      </div>

      <div className="who" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button
          onClick={onThemeToggle}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            padding: '6px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.15s ease',
            marginRight: '4px'
          }}
          className="theme-toggle-btn"
          title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
        >
          {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
        </button>

        <div className="avatar" style={{ backgroundColor: currentUser?.avatar_color || '#9D8CFF', color: 'rgba(15, 23, 42, 0.85)', position: 'relative' }}>
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
