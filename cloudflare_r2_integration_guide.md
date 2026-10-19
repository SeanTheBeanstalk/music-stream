# Lean Cloudflare R2 Integration Guide

This guide provides a minimalist setup for integrating **Cloudflare R2** into a personal Node.js / TypeScript project. Because R2 is fully S3-compatible, we use the official AWS SDK directly—avoiding unnecessary abstractions, custom adapters, or multi-bucket complexity.

---

## 1. Dependencies

Install the standard S3 client and the pre-signer utility:

```bash
pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

---

## 2. Environment Variables

Create or update your `.env` file with your Cloudflare R2 credentials:

```env
R2_ACCOUNT_ID="your_cloudflare_account_id"
R2_ACCESS_KEY_ID="your_r2_access_key_id"
R2_SECRET_ACCESS_KEY="your_r2_secret_access_key"
R2_BUCKET_NAME="your-bucket-name"
# Optional: Required only if you enabled custom domains or public r2.dev access
R2_PUBLIC_URL="https://pub-xxx.r2.dev"
```

---

## 3. Storage Client Setup (`lib/r2.ts`)

Instantiate the S3 client using your Cloudflare account endpoint:

```typescript
import { S3Client } from "@aws-sdk/client-s3";

export const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});
```

---

## 4. Helper Operations

Add basic operations in your helper file (e.g., `lib/storage.ts` or directly alongside `lib/r2.ts`) as needed.

### A. Upload File / Audio Buffer

```typescript
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2Client } from "./r2";

export async function uploadAudio(key: string, buffer: Buffer, mimeType = "audio/mpeg") {
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: key, // e.g., "audio/track-123.mp3"
    Body: buffer,
    ContentType: mimeType,
  });

  await r2Client.send(command);
  return key;
}
```

### B. Generate Presigned URL (For Private Playback or Direct Client Uploads)

```typescript
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2Client } from "./r2";

// Temporary playback URL for private buckets
export async function getAudioPlayUrl(key: string, expiresInSeconds = 3600) {
  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: key,
  });

  return await getSignedUrl(r2Client, command, { expiresIn: expiresInSeconds });
}

// Temporary upload URL for direct browser-to-R2 uploads
export async function getDirectUploadUrl(key: string, mimeType: string, expiresInSeconds = 900) {
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: key,
    ContentType: mimeType,
  });

  return await getSignedUrl(r2Client, command, { expiresIn: expiresInSeconds });
}
```

---

## Summary

- **One Client:** Standard AWS S3 SDK pointed at Cloudflare’s endpoint.
- **One Bucket:** Structure environment data via key prefixes (`dev/`, `audio/`) rather than separate infrastructure.
- **Direct Usage:** Call `PutObjectCommand` and `getSignedUrl` directly without boilerplate adapters.