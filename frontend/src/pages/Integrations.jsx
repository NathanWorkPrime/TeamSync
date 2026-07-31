import React, { useState } from 'react';

export default function Integrations({ integrations, onRegisterIntegration }) {
  const [sourceKey, setSourceKey] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [callbackUrl, setCallbackUrl] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!sourceKey || !displayName) return;

    onRegisterIntegration({
      source_key: sourceKey.trim().toLowerCase().replace(/\s+/g, '-'),
      display_name: displayName.trim(),
      outbound_callback_url: callbackUrl.trim()
    });

    // Reset Form
    setSourceKey('');
    setDisplayName('');
    setCallbackUrl('');
    setShowAddForm(false);
  };

  return (
    <div className="view">
      <div className="page-header-card">
        <div className="page-header-title-area">
          <div className="page-header-title">External Client Integrations</div>
          <div className="page-header-desc">
            Manage two-way sync credentials for internal client apps and companion extensions.
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 className="display" style={{ fontSize: '18px', fontWeight: 600 }}>
          Connected Systems
        </h2>
        <button 
          className="btn-primary" 
          onClick={() => setShowAddForm(true)}
        >
          + Register Client App
        </button>
      </div>

      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
          <thead>
            <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '12px 16px', color: 'var(--text-dim)' }}>Name</th>
              <th style={{ padding: '12px 16px', color: 'var(--text-dim)' }}>Source Key</th>
              <th style={{ padding: '12px 16px', color: 'var(--text-dim)' }}>Webhook Secret</th>
              <th style={{ padding: '12px 16px', color: 'var(--text-dim)' }}>Outbound Callback</th>
              <th style={{ padding: '12px 16px', color: 'var(--text-dim)' }}>API Key</th>
              <th style={{ padding: '12px 16px', color: 'var(--text-dim)' }}>Registered</th>
            </tr>
          </thead>
          <tbody>
            {integrations.length === 0 ? (
              <tr>
                <td colSpan="6" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-dim)' }}>
                  No external integrations configured.
                </td>
              </tr>
            ) : (
              integrations.map((int) => (
                <tr key={int.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600 }}>{int.display_name}</td>
                  <td style={{ padding: '12px 16px', fontFamily: 'JetBrains Mono', color: 'var(--teal)' }}>{int.source_key}</td>
                  <td style={{ padding: '12px 16px', fontFamily: 'JetBrains Mono' }}>
                    {int.inbound_webhook_secret || '••••••••'}
                  </td>
                  <td style={{ padding: '12px 16px', color: 'var(--text-dim)' }}>
                    {int.outbound_callback_url || '—'}
                  </td>
                  <td style={{ padding: '12px 16px', fontFamily: 'JetBrains Mono' }}>
                    {int.outbound_api_key || '••••••••'}
                  </td>
                  <td style={{ padding: '12px 16px', color: 'var(--text-dim)' }}>
                    {new Date(int.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showAddForm && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-title">Register External Client App</div>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Display Name</label>
                <input 
                  type="text" 
                  className="form-control" 
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Client App Alpha"
                  required
                />
              </div>

              <div className="form-group">
                <label>Source Key (Identifier)</label>
                <input 
                  type="text" 
                  className="form-control" 
                  value={sourceKey}
                  onChange={(e) => setSourceKey(e.target.value)}
                  placeholder="e.g. client-app-alpha"
                  required
                />
              </div>

              <div className="form-group">
                <label>Outbound Callback URL (API callback for ticketing changes)</label>
                <input 
                  type="url" 
                  className="form-control" 
                  value={callbackUrl}
                  onChange={(e) => setCallbackUrl(e.target.value)}
                  placeholder="https://client-app-alpha.internal/webhooks/tickets"
                />
              </div>

              <div className="modal-actions">
                <button 
                  type="button" 
                  className="btn-secondary"
                  onClick={() => setShowAddForm(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Save Integration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
