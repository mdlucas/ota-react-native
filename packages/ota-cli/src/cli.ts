import "dotenv/config";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Command } from "commander";
import { githubGetContentSha, githubPutContent } from "./github-api.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function createS3(): S3Client {
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

function prefixKey(appId: string, platform: string, channel: string, ...rest: string[]): string {
  const base = `apps/${appId}/${platform}/${channel}`;
  return rest.length ? `${base}/${rest.join("/")}` : base;
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (c) => hash.update(c));
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });
  return hash.digest("hex");
}

const program = new Command();
program.name("ota").description("OTA bundle publish CLI").version("0.1.0");

program
  .command("publish")
  .requiredOption("--app <id>", "app id")
  .requiredOption("--platform <ios|android>", "platform")
  .requiredOption("--channel <name>", "release channel", "production")
  .requiredOption("--bundle <path>", "path to bundle.jsbundle")
  .requiredOption("--version <semver>", "release version label")
  .requiredOption("--native-version <semver>", "min native app version (semver)")
  .option("--mandatory", "mark update mandatory", false)
  .action(async (opts) => {
    const platform = opts.platform as string;
    if (platform !== "ios" && platform !== "android") {
      throw new Error("platform must be ios or android");
    }

    const bundlePath = path.resolve(opts.bundle);
    const sha256 = await sha256File(bundlePath);
    const appId = opts.app as string;
    const channel = opts.channel as string;
    const version = opts.version as string;

    const bundleKey = `${prefixKey(appId, platform, channel)}/releases/${version}/bundle.jsbundle`;
    const manifest = {
      version,
      sha256,
      minNativeVersion: opts.nativeVersion,
      mandatory: Boolean(opts.mandatory),
      bundleKey,
      platform,
      channel,
    };
    const manifestKey = `${prefixKey(appId, platform, channel)}/releases/${version}/manifest.json`;

    const client = createS3();
    const bucket = requireEnv("S3_BUCKET");
    const body = await readFile(bundlePath);

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: bundleKey,
        Body: body,
        ContentType: "application/javascript",
      })
    );

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: manifestKey,
        Body: JSON.stringify(manifest, null, 2),
        ContentType: "application/json",
      })
    );

    const serverUrl = requireEnv("OTA_SERVER_URL").replace(/\/$/, "");
    const apiKey = requireEnv("OTA_API_KEY");

    const res = await fetch(`${serverUrl}/v1/apps/${encodeURIComponent(appId)}/releases`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        platform,
        channel,
        version,
        sha256,
        minNativeVersion: opts.nativeVersion,
        mandatory: Boolean(opts.mandatory),
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`register release failed: ${res.status} ${text}`);
    }

    console.log(JSON.stringify({ ok: true, bundleKey, manifestKey, sha256 }, null, 2));
  });

program
  .command("publish-github")
  .description(
    "Build current.json pointing at raw.githubusercontent.com and optionally push bundle + manifest via API"
  )
  .requiredOption("--bundle <path>", "path to bundle.jsbundle")
  .requiredOption("--version <semver>", "release version label")
  .requiredOption("--native-version <semver>", "min native app version (semver)")
  .requiredOption("--github-owner <login>", "GitHub user or org")
  .requiredOption("--github-repo <name>", "repository name")
  .requiredOption("--github-branch <branch>", "branch used in raw URL (e.g. main)", "main")
  .requiredOption("--app <id>", "app id (folder segment, same as API appId)")
  .requiredOption("--platform <ios|android>", "platform segment")
  .requiredOption("--channel <name>", "channel segment", "production")
  .option("--root-prefix <path>", "root folder in repo", "ota")
  .option("--mandatory", "mark update mandatory", false)
  .option("--out-dir <dir>", "write bundle.jsbundle + current.json to this folder")
  .option("--push", "PUT files using GITHUB_TOKEN from environment")
  .action(async (opts) => {
    const platform = opts.platform as string;
    if (platform !== "ios" && platform !== "android") {
      throw new Error("platform must be ios or android");
    }
    const appId = opts.app as string;
    const channel = opts.channel as string;
    const root = (opts.rootPrefix as string).replace(/^\/+|\/+$/g, "");
    const repoPathBase = `${root}/${appId}/${platform}/${channel}`.replace(/\/+/g, "/");

    const owner = opts.githubOwner as string;
    const repo = opts.githubRepo as string;
    const branch = opts.githubBranch as string;

    const bundlePath = path.resolve(opts.bundle as string);
    const sha256 = await sha256File(bundlePath);
    const bundleUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${repoPathBase}/bundle.jsbundle`;

    const manifest = {
      version: opts.version as string,
      sha256,
      minNativeVersion: opts.nativeVersion as string,
      mandatory: Boolean(opts.mandatory),
      bundleUrl,
    };
    const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
    const bundleBytes = await readFile(bundlePath);

    const outDir = opts.outDir as string | undefined;
    if (outDir) {
      const dir = path.resolve(outDir);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "bundle.jsbundle"), bundleBytes);
      await writeFile(path.join(dir, "current.json"), manifestJson, "utf8");
    }

    const serverTemplate = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${root}/{appId}/{platform}/{channel}/current.json`;

    console.log(
      JSON.stringify(
        {
          ok: true,
          sha256,
          bundleUrl,
          repoPaths: {
            bundle: `${repoPathBase}/bundle.jsbundle`,
            manifest: `${repoPathBase}/current.json`,
          },
          serverEnv: {
            OTA_GITHUB_MANIFEST_URL_TEMPLATE: serverTemplate,
          },
          nextSteps: opts.push
            ? ["Files pushed via API (if --push succeeded)."]
            : [
                "Add/commit/push to GitHub:",
                `  git add ${repoPathBase}/bundle.jsbundle ${repoPathBase}/current.json`,
                "Or copy files from --out-dir into the repo under that path.",
                "Set ota-server env OTA_GITHUB_MANIFEST_URL_TEMPLATE to serverEnv value above.",
              ],
        },
        null,
        2
      )
    );

    if (opts.push) {
      const token = process.env.GITHUB_TOKEN?.trim();
      if (!token) {
        throw new Error("GITHUB_TOKEN is required for --push");
      }
      const bundleRepoPath = `${repoPathBase}/bundle.jsbundle`;
      const manifestRepoPath = `${repoPathBase}/current.json`;
      const b64Bundle = bundleBytes.toString("base64");
      const b64Manifest = Buffer.from(manifestJson, "utf8").toString("base64");

      const shaBundle = await githubGetContentSha(token, owner, repo, bundleRepoPath, branch);
      const shaManifest = await githubGetContentSha(token, owner, repo, manifestRepoPath, branch);

      await githubPutContent(
        token,
        owner,
        repo,
        bundleRepoPath,
        branch,
        `OTA bundle ${manifest.version} (${platform}/${channel})`,
        b64Bundle,
        shaBundle
      );
      await githubPutContent(
        token,
        owner,
        repo,
        manifestRepoPath,
        branch,
        `OTA manifest ${manifest.version} (${platform}/${channel})`,
        b64Manifest,
        shaManifest
      );
      console.log("GitHub API: bundle + current.json updated.");
    }
  });

program.parseAsync(process.argv).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
