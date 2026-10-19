-- Account-owned libraries. Apply after 0002; no existing library data is changed.
BEGIN;
CREATE TABLE public.account_credentials (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL
);
CREATE TABLE public.account_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX account_sessions_expiry ON public.account_sessions(expires_at);
-- Shared, bounded sign-in throttling across app instances.
CREATE TABLE public.account_attempts (
    username TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL,
    reset_at TIMESTAMPTZ NOT NULL
);
COMMIT;
