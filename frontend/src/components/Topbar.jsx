import React from 'react';
import { Sun, Moon, Settings } from 'lucide-react';

export function getInitials(displayName, username) {
  if (!displayName || typeof displayName !== 'string') {
    return getFallbackInitials(username);
  }

  const tokens = displayName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return getFallbackInitials(username);
  }

  const limitedTokens = tokens.slice(0, 2);
  const initials = limitedTokens.map(t => t[0]);
  const allAreLetters = initials.every(char => /^[a-zA-Z]$/.test(char));

  if (!allAreLetters) {
    return getFallbackInitials(username);
  }

  return initials.join('').toUpperCase();
}

function getFallbackInitials(username) {
  if (!username || typeof username !== 'string') {
    return 'TS';
  }
  const cleanUser = username.trim();
  if (cleanUser.length === 0) return 'TS';
  return cleanUser.slice(0, 2).toUpperCase();
}

// Simple inline unit test assertion helper
function assertEqual(actual, expected, testName) {
  if (actual !== expected) {
    console.error(`[Topbar Test Fail] ${testName}: Expected "${expected}", but got "${actual}"`);
  } else {
    console.log(`[Topbar Test Pass] ${testName}`);
  }
}

// Run inline tests immediately on load to verify correctness
try {
  assertEqual(getInitials("John Doe", "johndoe"), "JD", "Normal two-word name");
  assertEqual(getInitials("Sarah", "sarah"), "S", "Single-word name");
  assertEqual(getInitials("", "nathanworkprime"), "NA", "Empty string with username fallback");
  assertEqual(getInitials("   ", "nathanworkprime"), "NA", "Whitespace string with username fallback");
  assertEqual(getInitials("1:nathan:Nathan, 3:conroy-byleveldt:conroy-Byleveldt", "nathanworkprime"), "NA", "Malformed multi-colon string");
  assertEqual(getInitials(null, "sarah"), "SA", "Null display name");
} catch (e) {
  console.error("Error running Topbar getInitials inline tests:", e);
}

export default function Topbar({ activeView, onViewChange, currentUser, theme, onThemeToggle }) {
  return (
    <div className="topbar">
      <div className="brand" style={{ cursor: 'pointer' }} onClick={() => onViewChange('projects')}>
        <div className="brand-mark">&gt;_</div>
        <div className="brand-name">TeamSync</div>
      </div>

      <div className="who" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button
          onClick={() => onViewChange('global-settings')}
          style={{
            background: 'none',
            border: 'none',
            color: activeView === 'global-settings' ? 'var(--teal)' : 'var(--text-dim)',
            cursor: 'pointer',
            padding: '6px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.15s ease',
            marginRight: '4px'
          }}
          className="global-settings-btn"
          title="Global Application Settings"
        >
          <Settings size={15} />
        </button>

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
          {getInitials(currentUser?.display_name, currentUser?.username)}
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
