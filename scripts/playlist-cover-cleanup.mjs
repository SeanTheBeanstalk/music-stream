import { getDatabase } from "../lib/server/database.ts";
import { cleanupPlaylistCovers } from "../lib/server/playlist-covers.ts";

const database = getDatabase();
if (!database) throw new Error("DATABASE_URL is required.");
try {
  await cleanupPlaylistCovers(database);
} finally {
  await database.end();
}
