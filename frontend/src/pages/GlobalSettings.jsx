import React, { useState } from 'react';
import { Settings, Shield, UserPlus, Trash2 } from 'lucide-react';

export default function GlobalSettings({ users = [], onAddUser, onRemoveUser }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [avatarColor, setAvatarColor] = useState('var(--violet)');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!username.trim() || !displayName.trim()) return;

    if (onAddUser) {
      onAddUser({
        username: username.trim().toLowerCase(),
        display_name: displayName.trim(),
        email: email.trim() || null,
        avatar_color: avatarColor
      });
    }

    // Reset Form
    setUsername('');
    setDisplayName('');
    setEmail('');
    setAvatarColor('var(--violet)');
    setShowAddForm(false);
  };

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
            className="btn-primary" 
            onClick={() => setShowAddForm(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', fontSize: '13px' }}
          >
            <UserPlus size={16} /> Add Developer Profile
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
                  No developer profiles configured. Create one to get started.
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

      {showAddForm && (
        <div className="modal-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-card" style={{ width: '450px', padding: '24px', borderRadius: '14px', background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="modal-title" style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>Add Developer Profile</div>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="form-group">
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Display Name</label>
                <input 
                  type="text" 
                  className="form-control" 
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Jane Doe"
                  required
                  style={{ fontSize: '13px', padding: '10px' }}
                />
              </div>

              <div className="form-group">
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>GitHub Username</label>
                <input 
                  type="text" 
                  className="form-control" 
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. jane"
                  required
                  style={{ fontSize: '13px', padding: '10px' }}
                />
              </div>

              <div className="form-group">
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Email Address</label>
                <input 
                  type="email" 
                  className="form-control" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. jane@company.com"
                  style={{ fontSize: '13px', padding: '10px' }}
                />
              </div>

              <div className="form-group">
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Avatar Accent Color</label>
                <select 
                  className="form-control" 
                  value={avatarColor}
                  onChange={(e) => setAvatarColor(e.target.value)}
                  style={{ fontSize: '13px', padding: '10px', backgroundColor: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '8px', color: '#ffffff', width: '100%' }}
                >
                  <option value="var(--violet)">Violet</option>
                  <option value="var(--amber)">Amber</option>
                  <option value="var(--red)">Red</option>
                  <option value="var(--teal)">Teal</option>
                  <option value="var(--blue)">Blue</option>
                  <option value="var(--green)">Green</option>
                </select>
              </div>

              <div className="modal-actions" style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '12px' }}>
                <button 
                  type="button" 
                  className="btn-secondary"
                  onClick={() => setShowAddForm(false)}
                  style={{ padding: '8px 16px', fontSize: '13px' }}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary" style={{ padding: '8px 16px', fontSize: '13px' }}>
                  Create Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
