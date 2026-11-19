-- Signing keys of the jwt plugin. Private keys are encrypted with AUTH_SECRET.
CREATE TABLE auth.jwks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_key  text NOT NULL,
  private_key text NOT NULL,
  alg         text,
  crv         text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz
);
