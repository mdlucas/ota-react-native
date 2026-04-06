import type { ReleaseManifestResponse } from "./types.js";

export function githubManifestTemplate(): string | null {
  const t = process.env.OTA_GITHUB_MANIFEST_URL_TEMPLATE?.trim();
  return t ? t : null;
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
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "ota-server/0.1",
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GitHub manifest fetch failed: ${res.status} ${await res.text()}`);
  }
  const raw = (await res.json()) as Record<string, unknown>;
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
