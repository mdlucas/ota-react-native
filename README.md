# OTA monorepo (React Native + Node + S3/R2 ou GitHub raw)

Monorepo with a **self-hosted OTA server** (Fastify + optional S3 **or** GitHub `raw.githubusercontent.com`), a **publish CLI**, and a **React Native 0.77** library (`react-native-ota`) using the **New Architecture** (Turbo Module) for downloading a JS bundle, verifying **SHA-256**, persisting a pending path, and loading that file on the next cold start.

## Layout

| Path | Role |
|------|------|
| [packages/ota-server](packages/ota-server) | HTTP API: `GET` manifest, `POST` register release |
| [packages/ota-cli](packages/ota-cli) | `ota publish` (S3) · `ota publish-github` (GitHub raw + API opcional) |
| [packages/react-native-ota](packages/react-native-ota) | Turbo Module + JS `OtaClient` |
| [apps/example](apps/example) | Bare RN app wired to Metro + native bundle hook |

## Prerequisites

- Node 20+
- pnpm (root uses `packageManager` in [package.json](package.json)). [.npmrc](.npmrc) uses hoisted `node_modules` for React Native compatibility. From the repo root run `pnpm install` (includes `apps/example` and `packages/*`). You can also use **npm only** inside `apps/example` with `react-native-ota` as a `file:` dependency, but then skip the root pnpm workspace for that app.
- Android: JDK 17, Android SDK (example targets compile SDK 35)
- iOS: Xcode, CocoaPods
- Para modo **S3/R2**: bucket e credenciais
- Para modo **GitHub**: repositório **público** (URLs `raw.githubusercontent.com` são anônimas; repositório privado exige outra estratégia de download)

## Server

1. Copy [packages/ota-server/.env.example](packages/ota-server/.env.example) to `packages/ota-server/.env` and fill values.
2. From repo root:

```bash
pnpm install
pnpm --filter ota-server build
pnpm dev:server
```

### Modo GitHub (só para testar)

1. Crie um repositório no GitHub (recomendado **público** para o bundle baixar sem autenticação).
2. No `.env` do servidor, defina **só** o template (deixe S3 vazio ou incompleto — o `GET` usa GitHub quando o template existe):

```bash
OTA_GITHUB_MANIFEST_URL_TEMPLATE=https://raw.githubusercontent.com/SEU_USUARIO/SEU_REPO/main/ota/{appId}/{platform}/{channel}/current.json
```

3. O arquivo `current.json` no GitHub deve ter este formato (o app e o servidor esperam o mesmo contrato):

```json
{
  "version": "1.0.0",
  "sha256": "hex minúsculo do arquivo bundle",
  "minNativeVersion": "1.0",
  "mandatory": false,
  "bundleUrl": "https://raw.githubusercontent.com/SEU_USUARIO/SEU_REPO/main/ota/example/android/production/bundle.jsbundle"
}
```

4. `GET /health` mostra `githubTemplate: true` e `s3: false` quando estiver nesse modo.

Endpoints:

- `GET /health`
- `GET /v1/apps/:appId/releases/:platform?channel=production` — devolve `version`, `sha256`, `minNativeVersion`, `mandatory`, `bundleUrl` (URL presignada S3 **ou** URL raw do GitHub vinda do JSON)
- `POST /v1/apps/:appId/releases` — só com **S3 configurado**; com GitHub puro, atualize o repo (CLI abaixo) em vez deste endpoint

Bucket layout (modo S3 — CLI `publish`):

- `apps/{appId}/{platform}/{channel}/releases/{version}/bundle.jsbundle`
- `apps/{appId}/{platform}/{channel}/current.json`

Layout sugerido no GitHub (modo `publish-github`):

- `ota/{appId}/{platform}/{channel}/bundle.jsbundle`
- `ota/{appId}/{platform}/{channel}/current.json`

## CLI publish

1. Build a release bundle, e.g.:

```bash
cd apps/example
npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output /tmp/index.android.bundle
```

2. Copy [packages/ota-cli/.env.example](packages/ota-cli/.env.example), then:

```bash
pnpm --filter ota-cli build
set -a && source packages/ota-cli/.env && set +a
node packages/ota-cli/dist/cli.js publish \
  --app example \
  --platform android \
  --channel production \
  --bundle /tmp/index.android.bundle \
  --version 1.0.0 \
  --native-version 1.0
```

Use `--platform ios` and an iOS `.jsbundle` for iOS.

## Publicar bundle no GitHub (`ota publish-github`)

1. Gere o bundle de release:

```bash
cd apps/example
npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output /tmp/index.android.bundle
```

2. Opção A — **só gerar arquivos localmente** (você faz `git add` / `push` manual):

```bash
pnpm --filter ota-cli build
node packages/ota-cli/dist/cli.js publish-github \
  --bundle /tmp/index.android.bundle \
  --version 1.0.0 \
  --native-version 1.0 \
  --github-owner SEU_USUARIO \
  --github-repo SEU_REPO \
  --github-branch main \
  --app example \
  --platform android \
  --channel production \
  --out-dir ./dist-ota-upload
```

Copie `dist-ota-upload/bundle.jsbundle` e `dist-ota-upload/current.json` para o repo em  
`ota/example/android/production/` (mesma árvore que o template `{appId}/{platform}/{channel}`). Faça commit e push na branch usada na URL raw (ex.: `main`).

3. Opção B — **enviar pela API do GitHub** (token com escopo `repo`):

```bash
export GITHUB_TOKEN=ghp_xxxx
node packages/ota-cli/dist/cli.js publish-github \
  --bundle /tmp/index.android.bundle \
  --version 1.0.0 \
  --native-version 1.0 \
  --github-owner SEU_USUARIO \
  --github-repo SEU_REPO \
  --github-branch main \
  --app example \
  --platform android \
  --channel production \
  --push
```

O comando imprime também `OTA_GITHUB_MANIFEST_URL_TEMPLATE` sugerido para colar no `.env` do `ota-server`.

4. Suba o servidor com esse template e aponte o app `baseUrl` para ele; o fluxo de download no cliente continua igual (HTTPS → bundle em disco → SHA-256).

## Example app

The example depends on the local package via `file:../../packages/react-native-ota`. [metro.config.js](apps/example/metro.config.js) watches the monorepo root.

- **Android**: [MainApplication.kt](apps/example/android/app/src/main/java/com/example/MainApplication.kt) overrides `getJSBundleFile()` in release to use the path stored by the library (when not in dev support).
- **iOS**: [AppDelegate.swift](apps/example/ios/example/AppDelegate.swift) uses `UserDefaults` key `pending_bundle_path` in release to prefer a file URL over `main.jsbundle`.

Run Metro from `apps/example`, then `npx react-native run-android` / `run-ios`. The sample UI uses `http://10.0.2.2:3000` on Android emulator to reach the host machine’s server.

## R2 / CORS

- Configure the bucket CORS policy to allow **GET** from your app origins if the client fetches presigned URLs directly (browser/WebViews); native `NSURLSession` / OkHttp are not subject to browser CORS, but any web-based tooling might be.
- For R2, set `S3_ENDPOINT`, `S3_REGION=auto`, and often `forcePathStyle` (the server already sets path-style when `S3_ENDPOINT` is present).

## iOS note (`restartApp`)

`restartApp` calls `exit(0)` after resolving the promise; reopen the app from the home screen (or automate via your test harness). Android uses a relaunch intent before exit.

## Version matrix

The native bundle loader hooks are written against **React Native 0.77** / New Architecture. Other RN versions may require small adjustments in `MainApplication` / `AppDelegate`.
