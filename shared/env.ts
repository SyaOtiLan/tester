import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { PRODUCT_NAMES, type ProductName, baseURLKey as _baseURLKey } from './types';

// Re-export so scripts/ can use it without importing types.ts.
export const baseURLKey = _baseURLKey;

/**
 * Environment selection for local vs. test vs. production config.
 *
 * The `TEST_ENV` variable picks which `.env.<env>` file is loaded:
 *
 *   TEST_ENV=local  npx playwright test --project=wallet   → .env.local
 *   TEST_ENV=test   npx playwright test --project=wallet   → .env.test
 *   TEST_ENV=prod   npx playwright test --project=wallet   → .env.prod
 *
 * Rules:
 *   - If TEST_ENV is set, EXACTLY that file is loaded; a missing file is a
 *     hard error (so you never silently run against the wrong config).
 *   - If TEST_ENV is unset, we cascade: the first of .env.local → .env.test →
 *     .env.prod that exists wins. None existing is fine (CI sets vars directly).
 *
 * Only one file is ever loaded — this is a selection model, not layering.
 */
export const KNOWN_TEST_ENVS = ['local', 'test', 'prod'] as const;
export type TestEnv = (typeof KNOWN_TEST_ENVS)[number];

function envFilePath(env: TestEnv): string {
  return resolve(process.cwd(), `.env.${env}`);
}

function loadTestEnv(): { env: TestEnv | null; path: string | null } {
  const requested = process.env.TEST_ENV?.trim().toLowerCase();
  if (requested) {
    if (!(KNOWN_TEST_ENVS as readonly string[]).includes(requested)) {
      throw new Error(
        `Invalid TEST_ENV="${requested}". Expected one of: ${KNOWN_TEST_ENVS.join(', ')}.`,
      );
    }
    const env = requested as TestEnv;
    const path = envFilePath(env);
    if (!existsSync(path)) {
      throw new Error(
        `TEST_ENV="${env}" was specified but ${path} does not exist. ` +
          `Create it, or unset TEST_ENV to fall back to the default cascade ` +
          `(${KNOWN_TEST_ENVS.map((e) => `.env.${e}`).join(' → ')}).`,
      );
    }
    loadDotenv({ path, quiet: true });
    return { env, path };
  }
  // Default cascade: first existing file wins.
  for (const env of KNOWN_TEST_ENVS) {
    const path = envFilePath(env);
    if (existsSync(path)) {
      loadDotenv({ path, quiet: true });
      return { env, path };
    }
  }
  // Nothing on disk — fine; CI / the shell may set vars directly.
  return { env: null, path: null };
}

const loaded = loadTestEnv();

/** The environment whose `.env.<env>` file was loaded, or null if none. */
export const activeTestEnv: TestEnv | null = loaded.env;
/** Absolute path of the loaded env file, or null if none was found. */
export const activeEnvFilePath: string | null = loaded.path;

/**
 * Per-product env contract. Only the base URL is required for most products; the
 * other keys are optional and consumed only by specific specs.
 */
export interface ProductEnv {
  name: ProductName;
  baseURL: string | undefined;
  apiURL?: string;
  authToken?: string;
  [extra: string]: string | undefined;
}

