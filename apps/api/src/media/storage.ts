import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../env";

let client: S3Client | null = null;

function validStorageKey(key: string): boolean {
  return /^(clips|cinema|playback-cache|images)\/[A-Za-z0-9_./-]{1,400}$/.test(key)
    && !key.includes("..");
}

function storageClient(): S3Client {
  if (!client) {
    client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

export async function checkStorage(): Promise<boolean> {
  try {
    await storageClient().send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
    return true;
  } catch {
    return false;
  }
}

export async function putMediaObject(input: {
  key: string;
  body: Uint8Array;
  contentType: string;
}): Promise<void> {
  if (!validStorageKey(input.key)) {
    throw new Error("Invalid storage key");
  }
  await storageClient().send(new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType,
    CacheControl: "private, max-age=300",
  }));
}

export async function signedMediaDownload(
  key: string,
  filename: string,
  expiresInSeconds = 900,
): Promise<string> {
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 100) || "zipo-media";
  return getSignedUrl(storageClient(), new GetObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${safeFilename}"`,
  }), { expiresIn: Math.min(900, Math.max(60, expiresInSeconds)) });
}

export async function signedMediaPreview(key: string, expiresInSeconds = 900): Promise<string> {
  return getSignedUrl(storageClient(), new GetObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    ResponseContentDisposition: "inline",
  }), { expiresIn: Math.min(900, Math.max(60, expiresInSeconds)) });
}

export async function deleteMediaObject(key: string): Promise<void> {
  if (!validStorageKey(key)) throw new Error("Invalid storage key");
  await storageClient().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
}

export async function readMediaObject(key: string): Promise<{
  body: Uint8Array;
  contentType: string;
  contentLength?: number;
}> {
  if (!validStorageKey(key)) throw new Error("Invalid storage key");
  const result = await storageClient().send(new GetObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
  }));
  if (!result.Body) throw new Error("Media object is empty");
  const body = await result.Body.transformToByteArray();
  return {
    body,
    contentType: result.ContentType ?? "application/octet-stream",
    contentLength: result.ContentLength,
  };
}

export async function deleteMediaPrefix(prefix: string): Promise<void> {
  if (!/^playback-cache\/[A-Za-z0-9_-]{24}\/$/.test(prefix)) {
    throw new Error("Invalid playback cache prefix");
  }
  let continuationToken: string | undefined;
  do {
    const listed = await storageClient().send(new ListObjectsV2Command({
      Bucket: env.S3_BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    const objects = (listed.Contents ?? [])
      .flatMap((entry) => entry.Key && validStorageKey(entry.Key) ? [{ Key: entry.Key }] : []);
    if (objects.length > 0) {
      await storageClient().send(new DeleteObjectsCommand({
        Bucket: env.S3_BUCKET,
        Delete: { Objects: objects, Quiet: true },
      }));
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
}
