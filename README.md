<div align="center">
  <a href="https://monetizationos.com">
  <img alt="MonetizationOS logo" src="https://app.monetizationos.com/static/monetizationos-logo.png" height="48">
  </a>
  <h1>MonetizationOS Fastly Proxy</h1>
</div>

[MonetizationOS](https://monetizationos.com) powers monetization for human and bot users alike. Use this Fastly Compute edge worker to proxy your website and integrate MonetizationOS Surfaces, enabling seamless monetization experiences for sites served with static HTML.

This worker includes handling for both HTTP response modification and CSS-targeted Components for content modifications including: removal/truncation, displaying offerings, and custom messaging.

The shared proxy pipeline is provided by [`@monetizationos/proxy`](https://www.npmjs.com/package/@monetizationos/proxy). This repository contains the Fastly Compute entrypoint, Config Store / Secret Store loading, and Fastly-specific adapters for `HTMLRewritingStream` and client metadata (including optional Next-Gen WAF signals).

Read more about using MonetizationOS at [docs.monetizationos.com](https://docs.monetizationos.com).

This package mirrors the architecture of the [Cloudflare proxy worker](https://github.com/MonetizationOS/cloudflare-proxy-worker).

## Required configuration

These values are stored in Fastly Config Store (`config`) and Secret Store (`secrets`) entries. The store names are hardcoded in `src/env.ts`; rename the constants there if you use different store names during setup.

| Key | Description |
|---|---|
| `MONETIZATION_OS_SECRET_KEY` | Your MonetizationOS secret key, **base64-encoded** in the Secret Store. [Get your secret key](https://docs.monetizationos.com/docs/guides/environments/managing-environments#api-keys). |
| `ORIGIN_URL` | The origin URL for your proxied website. |
| `SURFACE_SLUG` | The slug for the MonetizationOS surface you want to target. |
| `AUTHENTICATED_USER_JWT_COOKIE_NAME` | Cookie name for authenticated user JWT sessions. |
| `ANONYMOUS_SESSION_COOKIE_NAME` | Cookie name for anonymous sessions. |
| `INJECT_SCRIPT_URL` | URL of the MonetizationOS web components script to inject when component transforms run. |
| `MONETIZATION_OS_HOST` | MonetizationOS API host. Defaults to `https://api.monetizationos.com`. |
| `MONETIZATION_OS_ENDPOINTS_PREFIX` | Path prefix for proxied custom endpoints. Defaults to `/mos-endpoints/`. |

To base64-encode your secret key:

```bash
echo -n 'your_secret_key' | base64
```

## Optional: paths that skip surface decisions

`SURFACE_DECISIONS_IGNORE_PATHS` is a comma-separated list of regular expressions. Matching pathnames still proxy to the origin and rewrite origin links, but skip MonetizationOS surface decisions and component transforms.

## Optional: cookies forwarded to surface decisions

`SURFACE_DECISIONS_COOKIES` is a comma-separated list of regular expressions. Cookie names matching any pattern are forwarded to the MonetizationOS surface-decisions API as `http.cookies`. Matching cookies are read from the incoming request `Cookie` header and from the origin response `Set-Cookie` headers; when the same name appears in both, the origin value is used. When unset or when no cookies match, `http.cookies` is omitted from the surface-decisions payload.

Example Config Store value:

```
^__session$, ^theme$, ^mos_
```

Each pattern is a regex tested against the cookie **name**. Plain names like `^__session$` match exactly; prefixes like `^mos_` match any cookie whose name starts with `mos_`.

## Optional: Next-Gen WAF signals

When both are set in the Config Store, the worker calls Fastly Compute `inspect()` and sends WAF bot-management signals with surface-decisions requests:

- `NEXT_GEN_WAF_CORP` — your Fastly Next-Gen WAF corp/account name
- `NEXT_GEN_WAF_WORKSPACE` — your Fastly Next-Gen WAF workspace/site name

## Commands

- `pnpm start` — Build and run the local Compute server at `http://127.0.0.1:7676`.
- `pnpm run deploy` — Build and publish to Fastly.
- `pnpm test` — Run tests with Vitest.
- `pnpm run build` — Compile TypeScript to `bin/main.wasm`.
- `pnpm exec tsc --noEmit` — Type check without emitting files.

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
3. Creates the **`config`** Config Store and prompts for each key listed in [Required configuration](#required-configuration), plus optional keys above
4. Creates the **`secrets`** Secret Store and prompts for `MONETIZATION_OS_SECRET_KEY` (base64-encoded)

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

For the secret store, set the base64-encoded value in `fastly.toml`:

```toml
[[local_server.secret_stores.secrets]]
  key = "MONETIZATION_OS_SECRET_KEY"
  data = "<base64-encoded secret key>"
```

Both `key` and `data` are required for each secret entry.

### 3. Run locally

```bash
pnpm start
```
