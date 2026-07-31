import React, { useState, useEffect, useRef } from 'react';
import { 
  Folder, 
  FolderOpen, 
  FileCode, 
  FileText, 
  File, 
  Copy, 
  Check, 
  Clock, 
  User, 
  Server, 
  MessageSquare, 
  Plus,
  Compass, 
  FileCheck,
  ChevronRight,
  ChevronDown,
  BookOpen,
  Edit3,
  Save
} from 'lucide-react';

// Collapsible File Node Component
function FileNode({ node, level = 0, members = [] }) {
  const [isOpen, setIsOpen] = useState(level < 2); // Auto-expand top levels
  const isDir = node.isDir;

  const toggleOpen = () => {
    setIsOpen(!isOpen);
  };

  const getIcon = () => {
    if (isDir) {
      return isOpen ? (
        <FolderOpen size={16} style={{ color: 'var(--amber)', marginRight: '6px' }} />
      ) : (
        <Folder size={16} style={{ color: 'var(--amber)', marginRight: '6px' }} />
      );
    }
    
    // File icons based on extension
    const ext = node.name.split('.').pop().toLowerCase();
    if (['js', 'jsx', 'ts', 'tsx'].includes(ext)) {
      return <FileCode size={16} style={{ color: 'var(--teal)', marginRight: '6px' }} />;
    } else if (['md', 'txt', 'json'].includes(ext)) {
      return <FileText size={16} style={{ color: 'var(--violet)', marginRight: '6px' }} />;
    }
    return <File size={16} style={{ color: 'var(--text-dim)', marginRight: '6px' }} />;
  };

  // Find active editors on this file path
  const activeEditors = members.filter(m => m.active_file && m.active_file === node.path);

  return (
    <div style={{ marginLeft: `${level * 12}px`, fontSize: '13px' }}>
      <div 
        onClick={isDir ? toggleOpen : null}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '4px 6px',
          borderRadius: '4px',
          cursor: isDir ? 'pointer' : 'default',
          userSelect: 'none',
          backgroundColor: 'transparent',
          transition: 'background-color 0.15s'
        }}
        className="file-tree-row"
      >
        {isDir && (
          <span style={{ display: 'inline-flex', alignItems: 'center', marginRight: '2px', color: 'var(--text-dim)' }}>
            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        )}
        {!isDir && <span style={{ width: '14px' }}></span>}
        {getIcon()}
        <span style={{ color: isDir ? '#ffffff' : 'var(--text)' }}>{node.name}</span>

        {/* Render active editors initials */}
        {activeEditors.map(editor => (
          <span 
            key={editor.user_id}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '18px',
              height: '18px',
              borderRadius: '50%',
              fontSize: '8px',
              fontWeight: 700,
              backgroundColor: editor.avatar_color || 'var(--violet)',
              color: '#0c1116',
              marginLeft: '6px',
              border: '1px solid var(--border)',
              boxShadow: '0 0 4px var(--teal-glow)'
            }}
            title={`${editor.user_name || editor.display_name} is editing this file`}
          >
            {(editor.user_name || editor.display_name || 'U').split(' ').map(n => n[0]).join('').toUpperCase()}
          </span>
        ))}
      </div>
      
      {isDir && isOpen && node.children && (
        <div style={{ borderLeft: '1px solid var(--border)', marginLeft: '12px' }}>
          {node.children.map((child, idx) => (
            <FileNode key={idx} node={child} level={level + 1} members={members} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Session({ sessionData, activePresence, currentUser, onSavePresence, socket, onLeaveSession }) {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [sessionUrl, setSessionUrl] = useState('');
  const [deployments, setDeployments] = useState([]);
  
  // Workspace States
  const [fileTree, setFileTree] = useState(null);
  const [fileTreeLoading, setFileTreeLoading] = useState(true);
  const [fileTreeError, setFileTreeError] = useState(null);
  const [commits, setCommits] = useState([]);
  const [commitsLoading, setCommitsLoading] = useState(true);
  
  // Embedded Project Tab States
  const [leftTab, setLeftTab] = useState('files'); // 'files' or 'project'
  const [overview, setOverview] = useState(null);
  const [docs, setDocs] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [sessionHost, setSessionHost] = useState(null);
  const [sessionHostId, setSessionHostId] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [relatedTickets, setRelatedTickets] = useState([]);
  
  // Elapsed session timer states
  const [sessionCreatedAt, setSessionCreatedAt] = useState(null);
  const [elapsedTime, setElapsedTime] = useState('Session open: 0m');
  const [pendingJoinRequests, setPendingJoinRequests] = useState([]);

  const [copied, setCopied] = useState(false);
  const chatEndRef = useRef(null);

  const repo = sessionData?.repo || 'Shift_Software';
  const branch = sessionData?.branch || 'development';
  const sessionLink = sessionData?.sessionLink || '';

  const getJoinCode = (url) => {
    if (!url) return '';
    const parts = url.split('/');
    return parts[parts.length - 1];
  };

  // Fetch Session details
  const fetchSessionHostAndTickets = async () => {
    try {
      // 1. Fetch active session room host details
      const activeRes = await fetch(`/api/session-rooms/active?repo=${repo}&branch=${branch}`);
      if (activeRes.ok) {
        const roomData = await activeRes.json();
        if (roomData) {
          setSessionHost(roomData.creator_display_name || 'Unknown Host');
          setSessionHostId(roomData.created_by_user_id);
          setRoomId(roomData.id);
          setSessionCreatedAt(roomData.created_at);
        }
      }

      // 2. Fetch related tickets (any tickets of this project)
      const ticketRes = await fetch(`/api/tickets?repo=${repo}`);
      if (ticketRes.ok) {
        const allTickets = await ticketRes.json();
        const branchLower = branch.toLowerCase();
        const related = allTickets.filter(t => {
          const ticketIdStr = t.id.toString();
          const extIdStr = t.external_id ? t.external_id.toString() : '';
          return (
            branchLower.includes(ticketIdStr) || 
            (extIdStr && branchLower.includes(extIdStr)) ||
            branchLower.includes(t.title.toLowerCase().replace(/[^a-z0-9]/g, '')) ||
            t.status === 'in-progress'
          );
        });
        setRelatedTickets(related);
      }
    } catch (err) {
      console.error('Error fetching session info:', err);
    }
  };

  // Dynamic elapsed time update loop
  useEffect(() => {
    if (!sessionCreatedAt) return;

    const updateTimer = () => {
      const start = new Date(sessionCreatedAt).getTime();
      const diffMs = Date.now() - start;
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 60) {
        setElapsedTime(`Session open: ${diffMins}m`);
      } else {
        const hrs = Math.floor(diffMins / 60);
        const mins = diffMins % 60;
        setElapsedTime(`Session open: ${hrs}h ${mins}m`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 30000);
    return () => clearInterval(interval);
  }, [sessionCreatedAt]);

  // Fetch live File Tree
  const fetchFileTree = async () => {
    setFileTreeError(null);
    try {
      const res = await fetch(`/api/repos/${repo}/files`);
      if (res.ok) {
        const tree = await res.json();
        setFileTree(tree);
      } else {
        const data = await res.json().catch(() => ({}));
        setFileTreeError(data.error || 'Local directory unavailable.');
        setFileTree(null);
      }
    } catch (err) {
      console.error('Error fetching file tree:', err);
      setFileTreeError('Connection to workspace failed.');
      setFileTree(null);
    } finally {
      setFileTreeLoading(false);
    }
  };

  // Fetch Commits
  const fetchCommits = async () => {
    try {
      const res = await fetch(`/api/repos/${repo}/overview`);
      if (res.ok) {
        const overview = await res.json();
        setCommits(overview.commits || []);
      }
    } catch (err) {
      console.error('Error fetching commits:', err);
    } finally {
      setCommitsLoading(false);
    }
  };


  const fetchOverviewData = async () => {
    try {
      const res = await fetch(`/api/repos/${repo}/overview`);
      if (res.ok) {
        const data = await res.json();
        setOverview(data);
      }
    } catch (err) {
      console.error('Error fetching overview inside session:', err);
    } finally {
      setOverviewLoading(false);
    }
  };

  const fetchDocs = async () => {
    try {
      const res = await fetch(`/api/docs?repo_name=${repo}`);
      if (res.ok) {
        const data = await res.json();
        setDocs(data);
      }
    } catch (err) {
      console.error('Error fetching docs inside session:', err);
    }
  };

  const fetchTickets = async () => {
    try {
      const res = await fetch(`/api/tickets?repo=${repo}`);
      if (res.ok) {
        const data = await res.json();
        setTickets(data);
      }
    } catch (err) {
      console.error('Error fetching tickets inside session:', err);
    }
  };


  // Run on mount or session change
  useEffect(() => {
    setFileTreeLoading(true);
    fetchFileTree();
    fetchCommits();
    fetchSessionHostAndTickets();
    fetchOverviewData();
    fetchDocs();
    fetchTickets();

    const intervalId = setInterval(() => {
      fetchOverviewData();
      fetchDocs();
      fetchTickets();
    }, 10000);

    // Fetch chat history from DB
    const fetchHistory = async () => {
      try {
        const res = await fetch(`/api/rooms/${repo}/${branch}/messages`);
        if (res.ok) {
          const history = await res.json();
          const mapped = history.map(h => ({
            system: false,
            sender: h.display_name,
            avatarColor: h.avatar_color,
            text: h.message,
            time: new Date(h.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }));
          
          const systemMsg = {
            system: true,
            text: `Connected to live collaboration room ${repo}/${branch}`,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          };
          
          setMessages([systemMsg, ...mapped]);
        }
      } catch (err) {
        console.error('Error fetching chat history:', err);
      }
    };

    // Fetch deployments history
    const fetchDeployments = async () => {
      try {
        const res = await fetch(`/api/rooms/${repo}/${branch}/deployments`);
        if (res.ok) {
          const history = await res.json();
          setDeployments(history);
        }
      } catch (err) {
        console.error('Error fetching deployments:', err);
      }
    };

    fetchHistory();
    fetchDeployments();

    // WebSocket Listeners
    if (socket) {
      socket.emit('room:join', { repo, branch });

      socket.on('room:event', (event) => {
        if (event.event_type === 'repo:synced') {
          console.log('[Session] Git repo synchronized! Reloading file tree...');
          fetchFileTree();
          fetchCommits();
        }
      });
      socket.on('team:message', (newMsg) => {
        const mapped = {
          system: false,
          sender: newMsg.display_name,
          avatarColor: newMsg.avatar_color,
          text: newMsg.message,
          time: new Date(newMsg.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        setMessages(prev => [...prev, mapped]);
      });

      socket.on('room:deploy', (newDeploy) => {
        setDeployments(prev => [newDeploy, ...prev]);
      });

      socket.on('session:join_request', (req) => {
        setPendingJoinRequests(prev => [...prev, req]);
      });

      socket.on('room:closed', (closedData) => {
        alert('The host has ended this collaboration session.');
        window.location.reload();
      });
    }

    return () => {
      clearInterval(intervalId);
      if (socket) {
        socket.off('team:message');
        socket.off('room:deploy');
        socket.off('room:event');
        socket.off('session:join_request');
        socket.off('room:closed');
      }
    };
  }, [repo, branch, socket]);

  // Keep chat scrolled
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    setSessionUrl(sessionLink);
  }, [sessionLink]);

  const handleSend = (e) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    if (socket) {
      socket.emit('room:message', {
        repo,
        branch,
        user_id: currentUser.id,
        message: inputValue
      });
      setInputValue('');
    }
  };

  const handleUpdateLink = (e) => {
    e.preventDefault();
    if (!sessionUrl.trim()) return;
    onSavePresence(repo, branch, sessionUrl);
  };

  const handleCopy = () => {
    const code = getJoinCode(sessionUrl);
    navigator.clipboard.writeText(code || sessionUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const members = activePresence.filter(p => p.repo_name === repo && p.branch_name === branch);

  // Markdown renderer for session notes
  const renderNoteMarkdown = (text) => {
    if (!text) return null;
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^\- (.*$)/gim, '<li>$1</li>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/`(.*?)`/g, '<code class="mono">$1</code>');
    
    html = html.split('\n\n').map(p => {
      if (p.startsWith('<h') || p.startsWith('<li>')) return p;
      return `<p>${p.replace(/\n/g, '<br />')}</p>`;
    }).join('');

    return <div className="doc-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
  };

  const myPresence = activePresence.find(p => p.repo_name === repo && p.branch_name === branch && p.user_id === currentUser.id);
  let showSyncWarning = false;
  let modifiedCount = 0;
  if (myPresence && myPresence.modified_files) {
    try {
      const parsed = JSON.parse(myPresence.modified_files);
      if (Array.isArray(parsed) && parsed.length > 0) {
        showSyncWarning = true;
        modifiedCount = parsed.length;
      }
    } catch(e) {}
  }

  // Find any other users editing the same repo but on different branches
  const otherParticipants = activePresence.filter(p => p.repo_name === repo && p.user_id !== currentUser.id);
  const overlappingFiles = [];
  
  let myModifiedList = [];
  if (myPresence && myPresence.modified_files) {
    try {
      myModifiedList = JSON.parse(myPresence.modified_files) || [];
    } catch(e) {}
  }
  
  otherParticipants.forEach(op => {
    if (op.modified_files) {
      try {
        const opModified = JSON.parse(op.modified_files) || [];
        opModified.forEach(file => {
          if (myModifiedList.includes(file)) {
            overlappingFiles.push({
              file,
              user: op.display_name || op.username || 'Someone else',
              branch: op.branch_name
            });
          }
        });
      } catch(e) {}
    }
  });

  return (
    <div className="view" style={{ maxWidth: '100%' }}>
      
      {/* Page Header */}
      <div className="page-header-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="page-header-title-area">
          <div className="page-header-title">
            <span>Collaboration Room</span>
            <span style={{
              fontSize: '11px',
              backgroundColor: 'var(--green-glow)',
              color: 'var(--green)',
              padding: '3px 8px',
              borderRadius: '12px',
              fontWeight: 700,
              textTransform: 'uppercase',
              border: '1px solid var(--green)'
            }}>
              ● Live Sync Connected
            </span>
          </div>
          <div className="page-header-desc">
            Active session room for {repo} on branch {branch}
          </div>
        </div>
        
        {/* End/Leave Button */}
        <div>
          {currentUser.id === sessionHostId ? (
            <button
              className="btn-primary"
              style={{ backgroundColor: 'var(--red)', borderColor: 'var(--red)', padding: '8px 16px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}
              onClick={async () => {
                if (window.confirm("Are you sure you want to end this collaboration session? This will disconnect all participants and archive the session history.")) {
                  if (onLeaveSession) {
                    try {
                      const activeRes = await fetch(`/api/session-rooms/active?repo=${repo}&branch=${branch}`);
                      if (activeRes.ok) {
                        const roomData = await activeRes.json();
                        await onLeaveSession(roomData.id, true);
                      }
                    } catch (e) {
                      console.error("Failed to close session:", e);
                    }
                  }
                }
              }}
            >
              End Session
            </button>
          ) : (
            <button
              className="btn-secondary"
              style={{ padding: '8px 16px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}
              onClick={async () => {
                if (window.confirm("Are you sure you want to leave this collaboration room?")) {
                  if (onLeaveSession) {
                    try {
                      const activeRes = await fetch(`/api/session-rooms/active?repo=${repo}&branch=${branch}`);
                      if (activeRes.ok) {
                        const roomData = await activeRes.json();
                        await onLeaveSession(roomData.id, false);
                      }
                    } catch (e) {
                      console.error("Failed to leave session:", e);
                    }
                  }
                }
              }}
            >
              Leave Room
            </button>
          )}
        </div>
      </div>

      {/* Sync Warning Banner */}
      {showSyncWarning && (
        <div style={{
          background: 'rgba(245, 158, 11, 0.1)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          borderLeft: '4px solid var(--amber)',
          borderRadius: '8px',
          padding: '12px 16px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '13px',
          color: 'var(--amber)',
          fontFamily: 'Inter, sans-serif'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>⚠️</span>
            <span><strong>Sync Reminder:</strong> You have {modifiedCount} local uncommitted changes sitting in your workspace. Remember to commit and sync with GitHub regularly so others can see your progress.</span>
          </div>
        </div>
      )}

      {/* Overlapping Changes Conflict Alert */}
      {overlappingFiles.length > 0 && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderLeft: '4px solid var(--red)',
          borderRadius: '8px',
          padding: '12px 16px',
          marginBottom: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          fontSize: '13px',
          color: 'var(--red)',
          fontFamily: 'Inter, sans-serif'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700 }}>
            <span>🚨</span>
            <span>Preemptive Conflict Alert: Overlapping local changes detected!</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '22px', fontSize: '12px', color: 'var(--text-dim)' }}>
            {overlappingFiles.map((item, idx) => (
              <div key={idx}>
                File <code className="mono" style={{ color: 'var(--amber)' }}>{item.file}</code> is also being modified by <strong>{item.user}</strong> on branch <code className="mono">{item.branch}</code>.
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Grid: Three Columns */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: '20px', height: 'calc(100vh - 200px)', minHeight: '550px' }}>
        
        {/* Left Column: Switcher + File Tree / Project Context */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%', overflow: 'hidden' }}>
          
          {/* Tab bar switcher */}
          <div style={{ display: 'flex', gap: '6px', background: 'var(--surface-2)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border)', flexShrink: 0 }}>
            <button 
              onClick={() => setLeftTab('files')}
              style={{
                flex: 1,
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                background: leftTab === 'files' ? 'var(--surface)' : 'transparent',
                color: leftTab === 'files' ? 'var(--teal)' : 'var(--text-dim)',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              Workspace Files
            </button>
            <button 
              onClick={() => setLeftTab('project')}
              style={{
                flex: 1,
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                background: leftTab === 'project' ? 'var(--surface)' : 'transparent',
                color: leftTab === 'project' ? 'var(--teal)' : 'var(--text-dim)',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              Project Context
            </button>
          </div>

          {leftTab === 'files' ? (
            <>
              {/* File Tree Panel */}
              <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', margin: 0 }}>
                <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                  <Compass size={16} /> Live Project Files
                </div>
                
                <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
                  {fileTreeLoading ? (
                    <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '20px 0' }}>
                      Scanning project workspace...
                    </div>
                  ) : fileTreeError ? (
                    <div style={{ color: 'var(--amber)', textAlign: 'center', padding: '20px 10px', fontSize: '12px', background: 'rgba(245,158,11,0.08)', borderRadius: '6px', border: '1px solid rgba(245,158,11,0.2)' }}>
                      ⚠️ {fileTreeError}
                    </div>
                  ) : fileTree ? (
                    <div style={{ padding: '2px' }}>
                      <FileNode node={fileTree} level={0} members={members} />
                    </div>
                  ) : (
                    <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '20px 0' }}>
                      No local files found.
                    </div>
                  )}
                </div>
              </div>

              {/* Recent Commits Panel */}
              <div className="panel" style={{ height: '140px', display: 'flex', flexDirection: 'column', overflow: 'hidden', margin: 0 }}>
                <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <Clock size={16} /> Branch History
                </div>
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {commitsLoading ? (
                    [1, 2].map(i => (
                      <div key={i} className="skeleton" style={{ height: '42px', borderRadius: '6px', opacity: 0.3 }}></div>
                    ))
                  ) : commits.length === 0 ? (
                    <div style={{ color: 'var(--text-dim)', fontSize: '12px', fontStyle: 'italic', padding: '10px 0' }}>
                      No commits found.
                    </div>
                  ) : (
                    commits.map((c) => (
                      <div key={c.hash} style={{ background: 'var(--surface-2)', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '11.5px' }}>
                        <div style={{ fontWeight: 600, color: '#ffffff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {c.message}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-dim)', fontSize: '10px', marginTop: '4px' }}>
                          <span>by {c.author}</span>
                          <span className="mono" style={{ color: 'var(--teal)' }}>{c.hash.substring(0, 7)}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Rider Diffs Panel */}
              <div className="panel" style={{ height: '140px', display: 'flex', flexDirection: 'column', overflow: 'hidden', margin: 0 }}>
                <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <Compass size={16} /> Workspace Diffs
                </div>
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {members.length === 0 ? (
                    <div style={{ color: 'var(--text-dim)', fontSize: '12px', fontStyle: 'italic', padding: '10px 0' }}>
                      No active telemetry.
                    </div>
                  ) : (
                    members.map((m) => {
                      let staged = [];
                      let modified = [];
                      try {
                        if (m.staged_files) staged = JSON.parse(m.staged_files);
                        if (m.modified_files) modified = JSON.parse(m.modified_files);
                      } catch (e) {}

                      return (
                        <div key={m.user_id} style={{ background: 'var(--surface-2)', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '11.5px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: '#ffffff' }}>
                            <span>{m.user_name || m.display_name}</span>
                            <span style={{ color: 'var(--teal)', fontSize: '10.5px', textTransform: 'uppercase', fontWeight: 700 }}>
                              {m.last_activity || 'online'}
                            </span>
                          </div>
                          {m.active_file && (
                            <div style={{ color: 'var(--text)', fontSize: '11px', marginTop: '4px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                              Editing: <code className="mono" style={{ color: 'var(--amber)' }}>{m.active_file}</code>
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: '10px', color: 'var(--text-dim)', fontSize: '10.5px', marginTop: '4px' }}>
                            <span>Staged: <strong style={{ color: staged.length > 0 ? 'var(--green)' : 'var(--text-dim)' }}>{staged.length}</strong></span>
                            <span>Modified: <strong style={{ color: modified.length > 0 ? 'var(--amber)' : 'var(--text-dim)' }}>{modified.length}</strong></span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          ) : (
            /* Project Overview Side Panel */
            <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', gap: '16px', margin: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--teal)' }}>Project: {repo}</div>
                {overview && (
                  <span style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: overview.health.score === 'A' ? 'var(--green)' : 'var(--amber)',
                    background: overview.health.score === 'A' ? 'var(--green-glow)' : 'rgba(242,166,90,0.15)',
                    padding: '2px 6px',
                    borderRadius: '4px'
                  }}>
                    Health: {overview.health.score}
                  </span>
                )}
              </div>

              {overviewLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[1, 2, 3].map(i => (
                    <div key={i} className="skeleton" style={{ height: '50px', borderRadius: '6px', opacity: 0.3 }}></div>
                  ))}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '12px' }}>
                  
                  {/* Health score details */}
                  {overview?.health && (
                    <div style={{ background: 'var(--surface-2)', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                      <div style={{ fontWeight: 600, color: '#ffffff', marginBottom: '4px' }}>Health Metrics</div>
                      {overview.health.factors.map((f, idx) => (
                        <div key={idx} style={{ color: 'var(--text-dim)', fontSize: '11px' }}>• {f}</div>
                      ))}
                    </div>
                  )}

                  {/* Active Branches */}
                  <div>
                    <div style={{ fontWeight: 600, color: '#ffffff', marginBottom: '6px', textTransform: 'uppercase', fontSize: '10.5px', letterSpacing: '0.05em' }}>Active Branches</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {overview?.branches?.slice(0, 3).map((b, idx) => (
                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: 'var(--surface-2)', borderRadius: '4px' }}>
                          <span className="mono" style={{ color: 'var(--text)' }}>{b.name}</span>
                          <span style={{ color: 'var(--text-dim)', fontSize: '10.5px' }}>{b.meta}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Documentation */}
                  <div>
                    <div style={{ fontWeight: 600, color: '#ffffff', marginBottom: '6px', textTransform: 'uppercase', fontSize: '10.5px', letterSpacing: '0.05em' }}>Project Documentation</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {docs.slice(0, 3).map(d => (
                        <div key={d.id} style={{ padding: '6px 8px', background: 'var(--surface-2)', borderRadius: '4px', color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          📄 {d.title}
                        </div>
                      ))}
                      {docs.length === 0 && (
                        <div style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontSize: '11px' }}>No documents created.</div>
                      )}
                    </div>
                  </div>

                  {/* Ticket Summary */}
                  <div>
                    <div style={{ fontWeight: 600, color: '#ffffff', marginBottom: '6px', textTransform: 'uppercase', fontSize: '10.5px', letterSpacing: '0.05em' }}>Ticket Summary</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {tickets.slice(0, 3).map(t => (
                        <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', background: 'var(--surface-2)', borderRadius: '4px' }}>
                          <span style={{ color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px' }}>#{t.id} {t.title}</span>
                          <span className={`kcard-prio ${t.priority}`} style={{ fontSize: '9px', padding: '1px 4px', borderRadius: '3px' }}>{t.priority}</span>
                        </div>
                      ))}
                      {tickets.length === 0 && (
                        <div style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontSize: '11px' }}>No active tickets.</div>
                      )}
                    </div>
                  </div>

                  {/* Deployment History */}
                  <div>
                    <div style={{ fontWeight: 600, color: '#ffffff', marginBottom: '6px', textTransform: 'uppercase', fontSize: '10.5px', letterSpacing: '0.05em' }}>Deployment History</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {deployments.slice(0, 3).map(d => (
                        <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: 'var(--surface-2)', borderRadius: '4px' }}>
                          <span style={{ color: 'var(--text-dim)' }}>v{d.version}</span>
                          <span style={{
                            color: d.status === 'success' ? 'var(--green)' : 'var(--red)',
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            fontSize: '10px'
                          }}>
                            {d.status}
                          </span>
                        </div>
                      ))}
                      {deployments.length === 0 && (
                        <div style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontSize: '11px' }}>No deployment history.</div>
                      )}
                    </div>
                  </div>

                </div>
              )}
            </div>
          )}
        </div>

        {/* Middle Column: Room Info, Chat & Tickets, Relational Notes */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: '100%', overflow: 'hidden' }}>
          
          {/* Prominent Join Code Banner */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(77, 238, 234, 0.08) 0%, rgba(189, 147, 249, 0.08) 100%)',
            border: '2px solid var(--teal)',
            borderRadius: '16px',
            padding: '16px 20px',
            boxShadow: '0 8px 32px var(--teal-glow)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--teal)', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '4px' }}>
                  ● Session Host: <strong style={{ color: '#ffffff' }}>{sessionHost || 'No active session'}</strong>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div className="mono" style={{ fontSize: '20px', fontWeight: 800, color: '#ffffff', background: 'rgba(0,0,0,0.3)', padding: '4px 12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)' }}>
                    {getJoinCode(sessionUrl) || 'NO ACTIVE ROOM'}
                  </div>
                </div>
              </div>
              {sessionUrl && (
                <button 
                  type="button" 
                  onClick={handleCopy} 
                  className="btn-primary" 
                  style={{ padding: '8px 16px', borderRadius: '6px', fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? 'Copied' : 'Copy Code'}
                </button>
              )}
            </div>
          </div>

          {/* Linked Tickets Panel */}
          {relatedTickets.length > 0 && (
            <div className="panel" style={{ padding: '12px 16px', flexShrink: 0 }}>
              <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '13.5px' }}>
                <FileCheck size={15} /> Linked Tickets
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {relatedTickets.map(t => (
                  <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 12px', background: 'var(--surface-2)', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className={`prio-dot ${t.priority}`}></span>
                      <span style={{ fontWeight: 600, color: '#ffffff' }}>#{t.id} {t.title}</span>
                    </div>
                    <span style={{
                      fontSize: '9px',
                      textTransform: 'uppercase',
                      fontWeight: 700,
                      color: t.status === 'in-progress' ? 'var(--amber)' : t.status === 'review' ? 'var(--violet)' : 'var(--text-dim)',
                      border: `1px solid ${t.status === 'in-progress' ? 'var(--amber)' : t.status === 'review' ? 'var(--violet)' : 'var(--border)'}`,
                      padding: '1px 5px',
                      borderRadius: '4px'
                    }}>
                      {t.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Team Chat Panel */}
          <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '10px', marginBottom: '12px' }}>
              <MessageSquare size={15} style={{ color: 'var(--teal)' }} />
              <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#ffffff' }}>Team Chat</span>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div className="chat-messages" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', paddingRight: '4px', marginBottom: '12px' }}>
                {messages.map((m, idx) => (
                  <div key={idx} className="msg" style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    {m.system ? (
                      <div style={{ flex: 1, color: 'var(--text-dim)', fontSize: '11.5px', fontStyle: 'italic', textAlign: 'center', padding: '4px 0', borderBottom: '1px dashed var(--border)' }}>
                        {m.text} · {m.time}
                      </div>
                    ) : (
                      <>
                        <div 
                          className="avatar" 
                          style={{ backgroundColor: m.avatarColor || 'var(--violet)', color: '#0C1116', flexShrink: 0 }}
                        >
                          {m.sender.split(' ').map(n => n[0]).join('').toUpperCase()}
                        </div>
                        <div className="msg-body" style={{ minWidth: 0 }}>
                          <div className="msg-name" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-dim)', display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                            <span style={{ color: '#ffffff' }}>{m.sender}</span>
                            <span style={{ fontWeight: 400, fontSize: '10px' }}>{m.time}</span>
                          </div>
                          <div style={{ fontSize: '13px', color: 'var(--text)', marginTop: '2px', lineHeight: 1.4, wordBreak: 'break-word' }}>
                            {m.text}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              <form onSubmit={handleSend} className="chat-input" style={{ display: 'flex', gap: '10px' }}>
                <input 
                  type="text" 
                  placeholder="Message the team..." 
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  style={{
                    flex: 1,
                    backgroundColor: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    color: '#ffffff',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    outline: 'none'
                  }}
                />
                <button 
                  type="submit" 
                  className="btn-primary"
                  style={{ height: '38px', padding: '0 20px', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
                >
                  Send
                </button>
              </form>
            </div>
          </div>

        </div>

        {/* Right Column: Active Developers, Deployments & Session Timeline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: '100%', overflow: 'hidden' }}>
          
          {/* Active Collaborators panel */}
          <div className="panel" style={{ flexShrink: 0 }}>
            <div className="panel-title">
              In this room <span className="count">{members.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {members.length === 0 ? (
                <div style={{ color: 'var(--text-dim)', fontSize: '12px', fontStyle: 'italic' }}>
                  No other active collaborators.
                </div>
              ) : (
                members.map((m) => (
                  <div key={m.user_id} className="member" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div 
                      className="avatar" 
                      style={{ backgroundColor: m.avatar_color || 'var(--violet)', color: '#0C1116', flexShrink: 0 }}
                    >
                      {m.display_name ? m.display_name.split(' ').map(n => n[0]).join('').toUpperCase() : 'U'}
                    </div>
                    <div>
                      <div className="member-name" style={{ fontSize: '13px', fontWeight: 600, color: '#ffffff' }}>{m.display_name}</div>
                      <div className="member-status" style={{ fontSize: '10px', color: 'var(--green)' }}>● active session</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Deployment list panel */}
          <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className="side-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <Server size={14} /> Deployments
            </div>
            
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {deployments.length === 0 ? (
                <div style={{ color: 'var(--text-dim)', fontSize: '12px', fontStyle: 'italic', padding: '10px 0' }}>
                  No deployments.
                </div>
              ) : (
                deployments.map((d) => (
                  <div key={d.id} style={{
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    fontSize: '11.5px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <span className="mono" style={{ color: 'var(--teal)', fontWeight: 600 }}>
                        {d.commit_hash ? d.commit_hash.substring(0, 7) : 'no-hash'}
                      </span>
                      <span style={{ 
                        color: d.status === 'success' ? 'var(--green)' : 'var(--red)',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        fontSize: '9px',
                        background: d.status === 'success' ? 'var(--green-glow)' : 'rgba(255, 85, 85, 0.1)',
                        padding: '1px 4px',
                        borderRadius: '3px'
                      }}>
                        {d.status}
                      </span>
                    </div>
                    <div style={{ color: 'var(--text-dim)', fontSize: '10px' }}>
                      By {d.display_name || 'System'} · {new Date(d.deployed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Dynamic Session Duration Panel */}
          <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '16px 20px', background: 'linear-gradient(135deg, rgba(77,238,234,0.02) 0%, rgba(189,147,249,0.02) 100%)', border: '1px solid var(--border)', borderRadius: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <Clock size={12} style={{ color: 'var(--teal)' }} /> Elapsed Duration
            </div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--teal)', fontFamily: 'monospace' }}>
              {elapsedTime}
            </div>
          </div>

        </div>

      </div>

      {pendingJoinRequests.map((req) => (
        <div key={req.requestId} style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.85)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          backdropFilter: 'blur(4px)',
          fontFamily: 'Inter, sans-serif'
        }}>
          <div className="card" style={{
            width: '420px',
            padding: '28px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            textAlign: 'center',
            border: '2px solid var(--violet)',
            boxShadow: '0 8px 32px rgba(189, 147, 249, 0.15)',
            background: 'var(--surface)',
            borderRadius: '12px'
          }}>
            <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--violet)', margin: 0 }}>
              Join Request Received
            </h3>
            
            <p style={{ fontSize: '13.5px', color: '#ffffff', lineHeight: 1.5, margin: 0 }}>
              Developer <strong>{req.username}</strong> wants to join your collaboration session.
              <br />
              <span style={{ display: 'inline-block', marginTop: '12px', fontSize: '12px', color: 'var(--text-dim)' }}>
                By approving, they will be given co-editing and file viewing access to your local workspace.
              </span>
            </p>
            
            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '8px' }}>
              <button 
                onClick={() => {
                  socket.emit('session:respond_join', { requestId: req.requestId, approve: false });
                  setPendingJoinRequests(prev => prev.filter(p => p.requestId !== req.requestId));
                }}
                className="btn-secondary"
                style={{ padding: '8px 20px', fontSize: '13px', borderColor: 'var(--red)', color: 'var(--red)', cursor: 'pointer', borderRadius: '6px' }}
              >
                Deny
              </button>
              <button 
                onClick={() => {
                  socket.emit('session:respond_join', { requestId: req.requestId, approve: true });
                  setPendingJoinRequests(prev => prev.filter(p => p.requestId !== req.requestId));
                }}
                className="btn-primary"
                style={{ padding: '8px 20px', fontSize: '13px', backgroundColor: 'var(--violet)', borderColor: 'var(--violet)', cursor: 'pointer', borderRadius: '6px' }}
              >
                Grant Access
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
