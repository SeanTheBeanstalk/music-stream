import "server-only";
import pg from "pg";

const globalDatabase = globalThis as typeof globalThis & {
  musicDatabase?: pg.Pool;
};

// Lazy initialization keeps builds and unconfigured development independent of PG.
export function getDatabase() {
  if (!process.env.DATABASE_URL?.trim()) return null;
  if (!globalDatabase.musicDatabase) {
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 3_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 5_000,
      idle_in_transaction_session_timeout: 10_000,
      application_name: "music-stream",
    });
    // Never log driver errors: they may include connection details or SQL values.
    pool.on("error", () => console.warn("Postgres idle connection failed."));
    globalDatabase.musicDatabase = pool;
  }
  return globalDatabase.musicDatabase;
}
