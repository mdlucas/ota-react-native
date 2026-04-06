import type { ReleaseManifestResponse } from "./types.js";

export function githubManifestTemplate(): string | null {
  const t = process.env.OTA_GITHUB_MANIFEST_URL_TEMPLATE?.trim();
  return t ? t : null;
}

/** PAT for private repos (or higher rate limits). Same as ota-cli GITHUB_TOKEN. */
export function githubReadToken(): string | null {
  const t =
    process.env.OTA_GITHUB_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim();
  return t || null;
}

export function expandManifestUrl(
  template: string,
  appId: string,
  platform: string,
  channel: string
): string {
  return template
    .replaceAll("{appId}", encodeURIComponent(appId))
    .replaceAll("{platform}", encodeURIComponent(platform))
    .replaceAll("{channel}", encodeURIComponent(channel));
}

/** Parse https://raw.githubusercontent.com/owner/repo/ref/path/to/file */
export function parseRawGithubUrl(
  url: string
): { owner: string; repo: string; ref: string; path: string } | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "raw.githubusercontent.com") return null;
    const segments = u.pathname.split("/").filter(Boolean);
    if (segments.length < 4) return null;
    const [owner, repo, ref, ...pathParts] = segments;
    return { owner, repo, ref, path: pathParts.join("/") };
  } catch {
    return null;
  }
}

function encodeRepoPath(repoPath: string): string {
  return repoPath
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

interface GhContentFile {
  encoding?: string;
  content?: string;
}

async function fetchFileViaGithubApi(
  owner: string,
  repo: string,
  ref: string,
  filePath: string,
  token: string
): Promise<string | null> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeRepoPath(filePath)}?ref=${encodeURIComponent(ref)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ota-server/0.1",
      },
    }
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as GhContentFile;
  if (data.encoding !== "base64" || !data.content) {
    throw new Error("GitHub API: expected a single file (base64 content)");
  }
  return Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
}

function isHttpsUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

export async function fetchManifestFromGitHub(
  url: string
): Promise<ReleaseManifestResponse | null> {
  let text: string | null = null;

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "ota-server/0.1",
    },
  });
  if (res.ok) {
    text = await res.text();
  } else if (res.status === 404) {
    const token = githubReadToken();
    const parsed = parseRawGithubUrl(url);
    if (token && parsed) {
      const apiBody = await fetchFileViaGithubApi(
        parsed.owner,
        parsed.repo,
        parsed.ref,
        parsed.path,
        token
      );
      if (apiBody) text = apiBody;
      else return null;
    } else {
      return null;
    }
  } else {
    throw new Error(`GitHub manifest fetch failed: ${res.status} ${await res.text()}`);
  }

  if (!text) return null;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("Manifest is not valid JSON");
  }
  const version = typeof raw.version === "string" ? raw.version : "";
  const sha256 = typeof raw.sha256 === "string" ? raw.sha256 : "";
  const minNativeVersion =
    typeof raw.minNativeVersion === "string" ? raw.minNativeVersion : "";
  const bundleUrl = typeof raw.bundleUrl === "string" ? raw.bundleUrl : "";
  const mandatory = Boolean(raw.mandatory);

  if (!version || !sha256 || !minNativeVersion || !bundleUrl) {
    throw new Error("Invalid manifest JSON: need version, sha256, minNativeVersion, bundleUrl");
  }
  if (!isHttpsUrl(bundleUrl)) {
    throw new Error("Invalid bundleUrl: must be https");
  }

  return {
    version,
    sha256,
    minNativeVersion,
    mandatory,
    bundleUrl,
  };
}
