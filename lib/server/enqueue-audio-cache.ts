import "server-only";
import { audioCacheEnabled } from "./audio-cache-config.ts";
import { createAudioCacheRepository } from "./audio-cache-repository.ts";
import { getDatabase } from "./database.ts";
import { optionalPersistence } from "./persistent-music.ts";

export async function enqueueAudioCache(videoId: string) {
  if (!audioCacheEnabled()) return;
  const database = getDatabase();
  if (database)
    await optionalPersistence(() =>
      createAudioCacheRepository(database).enqueue(videoId)
    );
}
