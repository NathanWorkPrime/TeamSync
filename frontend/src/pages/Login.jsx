import React, { useState, useEffect } from 'react';

export default function Login({ onLogin, users }) {
  const [oauthEnabled, setOauthEnabled] = useState(false);
  const [allowDevMockLogin, setAllowDevMockLogin] = useState(false);

  useEffect(() => {
    fetch('/api/auth/config')
      .then(res => res.json())
      .then(config => {
        setOauthEnabled(config.githubOAuthEnabled);
        setAllowDevMockLogin(config.allowDevMockLogin);
      })
      .catch(err => console.error('Failed to load auth config:', err));
  }, []);

  const handleGithubSignIn = () => {
    const origin = window.location.origin;
    window.location.href = `/api/auth/github?origin=${encodeURIComponent(origin)}`;
  };

  const handleDevBypass = () => {
    const fallbackUser = users.find(u => u.username === 'you') || users[0] || {
      id: 1,
      username: 'you',
      display_name: 'Default Developer',
      email: 'you@company.com',
      avatar_color: 'var(--violet)'
    };
    onLogin(fallbackUser);
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">&gt;_</div>
        <h1 className="login-title display">TeamSync</h1>
        <p className="login-sub" style={{ marginBottom: '32px' }}>Internal Developer Hub</p>
        
        {/* GitHub OAuth Button */}
        <button 
          type="button"
          onClick={handleGithubSignIn}
          className="btn-primary" 
          style={{ 
            width: '100%', 
            padding: '12px', 
            borderRadius: '8px', 
            fontWeight: 600, 
            marginBottom: allowDevMockLogin ? '20px' : '0px',
            backgroundColor: '#24292e',
            borderColor: '#24292e',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            cursor: 'pointer',
            transition: 'opacity 0.15s ease'
          }}
          onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
          onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
        >
          <svg height="20" aria-hidden="true" viewBox="0 0 16 16" version="1.1" width="20" fill="currentColor">
              <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.35 3.09.87 0 .48.01.93.01 1.09 0 .22-.15.47-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path>
          </svg>
          Sign in with GitHub
        </button>

        {/* Developer Sandbox Bypass Option */}
        {allowDevMockLogin && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', color: 'var(--text-dim)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              <div style={{ flexGrow: 1, height: '1px', background: 'var(--border)' }}></div>
              <span>Developer Bypass</span>
              <div style={{ flexGrow: 1, height: '1px', background: 'var(--border)' }}></div>
            </div>

            <button 
              type="button" 
              onClick={handleDevBypass}
              className="btn-secondary" 
              style={{ width: '100%', padding: '12px', borderRadius: '8px', fontWeight: 600, borderColor: 'var(--amber)', color: 'var(--amber)' }}
            >
              Developer Bypass (Sandbox Mode)
            </button>
          </>
        )}
      </div>
    </div>
  );
}
