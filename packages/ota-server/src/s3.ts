import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { CurrentPointer } from "./types.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export function createS3Client(): S3Client {
  const endpoint = process.env.S3_ENDPOINT;
  return new S3Client({
    region: requireEnv("S3_REGION"),
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    credentials: {
      accessKeyId: requireEnv("AWS_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("AWS_SECRET_ACCESS_KEY"),
    },
  });
}

export function bucket(): string {
  return requireEnv("S3_BUCKET");
}

export function prefixKey(
  appId: string,
  platform: string,
  channel: string,
  ...rest: string[]
): string {
  const base = `apps/${appId}/${platform}/${channel}`;
  return rest.length ? `${base}/${rest.join("/")}` : base;
}

export function currentJsonKey(appId: string, platform: string, channel: string): string {
  return `${prefixKey(appId, platform, channel)}/current.json`;
}

export async function getCurrentPointer(
  client: S3Client,
  appId: string,
  platform: string,
  channel: string
): Promise<CurrentPointer | null> {
  const key = currentJsonKey(appId, platform, channel);
  try {
    const out = await client.send(
      new GetObjectCommand({ Bucket: bucket(), Key: key })
    );
    const body = await out.Body?.transformToString();
    if (!body) return null;
    return JSON.parse(body) as CurrentPointer;
  } catch (e: unknown) {
    const name = e && typeof e === "object" && "name" in e ? (e as { name: string }).name : "";
    if (name === "NoSuchKey" || name === "NotFound") return null;
    throw e;
  }
}

export async function putCurrentPointer(
  client: S3Client,
  appId: string,
  platform: string,
  channel: string,
  pointer: CurrentPointer
): Promise<void> {
  const key = currentJsonKey(appId, platform, channel);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: JSON.stringify(pointer, null, 2),
      ContentType: "application/json",
    })
  );
}

export async function presignBundleGet(
  client: S3Client,
  bundleKey: string,
  expiresSeconds: number
): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: bucket(), Key: bundleKey });
  return getSignedUrl(client, cmd, { expiresIn: expiresSeconds });
}
