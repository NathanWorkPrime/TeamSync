const db = require('../database');

class EventBus {
  constructor() {
    this.subscribers = new Map(); // eventType -> Set of callbacks
    this.io = null;
  }

  setSocketIO(io) {
    this.io = io;
  }

  subscribe(eventType, callback) {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, new Set());
    }
    this.subscribers.get(eventType).add(callback);
    return () => this.unsubscribe(eventType, callback);
  }

  unsubscribe(eventType, callback) {
    if (this.subscribers.has(eventType)) {
      this.subscribers.get(eventType).delete(callback);
    }
  }

  publish(event) {
    const {
      event_type,
      event_category,
      event_version = '1.0',
      correlation_id = null,
      project_id = null,
      session_id = null,
      repo_name = null,
      branch_name = null,
      user_id = null,
      ticket_id = null,
      deployment_id = null,
      metadata = {}
    } = event;

    const timestamp = new Date().toISOString();
    const metaStr = JSON.stringify(metadata);

    const self = this;

    db.run(`
      INSERT INTO events (
        event_type, event_category, event_version, timestamp, correlation_id,
        project_id, session_id, repo_name, branch_name, user_id, ticket_id, deployment_id, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      event_type, event_category, event_version, timestamp, correlation_id,
      project_id, session_id, repo_name, branch_name, user_id, ticket_id, deployment_id, metaStr
    ], function(err) {
      if (err) {
        console.error('[EventBus] Database persistence failed:', err.message);
      } else {
        const enrichedEvent = {
          id: this.lastID,
          event_type,
          event_category,
          event_version,
          timestamp,
          correlation_id,
          project_id,
          session_id,
          repo_name,
          branch_name,
          user_id,
          ticket_id,
          deployment_id,
          metadata
        };

        // 1. Broadcast to WebSocket clients
        if (self.io) {
          self.io.emit('event:stream', enrichedEvent);
          if (repo_name && branch_name) {
            self.io.to(`${repo_name}/${branch_name}`).emit('room:event', enrichedEvent);
          }
        }

        // 2. Notify local memory subscribers
        const callbacks = self.subscribers.get(event_type);
        if (callbacks) {
          callbacks.forEach(cb => {
            try {
              cb(enrichedEvent);
            } catch (cbErr) {
              console.error(`[EventBus] Subscriber error for event ${event_type}:`, cbErr.message);
            }
          });
        }
      }
    });
  }
}

const eventBus = new EventBus();
module.exports = eventBus;
