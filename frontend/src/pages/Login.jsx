import React, { useState } from 'react';

export default function Login({ onLogin, users }) {
  const [username, setUsername] = useState('you');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!username.trim()) return;
    
    // Find matched seed user
    const matchedUser = users.find(
      u => u.username === username.toLowerCase().trim()
    ) || users[0]; // fallback to first user (You / JM)
    
    onLogin(matchedUser);
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">&gt;_</div>
        <h1 className="login-title display">TeamSync</h1>
        <p className="login-sub">Internal Developer Hub</p>
        
        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ textAlign: 'left' }}>
            <label>Login Username</label>
            <select 
              className="form-control"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={{ padding: '12px', fontSize: '14px' }}
            >
              {users.map(u => (
                <option key={u.id} value={u.username}>{u.display_name} ({u.username})</option>
              ))}
            </select>
          </div>
          
          <button 
            type="submit" 
            className="btn-primary" 
            style={{ width: '100%', padding: '12px', borderRadius: '8px', fontWeight: 600, marginTop: '10px' }}
          >
            Enter Dashboard
          </button>
        </form>
      </div>
    </div>
  );
}
