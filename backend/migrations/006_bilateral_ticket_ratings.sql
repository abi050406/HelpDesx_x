BEGIN;

CREATE TABLE IF NOT EXISTS ticket_ratings (
  id BIGSERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL,
  rating_type VARCHAR(50) NOT NULL CHECK (rating_type IN ('associate_to_technician', 'technician_to_associate')),
  rater_user_id INTEGER,
  rater_name VARCHAR(150),
  rated_user_id INTEGER,
  rated_name VARCHAR(150),
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment TEXT NOT NULL CHECK (length(trim(comment)) >= 1),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (ticket_id, rating_type)
);

CREATE INDEX IF NOT EXISTS idx_ticket_ratings_ticket_id ON ticket_ratings(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_ratings_type ON ticket_ratings(rating_type);
CREATE INDEX IF NOT EXISTS idx_ticket_ratings_rater ON ticket_ratings(rater_user_id);
CREATE INDEX IF NOT EXISTS idx_ticket_ratings_rated ON ticket_ratings(rated_user_id);
CREATE INDEX IF NOT EXISTS idx_ticket_ratings_created ON ticket_ratings(created_at DESC);

COMMIT;
