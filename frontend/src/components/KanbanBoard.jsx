import React from 'react';

const COLUMNS = [
  { id: 'todo', title: 'To Do' },
  { id: 'in-progress', title: 'In Progress' },
  { id: 'review', title: 'Review' },
  { id: 'done', title: 'Done' }
];

export default function KanbanBoard({ tickets, onUpdateTicketStatus, onCardClick, users }) {
  // Group tickets by status
  const getTicketsByStatus = (status) => {
    return tickets.filter(t => t.status === status);
  };

  const handleDragStart = (e, ticketId) => {
    e.dataTransfer.setData('text/plain', ticketId);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e, status) => {
    e.preventDefault();
    const ticketId = e.dataTransfer.getData('text/plain');
    if (ticketId) {
      onUpdateTicketStatus(parseInt(ticketId, 10), status);
    }
  };

  return (
    <div className="kanban">
      {COLUMNS.map((col) => {
        const colTickets = getTicketsByStatus(col.id);

        return (
          <div 
            key={col.id} 
            className="kcol"
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, col.id)}
          >
            <div className="kcol-head">
              {col.title} <span>{colTickets.length}</span>
            </div>
            
            <div className="kcol-cards">
              {colTickets.map((t) => (
                <div 
                  key={t.id} 
                  className="kcard"
                  draggable
                  onDragStart={(e) => handleDragStart(e, t.id)}
                  onClick={() => onCardClick(t)}
                >
                  <div className="kcard-top">
                    <span className={`kcard-prio ${t.priority}`}>
                      {t.priority}
                    </span>
                    {t.source && t.source !== 'internal' && (
                      <span className="mono" style={{ fontSize: '9px', color: 'var(--text-dim)' }}>
                        {t.source === 'github' ? 'GH' : 'EXT'}
                      </span>
                    )}
                  </div>
                  
                  <div className="kcard-title">
                    {t.title}
                  </div>
                  
                  <div className="kcard-foot">
                    <span className="kcard-branch">
                      {t.repo_or_project ? t.repo_or_project : '—'}
                    </span>
                    
                    {t.assignee_user_id ? (
                      <div 
                        className="avatar kcard-assignee" 
                        style={{ 
                          backgroundColor: t.assignee_avatar_color || 'var(--violet)', 
                          color: '#0C1116' 
                        }}
                        title={`Assigned to ${t.assignee_display_name}`}
                      >
                        {t.assignee_display_name ? t.assignee_display_name.split(' ').map(n => n[0]).join('').toUpperCase() : '?'}
                      </div>
                    ) : (
                      <div 
                        className="avatar kcard-assignee" 
                        style={{ backgroundColor: 'var(--border)', color: 'var(--text-dim)' }}
                        title="Unassigned"
                      >
                        ?
                      </div>
                    )}
                  </div>
                </div>
              ))}
              
              {colTickets.length === 0 && (
                <div style={{ 
                  border: '1px dashed var(--border)', 
                  borderRadius: '10px', 
                  height: '80px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  color: 'var(--text-dim)',
                  fontSize: '12px'
                }}>
                  Drop cards here
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
