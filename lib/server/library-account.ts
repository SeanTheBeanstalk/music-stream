import "server-only";
import type pg from "pg";
import {
  credentials,
  hashPassword,
  verifyPassword,
  tokenHash,
  newToken,
} from "./account-crypto.ts";
import { LibraryError } from "./library-validation.ts";

export const SESSION_COOKIE = "music_session";
export function sessionToken(request: Request) {
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}
export function sessionCookie(request: Request, token: string, clear = false) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 60 * 60 * 24 * 30}${process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
export function createLibraryAccount(
  database: Pick<pg.Pool, "connect" | "query">
) {
  async function current(request: Request) {
    const token = sessionToken(request);
    if (!token) return null;
    const result = await database.query<{ id: string; name: string }>(
      `SELECT u.id,u.auth_subject AS name FROM public.account_sessions s
      JOIN public.users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`,
      [tokenHash(token)]
    );
    return result.rows[0] ?? null;
  }
  async function signIn(value: unknown, register: boolean) {
    const { username, password } = credentials(value);
    // The global limit also bounds attempts against arbitrary usernames and KDF work.
    for (const [key, limit] of [
      ["*", 100],
      [username, 10],
    ] as const) {
      const attempt = await database.query(
        `INSERT INTO public.account_attempts (username,attempts,reset_at) VALUES ($1,1,now()+interval '15 minutes')
        ON CONFLICT (username) DO UPDATE SET attempts=CASE WHEN account_attempts.reset_at<=now() THEN 1 ELSE account_attempts.attempts+1 END,
        reset_at=CASE WHEN account_attempts.reset_at<=now() THEN now()+interval '15 minutes' ELSE account_attempts.reset_at END RETURNING attempts`,
        [key]
      );
      if (attempt.rows[0].attempts > limit)
        throw new LibraryError(
          "Too many sign-in attempts. Try again in 15 minutes.",
          429
        );
    }
    let userId: string;
    if (register) {
      const hash = await hashPassword(password);
      const client = await database.connect();
      let broken = false;
      try {
        await client.query("BEGIN");
        const user = await client.query(
          "INSERT INTO public.users (auth_provider,auth_subject,display_name) VALUES ('password',$1,$1) ON CONFLICT DO NOTHING RETURNING id",
          [username]
        );
        if (!user.rows[0])
          throw new LibraryError("That username is unavailable.", 409);
        userId = user.rows[0].id;
        await client.query(
          "INSERT INTO public.account_credentials (user_id,password_hash) VALUES ($1,$2)",
          [userId, hash]
        );
        await client.query("COMMIT");
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          broken = true;
        }
        throw error;
      } finally {
        client.release(broken);
      }
    } else {
      const user = await database.query(
        `SELECT u.id,c.password_hash FROM public.users u JOIN public.account_credentials c ON c.user_id=u.id
        WHERE u.auth_provider='password' AND u.auth_subject=$1`,
        [username]
      );
      if (!(await verifyPassword(password, user.rows[0]?.password_hash)))
        throw new LibraryError("Username or password is incorrect.", 401);
      userId = user.rows[0].id;
    }
    const token = newToken();
    await database.query(
      "INSERT INTO public.account_sessions (token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '30 days')",
      [tokenHash(token), userId]
    );
    await database.query(
      "DELETE FROM public.account_sessions WHERE expires_at<=now()"
    );
    await database.query(
      "DELETE FROM public.account_attempts WHERE reset_at<=now()"
    );
    return token;
  }
  async function signOut(request: Request) {
    const token = sessionToken(request);
    if (token)
      await database.query(
        "DELETE FROM public.account_sessions WHERE token_hash=$1",
        [tokenHash(token)]
      );
  }
  return { current, signIn, signOut };
}
