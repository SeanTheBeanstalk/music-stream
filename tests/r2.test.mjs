import test from "node:test";
import assert from "node:assert/strict";
import { S3Client } from "@aws-sdk/client-s3";
import { getR2Bucket, getR2Client } from "../lib/server/r2.ts";
import {
  uploadAudio,
  getAudioPlayUrl,
  getDirectUploadUrl,
  headAudio,
  getAudio,
  deleteAudio,
} from "../lib/server/storage.ts";

test("R2 configuration is lazy, validated, and never includes secret values in errors", async () => {
  for (const key of [
    "R2_ACCOUNT_ID",
    "R2_BUCKET_NAME",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
  ])
    delete process.env[key];
  assert.throws(() => getR2Client(), /Missing R2 configuration: R2_ACCOUNT_ID/);
  process.env.R2_ACCOUNT_ID = "invalid-account-secret";
  assert.throws(() => getR2Client(), { message: "Invalid R2_ACCOUNT_ID." });
  process.env.R2_ACCOUNT_ID = "a".repeat(32);
  process.env.R2_BUCKET_NAME = "test-audio";
  process.env.R2_ACCESS_KEY_ID = "test-access-key";
  assert.throws(() => getR2Client(), /R2_SECRET_ACCESS_KEY/);
  process.env.R2_SECRET_ACCESS_KEY = "test-secret-not-real";
  const client = getR2Client();
  assert.equal(getR2Client(), client);
  assert.equal(await client.config.region(), "auto");
  assert.equal(
    (await client.config.endpoint()).hostname,
    `${"a".repeat(32)}.r2.cloudflarestorage.com`
  );
  process.env.R2_BUCKET_NAME = "../bad-bucket";
  assert.throws(() => getR2Bucket(), /Invalid R2_BUCKET_NAME/);
  process.env.R2_BUCKET_NAME = "test-audio";
});

test("private playback and upload URLs sign the exact key, bounded expiry, and upload content type", async () => {
  const key = "audio/track 123/song.mp3";
  const play = new URL(await getAudioPlayUrl(key));
  assert.equal(play.protocol, "https:");
  assert.match(play.hostname, /\.r2\.cloudflarestorage\.com$/);
  assert.equal(
    play.hostname,
    `test-audio.${"a".repeat(32)}.r2.cloudflarestorage.com`
  );
  assert.equal(decodeURIComponent(play.pathname), `/${key}`);
  assert.equal(play.searchParams.get("X-Amz-Expires"), "3600");
  assert.ok(play.searchParams.has("X-Amz-Signature"));
  const put = new URL(await getDirectUploadUrl(key, "audio/mpeg"));
  assert.equal(put.searchParams.get("X-Amz-Expires"), "900");
  assert.ok(
    put.searchParams
      .get("X-Amz-SignedHeaders")
      .split(";")
      .includes("content-type")
  );
  assert.notEqual(
    put.searchParams.get("X-Amz-Signature"),
    play.searchParams.get("X-Amz-Signature")
  );
  for (const invalid of [0, -1, 1.5, 604801, NaN])
    await assert.rejects(getAudioPlayUrl(key, invalid), /expiry/);
  await assert.rejects(getDirectUploadUrl(key, "audio/mpeg", 0), /expiry/);
});

test("invalid keys, MIME types, and multi-ranges are rejected before storage I/O", async (t) => {
  const send = t.mock.method(S3Client.prototype, "send", () => {
    throw new Error("unexpected I/O");
  });
  for (const key of [
    "",
    "/audio/test",
    "audio//test",
    "audio/../test",
    "audio\\test",
    "audio/\nsecret",
    "x".repeat(1025),
  ]) {
    await assert.rejects(
      uploadAudio(key, Buffer.from("test")),
      /Invalid R2 object key/
    );
    await assert.rejects(getAudioPlayUrl(key), /Invalid R2 object key/);
    await assert.rejects(deleteAudio(key), /Invalid R2 object key/);
  }
  await assert.rejects(getDirectUploadUrl("audio/test", "text/html"), /MIME/);
  await assert.rejects(
    getDirectUploadUrl("audio/test", "audio/mpeg\n"),
    /MIME/
  );
  await assert.rejects(
    uploadAudio("audio/test", Buffer.from("test"), "audio/mpeg\r\nx: y"),
    /MIME/
  );
  for (const range of [
    "bytes=-",
    "bytes=0-1,2-3",
    "items=0-1",
    "bytes=1-2\r\n",
    "bytes=1-2\n",
  ])
    await assert.rejects(
      getAudio("audio/test", { range }),
      /single byte range/
    );
  assert.equal(send.mock.callCount(), 0);
});

test("storage sends exact bytes, preserves range metadata, and propagates cancellation", async (t) => {
  const bytes = Buffer.from("audio-bytes");
  const response = {
    ContentLength: 3,
    ContentRange: "bytes 2-4/11",
    ContentType: "audio/mpeg",
    Body: { marker: true },
  };
  const send = t.mock.method(S3Client.prototype, "send", async () => response);
  assert.equal(await uploadAudio("audio/test.mp3", bytes), "audio/test.mp3");
  const input = send.mock.calls[0].arguments[0].input;
  assert.equal(input.Body, bytes);
  assert.equal(input.ContentLength, bytes.length);
  assert.equal(input.ContentType, "audio/mpeg");
  assert.equal(input.Bucket, "test-audio");
  assert.equal(await headAudio("audio/test.mp3"), response);
  const controller = new AbortController();
  assert.equal(
    await getAudio("audio/test.mp3", {
      range: "bytes=2-4",
      signal: controller.signal,
    }),
    response
  );
  const [command, options] = send.mock.calls[2].arguments;
  assert.equal(command.input.Range, "bytes=2-4");
  assert.equal(options.abortSignal.aborted, false);
  controller.abort();
  assert.equal(options.abortSignal.aborted, true);
  await deleteAudio("audio/test.mp3");
  assert.equal(
    send.mock.calls[3].arguments[0].constructor.name,
    "DeleteObjectCommand"
  );
});

test("missing objects, rejected ranges, and upload failures stay visible to the caller", async (t) => {
  const failure = new Error("storage failure");
  const send = t.mock.method(S3Client.prototype, "send", async () => {
    throw failure;
  });
  for (const operation of [
    () => headAudio("audio/missing"),
    () => getAudio("audio/missing", { range: "bytes=999-" }),
    () => uploadAudio("audio/failure", Buffer.from("test")),
    () => deleteAudio("audio/failure"),
  ])
    await assert.rejects(operation, (error) => error === failure);
  assert.equal(send.mock.callCount(), 4);
});
