import { readFile } from "node:fs/promises";
import {
  uploadAudio,
  headAudio,
  getAudioPlayUrl,
  getDirectUploadUrl,
} from "../lib/server/storage.ts";

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "upload" && args.length === 3) {
    const [file, key, mimeType] = args;
    console.log(await uploadAudio(key, await readFile(file), mimeType));
  } else if (command === "head" && args.length === 1) {
    const result = await headAudio(args[0]);
    console.log(
      JSON.stringify({
        bytes: result.ContentLength,
        contentType: result.ContentType,
        etag: result.ETag,
      })
    );
  } else if (command === "play-url" && args.length === 1) {
    console.log(await getAudioPlayUrl(args[0]));
  } else if (command === "upload-url" && args.length === 2) {
    console.log(await getDirectUploadUrl(args[0], args[1]));
  } else {
    throw new Error(
      "Usage: pnpm r2 upload <file> <key> <audio MIME type> | head <key> | play-url <key> | upload-url <key> <audio MIME type>"
    );
  }
} catch (error) {
  // Avoid dumping SDK request details, credentials, or signed URLs on failure.
  console.error(error instanceof Error ? error.name : "R2Error");
  if (error instanceof Error && error.name === "Error")
    console.error(error.message);
  process.exitCode = 1;
}
