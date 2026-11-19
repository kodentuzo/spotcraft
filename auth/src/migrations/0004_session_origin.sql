-- Where each session was made or last renewed (ADR 0038), so the agent can count an app's
-- active accounts: the host it came through, and the client's `Spotcraft-Client` header
-- (`<platform>/<version>`), if it sent one. Set by the pool on every create and renewal.
ALTER TABLE auth.sessions ADD COLUMN host text;
ALTER TABLE auth.sessions ADD COLUMN client text;
CREATE INDEX sessions_host_updated_at_idx ON auth.sessions (host, updated_at);
