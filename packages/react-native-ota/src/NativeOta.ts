import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

export interface Spec extends TurboModule {
  downloadAndVerifyBundle(url: string, expectedSha256Hex: string): Promise<string>;
  getPendingBundlePath(): Promise<string>;
  setPendingBundlePath(path: string): Promise<void>;
  clearPendingBundle(): Promise<void>;
  restartApp(): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('RNOta');
