BEGIN;

CREATE TABLE IF NOT EXISTS ticket_status_history (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL,
  from_status VARCHAR(50),
  to_status VARCHAR(50) NOT NULL,
  actor_id INTEGER NULL,
  actor_name VARCHAR(150) NULL,
  actor_role VARCHAR(50) NULL,
  reason TEXT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NULL,
  username VARCHAR(100) NULL,
  ticket_id INTEGER NULL,
  type VARCHAR(80) NOT NULL,
  severity VARCHAR(30) DEFAULT 'info',
  title VARCHAR(180) NOT NULL,
  body TEXT NULL,
  payload JSONB DEFAULT '{}'::jsonb,
  read_at TIMESTAMP NULL,
  seen_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_status_history_ticket_id ON ticket_status_history(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_status_history_actor_id ON ticket_status_history(actor_id);
CREATE INDEX IF NOT EXISTS idx_ticket_status_history_to_status ON ticket_status_history(to_status);
CREATE INDEX IF NOT EXISTS idx_ticket_status_history_created_at ON ticket_status_history(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_log_user_id ON notification_log(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_log_username ON notification_log(username);
CREATE INDEX IF NOT EXISTS idx_notification_log_ticket_id ON notification_log(ticket_id);
CREATE INDEX IF NOT EXISTS idx_notification_log_type ON notification_log(type);
CREATE INDEX IF NOT EXISTS idx_notification_log_severity ON notification_log(severity);
CREATE INDEX IF NOT EXISTS idx_notification_log_read_at ON notification_log(read_at);
CREATE INDEX IF NOT EXISTS idx_notification_log_created_at ON notification_log(created_at DESC);

COMMIT;
