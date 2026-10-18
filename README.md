# yeying-tester

End-to-end Playwright + Chromium test suite for the YeYing community products.

Implemented cases and the backlog of cases still to write are tracked in
[`docs/test-cases/`](docs/test-cases/) — a QA-authored, per-product enumeration
of the E2E cases each product should have (see its `README.md` for progress).

## What this repo covers

| product     | frontend / dev port  | backend port            | what is tested                                              |
| ----------- | -------------------- | ----------------------- | ----------------------------------------------------------- |
| warehouse   | 5173 (Vite)          | 6065 WebDAV, 6066 admin | admin login, WebDAV PROPFIND/PUT/GET, bucket UI             |
| node        | 8991                 | 8100                    | home, navigation, publish-app view                          |
| router      | 3011 (bundled)       | 3011 (Go binary)        | admin root page, sidebar items                              |
| chat        | 3020                 | embedded Next.js API    | home, new-chat dialog; LLM conversation tests gated on keys |
| social      | 8082                 | 8888 (via /api)         | login, nav after auth                                       |
| project     | 20833 (APP_DEV_PORT) | same                    | login, dashboard sidebar                                    |
| knowledge   | 5173                 | 8000 FastAPI            | home, search box, /health                                   |
| marketplace | none (static)        | none                    | index.json schema and shape                                 |
| books       | none (docs)          | none                    | SUMMARY.md links                                            |
| agent hub   | 5174                 | 3900 uvicorn            | home, /health, wallet tests gated on key                    |

## Layout

```
tester/
├── playwright.config.ts          # 10 projects, one per product
├── shared/                       # env, auth, api, fixtures, reporters
├── scripts/                      # check-env, list-projects, reset-state
└── products/<name>/              # one directory per product
    ├── playwright.config.ts      # product-specific overrides
    ├── tsconfig.json
    ├── fixtures.ts
    ├── pages/                    # optional Page Objects
    └── tests/*.spec.ts
```

## Prerequisites

- Node.js ≥ 24.18 (a `.nvmrc` is provided)
- pnpm ≥ 9
- Playwright browsers (`pnpm browsers:install`)
- Each product running on the documented ports

## First-time setup

```bash
pnpm install
pnpm browsers:install
cp .env.template .env.local   # tweak BASE_URL / path values to match your local setup
```

## Environment selection (local / test / prod)

Config is loaded from a single `.env.<env>` file chosen by the `TEST_ENV`
variable (see `shared/env.ts`):

- `TEST_ENV=local|test|prod` — load exactly `.env.<env>`; a missing file is a
  hard error (so you never silently run against the wrong config).
- `TEST_ENV` unset — cascade: the first of `.env.local` → `.env.test` →
  `.env.prod` that exists wins. None existing is fine (CI sets vars directly).

Only one file is ever loaded — it's a selection model, not layering. Compose
the environment as an inline prefix on any existing script; no `--` needed:

```bash
pnpm test:wallet                  # default → .env.local
TEST_ENV=test pnpm test:wallet    # → .env.test
TEST_ENV=prod pnpm test:wallet    # → .env.prod
TEST_ENV=test pnpm test:chat      # works for every product
```

(`npm run test:wallet` / `TEST_ENV=test npx playwright test --project=wallet`
work identically.) The `.env.local` / `.env.test` / `.env.prod` files are all
gitignored.

## Common commands

| Command                     | What it does                                      |
| --------------------------- | ------------------------------------------------- |
| `pnpm test`                 | run every project's tests                         |
| `pnpm test:<product>`       | run a single product (e.g. `pnpm test:warehouse`) |
| `pnpm list`                 | enumerate every test without executing            |
| `pnpm env:check`            | verify each `*_BASE_URL` is reachable             |
| `pnpm env:list`             | print per-product env-var matrix                  |
| `pnpm typecheck`            | `tsc -b` across every project                     |
| `pnpm lint` / `pnpm format` | eslint / prettier                                 |
| `pnpm report`               | open the last HTML report                         |
| `pnpm clean`                | remove reports, results, tsbuildinfo              |

> Prefix any of the above with `TEST_ENV=local|test|prod` to pick the config
> file — see [Environment selection](#environment-selection-local--test--prod).

## Verifying the scaffold without real services

The framework is decoupled from the products. You can verify the harness with
three steps that do not require any product running:

1. `pnpm install`
2. `pnpm exec playwright install chromium`
3. `pnpm list` — you should see every project's tests enumerated.

For a smoke run, start a Python static server:

```bash
python3 -m http.server 5173 --directory /tmp/stub &
WAREHOUSE_BASE_URL=http://localhost:5173 pnpm test --project=warehouse
```

The first `smoke` spec in each product only asserts a 2xx response, so it will
pass against any HTTP server.

## Bring-up recipes

> The tester never starts products itself. Pick one product to verify a release
> and start it using the recipe below.

- **warehouse** — `cd ../warehouse && docker compose up -d` (see repo README)
- **node** — start Postgres, then `cd ../node && npm install && npm run dev`
- **router** — `cd ../router && cp config.yaml.template config.yaml && go run ./cmd/router`
- **chat** — `cd ../chat && npm install && npm run dev` (Next.js on 3020)
- **social** — `cd ../social/web && npm install && npm run dev`; separately start Spring Boot
- **project** — `cd ../project && cp .env.template .env && ./cmd local-start`
- **knowledge** — `cd ../knowledge && docker compose up -d postgres && uvicorn ...`
- **marketplace** — no service needed (tests read `MARKETPLACE_REPO_PATH`)
- **books** — no service needed (tests read `BOOKS_REPO_PATH`)
- **agent** — `cd ../agent/hub/backend && uv run agent-hub`; `cd ../agent/hub/frontend && pnpm dev`

## Conventions

- Selectors: prefer `getByRole`, `getByLabel`, `getByText`. Hard-coded strings
  only when no semantic hook exists.
- Specs start with a comment naming the env vars they consume.
- Optional vars (LLM keys, wallet keys) cause a `test.skip()` with a clear
  reason when missing.
- All auth helpers live in `shared/auth.ts` as signatures; each product
  implements the strategies it needs in its `pages/`.

## Scheduled test-machine reports

Daily execution, public reports grouped by product, and Feishu notifications
are documented in [docs/test-machine-report.md](docs/test-machine-report.md).
For protected manual runs and main-update triggers on the test machine, see
[docs/test-control.md](docs/test-control.md).

## License

MIT — see `LICENSE`.
