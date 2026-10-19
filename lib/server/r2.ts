import "server-only";
import { S3Client } from "@aws-sdk/client-s3";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing R2 configuration: ${name}.`);
  return value;
}

export function getR2Bucket() {
  const bucket = required("R2_BUCKET_NAME");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket))
    throw new Error("Invalid R2_BUCKET_NAME.");
  return bucket;
}

let client: S3Client | undefined;

// Initialize at first use so builds and ordinary playback need no R2 credentials.
export function getR2Client() {
  if (client) return client;
  const accountId = required("R2_ACCOUNT_ID");
  if (!/^[a-f0-9]{32}$/i.test(accountId))
    throw new Error("Invalid R2_ACCOUNT_ID.");
  getR2Bucket();
  client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    },
    maxAttempts: 3,
    // R2 does not support every optional AWS checksum feature.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 120_000 },
  });
  return client;
}
