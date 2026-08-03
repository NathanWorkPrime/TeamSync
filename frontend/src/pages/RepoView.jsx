import React, { useState, useEffect } from 'react';
import BranchMap from '../components/BranchMap';
import KanbanBoard from '../components/KanbanBoard';
import Session from './Session';
import Integrations from './Integrations';
import { 
  GitBranch, 
  FileText, 
  Activity, 
  CheckSquare, 
  BookOpen, 
  Compass,
  Search, 
  Plus, 
  Trash2, 
  Edit2, 
  Server, 
  Clock, 
  User, 
  Heart, 
  AlertCircle,
  MessageSquare,
  Settings,
  BarChart2
} from 'lucide-react';

export default function RepoView({ 
  repoName, 
  githubRepo,
  onBack, 
  branches, 
  tickets, 
  users, 
  activePresence, 
  currentUser, 
  onWorkOnBranch, 
  onAddTicket, 
  onUpdateTicketStatus,
  subTab: propsSubTab,
  onTabChange,
  
  // Embedded views props
  sessionData,
  onSavePresence,
  socket,
  integrations,
  onRegisterIntegration,
  onLeaveSession,
  onAddUser,
  onRemoveUser
}) {
  const [localSubTab, setLocalSubTab] = useState('sessions');
  const subTab = propsSubTab !== undefined ? propsSubTab : localSubTab;
  const setSubTab = onTabChange !== undefined ? onTabChange : setLocalSubTab;
  const [showNewTicketModal, setShowNewTicketModal] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState(null);
  
  // Tasks state
  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [showNewTaskModal, setShowNewTaskModal] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDescription, setNewTaskDescription] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState('medium');
  const [newTaskAssignee, setNewTaskAssignee] = useState('');
  
  // Deployments state
  const [deployments, setDeployments] = useState([]);
  const [deploymentsLoading, setDeploymentsLoading] = useState(true);
  const [deployStatus, setDeployStatus] = useState('offline'); // 'online', 'offline', 'deploying'
  
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
  const [showStartSessionModal, setShowStartSessionModal] = useState(false);
  const [selectedStartBranch, setSelectedStartBranch] = useState('');
  const [sessionHistory, setSessionHistory] = useState([]);
  const [sessionHistoryLoading, setSessionHistoryLoading] = useState(true);
  
  const [showChangelogModal, setShowChangelogModal] = useState(false);
  const [selectedChangelog, setSelectedChangelog] = useState('');
  const [activeSessionBranch, setActiveSessionBranch] = useState(null);
  const [rollbackTarget, setRollbackTarget] = useState(null);
  const [isRollingBack, setIsRollingBack] = useState(false);
  
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

  // Fetch tasks
  const fetchTasks = async () => {
    try {
      const res = await fetch(`/api/repos/${repoName}/tasks`);
      if (res.ok) {
        const data = await res.json();
        setTasks(data);
      }
    } catch (err) {
      console.error('Error fetching tasks:', err);
    } finally {
      setTasksLoading(false);
    }
  };

  // Handle task submission
  const handleCreateTaskSubmit = async (e) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;

    try {
      const res = await fetch(`/api/repos/${repoName}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTaskTitle,
          description: newTaskDescription,
          priority: newTaskPriority,
          assignee_user_id: newTaskAssignee ? parseInt(newTaskAssignee, 10) : null
        })
      });
      if (res.ok) {
        fetchTasks();
        setShowNewTaskModal(false);
        setNewTaskTitle('');
        setNewTaskDescription('');
        setNewTaskPriority('medium');
        setNewTaskAssignee('');
      }
    } catch (err) {
      console.error('Error creating task:', err);
    }
  };

  // Update task status
  const handleUpdateTaskStatus = async (taskId, nextStatus, nextAssigneeId = undefined) => {
    const payload = { status: nextStatus };
    if (nextAssigneeId !== undefined) {
      payload.assignee_user_id = nextAssigneeId;
    }
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        fetchTasks();
      }
    } catch (err) {
      console.error('Error updating task:', err);
    }
  };

  // Fetch deployments
  const fetchDeployments = async () => {
    try {
      const res = await fetch(`/api/repos/${repoName}/deployments`);
      if (res.ok) {
        const data = await res.json();
        setDeployments(data);
      }
    } catch (err) {
      console.error('Error fetching deployments:', err);
    } finally {
      setDeploymentsLoading(false);
    }
  };

  // Fetch deployment status
  const fetchDeployStatus = async () => {
    try {
      const res = await fetch(`/api/repos/${repoName}/deploy/status`);
      if (res.ok) {
        const data = await res.json();
        setDeployStatus(data.status);
      }
    } catch (err) {
      console.error('Error fetching deploy status:', err);
    }
  };

  // Trigger deployment
  const handleDeployTrigger = async () => {
    setDeployStatus('deploying');
    try {
      const res = await fetch(`/api/repos/${repoName}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch_name: 'main',
          user_id: currentUser?.id || 1,
          commit_hash: 'HEAD'
        })
      });
      if (res.ok) {
        await fetchDeployments();
        setTimeout(fetchDeployStatus, 2000);
      } else {
        setDeployStatus('offline');
      }
    } catch (err) {
      console.error('Error triggering deploy:', err);
      setDeployStatus('offline');
    }
  };

  // Fetch session rooms history
  const fetchSessionHistory = async () => {
    try {
      const res = await fetch(`/api/repos/${repoName}/sessions`);
      if (res.ok) {
        const data = await res.json();
        setSessionHistory(data);
      }
    } catch (err) {
      console.error('Error fetching session history:', err);
    } finally {
      setSessionHistoryLoading(false);
    }
  };

  // Periodically poll session history when Sessions tab is active
  useEffect(() => {
    if (repoName && subTab === 'sessions') {
      fetchSessionHistory();
      const interval = setInterval(fetchSessionHistory, 5000);
      return () => clearInterval(interval);
    }
  }, [repoName, subTab]);

  // Set default branch for new session selector
  useEffect(() => {
    if (branches && branches.length > 0 && !selectedStartBranch) {
      setSelectedStartBranch(branches[0].name);
    }
  }, [branches, selectedStartBranch]);

  // Poll for overview, docs, tasks, and deployments periodically
  useEffect(() => {
    fetchOverviewData();
    fetchDocs();
    fetchTasks();
    fetchDeployments();
    fetchDeployStatus();

    const interval = setInterval(() => {
      fetchOverviewData();
      fetchDocs();
      fetchTasks();
      fetchDeployments();
      fetchDeployStatus();
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

  const renderChangelogMarkdown = (text) => {
    if (!text) return <p style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>No changelog available.</p>;
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    html = html.replace(/^### (.*$)/gim, '<h3 style="font-size:15px;font-weight:700;color:var(--teal);margin-bottom:8px;margin-top:12px;">$1</h3>');
    html = html.replace(/^#### (.*$)/gim, '<h4 style="font-size:13px;font-weight:700;color:#ffffff;margin-bottom:6px;margin-top:10px;">$1</h4>');
    html = html.replace(/^# (.*$)/gim, '<h1 style="font-size:18px;font-weight:700;color:var(--teal);margin-bottom:12px;">$1</h1>');
    html = html.replace(/^## (.*$)/gim, '<h2 style="font-size:16px;font-weight:700;color:var(--teal);margin-bottom:10px;">$1</h2>');
    
    html = html.replace(/^\* (.*$)/gim, '<li style="margin-left:14px;list-style-type:disc;margin-bottom:4px;color:#e1e4ea;">$1</li>');
    html = html.replace(/^\- (.*$)/gim, '<li style="margin-left:14px;list-style-type:disc;margin-bottom:4px;color:#e1e4ea;">$1</li>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/`(.*?)`/g, '<code class="mono" style="background:rgba(0,0,0,0.2);padding:2px 4px;border-radius:4px;font-family:monospace;font-size:11px;">$1</code>');
    
    html = html.split('\n').map(p => {
      if (p.trim().startsWith('<h') || p.trim().startsWith('<li') || p.trim().startsWith('<ul')) return p;
      if (!p.trim()) return '';
      return `<p style="margin-bottom:8px;color:var(--text);">${p}</p>`;
    }).join('\n');

    return <div className="doc-markdown" style={{ fontSize: '13px', lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: html }} />;
  };

  const handleWorkOnBranchWrapper = async (branchName, isJoined) => {
    await onWorkOnBranch(branchName, isJoined);
    if (!isJoined) {
      setActiveSessionBranch(branchName);
    } else {
      setActiveSessionBranch(null);
    }
  };

  const handleLeaveSessionWrapper = async (roomId) => {
    await onLeaveSession(roomId);
    setActiveSessionBranch(null);
  };

  const handleRollback = (deployment) => {
    setRollbackTarget(deployment);
  };

  const executeRollback = async () => {
    if (!rollbackTarget) return;
    setIsRollingBack(true);
    try {
      const res = await fetch(`/api/repos/${repoName}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch_name: rollbackTarget.branch_name,
          commit_hash: rollbackTarget.commit_hash,
          user_id: currentUser.id
        })
      });
      
      if (res.ok) {
        alert(`Successfully rolled back ${rollbackTarget.branch_name} to commit ${rollbackTarget.commit_hash.substring(0, 7)}.`);
        fetchDeployments();
        setRollbackTarget(null);
      } else {
        const errData = await res.json();
        alert(`Rollback failed: ${errData.error || 'Server error'}`);
      }
    } catch (err) {
      console.error('Error triggering rollback:', err);
      alert(`Rollback failed: ${err.message}`);
    } finally {
      setIsRollingBack(false);
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 64px)', background: 'var(--bg)', animation: 'fadein 0.25s ease' }}>
      
      {/* Left Navigation Side Rail */}
      <div style={{
        width: '240px',
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        flexShrink: 0
      }}>
        {/* Back Link */}
        <span 
          onClick={onBack}
          style={{
            color: 'var(--text-dim)',
            fontSize: '13px',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'color 0.15s ease',
            padding: '4px 8px',
            fontWeight: 500
          }}
          className="back-btn-hover"
        >
          ← Back to Projects
        </span>

        {/* Vertical Menu items */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '10px' }}>
          {[
            { id: 'sessions', label: 'Sessions', icon: <MessageSquare size={16} /> },
            { id: 'source_control', label: 'Branches', icon: <GitBranch size={16} /> },
            { id: 'deployments', label: 'Deployments', icon: <Server size={16} /> },
            { id: 'tickets', label: 'Tickets', icon: <Compass size={16} /> },
            { id: 'tasks', label: 'Tasks', icon: <CheckSquare size={16} /> },
            { id: 'overview', label: 'Overview', icon: <Activity size={16} /> },
            { id: 'settings', label: 'Settings', icon: <Settings size={16} /> }
          ].map(item => {
            const isActive = subTab === item.id;
            return (
              <div
                key={item.id}
                onClick={() => setSubTab(item.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  fontSize: '13.5px',
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? 'var(--teal)' : 'var(--text-dim)',
                  background: isActive ? 'var(--teal-glow)' : 'transparent',
                  transition: 'all 0.15s ease'
                }}
                className="siderail-item-hover"
              >
                {item.icon}
                <span>{item.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Content Area */}
      <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minWidth: 0, padding: '32px' }}>
        
        {/* Persistent Workspace Header */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          paddingBottom: '20px', 
          borderBottom: '1px solid var(--border)', 
          marginBottom: '28px',
          flexWrap: 'wrap',
          gap: '16px' 
        }}>
          {/* Left: Project Name */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              background: 'var(--teal)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'var(--node-shadow)',
              color: 'var(--bg)'
            }}>
              <GitBranch size={18} />
            </div>
            <div>
              <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)', margin: 0, letterSpacing: '-0.5px' }}>
                {repoName}
              </h1>
              <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px', fontFamily: 'monospace' }}>
                {githubRepo ? `github: ${githubRepo}` : 'local repository'}
              </div>
            </div>
          </div>

          {/* Middle: Active Session/Branch & Avatars */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
            {/* Status Badge */}
            {(() => {
              const activeSession = activePresence.find(p => p.user_id === currentUser.id && p.repo_name === repoName && p.session_link && p.session_link !== '');
              const activeLocal = activePresence.find(p => p.user_id === currentUser.id && p.repo_name === repoName);
              
              let badgeText = `Default: ${overview?.defaultBranch || 'main'}`;
              let badgeColor = 'var(--text-dim)';
              let badgeBg = 'var(--surface-2)';
              let badgeBorder = 'var(--border)';

              if (activeSession) {
                badgeText = `Live Session: ${activeSession.branch_name}`;
                badgeColor = 'var(--green)';
                badgeBg = 'rgba(16, 185, 129, 0.08)';
                badgeBorder = 'var(--green)';
              } else if (activeLocal) {
                badgeText = `Workspace active: ${activeLocal.branch_name}`;
                badgeColor = 'var(--teal)';
                badgeBg = 'var(--teal-glow)';
                badgeBorder = 'var(--teal)';
              }

              return (
                <div style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  padding: '6px 12px',
                  borderRadius: '30px',
                  color: badgeColor,
                  background: badgeBg,
                  border: `1px solid ${badgeBorder}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  <span style={{ 
                    display: 'inline-block', 
                    width: '6px', 
                    height: '6px', 
                    borderRadius: '50%', 
                    backgroundColor: badgeColor,
                    animation: activeSession ? 'pulse-live-badge 1.5s infinite' : 'none'
                  }} />
                  {badgeText}
                </div>
              );
            })()}

            {/* Overlapping active developers list with live avatars */}
            {(() => {
              const devs = activePresence.filter(p => p.repo_name === repoName);
              if (devs.length === 0) return null;
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Active:</span>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    {devs.map((dev, idx) => {
                      const isDevLive = dev.session_link && dev.session_link !== '';
                      return (
                        <div key={dev.user_id} style={{ position: 'relative', marginLeft: idx > 0 ? '-8px' : '0', zIndex: devs.length - idx }}>
                          <div 
                            title={`${dev.user_name} is active on ${dev.branch_name}`} 
                            style={{
                              width: '26px',
                              height: '26px',
                              borderRadius: '50%',
                              backgroundColor: dev.avatar_color || 'var(--teal)',
                              color: 'rgba(15, 23, 42, 0.85)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '10px',
                              fontWeight: 700,
                              border: '2px solid var(--surface)',
                              cursor: 'default',
                              boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                            }}
                          >
                            {dev.user_name ? dev.user_name.split(' ').map(n => n[0]).join('').toUpperCase() : 'U'}
                          </div>
                          {isDevLive && (
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
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Right Section: Repository Health */}
          {overview && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.5px' }}>
                  Repo Health
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text)', fontWeight: 700 }}>
                  {overview.health.status}
                </div>
              </div>
              {(() => {
                const score = overview.health.score;
                const isGood = score === 'A' || score === 'B';
                return (
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 900,
                    fontSize: '16px',
                    color: isGood ? 'var(--green)' : 'var(--red)',
                    background: isGood ? 'var(--green-glow)' : 'rgba(255,85,85,0.15)',
                    border: `2px solid ${isGood ? 'var(--green)' : 'var(--red)'}`,
                    boxShadow: `0 0 8px ${isGood ? 'rgba(80,250,123,0.15)' : 'rgba(255,85,85,0.15)'}`
                  }}>
                    {score}
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* Subview Content Area */}
        <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          
          {/* OVERVIEW SUBVIEW (TONED DOWN) */}
          {subTab === 'overview' && (
            <div className="subview active">
              {overviewLoading ? (
                <div style={{ color: 'var(--text-dim)', padding: '40px 0', textAlign: 'center' }}>
                  Loading project metrics...
                </div>
              ) : overview ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '28px' }}>
                  {/* Left Column: Repository details */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div className="card" style={{ padding: '20px', minHeight: 'auto' }}>
                      <div style={{ color: 'var(--text-dim)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
                        Project Description
                      </div>
                      <div style={{ fontSize: '13.5px', lineHeight: 1.6, color: 'var(--text)', marginBottom: '16px' }}>
                        {overview.repo.description || 'No description provided.'}
                      </div>
                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px', color: 'var(--text-dim)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Default Branch:</span>
                          <strong className="mono" style={{ color: 'var(--teal)' }}>{overview.defaultBranch}</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Total Branches:</span>
                          <strong style={{ color: 'var(--text)' }}>{overview.branchesCount}</strong>
                        </div>
                      </div>
                    </div>

                    {/* Quiet Factors Card */}
                    <div className="card" style={{ padding: '20px', minHeight: 'auto' }}>
                      <div style={{ color: 'var(--text-dim)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
                        Integration Factors
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-dim)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {overview.health.factors.map((f, idx) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ width: '4px', height: '4px', borderRadius: '50%', backgroundColor: 'var(--teal)' }}></span>
                            <span>{f}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Quiet Recent Activity Timeline */}
                  <div className="panel" style={{ margin: 0 }}>
                    <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', border: 'none', padding: 0, marginBottom: '16px' }}>
                      <Activity size={15} /> Recent Activity Log
                    </div>
                    {overview.timeline.length === 0 ? (
                      <div style={{ padding: '16px 0', color: 'var(--text-dim)', fontSize: '13px', fontStyle: 'italic' }}>
                        No recent activity events.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {overview.timeline.slice(0, 8).map((e) => {
                          const eventDate = new Date(e.timestamp);
                          const cleanTime = eventDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                          
                          let text = '';
                          if (e.event_type === 'presence:started') text = `joined branch ${e.branch_name}`;
                          else if (e.event_type === 'presence:ended') text = `left branch ${e.branch_name}`;
                          else if (e.event_type === 'ticket:created') text = `created ticket "${e.metadata?.title || 'Untitled'}"`;
                          else if (e.event_type === 'ticket:updated') text = `updated ticket status`;
                          else if (e.event_type === 'deploy:success') text = `deployed successfully to ${e.branch_name}`;
                          else if (e.event_type === 'deploy:failed') text = `deployment failed on ${e.branch_name}`;
                          else if (e.event_type === 'repo:synced') text = `synced workspace branch ${e.branch_name}`;
                          else if (e.event_type === 'git:commit') text = `committed to ${e.branch_name}: "${e.metadata?.message || ''}"`;
                          else if (e.event_type === 'git:branch_switch') text = `switched branch to ${e.metadata?.new_branch || 'main'}`;
                          else if (e.event_type === 'git:conflict') text = `encountered merge conflicts on ${e.branch_name}`;
                          else text = e.event_type;

                          return (
                            <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', paddingBottom: '10px', borderBottom: '1px solid var(--border)', fontSize: '12.5px' }}>
                              <div style={{ display: 'flex', gap: '8px', minWidth: 0 }}>
                                <strong style={{ color: 'var(--text)', whiteSpace: 'nowrap' }}>{e.user_name || 'System'}</strong>
                                <span style={{ color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
                              </div>
                              <span style={{ color: 'var(--text-dim)', fontSize: '10.5px', marginLeft: '12px', flexShrink: 0 }}>{cleanTime}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ color: 'var(--red)', padding: '20px 0', textAlign: 'center' }}>
                  Error loading metrics from API.
                </div>
              )}
            </div>
          )}

          {/* SOURCE CONTROL SUBVIEW */}
          {subTab === 'source_control' && (
            <div className="subview active" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
              <BranchMap 
                branches={branches}
                onWorkOnBranch={handleWorkOnBranchWrapper}
                activePresence={activePresence.filter(p => p.repo_name === repoName)}
                currentUser={currentUser}
                repoName={repoName}
                githubRepo={githubRepo}
              />
            </div>
          )}

          {/* TICKETS SUBVIEW */}
          {subTab === 'tickets' && (
            <div className="subview active">
              <div className="panel" style={{ textAlign: 'center', padding: '64px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                <Compass size={48} style={{ color: 'var(--text-dim)', opacity: 0.5 }} />
                <div>
                  <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text)', marginBottom: '8px' }}>External Tickets Integration</h3>
                  <p style={{ color: 'var(--text-dim)', fontSize: '13.5px', maxWidth: '460px', margin: '0 auto', lineHeight: 1.5, marginBottom: '20px' }}>
                    Connect TeamSync to your external issue trackers (GitHub Issues, Jira, or Linear) to sync developer actions with tickets automatically.
                  </p>
                  <button 
                    className="btn-secondary" 
                    style={{ opacity: 0.7, cursor: 'not-allowed' }}
                    disabled
                  >
                    Integration Offline / Not Connected Yet
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TASKS SUBVIEW */}
          {subTab === 'tasks' && (
            <div className="subview active" style={{ display: 'flex', flexDirection: 'column', gap: '16px', flexGrow: 1, minHeight: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
                  Internal Tasks Board
                </h3>
                <button 
                  className="btn-primary" 
                  onClick={() => setShowNewTaskModal(true)}
                  style={{ padding: '6px 14px', fontSize: '13px' }}
                >
                  + Create Task
                </button>
              </div>

              {tasksLoading ? (
                <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '40px' }}>Loading tasks...</div>
              ) : (
                <div style={{ flexGrow: 1, minHeight: 0 }}>
                  <KanbanBoard 
                    tickets={tasks}
                    onUpdateTicketStatus={handleUpdateTaskStatus}
                    onCardClick={setSelectedTicket}
                    users={users}
                  />
                </div>
              )}
            </div>
          )}

          {/* SESSIONS SUBVIEW */}
          {subTab === 'sessions' && (() => {
            // Compile active sessions on this project
            const projectPresence = activePresence.filter(p => p.repo_name === repoName);
            const branchSessions = {};
            projectPresence.forEach(p => {
              if (!p.branch_name) return;
              if (p.session_link === 'git-commit-activity') return;
              if (!branchSessions[p.branch_name]) {
                branchSessions[p.branch_name] = {
                  branch: p.branch_name,
                  sessionLink: p.session_link,
                  members: []
                };
              }
              branchSessions[p.branch_name].members.push(p);
            });

            const activeRoomPresence = activePresence.find(
              p => p.user_id === currentUser.id && 
                   p.repo_name === repoName && 
                   p.session_link && 
                   p.session_link !== '' && 
                   p.session_link !== 'git-commit-activity'
            ) || (sessionData && sessionData.repo === repoName && sessionData.sessionLink && sessionData.sessionLink !== '' ? {
              branch_name: sessionData.branch,
              session_link: sessionData.sessionLink
            } : null) || (activeSessionBranch ? {
              branch_name: activeSessionBranch,
              session_link: (branchSessions[activeSessionBranch]?.sessionLink) || ''
            } : null);            return (
              <div className="subview active" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minHeight: 0, gap: '24px' }}>
                {activeRoomPresence ? (
                  <Session 
                    sessionData={{
                      repo: repoName,
                      branch: activeRoomPresence.branch_name,
                      sessionLink: activeRoomPresence.session_link
                    }} 
                    activePresence={activePresence} 
                    currentUser={currentUser}
                    onSavePresence={onSavePresence}
                    socket={socket}
                    embedded={true}
                    onLeaveSession={handleLeaveSessionWrapper}
                  />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
                    
                    {/* Active Collaboration Rooms section */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
                          Active Collaboration Rooms
                        </h3>
                        <button 
                          className="btn-primary"
                          style={{ padding: '6px 14px', fontSize: '13px' }}
                          onClick={() => setShowStartSessionModal(true)}
                        >
                          + Start New Session
                        </button>
                      </div>
                      
                      {Object.keys(branchSessions).length === 0 ? (
                        <div className="panel" style={{ textAlign: 'center', padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                          <MessageSquare size={40} style={{ color: 'var(--text-dim)', opacity: 0.5 }} />
                          <div>
                            <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)', marginBottom: '6px' }}>No Active Session Rooms</h3>
                            <p style={{ color: 'var(--text-dim)', fontSize: '13px', maxWidth: '420px', margin: '0 auto', lineHeight: 1.5 }}>
                              There are currently no active workspace sessions. Click <strong>Start New Session</strong> or head to the <strong>Branches</strong> tab to checkout and begin.
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '20px' }}>
                          {Object.values(branchSessions).map((sess) => (
                            <div key={sess.branch} className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', minHeight: 'auto' }}>
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                  <span className="mono" style={{ fontSize: '14px', fontWeight: 700, color: 'var(--teal)' }}>
                                    {sess.branch}
                                  </span>
                                  {sess.sessionLink ? (
                                    <span style={{ fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--green)', background: 'var(--green-glow)', padding: '2px 8px', borderRadius: '4px', border: '1px solid var(--green)' }}>
                                      ⚡ LIVE ROOM
                                    </span>
                                  ) : (
                                    <span style={{ fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-dim)', background: 'var(--surface-2)', padding: '2px 8px', borderRadius: '4px', border: '1px solid var(--border)' }}>
                                      CHECKED OUT
                                    </span>
                                  )}
                                </div>
                                
                                <div style={{ fontSize: '13px', color: 'var(--text-dim)', marginTop: '6px' }}>
                                  Collaborators: {sess.members.map(m => m.display_name || m.username).join(', ')}
                                </div>
                              </div>
                              
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                  {sess.members.map((m, idx) => (
                                    <div 
                                      key={m.user_id} 
                                      title={m.display_name || m.username} 
                                      style={{
                                        width: '26px',
                                        height: '26px',
                                        borderRadius: '50%',
                                        backgroundColor: m.avatar_color || 'var(--teal)',
                                        color: 'rgba(15, 23, 42, 0.85)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '10px',
                                        fontWeight: 700,
                                        border: '2px solid var(--surface)',
                                        marginLeft: idx > 0 ? '-8px' : '0',
                                        zIndex: 10 - idx
                                      }}
                                    >
                                      {m.display_name ? m.display_name.split(' ').map(n => n[0]).join('').toUpperCase() : 'U'}
                                    </div>
                                  ))}
                                </div>
                                <button 
                                  className="btn-primary" 
                                  style={{ padding: '6px 14px', fontSize: '12px' }}
                                  onClick={() => {
                                    if (sess.members.some(m => m.user_id === currentUser.id)) {
                                      setActiveSessionBranch(sess.branch);
                                    } else {
                                      handleWorkOnBranchWrapper(sess.branch, false);
                                    }
                                  }}
                                >
                                  {sess.members.some(m => m.user_id === currentUser.id) ? 'Enter Room' : (sess.sessionLink ? 'Join Session' : 'Work on Branch')}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Session History section */}
                    <div>
                      <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text)', marginBottom: '16px' }}>
                        Session History
                      </h3>

                      {sessionHistoryLoading ? (
                        <div style={{ color: 'var(--text-dim)', padding: '24px 0', fontSize: '13.5px' }}>Loading session logs...</div>
                      ) : sessionHistory.length === 0 ? (
                        <div className="panel" style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '32px 16px', fontSize: '13.5px', fontStyle: 'italic' }}>
                          No historical sessions recorded for this project yet.
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                          {sessionHistory.map((sess) => {
                            const createdDate = new Date(sess.created_at).toLocaleString();
                            const closedDate = sess.closed_at ? new Date(sess.closed_at).toLocaleString() : 'Active';
                            
                            return (
                              <div key={sess.id} className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px', minHeight: 'auto' }}>
                                {/* Historical Session Header */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={{
                                      width: '32px',
                                      height: '32px',
                                      borderRadius: '50%',
                                      backgroundColor: sess.creator_avatar_color || 'var(--violet)',
                                      color: '#0c1116',
                                      fontWeight: 700,
                                      fontSize: '12px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center'
                                    }}>
                                      {sess.creator_display_name ? sess.creator_display_name[0].toUpperCase() : 'S'}
                                    </div>
                                    <div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ fontWeight: 600, color: '#ffffff', fontSize: '14px' }}>
                                          {sess.creator_display_name || 'System'}
                                        </span>
                                        <span className="mono" style={{ fontSize: '12px', color: 'var(--teal)', background: 'var(--surface-2)', padding: '2px 8px', borderRadius: '4px', border: '1px solid var(--border)', fontWeight: 600 }}>
                                          {sess.branch_name}
                                        </span>
                                      </div>
                                      <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px' }}>
                                        Opened: {createdDate} · Closed: {closedDate}
                                      </div>
                                    </div>
                                  </div>
                                  <div>
                                    {sess.status === 'active' ? (
                                      <span style={{ fontSize: '9px', fontWeight: 800, color: 'var(--green)', background: 'var(--green-glow)', padding: '3px 8px', borderRadius: '4px', border: '1px solid var(--green)' }}>
                                        ⚡ ACTIVE
                                      </span>
                                    ) : (
                                      <span style={{ fontSize: '9px', fontWeight: 800, color: 'var(--text-dim)', background: 'var(--surface-2)', padding: '3px 8px', borderRadius: '4px', border: '1px solid var(--border)' }}>
                                        COMPLETED
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {/* Enriched Changelog and Deployment metrics */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                  
                                  {/* Left: Changelog Column */}
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                      Session Changelog
                                    </span>
                                    {sess.changelogs.length === 0 ? (
                                      <div style={{ fontSize: '12.5px', color: 'var(--text-dim)', fontStyle: 'italic', background: 'var(--surface-2)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                                        No changelog entries written.
                                      </div>
                                    ) : (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto' }}>
                                        {sess.changelogs.map(log => (
                                          <div key={log.id} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '8px 12px', borderRadius: '6px', fontSize: '12.5px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                            <span style={{ color: 'var(--text)' }}>{log.content}</span>
                                            <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>
                                              by {log.author_display_name || 'Contributor'} · {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>

                                  {/* Right: Deployments Column */}
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                      Session Deployments
                                    </span>
                                    {sess.deployments.length === 0 ? (
                                      <div style={{ fontSize: '12.5px', color: 'var(--text-dim)', fontStyle: 'italic', background: 'var(--surface-2)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                                        No deployments triggered.
                                      </div>
                                    ) : (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto' }}>
                                        {sess.deployments.map(dep => (
                                          <div key={dep.id} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '8px 12px', borderRadius: '6px', fontSize: '12.5px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                                              <span className="mono" style={{ color: 'var(--teal)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                                                Commit: {dep.commit_hash?.substring(0, 7) || 'HEAD'}
                                              </span>
                                              <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>
                                                {new Date(dep.deployed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                              </span>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                              {dep.status === 'success' && (
                                                <button
                                                  onClick={() => {
                                                    setSelectedChangelog(dep.changelog);
                                                    setShowChangelogModal(true);
                                                  }}
                                                  title="View Changelog"
                                                  style={{
                                                    background: 'transparent',
                                                    border: 'none',
                                                    padding: '2px',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    color: 'var(--teal)'
                                                  }}
                                                >
                                                  <BookOpen size={13} />
                                                </button>
                                              )}
                                              <span style={{
                                                fontSize: '9px',
                                                fontWeight: 700,
                                                padding: '2px 6px',
                                                borderRadius: '4px',
                                                background: dep.status === 'success' ? 'var(--green-glow)' : 'rgba(255,85,85,0.1)',
                                                color: dep.status === 'success' ? 'var(--green)' : 'var(--red)',
                                                border: `1px solid ${dep.status === 'success' ? 'var(--green)' : 'var(--red)'}`
                                              }}>
                                                {dep.status.toUpperCase()}
                                              </span>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Start New Session Modal */}
                {showStartSessionModal && (
                  <div className="modal-overlay" style={{ zIndex: 1100 }}>
                    <div className="modal-content" style={{ maxWidth: '420px' }}>
                      <div className="modal-title" style={{ fontSize: '16px', fontWeight: 700, color: '#ffffff' }}>Start New Collaboration Session</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '12px' }}>
                        <p style={{ color: 'var(--text-dim)', fontSize: '13px', margin: 0, lineHeight: 1.5 }}>
                          Select an active branch to start a new collaboration session. This will checkout the branch on your local workspace and notify other team members.
                        </p>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-dim)' }}>Select Branch</label>
                          <select 
                            className="form-control"
                            value={selectedStartBranch}
                            onChange={(e) => setSelectedStartBranch(e.target.value)}
                            style={{ fontSize: '13px', padding: '10px', width: '100%', marginTop: '6px' }}
                          >
                            <option value="">Choose a branch...</option>
                            {branches.map(b => (
                              <option key={b.name} value={b.name}>{b.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="modal-actions" style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '10px' }}>
                          <button 
                            type="button" 
                            className="btn-secondary" 
                            onClick={() => {
                              setShowStartSessionModal(false);
                            }}
                            style={{ padding: '8px 16px', fontSize: '13px' }}
                          >
                            Cancel
                          </button>
                          <button 
                            type="button" 
                            className="btn-primary" 
                            disabled={!selectedStartBranch}
                            onClick={() => {
                              handleWorkOnBranchWrapper(selectedStartBranch, false);
                              setShowStartSessionModal(false);
                            }}
                            style={{ padding: '8px 16px', fontSize: '13px' }}
                          >
                            Start Session
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* DEPLOYMENTS SUBVIEW */}
          {subTab === 'deployments' && (() => {
            const isSandbox = overview && overview.repo?.allow_sandbox_deploy;
            return (
              <div className="subview active" style={{ display: 'flex', flexDirection: 'column', gap: '20px', flexGrow: 1, minHeight: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
                    Deployment Environments
                  </h3>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr', gap: '24px', alignItems: 'start' }}>
                  {/* Active Environment Card */}
                  <div className="panel" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', paddingBottom: '8px', borderBottom: '1px solid var(--border)' }}>
                      Active Environment
                    </div>

                    {isSandbox ? (
                      <>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '13px', color: 'var(--text-dim)' }}>Status:</span>
                            {deployStatus === 'online' ? (
                              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--green)', background: 'var(--green-glow)', padding: '2px 8px', borderRadius: '100px', border: '1px solid var(--green)' }}>
                                ● ONLINE
                              </span>
                            ) : deployStatus === 'deploying' ? (
                              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--amber)', background: 'rgba(245,158,11,0.1)', padding: '2px 8px', borderRadius: '100px', border: '1px solid var(--amber)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <span className="spin" style={{ display: 'inline-block', width: '8px', height: '8px', border: '1.5px solid var(--amber)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></span>
                                DEPLOYING
                              </span>
                            ) : (
                              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--red)', background: 'rgba(248,113,113,0.1)', padding: '2px 8px', borderRadius: '100px', border: '1px solid var(--red)' }}>
                                ● OFFLINE
                              </span>
                            )}
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '13px', color: 'var(--text-dim)' }}>Host Port:</span>
                            <span className="mono" style={{ fontSize: '13px' }}>5001</span>
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '13px', color: 'var(--text-dim)' }}>Endpoint:</span>
                            {deployStatus === 'online' ? (
                              <a 
                                href="http://localhost:5001/" 
                                target="_blank" 
                                rel="noreferrer" 
                                style={{ fontSize: '13px', color: 'var(--teal)', textDecoration: 'none', fontWeight: 500 }}
                              >
                                localhost:5001 ↗
                              </a>
                            ) : (
                              <span style={{ fontSize: '13px', color: 'var(--text-dim)' }}>—</span>
                            )}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', color: 'var(--text-dim)', fontSize: '13.5px', lineHeight: 1.5 }}>
                        <span style={{ fontWeight: 600, color: 'var(--text)' }}>Informational Only</span>
                        <span>This repository has no connected deployment feeds. Deployments are managed externally via Antigravity AI.</span>
                      </div>
                    )}
                  </div>

                  {/* Deployment Log Cards */}
                  <div className="panel" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', paddingBottom: '8px', borderBottom: '1px solid var(--border)' }}>
                      Deployment History Log
                    </div>

                    {deploymentsLoading ? (
                      <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '24px' }}>Loading history...</div>
                    ) : deployments.length === 0 ? (
                      <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '24px', fontSize: '13px', fontStyle: 'italic', lineHeight: 1.5 }}>
                        {isSandbox ? (
                          "No deployment logs found. Trigger a deployment to start."
                        ) : (
                          "No deployment logs found. This is currently informational-only and empty is expected until a real status feed is connected later."
                        )}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {deployments.map((d, index) => {
                          const dateStr = new Date(d.deployed_at).toLocaleString();
                          return (
                            <div 
                              key={d.id} 
                              style={{ 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                alignItems: 'center', 
                                padding: '12px 16px', 
                                background: 'var(--surface-2)', 
                                border: '1px solid var(--border)', 
                                borderRadius: '8px',
                                fontSize: '13px'
                              }}
                            >
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span className="mono" style={{ fontWeight: 600, color: 'var(--teal)' }}>
                                    {d.branch_name}
                                  </span>
                                  <span className="mono" style={{ color: 'var(--text-dim)', fontSize: '11px' }}>
                                    ({d.commit_hash?.substring(0, 7) || 'HEAD'})
                                  </span>
                                </div>
                                <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                                  {dateStr} · by {d.display_name || 'System'}
                                </span>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                {d.status === 'success' && (
                                  <button
                                    onClick={() => {
                                      setSelectedChangelog(d.changelog);
                                      setShowChangelogModal(true);
                                    }}
                                    style={{
                                      background: 'rgba(77,238,234,0.05)',
                                      border: '1px solid rgba(77,238,234,0.2)',
                                      padding: '4px 8px',
                                      borderRadius: '4px',
                                      fontSize: '11px',
                                      color: 'var(--teal)',
                                      cursor: 'pointer',
                                      transition: 'all 0.15s ease'
                                    }}
                                    onMouseOver={(e) => {
                                      e.currentTarget.style.background = 'rgba(77,238,234,0.1)';
                                      e.currentTarget.style.borderColor = 'var(--teal)';
                                    }}
                                    onMouseOut={(e) => {
                                      e.currentTarget.style.background = 'rgba(77,238,234,0.05)';
                                      e.currentTarget.style.borderColor = 'rgba(77,238,234,0.2)';
                                    }}
                                  >
                                    View Changelog
                                  </button>
                                )}
                                {d.status === 'success' && index > 0 && (
                                  <button
                                    onClick={() => handleRollback(d)}
                                    style={{
                                      background: 'rgba(244,63,94,0.05)',
                                      border: '1px solid rgba(244,63,94,0.2)',
                                      padding: '4px 8px',
                                      borderRadius: '4px',
                                      fontSize: '11px',
                                      color: 'var(--red)',
                                      cursor: 'pointer',
                                      transition: 'all 0.15s ease',
                                      marginLeft: '6px'
                                    }}
                                    onMouseOver={(e) => {
                                      e.currentTarget.style.background = 'rgba(244,63,94,0.1)';
                                      e.currentTarget.style.borderColor = 'var(--red)';
                                    }}
                                    onMouseOut={(e) => {
                                      e.currentTarget.style.background = 'rgba(244,63,94,0.05)';
                                      e.currentTarget.style.borderColor = 'rgba(244,63,94,0.2)';
                                    }}
                                  >
                                    Rollback
                                  </button>
                                )}
                                <span 
                                  style={{ 
                                    fontSize: '10px', 
                                    fontWeight: 800, 
                                    color: d.status === 'success' ? 'var(--green)' : 'var(--red)', 
                                    textTransform: 'uppercase',
                                    background: d.status === 'success' ? 'var(--green-glow)' : 'rgba(248,113,113,0.1)',
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    border: `1px solid ${d.status === 'success' ? 'var(--green)' : 'var(--red)'}`
                                  }}
                                >
                                  {d.status}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ANALYTICS SUBVIEW */}
          {subTab === 'analytics' && (
            <div className="subview active">
              <div className="panel" style={{ textAlign: 'center', padding: '64px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                <BarChart2 size={48} style={{ color: 'var(--text-dim)', opacity: 0.5 }} />
                <div>
                  <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text)', marginBottom: '8px' }}>Analytics Area</h3>
                  <p style={{ color: 'var(--text-dim)', fontSize: '13.5px', maxWidth: '460px', margin: '0 auto', lineHeight: 1.5 }}>
                    This area will visualize team velocity, repository health trends, and code metrics. To build this, we need defined metrics and a pipeline to compile analytics data.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* SETTINGS SUBVIEW */}
          {subTab === 'settings' && (
            <div className="subview active">
              <Integrations 
                integrations={integrations} 
                onRegisterIntegration={onRegisterIntegration}
                embedded={true}
              />
            </div>
          )}
        </div>
      </div>

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

      {/* New Task Modal */}
      {showNewTaskModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-title">Create New Task</div>
            <form onSubmit={handleCreateTaskSubmit}>
              <div className="form-group">
                <label>Title</label>
                <input 
                  type="text" 
                  className="form-control" 
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="Task title"
                  required
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea 
                  className="form-control" 
                  rows="3"
                  value={newTaskDescription}
                  onChange={(e) => setNewTaskDescription(e.target.value)}
                  placeholder="Detailed description..."
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="form-group">
                  <label>Priority</label>
                  <select 
                    className="form-control"
                    value={newTaskPriority}
                    onChange={(e) => setNewTaskPriority(e.target.value)}
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
                    value={newTaskAssignee}
                    onChange={(e) => setNewTaskAssignee(e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.display_name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="modal-actions">
                <button 
                  type="button" 
                  className="btn-secondary"
                  onClick={() => setShowNewTaskModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Create Task
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
                <span className="mono">{selectedTicket.source || 'internal'}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-dim)' }}>Status:</span>{' '}
                <span className="mono" style={{ color: 'var(--teal)' }}>{selectedTicket.status}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-dim)' }}>Assignee:</span>{' '}
                <span>{selectedTicket.assignee_name || selectedTicket.assignee_display_name || 'Unassigned'}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-dim)' }}>Related branch:</span>{' '}
                <span className="mono">{selectedTicket.repo_name || selectedTicket.repo_or_project || '—'}</span>
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
                    const isTask = !selectedTicket.source || selectedTicket.source === 'internal';
                    if (isTask) {
                      handleUpdateTaskStatus(selectedTicket.id, selectedTicket.status, nextVal);
                    } else {
                      onUpdateTicketStatus(selectedTicket.id, selectedTicket.status, nextVal);
                    }
                    setSelectedTicket({ ...selectedTicket, assignee_user_id: nextVal, assignee_display_name: users.find(u => u.id === nextVal)?.display_name, assignee_name: users.find(u => u.id === nextVal)?.display_name });
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
      {/* Changelog Modal */}
      {showChangelogModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '650px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-title" style={{ flexShrink: 0 }}>Deployment Changelog Details</div>
            
            <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px', marginBottom: '20px' }}>
              {renderChangelogMarkdown(selectedChangelog)}
            </div>

            <div className="modal-actions" style={{ flexShrink: 0, justifyContent: 'flex-end', margin: 0, paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
              <button 
                type="button" 
                className="btn-primary"
                onClick={() => {
                  setShowChangelogModal(false);
                  setSelectedChangelog('');
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rollback Confirmation Modal */}
      {rollbackTarget && (
        <div className="modal-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div className="modal-card" style={{ width: '450px', padding: '28px', borderRadius: '14px', background: 'var(--surface)', border: '2px solid var(--red)', boxShadow: '0 8px 32px rgba(244,63,94,0.15)' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--red)', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
              ⚠️ Confirm Rollback
            </h3>
            
            <p style={{ fontSize: '13.5px', color: '#ffffff', lineHeight: 1.5, margin: '0 0 20px 0' }}>
              This will checkout commit <code className="mono" style={{ color: 'var(--amber)', background: 'rgba(0,0,0,0.2)', padding: '2px 6px', borderRadius: '4px' }}>{rollbackTarget.commit_hash.substring(0, 7)}</code> (deployed on {new Date(rollbackTarget.deployed_at).toLocaleString()}) in the local workspace and restart the sandbox server on port 5001.
              <br /><br />
              <strong>Are you sure you want to continue?</strong>
            </p>
            
            <div className="modal-actions" style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button 
                type="button" 
                className="btn-secondary" 
                onClick={() => setRollbackTarget(null)}
                style={{ padding: '8px 16px', fontSize: '13px', cursor: 'pointer' }}
                disabled={isRollingBack}
              >
                Cancel
              </button>
              <button 
                type="button" 
                className="btn-primary" 
                onClick={executeRollback}
                disabled={isRollingBack}
                style={{ padding: '8px 16px', fontSize: '13px', backgroundColor: 'var(--red)', borderColor: 'var(--red)', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
              >
                {isRollingBack ? (
                  <>
                    <RefreshCw size={13} className="spin" />
                    <span>Rolling Back...</span>
                  </>
                ) : (
                  <span>Continue Rollback</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
