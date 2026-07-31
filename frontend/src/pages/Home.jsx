import React, { useState, useEffect } from 'react';
import { 
  Terminal, 
  Activity, 
  Clock, 
  Compass, 
  Server, 
  CheckSquare, 
  User, 
  Wifi, 
  ChevronRight,
  Shield,
  Layers,
  Cpu,
  BookOpen
} from 'lucide-react';

export default function Home({ 
  todayData, 
  currentUser, 
  users = [], 
  allTickets = [], 
  repos = [], 
  activePresence = [], 
  socket, 
  onUpdateTicketStatus, 
  onSelectRepo, 
  onJoinSession 
}) {
  const [showAllTickets, setShowAllTickets] = useState(false);
  const [tickerEvents, setTickerEvents] = useState([]);
  const [globalDeployments, setGlobalDeployments] = useState([]);
  
  // Ticker filter category states
  const [filterCategories, setFilterCategories] = useState({
    project: true,
    session: true,
    developer: true,
    ticket: true,
    deployment: true,
    documentation: true
  });

  const [configStatus, setConfigStatus] = useState({ githubConfigured: true });

  // Fetch initial event history for ticker
  const fetchEventHistory = async () => {
    try {
      const res = await fetch('/api/events?limit=30');
      if (res.ok) {
        const data = await res.json();
        setTickerEvents(data);
      }
    } catch (err) {
      console.error('Error fetching event history:', err);
    }
  };

  // Fetch global recent deployments
  const fetchGlobalDeployments = async () => {
    try {
      const res = await fetch('/api/deployments');
      if (res.ok) {
        const data = await res.json();
        setGlobalDeployments(data);
      }
    } catch (err) {
      console.error('Error fetching global deployments:', err);
    }
  };

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/config/status');
        if (res.ok) {
          const data = await res.json();
          setConfigStatus(data);
        }
      } catch (e) {
        console.warn('[Home] Failed to fetch config status:', e.message);
      }
    };

    fetchStatus();
    fetchEventHistory();
    fetchGlobalDeployments();

    // Poll deployments every 5s
    const interval = setInterval(() => {
      fetchGlobalDeployments();
    }, 5000);

    // Listen to WebSocket event:stream for real-time ticker events
    if (socket) {
      const handleEventStream = (event) => {
        setTickerEvents(prev => [event, ...prev].slice(0, 60)); // Keep last 60
      };
      
      socket.on('event:stream', handleEventStream);
      
      return () => {
        socket.off('event:stream', handleEventStream);
        clearInterval(interval);
      };
    }

    return () => clearInterval(interval);
  }, [socket]);

  // Handle category toggle
  const toggleCategory = (cat) => {
    setFilterCategories(prev => ({
      ...prev,
      [cat]: !prev[cat]
    }));
  };

  // Filter ticker events based on categories
  const filteredEvents = tickerEvents.filter(e => {
    const category = e.event_category?.toLowerCase() || 'other';
    return filterCategories[category] !== false;
  });

  // Displayed Tickets
  const displayedTickets = showAllTickets 
    ? allTickets.filter(t => t.status !== 'done') 
    : allTickets.filter(t => t.assignee_user_id === currentUser?.id && t.status !== 'done');

  // Format activity timeline strings for the ticker
  const getEventDescription = (e) => {
    let text = '';
    const meta = e.metadata ? (typeof e.metadata === 'string' ? JSON.parse(e.metadata) : e.metadata) : {};

    switch (e.event_type) {
      case 'presence:started':
        text = `started active presence on branch ${e.branch_name || 'main'} of ${e.repo_name}`;
        break;
      case 'presence:ended':
        text = `ended active presence on branch ${e.branch_name || 'main'} of ${e.repo_name}`;
        break;
      case 'ticket:created':
        text = `created ticket #${e.ticket_id || ''} "${meta.title || 'Untitled'}"`;
        break;
      case 'ticket:status_changed':
        text = `updated ticket #${e.ticket_id} to status: ${meta.new_status}`;
        break;
      case 'chat:message':
        text = `posted message in ${e.repo_name}/${e.branch_name} chat: "${meta.message ? meta.message.substring(0, 40) : ''}..."`;
        break;
      case 'document:created':
        text = `published documentation [${meta.doc_type || 'notes'}] "${meta.title || 'Untitled'}" for project ${e.repo_name || 'General'}`;
        break;
      case 'document:updated':
        text = `updated documentation "${meta.title || 'Untitled'}"`;
        break;
      case 'repo:synced':
        text = `pulled local workspace updates for ${e.repo_name} (branch ${e.branch_name})`;
        break;
      case 'session:created':
        text = `created collaborative session workspace TS-${e.session_id} on ${e.repo_name}/${e.branch_name}`;
        break;
      case 'git:commit':
        text = `committed to ${e.branch_name || 'main'} of ${e.repo_name}: "${meta.message || 'commit'}" (${meta.hash ? meta.hash.substring(0, 7) : ''})`;
        break;
      case 'git:branch_switch':
        text = `switched branch from ${meta.previous_branch || 'main'} to ${meta.new_branch || 'main'} on ${e.repo_name}`;
        break;
      case 'git:conflict':
        text = `encountered merge conflicts in ${meta.conflicted_files ? meta.conflicted_files.join(', ') : 'files'} on ${e.repo_name}/${e.branch_name}`;
        break;
      default:
        if (e.event_type.startsWith('deploy:')) {
          text = `triggered automated deployment (${meta.status || 'success'}) on ${e.repo_name}/${e.branch_name}`;
        } else {
          text = `performed system event ${e.event_type}`;
        }
    }
    return text;
  };

  // Style helper for event category tags
  const getCategoryColor = (cat) => {
    const mapping = {
      project: 'var(--teal)',
      session: 'var(--amber)',
      developer: 'var(--violet)',
      ticket: 'rgba(255,184,108,0.9)',
      deployment: 'var(--green)',
      documentation: 'var(--violet)'
    };
    return mapping[cat?.toLowerCase()] || 'var(--text-dim)';
  };

  return (
    <div className="view">
      
      {/* Welcome Banner */}
      <div className="page-header-card">
        <div className="page-header-title-area">
          <div className="page-header-title">
            <span>Welcome back, {currentUser?.display_name || 'developer'}</span>
            <span style={{
              fontSize: '11px',
              backgroundColor: 'rgba(77,238,234,0.1)',
              color: 'var(--teal)',
              padding: '3px 8px',
              borderRadius: '12px',
              fontWeight: 700,
              border: '1px solid var(--teal)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              <Wifi size={10} className="pulse" /> Ops Center Online
            </span>
          </div>
          <div className="page-header-desc">
            You are currently assigned {allTickets.filter(t => t.assignee_user_id === currentUser?.id && t.status !== 'done').length} active tickets across all projects.
          </div>
        </div>
      </div>

      {/* Demo Mode Banner */}
      {!configStatus.githubConfigured && (
        <div style={{
          background: 'linear-gradient(90deg, rgba(255, 184, 108, 0.1) 0%, rgba(255, 184, 108, 0.05) 100%)',
          border: '1px solid rgba(255, 184, 108, 0.25)',
          borderRadius: '12px',
          padding: '12px 18px',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontSize: '12.5px',
          color: 'var(--amber)'
        }}>
          <span style={{ fontSize: '16px' }}>⚠️</span>
          <div>
            <strong>Offline Demo Mode Active</strong> — Local/GitHub integration credentials not found in backend environment. Relying on seeded SQLite records as a fallback.
          </div>
        </div>
      )}

      {/* Main Grid: Three Column Top Dashboard, Full Ticker bottom */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '20px', marginBottom: '24px' }}>
        
        {/* Column 1: Registered Projects Grid */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '360px' }}>
          <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <Layers size={16} /> Active Projects
          </div>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {repos.length === 0 ? (
              <div style={{ color: 'var(--text-dim)', fontSize: '13px' }}>
                No active projects. Register one in Projects view.
              </div>
            ) : (
              repos.map((r) => {
                // Calculate active developers for this project
                const devsCount = activePresence.filter(p => p.repo_name === r.name).length;
                return (
                  <div 
                    key={r.name} 
                    onClick={() => onSelectRepo(r.name)}
                    style={{
                      padding: '12px',
                      borderRadius: '8px',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                    className="project-row-hover"
                  >
                    <div>
                      <div style={{ fontWeight: 700, color: '#ffffff', fontSize: '13px' }}>{r.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '240px' }}>
                        {r.description}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {devsCount > 0 && (
                        <span style={{
                          fontSize: '9px',
                          background: 'rgba(77,238,234,0.1)',
                          color: 'var(--teal)',
                          padding: '1px 5px',
                          borderRadius: '4px',
                          fontWeight: 700
                        }}>
                          {devsCount} active
                        </span>
                      )}
                      <ChevronRight size={14} style={{ color: 'var(--text-dim)' }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Column 2: Live Team Collaboration Sessions */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '360px' }}>
          <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <Activity size={16} /> Collaboration Sessions
          </div>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {activePresence.length === 0 ? (
              <div style={{ color: 'var(--text-dim)', fontSize: '13px', textAlign: 'center', padding: '40px 0' }}>
                No active collaboration sessions right now.
              </div>
            ) : (
              activePresence.map((p) => (
                <div 
                  key={p.user_id} 
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    fontSize: '12.5px',
                    boxShadow: '0 0 10px var(--teal-glow)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                    <div style={{ position: 'relative', display: 'inline-block', flexShrink: 0 }}>
                      <div className="avatar" style={{ backgroundColor: p.avatar_color || 'var(--violet)', color: 'rgba(15, 23, 42, 0.85)', width: '24px', height: '24px', fontSize: '11px', flexShrink: 0 }}>
                        {p.user_name ? p.user_name.split(' ').map(n => n[0]).join('').toUpperCase() : 'U'}
                      </div>
                      <span className="live-avatar-badge" style={{
                        position: 'absolute',
                        bottom: '-1px',
                        right: '-1px',
                        width: '7px',
                        height: '7px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--green)',
                        border: '1.5px solid var(--surface)',
                        display: 'block',
                        boxShadow: '0 0 4px var(--green)'
                      }}></span>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.user_name}</div>
                      <div style={{ fontSize: '10.5px', color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.repo_name} · <span className="mono">{p.branch_name}</span>
                      </div>
                    </div>
                  </div>
                  {p.session_link && (
                    <button 
                      className="btn-primary"
                      onClick={() => onJoinSession(p.repo_name, p.branch_name, p.session_link)}
                      style={{ padding: '4px 10px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}
                    >
                      Join
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Column 3: Recent deployments & tickets */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '360px' }}>
          <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <Server size={16} /> Recent Deployments
          </div>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {globalDeployments.length === 0 ? (
              <div style={{ color: 'var(--text-dim)', fontSize: '13px', fontStyle: 'italic', padding: '20px 0', textAlign: 'center' }}>
                No recent deployments recorded.
              </div>
            ) : (
              globalDeployments.map((d) => (
                <div key={d.id} style={{
                  padding: '10px 12px',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  fontSize: '12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <strong style={{ color: '#ffffff' }}>{d.repo_name}</strong>
                      <span className="mono" style={{ color: 'var(--text-dim)', fontSize: '10px' }}>
                        {d.branch_name}
                      </span>
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '2px' }}>
                      by {d.display_name || 'System'} · {new Date(d.deployed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <span style={{
                    fontSize: '9px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: d.status === 'success' ? 'var(--green)' : 'var(--red)',
                    background: d.status === 'success' ? 'var(--green-glow)' : 'rgba(255,85,85,0.1)',
                    padding: '1px 5px',
                    borderRadius: '4px',
                    border: `1px solid ${d.status === 'success' ? 'var(--green)' : 'var(--red)'}`
                  }}>
                    {d.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

      </div>

      {/* Grid: Tickets & Event Ticker */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr', gap: '20px' }}>
        
        {/* Left pane: User tickets */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '360px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div className="panel-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CheckSquare size={16} /> Work Backlog
            </div>
            
            <div style={{ display: 'flex', gap: '4px' }}>
              <button 
                onClick={() => setShowAllTickets(false)} 
                style={{
                  padding: '3px 8px',
                  fontSize: '11px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  backgroundColor: !showAllTickets ? 'var(--teal)' : 'var(--surface-2)',
                  color: !showAllTickets ? '#0c1116' : 'var(--text)',
                  border: '1px solid var(--border)'
                }}
              >
                My Tickets
              </button>
              <button 
                onClick={() => setShowAllTickets(true)} 
                style={{
                  padding: '3px 8px',
                  fontSize: '11px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  backgroundColor: showAllTickets ? 'var(--teal)' : 'var(--surface-2)',
                  color: showAllTickets ? '#0c1116' : 'var(--text)',
                  border: '1px solid var(--border)'
                }}
              >
                All Active
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {displayedTickets.length === 0 ? (
              <div style={{ padding: '24px 0', color: 'var(--text-dim)', fontSize: '13px', textAlign: 'center' }}>
                All clear! No pending tickets.
              </div>
            ) : (
              displayedTickets.map((t) => (
                <div 
                  key={t.id} 
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    fontSize: '12px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                    <div className={`prio-dot ${t.priority}`} style={{ flexShrink: 0 }}></div>
                    <div style={{ fontWeight: 600, color: '#ffffff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t.title}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ fontSize: '10px', color: 'var(--text-dim)', background: 'rgba(255,255,255,0.05)', padding: '1px 5px', borderRadius: '4px' }}>
                      {t.repo_or_project || 'General'}
                    </span>
                    <select
                      value={t.assignee_user_id || ''}
                      onChange={(e) => {
                        const nextVal = e.target.value ? parseInt(e.target.value, 10) : null;
                        onUpdateTicketStatus(t.id, t.status, nextVal);
                      }}
                      style={{
                        backgroundColor: 'rgba(0,0,0,0.3)',
                        border: '1px solid var(--border)',
                        color: 'var(--text)',
                        borderRadius: '4px',
                        padding: '2px 4px',
                        fontSize: '11px',
                        cursor: 'pointer'
                      }}
                    >
                      <option value="">Unassigned</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.display_name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right pane: Live Activity Stream */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '360px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
            <div className="panel-title" style={{ margin: 0, border: 'none', padding: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Activity size={16} /> Live Activity Stream
            </div>
            
            {/* Filter tags */}
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {Object.keys(filterCategories).map(cat => (
                <span 
                  key={cat}
                  onClick={() => toggleCategory(cat)}
                  style={{
                    fontSize: '9px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    transition: 'all 0.15s',
                    border: `1px solid ${filterCategories[cat] ? getCategoryColor(cat) : 'var(--border)'}`,
                    color: filterCategories[cat] ? '#0c1116' : 'var(--text-dim)',
                    background: filterCategories[cat] ? getCategoryColor(cat) : 'transparent'
                  }}
                >
                  {cat}
                </span>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {filteredEvents.length === 0 ? (
              <div style={{ padding: '24px 0', color: 'var(--text-dim)', fontSize: '13px', textAlign: 'center', fontStyle: 'italic' }}>
                Awaiting live activity...
              </div>
            ) : (
              filteredEvents.map((e) => {
                const initials = e.user_name ? e.user_name.split(' ').map(n => n[0]).join('').toUpperCase() : 'SYS';
                return (
                  <div key={e.id} style={{ display: 'flex', gap: '10px', alignItems: 'start', padding: '8px 10px', background: 'var(--surface-2)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                    <div className="avatar" style={{
                      backgroundColor: e.user_name ? 'var(--violet)' : 'var(--border)',
                      color: '#0c1116',
                      width: '24px',
                      height: '24px',
                      fontSize: '10px',
                      flexShrink: 0,
                      fontWeight: 700
                    }}>
                      {initials}
                    </div>
                    <div style={{ flex: 1, minWidth: 0, fontSize: '12px' }}>
                      <div style={{ color: 'var(--text)', lineHeight: '1.4' }}>
                        <strong style={{ color: '#ffffff' }}>{e.user_name || 'System'}</strong>{' '}
                        {getEventDescription(e)}
                      </div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px', fontSize: '10px', color: 'var(--text-dim)' }}>
                        <span style={{ color: getCategoryColor(e.event_category), fontWeight: 700, textTransform: 'uppercase' }}>
                          {e.event_category || 'system'}
                        </span>
                        <span>•</span>
                        <span>{new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        {e.event_type?.startsWith('git:') && (
                          <>
                            <span>•</span>
                            <span style={{
                              background: 'rgba(77, 238, 234, 0.08)',
                              border: '1px solid rgba(77, 238, 234, 0.3)',
                              color: 'var(--teal)',
                              fontSize: '8.5px',
                              fontWeight: 800,
                              letterSpacing: '0.5px',
                              padding: '1px 5px',
                              borderRadius: '4px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px'
                            }}>
                              <span style={{
                                width: '4px',
                                height: '4px',
                                borderRadius: '50%',
                                backgroundColor: 'var(--teal)',
                                display: 'inline-block',
                                animation: 'pulse 1.5s infinite'
                              }}></span>
                              ⚡ LIVE
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>

    </div>
  );
}
