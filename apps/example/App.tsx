/**
 * Example app: OTA check → download → apply → restart
 */

import React, {useCallback, useMemo, useState} from 'react';
import {
  Alert,
  Button,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import {OtaClient, fetchReleaseManifest, type ReleaseInfo} from 'react-native-ota';

/** Logical JS bundle label you publish with `ota publish --version` */
const CURRENT_BUNDLE_VERSION = '0.0.0';
/** Must match native versionName (Android) / CFBundleShortVersionString (iOS) for minNativeVersion checks */
const NATIVE_APP_VERSION = '1.0';

function App(): React.JSX.Element {
  const isDark = useColorScheme() === 'dark';
  const [baseUrl, setBaseUrl] = useState(
    Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://127.0.0.1:3000',
  );
  const [appId, setAppId] = useState('example');
  const [log, setLog] = useState<string>('');
  const [manifest, setManifest] = useState<ReleaseInfo | null>(null);

  const client = useMemo(
    () =>
      new OtaClient({
        appId,
        baseUrl,
        nativeAppVersion: NATIVE_APP_VERSION,
      }),
    [appId, baseUrl],
  );

  const append = useCallback((line: string) => {
    setLog((prev) => `${prev}\n${line}`.trim());
  }, []);

  const onCheck = useCallback(async () => {
    setManifest(null);
    try {
      const m = await client.checkForUpdate(CURRENT_BUNDLE_VERSION);
      if (!m) {
        append('No update (or below min native / same version).');
        return;
      }
      setManifest(m);
      append(`Update available: ${m.version} (sha256 prefix ${m.sha256.slice(0, 12)}…)`);
    } catch (e) {
      append(String(e));
      Alert.alert('Check failed', String(e));
    }
  }, [append, client]);

  const onFetchManifest = useCallback(async () => {
    try {
      const m = await fetchReleaseManifest({
        appId,
        baseUrl,
        nativeAppVersion: NATIVE_APP_VERSION,
      });
      if (!m) {
        append('Manifest 404 — publish a release first.');
        return;
      }
      setManifest(m);
      append(`Manifest: ${m.version}`);
    } catch (e) {
      append(String(e));
    }
  }, [append, appId, baseUrl]);

  const onDownloadApply = useCallback(async () => {
    if (!manifest) {
      Alert.alert('Run check first');
      return;
    }
    try {
      const path = await client.downloadUpdate(manifest);
      append(`Downloaded to ${path}`);
      await client.applyDownloadedBundle(path);
      append('Pending bundle set — restart to load it.');
      Alert.alert('OTA', 'Restart the app to load the new bundle.');
    } catch (e) {
      append(String(e));
      Alert.alert('Download failed', String(e));
    }
  }, [append, client, manifest]);

  const onRestart = useCallback(async () => {
    try {
      await client.restart();
    } catch (e) {
      append(String(e));
    }
  }, [append, client]);

  const bg = isDark ? '#111' : '#f5f5f5';
  const fg = isDark ? '#fff' : '#111';

  return (
    <SafeAreaView style={[styles.root, {backgroundColor: bg}]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.title, {color: fg}]}>OTA example</Text>
        <Text style={[styles.meta, {color: fg}]}>
          Bundle label: {CURRENT_BUNDLE_VERSION} · Native app: {NATIVE_APP_VERSION}
        </Text>
        <Text style={[styles.label, {color: fg}]}>Server base URL</Text>
        <TextInput
          value={baseUrl}
          onChangeText={setBaseUrl}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="http://…"
          placeholderTextColor="#888"
          style={styles.input}
        />
        <Text style={[styles.label, {color: fg}]}>App id</Text>
        <TextInput
          value={appId}
          onChangeText={setAppId}
          autoCapitalize="none"
          style={styles.input}
        />
        <View style={styles.gap} />
        <Button title="Check for update (vs bundle label)" onPress={onCheck} />
        <View style={styles.gap} />
        <Button title="Fetch latest manifest (raw)" onPress={onFetchManifest} />
        <View style={styles.gap} />
        <Button title="Download + set pending bundle" onPress={onDownloadApply} />
        <View style={styles.gap} />
        <Button title="Restart app (native)" onPress={onRestart} />
        <Text style={[styles.log, {color: fg}]}>{log || '—'}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  scroll: {padding: 16, paddingBottom: 48},
  title: {fontSize: 22, fontWeight: '700', marginBottom: 8},
  meta: {fontSize: 13, marginBottom: 16, opacity: 0.85},
  label: {fontSize: 13, marginBottom: 4},
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#888',
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
    color: '#111',
    backgroundColor: '#fff',
    marginBottom: 12,
  },
  gap: {height: 10},
  log: {marginTop: 20, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12},
});

export default App;
