import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import {
  expandManifestUrl,
  fetchManifestFromGitHub,
  githubManifestTemplate,
  githubReadToken,
} from "./github.js";
import {
  bucket,
  createS3Client,
  getCurrentPointer,
  prefixKey,
  presignBundleGet,
  putCurrentPointer,
} from "./s3.js";
import { s3Configured } from "./s3-env.js";
import type { CurrentPointer, Platform, RegisterReleaseBody } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, "..", ".env") });

const PRESIGN_TTL = Number(process.env.PRESIGN_TTL_SECONDS ?? "900");

function apiKey(): string | null {
  const k = process.env.OTA_API_KEY?.trim();
  return k || null;
}

function authBearer(request: { headers: { authorization?: string } }): boolean {
  const expected = apiKey();
  if (!expected) return false;
  const auth = request.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return false;
  const token = auth.slice("Bearer ".length);
  return token === expected;
}

const fastify = Fastify({ logger: true });

fastify.get("/health", async () => ({
  ok: true,
  githubTemplate: Boolean(githubManifestTemplate()),
  githubReadTokenConfigured: Boolean(githubReadToken()),
  s3: s3Configured(),
}));

fastify.get<{
  Params: { appId: string; platform: string };
  Querystring: { channel?: string };
}>("/v1/apps/:appId/releases/:platform", async (request, reply) => {
  const { appId, platform } = request.params;
  const channel = request.query.channel ?? "production";
  if (platform !== "ios" && platform !== "android") {
    return reply.code(400).send({ error: "platform must be ios or android" });
  }

  const ghTemplate = githubManifestTemplate();
  if (ghTemplate) {
    const url = expandManifestUrl(ghTemplate, appId, platform, channel);
    try {
      const manifest = await fetchManifestFromGitHub(url);
      if (!manifest) {
        return reply.code(404).send({
          error: "no release for this app/channel (GitHub 404)",
          manifestUrl: url,
          hint:
            "Open manifestUrl in a browser. If it 404s but the file exists on GitHub: wrong path/branch, or the repo is private (set OTA_GITHUB_TOKEN or GITHUB_TOKEN in ota-server .env). Note: the app must still be able to download bundleUrl (public URL or use another host for the bundle).",
        });
      }
      return manifest;
    } catch (e) {
      request.log.error(e);
      return reply.code(502).send({
        error: "failed to load manifest from GitHub",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (!s3Configured()) {
    return reply.code(503).send({
      error:
        "Neither OTA_GITHUB_MANIFEST_URL_TEMPLATE nor S3 env is configured; cannot resolve releases",
    });
  }

  const client = createS3Client();
  const pointer = await getCurrentPointer(client, appId, platform, channel);
  if (!pointer) {
    return reply.code(404).send({ error: "no release for this app/channel" });
  }

  const bundleUrl = await presignBundleGet(client, pointer.bundleKey, PRESIGN_TTL);

  return {
    version: pointer.version,
    sha256: pointer.sha256,
    minNativeVersion: pointer.minNativeVersion,
    mandatory: pointer.mandatory ?? false,
    bundleUrl,
  };
});

fastify.post<{
  Params: { appId: string };
  Body: RegisterReleaseBody;
}>("/v1/apps/:appId/releases", async (request, reply) => {
  if (!authBearer(request)) {
    return reply.code(401).send({ error: "unauthorized" });
  }

  if (!s3Configured()) {
    return reply.code(503).send({
      error:
        "S3 is not configured. Register releases by committing current.json + bundle to GitHub (see ota publish-github) or configure S3_* env vars.",
    });
  }

  const { appId } = request.params;
  const body = request.body;
  if (!body?.platform || !body.channel || !body.version || !body.sha256 || !body.minNativeVersion) {
    return reply.code(400).send({
      error: "platform, channel, version, sha256, minNativeVersion are required",
    });
  }
  if (body.platform !== "ios" && body.platform !== "android") {
    return reply.code(400).send({ error: "platform must be ios or android" });
  }

  const bundleKey = `${prefixKey(appId, body.platform, body.channel)}/releases/${body.version}/bundle.jsbundle`;

  const pointer: CurrentPointer = {
    version: body.version,
    sha256: body.sha256,
    minNativeVersion: body.minNativeVersion,
    mandatory: body.mandatory,
    bundleKey,
  };

  const client = createS3Client();
  await putCurrentPointer(client, appId, body.platform, body.channel, pointer);

  return { ok: true, bundleKey, bucket: bucket() };
});

const port = Number(process.env.PORT ?? "3000");
const host = process.env.HOST ?? "0.0.0.0";

fastify.listen({ port, host }).catch((err) => {
  fastify.log.error(err);
  process.exit(1);
});
