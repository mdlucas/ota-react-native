import {Platform} from 'react-native';
import NativeOta from './NativeOta';

export type OtaPlatform = 'ios' | 'android';

export interface OtaConfig {
  appId: string;
  baseUrl: string;
  /** CFBundleShortVersionString / android versionName — used with manifest minNativeVersion */
  nativeAppVersion: string;
  channel?: string;
  platform?: OtaPlatform;
}

export interface ReleaseInfo {
  version: string;
  sha256: string;
  minNativeVersion: string;
  mandatory: boolean;
  bundleUrl: string;
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }
  return 0;
}

export async function fetchReleaseManifest(
  config: OtaConfig
): Promise<ReleaseInfo | null> {
  const channel = config.channel ?? 'production';
  const platform = config.platform ?? (Platform.OS as OtaPlatform);
  const url = `${config.baseUrl.replace(/\/$/, '')}/v1/apps/${encodeURIComponent(config.appId)}/releases/${platform}?channel=${encodeURIComponent(channel)}`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`OTA manifest failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as ReleaseInfo;
}

export class OtaClient {
  constructor(private readonly config: OtaConfig) {}

  async checkForUpdate(currentBundleVersion: string): Promise<ReleaseInfo | null> {
    const manifest = await fetchReleaseManifest(this.config);
    if (!manifest) return null;
    if (compareSemver(manifest.version, currentBundleVersion) <= 0) return null;
    if (compareSemver(this.config.nativeAppVersion, manifest.minNativeVersion) < 0) {
      return null;
    }
    return manifest;
  }

  async downloadUpdate(manifest: ReleaseInfo): Promise<string> {
    return NativeOta.downloadAndVerifyBundle(manifest.bundleUrl, manifest.sha256);
  }

  async applyDownloadedBundle(localPath: string): Promise<void> {
    await NativeOta.setPendingBundlePath(localPath);
  }

  async clearPending(): Promise<void> {
    await NativeOta.clearPendingBundle();
  }

  async restart(): Promise<void> {
    await NativeOta.restartApp();
  }
}

export {NativeOta};
