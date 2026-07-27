import React, { useState, useEffect } from 'react';
import BranchMap from '../components/BranchMap';
import KanbanBoard from '../components/KanbanBoard';
import { 
  GitBranch, 
  FileText, 
  Activity, 
  CheckSquare, 
  BookOpen, 
  Search, 
  Plus, 
  Trash2, 
  Edit2, 
  Server, 
  Clock, 
  User, 
  Heart, 
  AlertCircle 
} from 'lucide-react';

export default function RepoView({ 
  repoName, 
  onBack, 
  branches, 
  tickets, 
  users, 
  activePresence, 
  currentUser, 
  onWorkOnBranch, 
  onAddTicket, 
  onUpdateTicketStatus 
}) {
  const [subTab, setSubTab] = useState('overview');
  const [showNewTicketModal, setShowNewTicketModal] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState(null);
  
  // Overview state
  const [overview, setOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(true);

  // Docs state
  const [docs, setDocs] = useState([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [docSearch, setDocSearch] = useState('');
  const [docTypeFilter, setDocTypeFilter] = useState('');
  const [showNewDocModal, setShowNewDocModal] = useState(false);
  const [showEditDocModal, setShowEditDocModal] = useState(false);
  
  // Form states for new ticket
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPriority, setNewPriority] = useState('low');
  const [newAssignee, setNewAssignee] = useState('');
  const [newStatus, setNewStatus] = useState('todo');

  // Form states for docs
  const [newDocTitle, setNewDocTitle] = useState('');
  const [newDocContent, setNewDocContent] = useState('');
  const [newDocType, setNewDocType] = useState('notes');
  const [newDocScope, setNewDocScope] = useState('project');
  const [newDocTicketId, setNewDocTicketId] = useState('');
  const [newDocSessionId, setNewDocSessionId] = useState('');

  // Edit doc state
  const [editDocTitle, setEditDocTitle] = useState('');
  const [editDocContent, setEditDocContent] = useState('');
  const [editDocType, setEditDocType] = useState('notes');

  // Filter states for tickets
  const [prioFilter, setPrioFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');

  // Fetch overview data
  const fetchOverviewData = async () => {
    try {
      const res = await fetch(`/api/repos/${repoName}/overview`);
      if (res.ok) {
        const data = await res.json();
        setOverview(data);
      }
    } catch (err) {
      console.error('Error fetching repo overview:', err);
    } finally {
      setOverviewLoading(false);
    }
  };

  // Fetch documents
  const fetchDocs = async () => {
    try {
      let url = `/api/docs?repo_name=${repoName}`;
      if (docSearch) url += `&search=${encodeURIComponent(docSearch)}`;
      if (docTypeFilter) url += `&doc_type=${docTypeFilter}`;
      
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setDocs(data);
        // If a document is selected, refresh its content in details panel
        if (selectedDoc) {
          const refreshed = data.find(d => d.id === selectedDoc.id);
          if (refreshed) {
            setSelectedDoc(refreshed);
          } else {
            setSelectedDoc(null);
          }
        }
      }
    } catch (err) {
      console.error('Error fetching docs:', err);
    } finally {
      setDocsLoading(false);
    }
  };

  // Poll for overview and docs periodically
  useEffect(() => {
    fetchOverviewData();
    fetchDocs();

    const interval = setInterval(() => {
      fetchOverviewData();
      fetchDocs();
    }, 5000);

    return () => clearInterval(interval);
  }, [repoName, docSearch, docTypeFilter]);

  // Handle ticket submission
  const handleCreateTicketSubmit = (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    onAddTicket({
      title: newTitle,
      description: newDescription,
      priority: newPriority,
      assignee_user_id: newAssignee ? parseInt(newAssignee, 10) : null,
      status: newStatus,
      repo_or_project: repoName,
      source: 'github'
    });

    setNewTitle('');
    setNewDescription('');
    setNewPriority('low');
    setNewAssignee('');
    setNewStatus('todo');
    setShowNewTicketModal(false);
  };

  // Handle doc submission
  const handleCreateDocSubmit = async (e) => {
    e.preventDefault();
    if (!newDocTitle.trim()) return;

    try {
      const payload = {
        title: newDocTitle,
        content: newDocContent,
        scope: newDocScope,
        repo_name: repoName,
        doc_type: newDocType,
        created_by_user_id: currentUser?.id || 1
      };
      if (newDocScope === 'ticket' && newDocTicketId) {
        payload.ticket_id = parseInt(newDocTicketId, 10);
      }
      if (newDocScope === 'session' && newDocSessionId) {
        payload.session_id = parseInt(newDocSessionId, 10);
      }

      const res = await fetch('/api/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setNewDocTitle('');
        setNewDocContent('');
        setNewDocType('notes');
        setNewDocScope('project');
        setNewDocTicketId('');
        setNewDocSessionId('');
        setShowNewDocModal(false);
        fetchDocs();
        fetchOverviewData();
      }
    } catch (err) {
      console.error('Error creating doc:', err);
    }
  };

  // Handle doc edits
  const handleEditDocSubmit = async (e) => {
    e.preventDefault();
    if (!selectedDoc) return;

    try {
      const res = await fetch(`/api/docs/${selectedDoc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editDocTitle,
          content: editDocContent,
          doc_type: editDocType
        })
      });

      if (res.ok) {
        const updated = await res.json();
        setSelectedDoc(updated);
        setShowEditDocModal(false);
        fetchDocs();
        fetchOverviewData();
      }
    } catch (err) {
      console.error('Error editing doc:', err);
    }
  };

  // Handle doc deletion
  const handleDeleteDoc = async (id) => {
    if (!confirm('Are you sure you want to delete this document?')) return;
    try {
      const res = await fetch(`/api/docs/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setSelectedDoc(null);
        fetchDocs();
        fetchOverviewData();
      }
    } catch (err) {
      console.error('Error deleting doc:', err);
    }
  };

  // Filtered tickets (local view)
  const filteredTickets = tickets.filter(t => {
    if (t.repo_or_project !== repoName) return false;
    if (prioFilter && t.priority !== prioFilter) return false;
    if (assigneeFilter && t.assignee_user_id !== parseInt(assigneeFilter, 10)) return false;
    return true;
  });

  // Basic Markdown-to-HTML parser for documentation content
  const renderMarkdown = (text) => {
    if (!text) return <p style={{ fontStyle: 'italic', color: 'var(--text-dim)' }}>No content provided.</p>;
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    // Headers
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    
    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Code blocks
    html = html.replace(/```([\s\S]*?)```/g, '<pre className="mono">$1</pre>');
    // Inline Code
    html = html.replace(/`(.*?)`/g, '<code class="mono">$1</code>');
    
    // Alerts/GitHub Quotes
    html = html.replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>');
    
    // Bullet lists
    html = html.replace(/^\- (.*$)/gim, '<li>$1</li>');
    
    // Paragraph breaks
    html = html.split('\n\n').map(p => {
      if (p.startsWith('<h') || p.startsWith('<pre') || p.startsWith('<block') || p.startsWith('<li>')) return p;
      return `<p>${p.replace(/\n/g, '<br />')}</p>`;
    }).join('');
    
    return <div className="doc-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
  };

  // Open edit modal for doc
  const startEditDoc = () => {
    if (!selectedDoc) return;
    setEditDocTitle(selectedDoc.title);
    setEditDocContent(selectedDoc.content);
    setEditDocType(selectedDoc.doc_type);
    setShowEditDocModal(true);
  };

  return (
    <div className="view">
      <span className="backlink" onClick={onBack}>
        ← back to projects
      </span>
      
      <div className="page-header-card">
        <div className="page-header-title-area">
          <div className="page-header-title">
            <span>Workspace Control</span>
            {overview && (
              <span style={{
                fontSize: '11px',
                padding: '4px 10px',
                borderRadius: '20px',
                fontWeight: 700,
                textTransform: 'uppercase',
                background: overview.health.score === 'A' ? 'var(--green-glow)' : 'rgba(255,184,108,0.15)',
                color: overview.health.score === 'A' ? 'var(--green)' : 'var(--amber)',
                border: `1px solid ${overview.health.score === 'A' ? 'var(--green)' : 'var(--amber)'}`
              }}>
                ● Health: {overview.health.score} ({overview.health.status})
              </span>
            )}
          </div>
          <div className="page-header-desc">
            Project repository control center for {repoName}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="subtabs">
        <div 
          className={`subtab ${subTab === 'overview' ? 'active' : ''}`}
          onClick={() => setSubTab('overview')}
        >
          <Activity size={14} style={{ marginRight: '6px' }} />
          Overview
        </div>
        <div 
          className={`subtab ${subTab === 'branches' ? 'active' : ''}`}
          onClick={() => setSubTab('branches')}
        >
          <GitBranch size={14} style={{ marginRight: '6px' }} />
          Branches &amp; Sessions
        </div>
        <div 
          className={`subtab ${subTab === 'tickets' ? 'active' : ''}`}
          onClick={() => setSubTab('tickets')}
        >
          <CheckSquare size={14} style={{ marginRight: '6px' }} />
          Tickets
        </div>
        <div 
          className={`subtab ${subTab === 'docs' ? 'active' : ''}`}
          onClick={() => setSubTab('docs')}
        >
          <BookOpen size={14} style={{ marginRight: '6px' }} />
          Documentation
        </div>
      </div>

      {/* OVERVIEW SUBVIEW */}
      {subTab === 'overview' && (
        <div className="subview active">
          {overviewLoading ? (
            <div style={{ color: 'var(--text-dim)', padding: '40px 0', textAlign: 'center' }}>
              Loading project metrics...
            </div>
          ) : overview ? (
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
              
              {/* Left Column */}
              <div>
                {/* Repository Info Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                  <div className="card" style={{ padding: '20px' }}>
                    <div style={{ color: 'var(--text-dim)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>
                      Repository Info
                    </div>
                    <div style={{ fontSize: '14px', lineHeight: 1.5, color: 'var(--text)', marginBottom: '12px' }}>
                      {overview.repo.description}
                    </div>
                    <div style={{ display: 'flex', gap: '12px', fontSize: '12px', color: 'var(--text-dim)' }}>
                      <span>Default: <strong className="mono" style={{ color: 'var(--teal)' }}>{overview.defaultBranch}</strong></span>
                      <span>Branches: <strong>{overview.branchesCount}</strong></span>
                    </div>
                  </div>

                  <div className="card" style={{ padding: '20px', borderLeft: '4px solid var(--teal)' }}>
                    <div style={{ color: 'var(--teal)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>
                      Repository Health
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}>
                      <span style={{ fontSize: '32px', fontWeight: 800, color: '#ffffff' }}>
                        {overview.health.score}
                      </span>
                      <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-dim)' }}>
                        ({overview.health.status})
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-dim)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {overview.health.factors.map((f, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ color: 'var(--teal)' }}>•</span> {f}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Recent Commits */}
                <div className="panel" style={{ marginBottom: '24px' }}>
                  <div className="panel-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div className="panel-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Clock size={16} /> Recent Commits
                    </div>
                  </div>
                  {overview.commits.length === 0 ? (
                    <div style={{ padding: '16px 0', color: 'var(--text-dim)', fontSize: '13px' }}>
                      No commits recorded.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {overview.commits.map((c) => (
                        <div key={c.hash} style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '10px 14px',
                          background: 'var(--surface-2)',
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                          fontSize: '13px'
                        }}>
                          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, marginRight: '16px' }}>
                            <span style={{ fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {c.message}
                            </span>
                            <span style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              {c.matchedUser ? (
                                <span style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  width: '16px',
                                  height: '16px',
                                  borderRadius: '50%',
                                  fontSize: '8px',
                                  fontWeight: 700,
                                  backgroundColor: c.matchedUser.avatar_color || 'var(--violet)',
                                  color: '#0c1116'
                                }}>
                                  {c.matchedUser.display_name.split(' ').map(n => n[0]).join('').toUpperCase()}
                                </span>
                              ) : null}
                              by {c.matchedUser ? c.matchedUser.display_name : c.author} · {new Date(c.date).toLocaleDateString()} {new Date(c.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <span className="mono" style={{ color: 'var(--teal)', fontSize: '12px', background: 'rgba(77,238,234,0.08)', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(77,238,234,0.15)' }}>
                            {c.hash.substring(0, 7)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Recent Deployments */}
                <div className="panel">
                  <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                    <Server size={16} /> Recent Deployments
                  </div>
                  {overview.deployments.length === 0 ? (
                    <div style={{ padding: '16px 0', color: 'var(--text-dim)', fontSize: '13px', fontStyle: 'italic' }}>
                      No deployments recorded for this project.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {overview.deployments.map((d) => (
                        <div key={d.id} style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '12px 16px',
                          background: 'var(--surface-2)',
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                          fontSize: '13px'
                        }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                              <span className="mono" style={{ color: 'var(--teal)', fontWeight: 600 }}>
                                {d.commit_hash ? d.commit_hash.substring(0, 7) : d.branch_name}
                              </span>
                              <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                                on {d.branch_name}
                              </span>
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                              by {d.display_name || 'System'} · {new Date(d.deployed_at).toLocaleString()}
                            </div>
                          </div>
                          <span style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            color: d.status === 'success' ? 'var(--green)' : 'var(--red)',
                            background: d.status === 'success' ? 'var(--green-glow)' : 'rgba(255,85,85,0.12)',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            border: `1px solid ${d.status === 'success' ? 'var(--green)' : 'var(--red)'}`
                          }}>
                            {d.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column */}
              <div>
                {/* Active Presence */}
                <div className="panel" style={{ marginBottom: '24px' }}>
                  <div className="panel-title">
                    Active Developers <span className="count">{overview.activePresenceCount}</span>
                  </div>
                  {overview.activePresence.length === 0 ? (
                    <div style={{ padding: '16px 0', color: 'var(--text-dim)', fontSize: '13px' }}>
                      No active sessions on this project.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {overview.activePresence.map((p) => (
                        <div key={p.user_id} style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--surface-2)', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                          <div className="avatar" style={{ backgroundColor: p.avatar_color || 'var(--red)', color: '#0c1116' }}>
                            {p.user_name.split(' ').map(n => n[0]).join('').toUpperCase()}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                            <span style={{ fontSize: '13px', fontWeight: 600, color: '#ffffff' }}>
                              {p.user_name}
                            </span>
                            <span className="mono" style={{ fontSize: '11px', color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {p.branch_name}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Recent Event Timeline */}
                <div className="panel">
                  <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                    <Activity size={16} /> Activity timeline
                  </div>
                  {overview.timeline.length === 0 ? (
                    <div style={{ padding: '16px 0', color: 'var(--text-dim)', fontSize: '13px', fontStyle: 'italic' }}>
                      No recent activity events.
                    </div>
                  ) : (
                    <div className="timeline-container" style={{ display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative', borderLeft: '1px solid var(--border)', paddingLeft: '16px', marginLeft: '8px' }}>
                      {overview.timeline.map((e) => {
                        const eventDate = new Date(e.timestamp);
                        const cleanTime = eventDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        
                        let text = '';
                        if (e.event_type === 'presence:started') {
                          text = `started presence on branch ${e.branch_name}`;
                        } else if (e.event_type === 'presence:ended') {
                          text = `ended presence on branch ${e.branch_name}`;
                        } else if (e.event_type === 'ticket:created') {
                          text = `created ticket "${e.metadata.title || 'Untitled'}"`;
                        } else if (e.event_type === 'ticket:status_changed') {
                          text = `moved ticket "${e.metadata.title}" to ${e.metadata.new_status}`;
                        } else if (e.event_type === 'chat:message') {
                          text = `messaged in chat: "${e.metadata.message}"`;
                        } else if (e.event_type === 'document:created') {
                          text = `created document "${e.metadata.title}"`;
                        } else if (e.event_type === 'document:updated') {
                          text = `updated document "${e.metadata.title}"`;
                        } else if (e.event_type.startsWith('deploy:')) {
                          text = `initiated deployment (${e.metadata.status}) on ${e.branch_name}`;
                        } else if (e.event_type === 'session:created') {
                          text = `created collaborative session room on ${e.branch_name}`;
                        } else {
                          text = `triggered event ${e.event_type}`;
                        }

                        return (
                          <div key={e.id} style={{ position: 'relative', fontSize: '12.5px' }}>
                            <div style={{
                              position: 'absolute',
                              left: '-21px',
                              top: '2px',
                              width: '9px',
                              height: '9px',
                              borderRadius: '50%',
                              backgroundColor: 'var(--teal)',
                              boxShadow: '0 0 8px var(--teal)',
                              border: '2px solid var(--bg)'
                            }}></div>
                            <div>
                              <strong style={{ color: '#ffffff' }}>{e.user_name || 'System'}</strong>{' '}
                              <span style={{ color: 'var(--text-dim)' }}>{text}</span>
                            </div>
                            <div style={{ color: 'var(--text-dim)', fontSize: '10px', marginTop: '2px' }}>
                              {cleanTime}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

            </div>
          ) : (
            <div style={{ color: 'var(--red)', padding: '20px 0', textAlign: 'center' }}>
              Error loading metrics from API.
            </div>
          )}
        </div>
      )}

      {/* BRANCHES SUBVIEW */}
      {subTab === 'branches' && (
        <div className="subview active">
          <BranchMap 
            branches={branches}
            onWorkOnBranch={onWorkOnBranch}
            activePresence={activePresence.filter(p => p.repo_name === repoName)}
            currentUser={currentUser}
            repoName={repoName}
          />
        </div>
      )}

      {/* TICKETS SUBVIEW */}
      {subTab === 'tickets' && (
        <div className="subview active">
          <div className="kanban-head">
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <div className="page-sub" style={{ margin: 0 }}>
                Project tickets &amp; active issues list
              </div>
              
              <div style={{ display: 'flex', gap: '8px' }}>
                <select 
                  className="form-control" 
                  style={{ width: '120px', padding: '6px 10px', fontSize: '12px' }}
                  value={prioFilter}
                  onChange={(e) => setPrioFilter(e.target.value)}
                >
                  <option value="">All Priorities</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>

                <select 
                  className="form-control" 
                  style={{ width: '130px', padding: '6px 10px', fontSize: '12px' }}
                  value={assigneeFilter}
                  onChange={(e) => setAssigneeFilter(e.target.value)}
                >
                  <option value="">All Assignees</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.display_name}</option>
                  ))}
                </select>
              </div>
            </div>

            <button 
              className="new-ticket-btn"
              onClick={() => setShowNewTicketModal(true)}
            >
              + New ticket
            </button>
          </div>

          <KanbanBoard 
            tickets={filteredTickets}
            onUpdateTicketStatus={onUpdateTicketStatus}
            onCardClick={setSelectedTicket}
            users={users}
          />
        </div>
      )}

      {/* DOCUMENTATION SUBVIEW */}
      {subTab === 'docs' && (
        <div className="subview active">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px', height: 'calc(100vh - 280px)', minHeight: '450px' }}>
            
            {/* Left Column: Documents List */}
            <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <Search size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--text-dim)' }} />
                  <input 
                    type="text" 
                    placeholder="Search docs..."
                    value={docSearch}
                    onChange={(e) => setDocSearch(e.target.value)}
                    style={{
                      width: '100%',
                      backgroundColor: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      padding: '8px 10px 8px 32px',
                      borderRadius: '8px',
                      fontSize: '12.5px',
                      color: 'var(--text)',
                      outline: 'none'
                    }}
                  />
                </div>
                <select
                  value={docTypeFilter}
                  onChange={(e) => setDocTypeFilter(e.target.value)}
                  style={{
                    backgroundColor: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    padding: '8px',
                    borderRadius: '8px',
                    fontSize: '12.5px',
                    color: 'var(--text)',
                    outline: 'none'
                  }}
                >
                  <option value="">All Types</option>
                  <option value="adr">ADRs</option>
                  <option value="notes">Notes</option>
                  <option value="requirements">Requirements</option>
                  <option value="change-request">Change Requests</option>
                </select>
              </div>

              <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {docsLoading ? (
                  [1, 2, 3].map(i => (
                    <div key={i} className="skeleton" style={{ height: '60px', borderRadius: '8px', opacity: 0.3 }}></div>
                  ))
                ) : docs.length === 0 ? (
                  <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '24px 0', fontSize: '13px' }}>
                    No documents found.
                  </div>
                ) : (
                  docs.map((doc) => (
                    <div 
                      key={doc.id}
                      onClick={() => setSelectedDoc(doc)}
                      style={{
                        padding: '12px',
                        borderRadius: '8px',
                        background: selectedDoc?.id === doc.id ? 'var(--surface-2)' : 'rgba(18,22,32,0.5)',
                        border: `1px solid ${selectedDoc?.id === doc.id ? 'var(--teal)' : 'var(--border)'}`,
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#ffffff' }}>
                          {doc.title}
                        </span>
                        <span style={{
                          fontSize: '9px',
                          textTransform: 'uppercase',
                          fontWeight: 700,
                          padding: '1px 5px',
                          borderRadius: '4px',
                          color: doc.doc_type === 'adr' ? 'var(--teal)' : doc.doc_type === 'requirements' ? 'var(--amber)' : doc.doc_type === 'change-request' ? 'var(--red)' : 'var(--violet)',
                          background: 'rgba(255,255,255,0.05)'
                        }}>
                          {doc.doc_type}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dim)' }}>
                        <span>Scope: <strong className="mono">{doc.scope}</strong></span>
                        <span>{new Date(doc.updated_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <button 
                className="btn-primary" 
                onClick={() => setShowNewDocModal(true)}
                style={{ width: '100%', marginTop: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                <Plus size={16} /> Create Document
              </button>
            </div>

            {/* Right Column: Document Details Pane */}
            <div className="panel" style={{ height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              {selectedDoc ? (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '16px' }}>
                    <div>
                      <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#ffffff', marginBottom: '4px' }}>
                        {selectedDoc.title}
                      </h2>
                      <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: 'var(--text-dim)' }}>
                        <span>Author: <strong>{selectedDoc.creator_name || 'System'}</strong></span>
                        <span>Updated: <strong>{new Date(selectedDoc.updated_at).toLocaleString()}</strong></span>
                        {selectedDoc.ticket_title && (
                          <span>Ticket: <strong style={{ color: 'var(--teal)' }}>#{selectedDoc.ticket_id} {selectedDoc.ticket_title}</strong></span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button 
                        onClick={startEditDoc}
                        style={{
                          background: 'var(--surface-2)',
                          border: '1px solid var(--border)',
                          padding: '6px 10px',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          color: 'var(--text)',
                          fontSize: '12px'
                        }}
                      >
                        <Edit2 size={12} /> Edit
                      </button>
                      <button 
                        onClick={() => handleDeleteDoc(selectedDoc.id)}
                        style={{
                          background: 'rgba(255,85,85,0.1)',
                          border: '1px solid var(--red)',
                          padding: '6px 10px',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          color: 'var(--red)',
                          fontSize: '12px'
                        }}
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  </div>

                  <div style={{ flex: 1, overflowY: 'auto' }}>
                    {renderMarkdown(selectedDoc.content)}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)', gap: '12px' }}>
                  <BookOpen size={40} style={{ opacity: 0.3 }} />
                  <span>Select a document from the sidebar to read it, or click Create Document.</span>
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {/* New Ticket Modal */}
      {showNewTicketModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-title">Create New Ticket</div>
            <form onSubmit={handleCreateTicketSubmit}>
              <div className="form-group">
                <label>Title</label>
                <input 
                  type="text" 
                  className="form-control" 
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Ticket title"
                  required
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea 
                  className="form-control" 
                  rows="3"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Detailed description..."
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="form-group">
                  <label>Priority</label>
                  <select 
                    className="form-control"
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value)}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Assignee</label>
                  <select 
                    className="form-control"
                    value={newAssignee}
                    onChange={(e) => setNewAssignee(e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.display_name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Initial Status</label>
                <select 
                  className="form-control"
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                >
                  <option value="todo">To Do</option>
                  <option value="in-progress">In Progress</option>
                  <option value="review">Review</option>
                  <option value="done">Done</option>
                </select>
              </div>

              <div className="modal-actions">
                <button 
                  type="button" 
                  className="btn-secondary"
                  onClick={() => setShowNewTicketModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Create Ticket
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Ticket Details Modal */}
      {selectedTicket && (
        <div className="modal-overlay" onClick={() => setSelectedTicket(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Ticket Details</span>
              <span className={`kcard-prio ${selectedTicket.priority}`}>
                {selectedTicket.priority}
              </span>
            </div>
            
            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>
                {selectedTicket.title}
              </h3>
              <p style={{ color: 'var(--text-dim)', fontSize: '13px', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {selectedTicket.description || 'No description provided.'}
              </p>
            </div>

            <div style={{ background: 'var(--surface-2)', padding: '12px', borderRadius: '8px', fontSize: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <span style={{ color: 'var(--text-dim)' }}>Source:</span>{' '}
                <span className="mono">{selectedTicket.source}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-dim)' }}>Status:</span>{' '}
                <span className="mono" style={{ color: 'var(--teal)' }}>{selectedTicket.status}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-dim)' }}>Assignee:</span>{' '}
                <span>{selectedTicket.assignee_display_name || 'Unassigned'}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-dim)' }}>Related branch:</span>{' '}
                <span className="mono">{selectedTicket.repo_or_project || '—'}</span>
              </div>
            </div>

            {selectedTicket.external_url && (
              <div style={{ marginTop: '16px' }}>
                <a 
                  href={selectedTicket.external_url} 
                  target="_blank" 
                  rel="noreferrer"
                  style={{ color: 'var(--teal)', fontSize: '13px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  View in origin system ({selectedTicket.source}) ↗
                </a>
              </div>
            )}

            <div className="modal-actions">
              <div style={{ marginRight: 'auto', display: 'flex', gap: '8px' }}>
                <select 
                  className="form-control"
                  style={{ padding: '6px 10px', fontSize: '12px', width: '130px' }}
                  value={selectedTicket.assignee_user_id || ''}
                  onChange={(e) => {
                    const nextVal = e.target.value ? parseInt(e.target.value, 10) : null;
                    onUpdateTicketStatus(selectedTicket.id, selectedTicket.status, nextVal);
                    setSelectedTicket({ ...selectedTicket, assignee_user_id: nextVal, assignee_display_name: users.find(u => u.id === nextVal)?.display_name });
                  }}
                >
                  <option value="">Unassigned</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.display_name}</option>
                  ))}
                </select>
              </div>

              <button 
                className="btn-primary"
                onClick={() => setSelectedTicket(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Doc Modal */}
      {showNewDocModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '600px' }}>
            <div className="modal-title">Create New Document</div>
            <form onSubmit={handleCreateDocSubmit}>
              <div className="form-group">
                <label>Title</label>
                <input 
                  type="text" 
                  className="form-control" 
                  value={newDocTitle}
                  onChange={(e) => setNewDocTitle(e.target.value)}
                  placeholder="e.g. ADR 002: WebSockets for Collaboration"
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="form-group">
                  <label>Doc Type</label>
                  <select 
                    className="form-control"
                    value={newDocType}
                    onChange={(e) => setNewDocType(e.target.value)}
                  >
                    <option value="notes">Notes / Guide</option>
                    <option value="adr">ADR (Architecture Decision)</option>
                    <option value="requirements">Requirements Spec</option>
                    <option value="change-request">Change Request</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Scope</label>
                  <select 
                    className="form-control"
                    value={newDocScope}
                    onChange={(e) => setNewDocScope(e.target.value)}
                  >
                    <option value="project">Project Scope</option>
                    <option value="ticket">Ticket Scope</option>
                    <option value="session">Session Scope</option>
                  </select>
                </div>
              </div>

              {/* Scoped relations */}
              {newDocScope === 'ticket' && (
                <div className="form-group">
                  <label>Associate Ticket</label>
                  <select 
                    className="form-control"
                    value={newDocTicketId}
                    onChange={(e) => setNewDocTicketId(e.target.value)}
                    required
                  >
                    <option value="">Select Related Ticket...</option>
                    {tickets.filter(t => t.repo_or_project === repoName).map(t => (
                      <option key={t.id} value={t.id}>#{t.id} - {t.title}</option>
                    ))}
                  </select>
                </div>
              )}

              {newDocScope === 'session' && (
                <div className="form-group">
                  <label>Associate Session Room</label>
                  <select 
                    className="form-control"
                    value={newDocSessionId}
                    onChange={(e) => setNewDocSessionId(e.target.value)}
                    required
                  >
                    <option value="">Select Session...</option>
                    {overview?.activeSessions.map(s => (
                      <option key={s.id} value={s.id}>{s.branch_name} ({s.oct_room_id})</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="form-group">
                <label>Content (Markdown supported)</label>
                <textarea 
                  className="form-control" 
                  rows="8"
                  value={newDocContent}
                  onChange={(e) => setNewDocContent(e.target.value)}
                  placeholder="# Description&#10;&#10;Write markdown documentation here..."
                  style={{ fontFamily: 'monospace', fontSize: '13px' }}
                />
              </div>

              <div className="modal-actions">
                <button 
                  type="button" 
                  className="btn-secondary"
                  onClick={() => setShowNewDocModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Publish Document
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Doc Modal */}
      {showEditDocModal && selectedDoc && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '600px' }}>
            <div className="modal-title">Edit Document</div>
            <form onSubmit={handleEditDocSubmit}>
              <div className="form-group">
                <label>Title</label>
                <input 
                  type="text" 
                  className="form-control" 
                  value={editDocTitle}
                  onChange={(e) => setEditDocTitle(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Doc Type</label>
                <select 
                  className="form-control"
                  value={editDocType}
                  onChange={(e) => setEditDocType(e.target.value)}
                >
                  <option value="notes">Notes / Guide</option>
                  <option value="adr">ADR (Architecture Decision)</option>
                  <option value="requirements">Requirements Spec</option>
                  <option value="change-request">Change Request</option>
                </select>
              </div>

              <div className="form-group">
                <label>Content (Markdown supported)</label>
                <textarea 
                  className="form-control" 
                  rows="8"
                  value={editDocContent}
                  onChange={(e) => setEditDocContent(e.target.value)}
                  style={{ fontFamily: 'monospace', fontSize: '13px' }}
                />
              </div>

              <div className="modal-actions">
                <button 
                  type="button" 
                  className="btn-secondary"
                  onClick={() => setShowEditDocModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
