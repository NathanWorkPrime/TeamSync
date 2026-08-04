import React, { useState, useEffect } from 'react';
import { projectCache } from './utils/projectCache';
import Topbar from './components/Topbar';
import Login from './pages/Login';
import Home from './pages/Home';
import Projects from './pages/Projects';
import RepoView from './pages/RepoView';
import Session from './pages/Session';
import Integrations from './pages/Integrations';
import GlobalSettings from './pages/GlobalSettings';
import { io } from 'socket.io-client';

const socket = io(import.meta.env.VITE_API_URL || window.location.origin, { autoConnect: false });

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [activeView, setActiveView] = useState('login');

  // Core Data State
  const [users, setUsers] = useState([]);
  const [repos, setRepos] = useState([]);
  const [reposError, setReposError] = useState(null);
  const [reposErrorResetAt, setReposErrorResetAt] = useState(null);
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [branches, setBranches] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [integrations, setIntegrations] = useState([]);
  const [activePresence, setActivePresence] = useState([]);
  
  // Home Page Aggregated State
  const [todayData, setTodayData] = useState({
    tickets: [],
    activeCount: 0,
    activePresence: [],
    activity: []
  });

  // Selected Session Room State
  const [sessionData, setSessionData] = useState({
    repo: 'marketing-site',
    branch: 'feature/contact-page',
    sessionLink: 'oct://join/TS-4K9-XZQ2'
  });

  const [sessionError, setSessionError] = useState(null);
  const [joinRequest, setJoinRequest] = useState(null);

  // Fetch initial seed users
  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/users?_t=' + Date.now());
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (err) {
      console.error('Error fetching users:', err);
    }
  };

  // Fetch company repositories
  const fetchRepos = async () => {
    try {
      setReposError(null);
      setReposErrorResetAt(null);
      const headers = {};
      const cached = localStorage.getItem('teamsync_current_user');
      let activeUser = currentUser;
      if (!activeUser && cached) {
        try { activeUser = JSON.parse(cached); } catch (e) {}
      }
      if (activeUser && activeUser.session_token) {
        headers['X-User-Session'] = activeUser.session_token;
      }
      const res = await fetch('/api/repos?_t=' + Date.now(), { headers });
      if (res.ok) {
        const data = await res.json();
        setRepos(data);
      } else {
        const errData = await res.json().catch(() => ({}));
        setReposError(errData.message || 'Failed to verify repository access.');
        if (errData.resetAt) {
          setReposErrorResetAt(errData.resetAt);
        }
      }
    } catch (err) {
      console.error('Error fetching repos:', err);
      setReposError(err.message || 'Network error fetching projects.');
    }
  };

  // Fetch all tickets
  const fetchTickets = async () => {
    try {
      const res = await fetch('/api/tickets');
      if (res.ok) {
        const data = await res.json();
        setTickets(data);
      }
    } catch (err) {
      console.error('Error fetching tickets:', err);
    }
  };

  // Fetch active presence across all team members
  const fetchPresence = async () => {
    try {
      const res = await fetch('/api/presence');
      if (res.ok) {
        const data = await res.json();
        setActivePresence(data);
      }
    } catch (err) {
      console.error('Error fetching presence:', err);
    }
  };

  // Fetch integrations list
  const fetchIntegrations = async () => {
    try {
      const res = await fetch('/api/integrations');
      if (res.ok) {
        const data = await res.json();
        setIntegrations(data);
      }
    } catch (err) {
      console.error('Error fetching integrations:', err);
    }
  };

  // Fetch branches for selected repo
  const fetchBranches = async (repoName) => {
    try {
      const res = await fetch(`/api/repos/${repoName}/branches`);
      if (res.ok) {
        const data = await res.json();
        setBranches(data);
        projectCache.setTabData(repoName, 'branches', data);
      }
    } catch (err) {
      console.error(`Error fetching branches for ${repoName}:`, err);
    }
  };

  // Fetch Home View today aggregated tasks
  const fetchTodayData = async () => {
    if (!currentUser) return;
    try {
      const res = await fetch(`/api/me/today?user_id=${currentUser.id}`);
      if (res.ok) {
        const data = await res.json();
        setTodayData(data);
      }
    } catch (err) {
      console.error('Error fetching today summary:', err);
    }
  };

  const clearStorage = () => {
    localStorage.removeItem('teamsync_current_user');
    localStorage.removeItem('session_token');
  };

  // Initial load
  useEffect(() => {
    fetchUsers();
    
    // Handle GitHub OAuth callback redirect
    const urlParams = new URLSearchParams(window.location.search);
    const oauthUsername = urlParams.get('username');
    const sessionToken = urlParams.get('session_token');
    if (oauthUsername && sessionToken) {
      clearStorage();
      // Clear URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
      
      // Fetch users list to find the matching user profile
      fetch('/api/users')
        .then(res => res.json())
        .then(usersList => {
          const matchedUser = usersList.find(u => u.username === oauthUsername.toLowerCase().trim());
          if (matchedUser) {
            matchedUser.session_token = sessionToken;
            handleLogin(matchedUser);
          }
        })
        .catch(err => console.error('[App] OAuth user retrieval failed:', err));
    } else {
      // Auto-login from local storage if profile cached
      const cached = localStorage.getItem('teamsync_current_user');
      if (cached) {
        try {
          const user = JSON.parse(cached);
          setCurrentUser(user);
          setActiveView('projects');
          
          // Push user credentials to companion extension on load
          fetch('http://localhost:37845/configure', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user_id: user.id,
              username: user.username,
              server_url: window.location.origin
            })
          }).catch(() => {});
        } catch (e) {
          console.warn('[App] Failed to parse cached user:', e);
        }
      }
    }
  }, []);

  // Socket.io connection and listeners
  useEffect(() => {
    if (!currentUser) return;

    socket.connect();
    socket.emit('user:authenticate', { user_id: currentUser.id });

    socket.on('presence:update', (updatedPresence) => {
      setActivePresence(updatedPresence);
    });

    socket.on('activity:new', (newAct) => {
      setTodayData(prev => ({
        ...prev,
        activity: [newAct, ...prev.activity]
      }));
    });

    socket.on('session:join_response', ({ approve, error }) => {
      setJoinRequest(prev => {
        if (!prev) return null;
        if (approve) {
          if (prev.onApproved) prev.onApproved();
          return null;
        } else {
          setSessionError(error || 'The session host has denied your request to join.');
          return null;
        }
      });
    });

    return () => {
      socket.off('presence:update');
      socket.off('activity:new');
      socket.off('session:join_response');
      socket.disconnect();
    };
  }, [currentUser]);

  // Poll for background presence and today data updates every 5 seconds when logged in
  useEffect(() => {
    if (!currentUser) return;

    fetchRepos();
    fetchTickets();
    fetchPresence();
    fetchIntegrations();
    fetchTodayData();

    const interval = setInterval(() => {
      fetchPresence();
      fetchTodayData();
      fetchRepos();
    }, 5000);

    return () => clearInterval(interval);
  }, [currentUser, selectedRepo]);

  // Handle username selection
  const handleLogin = (user) => {
    setCurrentUser(user);
    setActiveView('projects');
    localStorage.setItem('teamsync_current_user', JSON.stringify(user));

    // Configure companion extension with logged in user context
    fetch('http://localhost:37845/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: user.id,
        username: user.username,
        server_url: window.location.origin
      })
    }).catch(() => {});
  };

  // Handle repository selection
  const handleSelectRepo = (repoName) => {
    const repoDetails = repos.find(r => r.name === repoName);
    if (repoDetails) {
      projectCache.setProjectMeta(repoName, repoDetails);
    }
    
    // Clear branches state to avoid showing stale data from the previous project.
    // If cached data is available, populate immediately to avoid flashing skeletons.
    const cachedBranches = projectCache.getTabData(repoName, 'branches');
    if (cachedBranches) {
      setBranches(cachedBranches);
    } else {
      setBranches([]);
    }

    setSelectedRepo(repoName);
    setActiveView('repo');

    // Update repository setting in companion extension
    fetch('http://localhost:37845/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: currentUser?.id,
        username: currentUser?.username,
        repo: repoName,
        server_url: window.location.origin
      })
    }).catch(() => {});
  };

  // Work on branch command
  const handleWorkOnBranch = async (branchName, isJoined) => {
    setSessionError(null);
    if (isJoined) {
      // Leave session (delete presence)
      try {
        const res = await fetch(`/api/presence/${currentUser.id}`, {
          method: 'DELETE'
        });
        if (res.ok) {
          fetchPresence();
          fetchTodayData();
          if (selectedRepo) fetchBranches(selectedRepo);
        }
      } catch (err) {
        console.error('Error leaving session:', err);
      }

      // Notify companion extension to leave room
      fetch('http://localhost:37845/leave-session', {
        method: 'POST'
      }).catch((e) => console.warn('[App] Failed to notify extension of leave:', e.message));
    } else {
      // 1. Automatically prepare local workspace (clone/checkout/open)
      try {
        console.log(`[App] Automatically preparing workspace for ${selectedRepo}/${branchName}...`);
        const cloneRes = await fetch('http://localhost:37845/clone-repo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repo: selectedRepo, branch: branchName })
        });
        if (!cloneRes.ok) {
          const errData = await cloneRes.json();
          throw new Error(errData.error || 'Failed to sync local workspace.');
        }
      } catch (cloneErr) {
        console.warn('[App] Local workspace preparation failed or extension offline:', cloneErr.message);
        setSessionError(`Could not sync workspace: ${cloneErr.message}. Make sure the Antigravity extension is active.`);
        return;
      }

      // 2. Enter session
      console.log(`[App] Checking for active session for ${selectedRepo}/${branchName}...`);
      let sessionLink = '';
      let octRoomId = '';

      let activeRoom = null;
      try {
        const activeRoomRes = await fetch(`/api/session-rooms/active?repo=${selectedRepo}&branch=${branchName}`);
        if (activeRoomRes.ok) {
          activeRoom = await activeRoomRes.json();
          if (activeRoom) {
            sessionLink = activeRoom.session_link;
            octRoomId = activeRoom.oct_room_id;
            console.log('[App] Found active session room:', activeRoom);
          }
        }
      } catch (activeErr) {
        console.error('[App] Error looking up active session:', activeErr);
      }

      if (sessionLink) {
        const isHost = activeRoom && activeRoom.created_by_user_id === currentUser.id;
        
        const proceedJoin = async () => {
          try {
            console.log('[App] Instructing companion extension to join existing session:', sessionLink);
            const extRes = await fetch('http://localhost:37845/join-session', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                repo: selectedRepo,
                branch: branchName,
                room_id: octRoomId,
                session_link: sessionLink
              })
            });
            if (!extRes.ok) {
              throw new Error('Companion extension failed to join the session.');
            }
          } catch (joinErr) {
            console.error('[App] Companion extension failed to join session:', joinErr.message);
            setSessionError('Failed to connect to the companion extension. Please ensure VS Code/Antigravity is open and running.');
            return;
          }

          try {
            const res = await fetch('/api/presence', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                user_id: currentUser.id,
                repo_name: selectedRepo,
                branch_name: branchName,
                session_link: sessionLink
              })
            });

            if (res.ok) {
              setSessionData({
                repo: selectedRepo,
                branch: branchName,
                sessionLink: sessionLink
              });
              fetchPresence();
              fetchTodayData();
              setRepoSubTab('sessions');
              setActiveView('repo');
            }
          } catch (err) {
            console.error('Error starting session:', err);
          }
        };

        if (isHost) {
          await proceedJoin();
        } else {
          setJoinRequest({
            status: 'pending',
            hostName: activeRoom.creator_display_name || 'Host',
            roomId: activeRoom.id,
            onApproved: proceedJoin
          });
          socket.emit('session:request_join', {
            roomId: activeRoom.id,
            userId: currentUser.id,
            username: currentUser.display_name || currentUser.username
          });
        }
      } else {
        // No active room! Create a new one via companion extension
        try {
          console.log('[App] Instructing companion extension to start new session...');
          const extRes = await fetch('http://localhost:37845/start-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repo: selectedRepo, branch: branchName })
          });
          
          if (extRes.ok) {
            const extData = await extRes.json();
            sessionLink = extData.link;
            octRoomId = sessionLink.split('/').pop() || sessionLink;
            console.log('[App] New session link generated:', sessionLink);

            // Register the new room in TeamSync backend database
            await fetch('/api/session-rooms', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                repo_name: selectedRepo,
                branch_name: branchName,
                oct_room_id: octRoomId,
                session_link: sessionLink,
                created_by_user_id: currentUser.id
              })
            });
          } else {
            throw new Error('Companion extension returned non-OK status on session creation.');
          }
        } catch (extErr) {
          console.error('[App] Companion extension failed to start session:', extErr.message);
          setSessionError('Could not start a companion session. Make sure VS Code/Antigravity is running with the extension enabled.');
          return;
        }
        try {
          const res = await fetch('/api/presence', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user_id: currentUser.id,
              repo_name: selectedRepo,
              branch_name: branchName,
              session_link: sessionLink
            })
          });

          if (res.ok) {
            setSessionData({
              repo: selectedRepo,
              branch: branchName,
              sessionLink: sessionLink
            });
            fetchPresence();
            fetchTodayData();
            setRepoSubTab('sessions');
            setActiveView('repo');
          }
        } catch (err) {
          console.error('Error starting session:', err);
        }
      }
    }
  };

  // Leave active session (host ends, rider leaves)
  const handleLeaveSession = async (roomId, isHost) => {
    try {
      if (isHost) {
        const res = await fetch(`/api/session-rooms/${roomId}/close`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: currentUser.id })
        });
        if (res.ok) {
          fetch('http://localhost:37845/leave-session', {
            method: 'POST'
          }).catch(() => {});
          
          fetchPresence();
          fetchTodayData();
          if (selectedRepo) fetchBranches(selectedRepo);
          
          setSessionData(null);
          setActiveView('repo');
        }
      } else {
        const res = await fetch(`/api/presence/${currentUser.id}`, {
          method: 'DELETE'
        });
        if (res.ok) {
          fetch('http://localhost:37845/leave-session', {
            method: 'POST'
          }).catch(() => {});
          
          fetchPresence();
          fetchTodayData();
          if (selectedRepo) fetchBranches(selectedRepo);
          
          setSessionData(null);
          setActiveView('repo');
        }
      }
    } catch (err) {
      console.error('Error leaving session:', err);
    }
  };

  // Join someone else's active session
  const handleJoinSession = async (repoName, branchName, sessionLink) => {
    setSessionError(null);
    setSelectedRepo(repoName);
    setSessionData({
      repo: repoName,
      branch: branchName,
      sessionLink: sessionLink
    });

    const octRoomId = sessionLink.split('/').pop() || sessionLink;
    try {
      console.log('[App] Instructing companion extension to join session:', sessionLink);
      const extRes = await fetch('http://localhost:37845/join-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: repoName,
          branch: branchName,
          room_id: octRoomId,
          session_link: sessionLink
        })
      });
      if (!extRes.ok) {
        throw new Error('Companion extension failed to join the session.');
      }
    } catch (joinErr) {
      console.error('[App] Companion extension failed to join session:', joinErr.message);
      setSessionError('Failed to connect to the companion extension. Please ensure VS Code/Antigravity is open and running.');
      return;
    }

    try {
      const res = await fetch('/api/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: currentUser.id,
          repo_name: repoName,
          branch_name: branchName,
          session_link: sessionLink
        })
      });
      if (res.ok) {
        fetchPresence();
        fetchTodayData();
        setActiveView('session');
      }
    } catch (err) {
      console.error('Error recording presence for join session:', err);
    }
  };

  // Update presence session link directly from the Session view
  const handleSavePresence = async (repoName, branchName, link) => {
    try {
      const res = await fetch('/api/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: currentUser.id,
          repo_name: repoName,
          branch_name: branchName,
          session_link: link
        })
      });

      if (res.ok) {
        setSessionData(prev => ({ ...prev, sessionLink: link }));

        // Register room on backend if not already active
        const activeRoomRes = await fetch(`/api/session-rooms/active?repo=${repoName}&branch=${branchName}`);
        if (activeRoomRes.ok) {
          const activeRoom = await activeRoomRes.json();
          if (!activeRoom) {
            const octRoomId = link.split('/').pop() || link;
            await fetch('/api/session-rooms', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                repo_name: repoName,
                branch_name: branchName,
                oct_room_id: octRoomId,
                session_link: link,
                created_by_user_id: currentUser.id
              })
            });
          }
        }

        fetchPresence();
        fetchTodayData();
      }
    } catch (err) {
      console.error('Error updating presence link:', err);
    }
  };

  // Add Ticket
  const handleAddTicket = async (ticketPayload) => {
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ticketPayload)
      });
      if (res.ok) {
        fetchTickets();
        fetchTodayData();
      }
    } catch (err) {
      console.error('Error creating ticket:', err);
    }
  };

  // Update Ticket Status/Assignee
  const handleUpdateTicketStatus = async (ticketId, nextStatus, nextAssigneeId = undefined) => {
    const payload = {};
    if (nextStatus) payload.status = nextStatus;
    if (nextAssigneeId !== undefined) payload.assignee_user_id = nextAssigneeId;

    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        fetchTickets();
        fetchTodayData();
      }
    } catch (err) {
      console.error('Error updating ticket:', err);
    }
  };

  // Register Outbound client integration
  const handleRegisterIntegration = async (integrationPayload) => {
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(integrationPayload)
      });
      if (res.ok) {
        fetchIntegrations();
      }
    } catch (err) {
      console.error('Error registering integration:', err);
    }
  };

  // Add User profile
  const handleAddUser = async (userPayload) => {
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userPayload)
      });
      if (res.ok) {
        fetchUsers();
      } else {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to add user.');
      }
    } catch (err) {
      console.error('Error adding user:', err);
      alert(err.message);
    }
  };

  // Remove User profile
  const handleRemoveUser = async (userId) => {
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        fetchUsers();
      } else {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to remove user.');
      }
    } catch (err) {
      console.error('Error removing user:', err);
      alert(err.message);
    }
  };


  // Logout utility
  const handleLogout = () => {
    clearStorage();
    setCurrentUser(null);
    setActiveView('login');

    // Notify companion extension
    fetch('http://localhost:37845/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: null,
        username: null,
        repo: '',
        branch: '',
        session_link: ''
      })
    }).catch(() => {});
  };

  // Renders pages dynamically
  const renderView = () => {
    switch (activeView) {
      case 'login':
        return <Login users={users} onLogin={handleLogin} />;
      case 'home':
        return (
          <Home 
            todayData={todayData} 
            currentUser={currentUser} 
            users={users}
            allTickets={tickets}
            repos={repos}
            activePresence={activePresence}
            socket={socket}
            onUpdateTicketStatus={handleUpdateTicketStatus}
            onSelectRepo={handleSelectRepo} 
            onJoinSession={handleJoinSession}
          />
        );
      case 'projects':
        return (
          <Projects 
            repos={repos} 
            reposError={reposError} 
            reposErrorResetAt={reposErrorResetAt}
            onSelectRepo={handleSelectRepo} 
            onRegisterSuccess={fetchRepos} 
            onRetry={fetchRepos}
          />
        );
      case 'repo':
        return (
          <RepoView 
            key={selectedRepo}
            repoName={selectedRepo} 
            githubRepo={repos.find(r => r.name === selectedRepo)?.github_repo}
            onBack={() => setActiveView('projects')} 
            branches={branches}
            tickets={tickets}
            users={users}
            activePresence={activePresence}
            currentUser={currentUser}
            fetchBranches={fetchBranches}
            onWorkOnBranch={handleWorkOnBranch}
            onAddTicket={handleAddTicket}
            onUpdateTicketStatus={handleUpdateTicketStatus}
            onLeaveSession={handleLeaveSession}
            onAddUser={handleAddUser}
            onRemoveUser={handleRemoveUser}
          />
        );
      case 'session':
        return (
          <Session 
            sessionData={sessionData} 
            activePresence={activePresence} 
            currentUser={currentUser}
            onSavePresence={handleSavePresence}
            socket={socket}
            onLeaveSession={handleLeaveSession}
          />
        );
      case 'integrations':
        return (
          <Integrations 
            integrations={integrations} 
            onRegisterIntegration={handleRegisterIntegration}
          />
        );
      case 'global-settings':
        return (
          <GlobalSettings 
            users={users}
            onRemoveUser={handleRemoveUser}
            onViewChange={handleViewChange}
          />
        );
      default:
        return <div>View not found</div>;
    }
  };

  const handleViewChange = (view) => {
    if (view === 'logout') {
      handleLogout();
    } else {
      setActiveView(view);
    }
  };

  if (activeView === 'login') {
    return <Login users={users} onLogin={handleLogin} />;
  }

  return (
    <div className="app-container">
      <Topbar 
        activeView={activeView} 
        onViewChange={handleViewChange} 
        currentUser={currentUser}
      />
      <main style={{ flexGrow: 1 }}>
        {sessionError && (
          <div style={{
            background: 'rgba(242, 84, 91, 0.1)',
            border: '1px solid var(--red)',
            color: '#ffffff',
            padding: '12px 24px',
            borderRadius: '8px',
            margin: '16px 32px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontFamily: 'Inter, sans-serif'
          }}>
            <span>{sessionError}</span>
            <button onClick={() => setSessionError(null)} style={{
              background: 'none',
              border: 'none',
              color: 'var(--red)',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '16px'
            }}>✕</button>
          </div>
        )}
        {renderView()}
      </main>

      {joinRequest && (
        <div style={{
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
            border: '2px solid var(--teal)',
            boxShadow: '0 8px 32px rgba(77, 238, 234, 0.15)',
            background: 'var(--surface)',
            borderRadius: '12px'
          }}>
            <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--teal)', margin: 0 }}>
              {joinRequest.status === 'pending' && 'Requesting Workspace Access'}
              {joinRequest.status === 'denied' && 'Access Denied'}
              {joinRequest.status === 'offline' && 'Host Offline'}
            </h3>
            
            <p style={{ fontSize: '13.5px', color: '#ffffff', lineHeight: 1.5, margin: 0 }}>
              {joinRequest.status === 'pending' && (
                <>
                  Sending request to join <strong>{joinRequest.hostName}</strong>'s session.
                  <br />
                  <span style={{ display: 'inline-block', marginTop: '12px', fontSize: '12px', color: 'var(--text-dim)' }}>
                    ⚠️ Note: By joining, you will co-edit files directly on the host's local machine workspace.
                  </span>
                </>
              )}
              {joinRequest.status === 'denied' && `The session host, ${joinRequest.hostName}, has denied your access request.`}
              {joinRequest.status === 'offline' && `The session host, ${joinRequest.hostName}, is currently offline.`}
            </p>
            
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '8px' }}>
              {joinRequest.status === 'pending' ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                  <div className="spin" style={{ width: '20px', height: '20px', border: '2px solid var(--teal)', borderTopColor: 'transparent', borderRadius: '50%' }}></div>
                  <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>Waiting for host approval...</span>
                  <button 
                    onClick={() => setJoinRequest(null)}
                    className="btn-secondary"
                    style={{ padding: '6px 16px', fontSize: '12px', marginTop: '8px', cursor: 'pointer', borderRadius: '6px' }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button 
                  onClick={() => setJoinRequest(null)}
                  className="btn-primary"
                  style={{ padding: '8px 20px', fontSize: '13px', cursor: 'pointer', borderRadius: '6px' }}
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
