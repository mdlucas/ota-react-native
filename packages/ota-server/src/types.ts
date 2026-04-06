export type Platform = "ios" | "android";

export interface CurrentPointer {
  version: string;
  sha256: string;
  minNativeVersion: string;
  mandatory?: boolean;
  /** S3 object key for the bundle */
  bundleKey: string;
}

export interface ReleaseManifestResponse {
  version: string;
  sha256: string;
  minNativeVersion: string;
  mandatory: boolean;
  bundleUrl: string;
}

export interface RegisterReleaseBody {
  platform: Platform;
  channel: string;
  version: string;
  sha256: string;
  minNativeVersion: string;
  mandatory?: boolean;
}
