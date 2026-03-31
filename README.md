# MonetizationOS Fastly Proxy


[MonetizationOS](https://monetizationos.com) powers monetization for human and bot users alike. Use this Fastly Compute edge worker to proxy your website and integrate MonetizationOS Surfaces, enabling seamless monetization experiences for sites served with static HTML.

Read more at [docs.monetizationos.com](https://docs.monetizationos.com).


This Edge Compute Proxy is based on our [cloudflare worker](https://github.com/MonetizationOS/cloudflare-proxy-worker)



---

## Deploy to Fastly

### Prerequisites

- A [Fastly account](https://www.fastly.com/signup) with an API token
- The Fastly CLI (installed as a dev dependency — run `pnpm install` first)

### Step 1 — Authenticate

```bash
npx fastly profile create
```

This prompts you for your Fastly API token and saves a local profile.

### Step 2 — Deploy

```bash
pnpm run deploy
```

On the first run (no `service_id` in `fastly.toml`), this launches an interactive wizard that:

1. Creates a new Fastly Compute service
2. Prompts for the two backend hostnames:
   - `origin` → your website's hostname (e.g. `news.example.com`)
   - `monetization_api` → `api.monetizationos.com`
3. Creates the **`config`** Config Store and prompts for each key:

| Key | Default / Example |
|---|---|
| `ORIGIN_URL` | Your website's origin URL (e.g. `https://www.example.com`) |
| `SURFACE_SLUG` | Your Surface slug from the MonetizationOS dashboard |
| `AUTHENTICATED_USER_JWT_COOKIE_NAME` | `__session` |
| `ANONYMOUS_SESSION_COOKIE_NAME` | `anon-session-id` |
| `INJECT_SCRIPT_URL` | `https://assets.monetizationos.com/web-components-latest.js` |
| `MONETIZATION_OS_HOST` | `https://api.monetizationos.com` |
| `MONETIZATION_OS_ENDPOINTS_PREFIX` | `/mos-endpoints/` |
| `SURFACE_DECISIONS_IGNORE_PATHS` | Comma-separated regex patterns for paths that should skip surface decisions (optional) |

> The store names **`config`** and **`secrets`** are hardcoded in `src/env.ts` (`new ConfigStore('config')` / `new SecretStore('secrets')`). If you use different names during setup, update the `CONFIG_STORE_NAME` and `SECRET_STORE_NAME` constants in `src/env.ts` to match.

4. Creates the **`secrets`** Secret Store and prompts for:

| Key | Value |
|---|---|
| `MONETIZATION_OS_SECRET_KEY` | Your Secret Key from the MonetizationOS dashboard, **base64-encoded** |

To encode your secret key before entering it:

```bash
echo -n 'your_secret_key' | base64
```

After the wizard completes, note the **Service ID** printed in the output and add it to `fastly.toml`:

```toml
service_id = "<YOUR_SERVICE_ID>"
```

This prevents the wizard from running again on future deploys.

### Subsequent deploys

```bash
pnpm run deploy
```

### Troubleshooting: `400 Bad Request (duplicate: name)` on secret store entry

If a deploy fails mid-way the CLI cleans up the service but leaves any Secret Store entries it already created. The next attempt fails with a duplicate error. Fix it by deleting the orphaned entry:

```bash
npx fastly secret-store list
# Note the Store ID for 'secrets', then:
npx fastly secret-store-entry delete --store-id <SECRET_STORE_ID> --name MONETIZATION_OS_SECRET_KEY
```

Then re-run `pnpm run deploy`.

---

## Local Development

### Prerequisites

- [Node.js](https://nodejs.org/) (see `.nvmrc` in parent directory)
- [Fastly CLI](https://developer.fastly.com/learning/tools/cli/) — installed via `pnpm install` as a dev dependency

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure local values

All local config is defined in `fastly.toml` under `[local_server.config_stores.config.contents]`. Update those values to match your environment.

For the secret store, update the base64-encoded value in `fastly.toml`:

```toml
[[local_server.secret_stores.secrets]]
  key = "MONETIZATION_OS_SECRET_KEY"
  data = "<base64-encoded secret key>"
```

To encode your key:

```bash
echo -n 'your_secret_key' | base64
```

### 3. Run locally

```bash
pnpm start          # build + serve at http://127.0.0.1:7676
```

### 4. Run tests

```bash
pnpm test           # run tests in watch mode
pnpm test --run     # run tests once
```

### 5. Type check

```bash
pnpm exec tsc --noEmit
```

### 6. Build

```bash
pnpm run build      # compile TypeScript → bin/main.wasm
```

### 7. Deploy

```bash
pnpm run deploy     # build + publish to Fastly
```
