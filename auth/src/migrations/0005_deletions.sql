-- Every deleted user's id, for as long as backups are kept, so a restore can delete them again
-- (ADR 0043). A trigger fills it, so every way of deleting counts: a guest deleting themselves,
-- the dashboard, and the idle-guest cleanup. It holds nothing but the id and the time.
CREATE TABLE auth.deletions (
  user_id    uuid PRIMARY KEY,
  deleted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deletions_deleted_at_idx ON auth.deletions (deleted_at);

-- Runs as the pool's role, so the agent's role needs no rights on the log to delete users.
CREATE FUNCTION auth.log_deletion() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, auth AS $$
BEGIN
  INSERT INTO auth.deletions (user_id) VALUES (OLD.id)
    ON CONFLICT (user_id) DO UPDATE SET deleted_at = now();
  RETURN OLD;
END
$$;
REVOKE ALL ON FUNCTION auth.log_deletion() FROM PUBLIC;

CREATE TRIGGER users_log_deletion AFTER DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION auth.log_deletion();
