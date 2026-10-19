import "server-only";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2Bucket, getR2Client } from "./r2.ts";

function objectInput(key: string) {
  if (
    !key ||
    Buffer.byteLength(key, "utf8") > 1024 ||
    /[\u0000-\u001f\u007f\\]/.test(key) ||
    key.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Invalid R2 object key.");
  return { Bucket: getR2Bucket(), Key: key };
}

function audioType(mimeType: string) {
  if (!/^audio\/[a-z0-9][a-z0-9.+-]*$/i.test(mimeType) || /\s/.test(mimeType))
    throw new Error("Expected an audio MIME type without parameters.");
  return mimeType;
}

function expiry(seconds: number) {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 604800)
    throw new Error("Signed URL expiry must be between 1 and 604800 seconds.");
  return seconds;
}

function operationSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(120_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

// Call only with application-generated keys and verified audio content.
export async function uploadAudio(
  key: string,
  buffer: Buffer,
  mimeType = "audio/mpeg",
  signal?: AbortSignal
) {
  const command = new PutObjectCommand({
    ...objectInput(key),
    Body: buffer,
    ContentType: audioType(mimeType),
    ContentLength: buffer.length,
  });
  await getR2Client().send(command, { abortSignal: operationSignal(signal) });
  return key;
}

export async function getAudioPlayUrl(key: string, expiresInSeconds = 3600) {
  const command = new GetObjectCommand(objectInput(key));
  const expiresIn = expiry(expiresInSeconds);
  return getSignedUrl(getR2Client(), command, { expiresIn });
}

export async function getDirectUploadUrl(
  key: string,
  mimeType: string,
  expiresInSeconds = 900
) {
  const command = new PutObjectCommand({
    ...objectInput(key),
    ContentType: audioType(mimeType),
  });
  const expiresIn = expiry(expiresInSeconds);
  return getSignedUrl(getR2Client(), command, {
    expiresIn,
    signableHeaders: new Set(["content-type"]),
  });
}

export async function headAudio(key: string, signal?: AbortSignal) {
  const command = new HeadObjectCommand(objectInput(key));
  return getR2Client().send(command, { abortSignal: operationSignal(signal) });
}

// The caller owns consumption/cancellation of Body. Missing objects and invalid
// ranges remain SDK errors, allowing a delivery route to decide its fallback.
export async function getAudio(
  key: string,
  options: { range?: string; signal?: AbortSignal } = {}
) {
  const input = objectInput(key);
  if (
    options.range !== undefined &&
    (!/^bytes=\d*-\d*$/.test(options.range) ||
      /\s/.test(options.range) ||
      options.range === "bytes=-")
  )
    throw new Error("Expected a single byte range.");
  const command = new GetObjectCommand({ ...input, Range: options.range });
  return getR2Client().send(command, {
    abortSignal: operationSignal(options.signal),
  });
}

export async function deleteAudio(key: string, signal?: AbortSignal) {
  const command = new DeleteObjectCommand(objectInput(key));
  await getR2Client().send(command, { abortSignal: operationSignal(signal) });
}
