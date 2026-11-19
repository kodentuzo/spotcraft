-- The AUTH_SECRET of each app that kept its own guests with @spotcraft/kit and moved into the
-- pool. Its guests' cookies are still signed with it; the pool re-signs them (src/former.ts).
-- Written by the agent when it moves an app.
CREATE TABLE auth.former_secrets (
  secret   text PRIMARY KEY,
  app      text NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now()
);
