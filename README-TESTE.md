# Passo a passo — testar OTA (Code Push) ponta a ponta

Este guia usa o fluxo **GitHub** (`current.json` + `bundle.jsbundle` no repo) e o **app de exemplo** em `apps/example`. Ajuste `SEU_USUARIO`, `SEU_REPO` e branch (`main`) onde indicado.

> **Importante:** na CLI use **`--release-version`**, não `--version` (o Commander reserva `--version` para mostrar a versão do programa e o comando “não faz nada”).

---

## 0. Pré-requisitos

- Node 20+
- `pnpm` (via `corepack enable`)
- Android: JDK 17 + Android SDK (para `run-android`)
- Conta GitHub e repositório para os bundles (idealmente **público** para o app baixar o `.jsbundle` sem token)
- Token `GITHUB_TOKEN` (PAT) com permissão para escrever no repo, se for usar `publish-github --push`

---

## 1. Instalar e compilar

Na **raiz** do monorepo:

```bash
cd /caminho/para/ota-project
corepack pnpm install
corepack pnpm --filter ota-server build
corepack pnpm --filter ota-cli build
```

---

## 2. Configurar o servidor (`packages/ota-server/.env`)

Copie de [packages/ota-server/.env.example](packages/ota-server/.env.example) se ainda não tiver `.env`.

Mínimo para modo GitHub:

```env
PORT=3000
HOST=0.0.0.0
OTA_API_KEY=local-test-key
OTA_GITHUB_MANIFEST_URL_TEMPLATE=https://raw.githubusercontent.com/SEU_USUARIO/SEU_REPO/main/ota/{appId}/{platform}/{channel}/current.json
```

- Troque `SEU_USUARIO` e `SEU_REPO`.
- O caminho `ota/{appId}/{platform}/{channel}/current.json` tem de ser o mesmo que a CLI `publish-github` usa (por defeito `ota` + `example` + `android` + `production`).

**Repo privado:** o `raw.githubusercontent.com` pode dar 404 ao servidor. Adicione o mesmo PAT que usa na CLI:

```env
OTA_GITHUB_TOKEN=ghp_...
```

(Recomendado: variável separada; também aceita `GITHUB_TOKEN`.)

> O **app** descarrega o ficheiro em `bundleUrl` **sem** autenticação. Para OTA real, o `bundleUrl` deve ser **público** (repo público ou outro host).

---

## 3. Subir o servidor

```bash
corepack pnpm dev:server
```

Se aparecer **`EADDRINUSE: ... :3000`**, já há um processo na porta. Ou pare-o (`lsof -i :3000` e `kill <PID>`) ou use outra porta:

```bash
PORT=3001 corepack pnpm dev:server
```

(nesse caso ajuste a URL no app para `3001`.)

### Verificar

```bash
curl -s http://127.0.0.1:3000/health
```

Esperado (exemplo): `ok`, `githubTemplate: true`, `s3: false`, e `githubReadTokenConfigured: true` se tiver token no `.env`.

---

## 4. Configurar a CLI (`packages/ota-cli/.env`)

```env
GITHUB_TOKEN=ghp_...
```

(Opcional: `OTA_SERVER_URL` / `OTA_API_KEY` só para o comando `publish` com S3.)

A CLI carrega automaticamente `packages/ota-cli/.env` mesmo que corra `node` a partir da raiz do monorepo.

---

## 5. Gerar o bundle Android

```bash
cd apps/example
corepack pnpm bundle:android
```

Isto gera `tmp/index.android.bundle` na **raiz** do monorepo.

Alternativa manual:

```bash
npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output /tmp/index.android.bundle
```

---

## 6. Publicar no GitHub (`publish-github`)

Na **raiz** do monorepo:

```bash
node packages/ota-cli/dist/cli.js publish-github \
  --bundle tmp/index.android.bundle \
  --release-version 1.0.0 \
  --native-version 1.0 \
  --github-owner SEU_USUARIO \
  --github-repo SEU_REPO \
  --github-branch main \
  --app example \
  --platform android \
  --channel production \
  --push
```

O que deve acontecer:

- Mensagens `[ota publish-github] starting…` e `wrote: .../packages/ota-cli/publish-out/...`
- JSON com `ok`, `bundleUrl`, `serverEnv`, etc.
- Com `--push`: `Pushing to …` e `GitHub API: bundle + current.json updated.`

Confirme no GitHub os ficheiros:

- `ota/example/android/production/bundle.jsbundle`
- `ota/example/android/production/current.json`

O `OTA_GITHUB_MANIFEST_URL_TEMPLATE` no servidor tem de bater com esse layout (branch `main`, prefixo `ota`, etc.).

---

## 7. Testar o endpoint de release

```bash
curl -s "http://127.0.0.1:3000/v1/apps/example/releases/android?channel=production"
```

Esperado: JSON com `version`, `sha256`, `minNativeVersion`, `mandatory`, `bundleUrl`.

Se vier `GitHub 404`, o corpo inclui **`manifestUrl`**. Abra essa URL no browser:

- 404 → caminho/branch errados, ou falta `OTA_GITHUB_TOKEN` em repo privado.
- 200 → o servidor deveria conseguir ler; reinicie o servidor após alterar `.env`.

---

## 8. Correr o app de exemplo

**Metro** (num terminal):

```bash
cd apps/example
npx react-native start
```

**Android** (outro terminal):

```bash
cd apps/example
npx react-native run-android
```

No **emulador Android**, o campo URL do servidor de teste costuma ser `http://10.0.2.2:3000` (já é o padrão na UI de exemplo). No dispositivo físico, use o IP da máquina na LAN.

### Fluxo na UI de exemplo

1. **Check for update** — compara com o “bundle label” em `App.tsx` (`CURRENT_BUNDLE_VERSION`).
2. **Download + set pending bundle**
3. **Restart app (native)**

Para ver update na **check**, o `release-version` publicado tem de ser **maior** que `CURRENT_BUNDLE_VERSION` no código (ex.: publique `1.0.1` e deixe o app em `0.0.0`).

### OTA em build de release (sem Metro)

O hook nativo que escolhe o bundle OTA aplica-se quando **não** está em modo dev/Metro. Para teste real de arranque com bundle em disco, use build **release** do Android (e confirme `versionName` ≥ `minNativeVersion` no `current.json`).

---

## 9. Checklist rápido de problemas

| Sintoma | O que verificar |
|--------|------------------|
| CLI só imprime `0.1.0` | Usou `--version`; troque para **`--release-version`**. |
| Nada gravado em disco | Sem `--skip-local-write`, os ficheiros vão para `packages/ota-cli/publish-out/`. |
| `EADDRINUSE :3000` | Já existe servidor; mate o processo ou use `PORT=3001`. |
| API `GitHub 404` | `manifestUrl` na resposta; branch/caminho; token se repo privado. |
| Update não aparece no “Check” | Aumente `--release-version` face a `CURRENT_BUNDLE_VERSION` em `App.tsx`. |
| Download do bundle falha no app | `bundleUrl` tem de ser acessível **sem** token (repo público ou CDN). |

---

## 10. iOS (opcional)

- Gere bundle: `corepack pnpm bundle:ios` em `apps/example` (saída em `tmp/index.ios.bundle`).
- `publish-github` com `--platform ios` e o mesmo `--app` / `--channel` coerentes com o template.
- `pod install` em `apps/example/ios` se ainda não tiver corrido.
- Na UI, a URL base para o Mac costuma ser `http://127.0.0.1:3000`.

---

Para detalhes de arquitetura e S3, veja o [README.md](README.md) principal.
