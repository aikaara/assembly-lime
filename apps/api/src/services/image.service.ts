import { eq, and } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import { images } from "@assembly-lime/shared/db/schema";
import {
  uploadToS3,
  presignUrl,
  deleteFromS3,
  s3Key,
  S3_BUCKET,
} from "../lib/s3";

type UploadInput = {
  tenantId: number;
  agentRunId?: number;
  ticketId?: number;
  fileName: string;
  mimeType: string;
  body: Uint8Array;
  purpose?: string;
};

export async function uploadImage(db: Db, input: UploadInput) {
  const key = s3Key(input.tenantId, "images", input.fileName);

  await uploadToS3(key, input.body, input.mimeType);

  const [row] = await db
    .insert(images)
    .values({
      tenantId: input.tenantId,
      agentRunId: input.agentRunId,
      ticketId: input.ticketId,
      s3Key: key,
      s3Bucket: S3_BUCKET,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.body.byteLength,
      purpose: input.purpose,
    })
    .returning();

  if (!row) throw new Error("Failed to insert image row");

  const url = await presignUrl(key);

  return { ...row, presignedUrl: url };
}

export async function getImage(db: Db, tenantId: number, imageId: number) {
  const [row] = await db
    .select()
    .from(images)
    .where(and(eq(images.id, imageId), eq(images.tenantId, tenantId)));
  if (!row) return null;
  const url = await presignUrl(row.s3Key);
  return { ...row, presignedUrl: url };
}

export async function deleteImage(db: Db, tenantId: number, imageId: number) {
  const [row] = await db
    .select()
    .from(images)
    .where(and(eq(images.id, imageId), eq(images.tenantId, tenantId)));
  if (!row) return false;

  await deleteFromS3(row.s3Key);
  await db
    .delete(images)
    .where(and(eq(images.id, imageId), eq(images.tenantId, tenantId)));
  return true;
}