const EXTRA_KEYS: Record<ProductName, string[]> = {
  warehouse: [
    'WAREHOUSE_ADMIN_URL',
    'WAREHOUSE_WEBDAV_URL',
    'WAREHOUSE_WEBDAV_PREFIX',
    'WAREHOUSE_USER',
    'WAREHOUSE_PASS',
    'WAREHOUSE_AUTH_TOKEN',
    'WAREHOUSE_WALLET_PRIVATE_KEY',
    'WAREHOUSE_EXPECTED_ADDRESS',
  ],
  node: [
    'NODE_API_URL',
    'NODE_WALLET_PRIVATE_KEY',
    'NODE_EXPECTED_ADDRESS',
    // Host the node service dials back for the generic-webhook delivery loop.
    // Defaults to 127.0.0.1 (node running on the same machine as the tester).
    'NODE_CALLBACK_HOST',
    // Optional real bot endpoints for DingTalk/Feishu delivery specs. Absent =
    // those specs skip. URL must be on the platform allowlist (oapi.dingtalk.com
    // / open.feishu.cn) and the secret is the bot's signing secret (加签).
    'NODE_DINGTALK_WEBHOOK_URL',
    'NODE_DINGTALK_WEBHOOK_SECRET',
    'NODE_FEISHU_WEBHOOK_URL',
    'NODE_FEISHU_WEBHOOK_SECRET',
  ],
  router: [
    'ROUTER_WALLET_PRIVATE_KEY',
    'ROUTER_EXPECTED_ADDRESS',
    // Admin/root wallet (must be in the deployment's bootstrap.root_wallet_address).
    // Consumed by the channel/provider admin specs via acquireAdminToken.
    'ROUTER_ADMIN_PRIVATE_KEY',
    'ROUTER_ADMIN_EXPECTED_ADDRESS',
    // Personal-provider (BYOK) upstream used by personal-provider routing specs.
    'ROUTER_PERSONAL_UPSTREAM_BASE_URL',
    'ROUTER_PERSONAL_UPSTREAM_KEY',
    'ROUTER_PERSONAL_UPSTREAM_MODEL',
  ],
  chat: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
  social: [
    'SOCIAL_USER',
    'SOCIAL_PASS',
    /**
     * URL of the Vue 3 SPA that fronts the social backend. Defaults to
     * 8082 in the standard dev layout. `SOCIAL_BASE_URL` points to the
     * Spring Boot backend (8888) for actuator / API tests; SPA tests
     * need `SOCIAL_WEB_URL` instead.
     */
    'SOCIAL_WEB_URL',
    /**
     * URL of the web3-identity SIWE service (8901). Its SIWE endpoints
     * (`/auth/siwe/nonce`, `/auth/siwe/verify`) are only reachable there
     * directly — the platform gateway on 8888 returns 500 for them.
     */
    'SOCIAL_IDENTITY_URL',
  ],
  project: ['APP_DEV_PORT', 'PROJECT_USER', 'PROJECT_PASS'],
  knowledge: ['KNOWLEDGE_API_URL'],
  marketplace: ['MARKETPLACE_BASE_URL', 'MARKETPLACE_REPO_PATH'],
  books: ['BOOKS_BASE_URL', 'BOOKS_REPO_PATH'],
  agent: ['AGENT_API_URL', 'AGENT_PRIVATE_KEY'],
  /**
   * Wallet is a Chromium MV3 extension, not a web app — it has no
   * `_BASE_URL`. Instead, specs need the path to the extension's source
   * directory (containing manifest.json + inject.js + …). Prefer
   * `WALLET_EXTENSION_PATH` if set; otherwise fall back to
   * `WALLET_REPO_PATH` so the convention matches marketplace/books.
   */
  wallet: ['WALLET_EXTENSION_PATH', 'WALLET_REPO_PATH'],
};

/** Return the base URL for a product, or undefined if not configured. */
export function baseURLFor(product: ProductName): string | undefined {
  return process.env[baseURLKey(product)]?.trim() || undefined;
}

export function hasEnv(name: string): boolean {
  const v = process.env[name];
  return typeof v === 'string' && v.trim().length > 0;
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new Error(`Required environment variable "${name}" is not set.`);
  }
  return v;
}

/** Load all known env values for a product into a structured object. */
export function envFor(product: ProductName): ProductEnv {
  const env: ProductEnv = {
    name: product,
    baseURL: baseURLFor(product),
  };
  for (const key of EXTRA_KEYS[product]) {
    env[key] = process.env[key];
  }
  return env;
}

/** Snapshot the env for a single product, or for all if `product` is omitted. */
export function loadEnv(product?: ProductName): ProductEnv | Record<ProductName, ProductEnv> {
  if (product) {
    return envFor(product);
  }
  return Object.fromEntries(PRODUCT_NAMES.map((p) => [p, envFor(p)])) as Record<
    ProductName,
    ProductEnv
  >;
}

/**
 * Try to read a value from `process.env` first, then from a `.env` file at the
 * given path. Used by scripts/check-env.ts to detect misconfigured variables
 * even when dotenv hasn't been loaded yet.
 */
export function readEnvFile(path: string, key: string): string | undefined {
  try {
    const raw = readFileSync(path, 'utf8');
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[1] === key) {
        const value = m[2] ?? '';
        const trimmed = value.trim();
        if (
          (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
          (trimmed.startsWith("'") && trimmed.endsWith("'"))
        ) {
          return trimmed.slice(1, -1);
        }
        return trimmed;
      }
    }
  } catch {
    // file missing or unreadable
  }
  return undefined;
}
