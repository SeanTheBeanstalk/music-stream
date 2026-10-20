import "server-only";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getR2Bucket, getR2Client } from "./r2.ts";
import { deleteAudio } from "./storage.ts";
import { LibraryError, parseCommand, readJson } from "./library-validation.ts";

const maxUpload = 5 * 1024 * 1024;
export async function normalizePlaylistCover(bytes: Buffer) {
  if (!bytes.length || bytes.length > maxUpload)
    throw new LibraryError("Choose an image up to 5 MB.", 413);
  try {
    const image = sharp(bytes, {
      limitInputPixels: 16_000_000,
      animated: false,
    }).timeout({ seconds: 10 });
    const metadata = await image.metadata();
    if (
      !metadata.format ||
      !["jpeg", "png", "webp"].includes(metadata.format) ||
      (metadata.pages ?? 1) > 1
    )
      throw new Error("Unsupported image");
    return await image
      .rotate()
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    throw new LibraryError(
      "Choose a valid JPG, PNG, or WebP image (up to 16 million pixels)."
    );
  }
}

export async function readPlaylistRequest(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data"))
    return { command: parseCommand(await readJson(request)), image: null };
  // Bound the complete body before invoking the multipart parser, including chunked requests.
  const reader = request.body?.getReader();
  if (!reader) throw new LibraryError("Missing request body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxUpload + 65536) {
        await reader.cancel();
        throw new LibraryError("Image upload is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let form: FormData;
  let value: unknown;
  try {
    form = await new Response(Buffer.concat(chunks), {
      headers: { "Content-Type": request.headers.get("content-type")! },
    }).formData();
    value = JSON.parse(String(form.get("command")));
  } catch {
    throw new LibraryError("Invalid playlist upload.");
  }
  const command = parseCommand(value);
  if (command.action !== "create" && command.action !== "update")
    throw new LibraryError(
      "Images can only be uploaded when saving a playlist."
    );
  const file = form.get("image");
  if (!(file instanceof File)) throw new LibraryError("Missing image.");
  return {
    command,
    image: await normalizePlaylistCover(Buffer.from(await file.arrayBuffer())),
  };
}

export async function stagePlaylistCover(
  database: Pick<pg.Pool, "query">,
  userId: string,
  image: Buffer,
  signal: AbortSignal
) {
  const key = `playlist-covers/${userId}/${randomUUID()}.webp`;
  await database.query(
    "INSERT INTO public.playlist_cover_cleanup (object_key,available_at) VALUES ($1,now()+interval '1 day')",
    [key]
  );
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: getR2Bucket(),
      Key: key,
      Body: image,
      ContentType: "image/webp",
      ContentLength: image.length,
    }),
    { abortSignal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) }
  );
  return key;
}

// Failed deletes stay durable and are retried on subsequent library writes or
// by the scheduled cleanup command. Cover keys are never reused.
export async function cleanupPlaylistCovers(database: Pick<pg.Pool, "query">) {
  const rows = await database.query<{ object_key: string }>(
    "SELECT object_key FROM public.playlist_cover_cleanup WHERE available_at<=now() ORDER BY available_at LIMIT 10"
  );
  for (const row of rows.rows) {
    try {
      await deleteAudio(row.object_key, AbortSignal.timeout(5000));
      await database.query(
        "DELETE FROM public.playlist_cover_cleanup WHERE object_key=$1",
        [row.object_key]
      );
    } catch {
      /* Retain the cleanup row for retry. */
    }
  }
}
