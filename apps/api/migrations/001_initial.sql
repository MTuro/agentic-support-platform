CREATE TABLE conversations (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX conversations_owner ON conversations(owner_id);
CREATE TABLE tickets (
  id text PRIMARY KEY CHECK (id ~ '^TKT-[0-9]{4}$'),
  owner_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('open','in_progress','resolved')),
  summary text NOT NULL CHECK (length(summary) BETWEEN 1 AND 200)
);
CREATE TABLE turns (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  idempotency_key uuid NOT NULL,
  content text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(conversation_id, idempotency_key),
  UNIQUE(id, conversation_id)
);
CREATE TABLE messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  turn_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(citations) = 'array'),
  escalated boolean NOT NULL DEFAULT false,
  reason text,
  route text CHECK (route IN ('rag','ticket','escalation')),
  ticket jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (turn_id, conversation_id) REFERENCES turns(id, conversation_id),
  UNIQUE(turn_id, role)
);
CREATE INDEX messages_conversation ON messages(conversation_id, created_at, id);
CREATE TABLE escalations (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  message_id uuid NOT NULL UNIQUE REFERENCES messages(id),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
