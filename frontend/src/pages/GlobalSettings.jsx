import React from 'react';
import { Settings, Shield, Trash2, ArrowLeft } from 'lucide-react';

export default function GlobalSettings({ users = [], onRemoveUser, onViewChange }) {
  const handleRemove = (userId, name) => {
    if (window.confirm(`Are you sure you want to remove user "${name}"?`)) {
      if (onRemoveUser) {
        onRemoveUser(userId);
      }
    }
  };

  return (
    <div className="view" style={{ padding: '32px', maxWidth: '1200px', margin: '0 auto' }}>
      <div className="page-header-card" style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <div className="page-header-title-area">
            <div className="page-header-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Settings size={22} style={{ color: 'var(--teal)' }} />
              <span>Global Application Settings</span>
            </div>
            <div className="page-header-desc">
              Manage system-wide developer accounts, profile roles, and access settings across all workspaces.
            </div>
          </div>
          <button 
            className="btn-secondary" 
            onClick={() => onViewChange('projects')}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', fontSize: '13px', border: '1px solid var(--border)' }}
          >
            <ArrowLeft size={16} /> Back to Projects
          </button>
        </div>
      </div>

      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Shield size={16} style={{ color: 'var(--teal)' }} />
          <strong style={{ fontSize: '14px' }}>Developer Accounts Directory</strong>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
          <thead>
            <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '12px 24px', color: 'var(--text-dim)', fontWeight: 600 }}>Display Name</th>
              <th style={{ padding: '12px 24px', color: 'var(--text-dim)', fontWeight: 600 }}>GitHub Username</th>
              <th style={{ padding: '12px 24px', color: 'var(--text-dim)', fontWeight: 600 }}>Email Address</th>
              <th style={{ padding: '12px 24px', color: 'var(--text-dim)', fontWeight: 600 }}>Auth Method</th>
              <th style={{ padding: '12px 24px', color: 'var(--text-dim)', fontWeight: 600, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan="5" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-dim)' }}>
                  No developer profiles configured.
                </td>
              </tr>
            ) : (
              users.map((u) => {
                const isOauthUser = !!u.github_id;
                return (
                  <tr key={u.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background-color 0.15s ease' }}>
                    <td style={{ padding: '16px 24px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ 
                        width: '28px', 
                        height: '28px', 
                        borderRadius: '50%', 
                        backgroundColor: u.avatar_color || 'var(--violet)',
                        color: 'rgba(15, 23, 42, 0.85)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '12px',
                        fontWeight: 700
                      }}>
                        {u.display_name ? u.display_name.split(' ').map(n => n[0]).join('').toUpperCase() : '??'}
                      </div>
                      {u.display_name}
                    </td>
                    <td style={{ padding: '16px 24px', fontFamily: 'JetBrains Mono', color: 'var(--teal)' }}>{u.username}</td>
                    <td style={{ padding: '16px 24px', color: 'var(--text-dim)' }}>{u.email || '—'}</td>
                    <td style={{ padding: '16px 24px' }}>
                      <span style={{ 
                        fontSize: '11px', 
                        fontWeight: 700, 
                        textTransform: 'uppercase',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        background: isOauthUser ? 'rgba(77,238,234,0.1)' : 'rgba(157,140,255,0.1)',
                        color: isOauthUser ? 'var(--teal)' : 'var(--violet)',
                        border: `1px solid ${isOauthUser ? 'rgba(77,238,234,0.2)' : 'rgba(157,140,255,0.2)'}`
                      }}>
                        {isOauthUser ? 'GitHub OAuth' : 'Local Fallback'}
                      </span>
                    </td>
                    <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                      <button 
                        className="btn-secondary" 
                        style={{ padding: '6px 12px', fontSize: '12px', color: 'var(--red)', borderColor: 'var(--red)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        onClick={() => handleRemove(u.id, u.display_name)}
                      >
                        <Trash2 size={13} />
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
