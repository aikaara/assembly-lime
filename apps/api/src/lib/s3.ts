import { S3Client } from "bun";

const endpoint = process.env.S3_ENDPOINT ?? "http://localhost:9000";
const bucket = process.env.S3_BUCKET ?? "assembly-lime";
const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? "minioadmin";
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? "minioadmin";
const region = process.env.S3_REGION ?? "us-east-1";

export const s3 = new S3Client({
  endpoint,
  bucket,
  accessKeyId,
  secretAccessKey,
  region,
});

export function s3Key(tenantId: number, prefix: string, fileName: string): string {
  const ts = Date.now();
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${tenantId}/${prefix}/${ts}-${safe}`;
}

export async function uploadToS3(
  key: string,
  body: Uint8Array | ArrayBuffer | string,
  contentType: string
): Promise<void> {
  await s3.write(key, body, { type: contentType });
}

export async function presignUrl(key: string, expiresIn = 3600): Promise<string> {
  return s3.presign(key, { expiresIn });
}

export async function deleteFromS3(key: string): Promise<void> {
  await s3.delete(key);
}

export { bucket as S3_BUCKET };
