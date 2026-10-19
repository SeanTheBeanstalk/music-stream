import "server-only";

function integer(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`Invalid ${name}.`);
  return value;
}

export function audioCacheEnabled() {
  return process.env.AUDIO_CACHE_ENABLED === "true";
}

export function audioCacheConfig() {
  const maxBytes = integer(
    "AUDIO_CACHE_MAX_BYTES",
    8_000_000_000,
    1,
    1_000_000_000_000
  );
  return {
    maxBytes,
    maxFileBytes: integer(
      "AUDIO_CACHE_MAX_FILE_BYTES",
      128_000_000,
      1,
      maxBytes
    ),
    retentionDays: integer("AUDIO_CACHE_RETENTION_DAYS", 30, 1, 365),
    concurrency: integer("AUDIO_CACHE_WORKER_CONCURRENCY", 1, 1, 4),
  };
}
