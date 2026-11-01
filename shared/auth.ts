/**
 * Auth helper signatures.
 *
 * IMPORTANT: this module deliberately exposes thin signatures, NOT a single
 * abstraction. The YeYing community products use wildly different auth
 * strategies (Basic/JWT/UCAN for warehouse; SIWE/WebAuthn for node;
 * username/password for social; wallet signatures for chat/orchestrator/project).
 * Each product's `pages/<role>.page.ts` implements only the strategies it
 * needs. Do not add a base class or factory here — keep helpers honest.
 */

import type { BrowserContext, Page } from '@playwright/test';
import { NotImplementedForProduct } from './types';

export interface PasswordLoginOptions {
  /** Login URL (absolute or relative to baseURL). */
  url: string;
  username: string;
  password: string;
}

export interface SIWELoginOptions {
  url: string;
  /** Hex-encoded private key for the wallet that signs the SIWE message. */
  privateKey: string;
}

export interface UCANLoginOptions {
  url: string;
  /** Pre-issued UCAN token to inject as a cookie or header. */
  token: string;
}

export interface WalletLoginOptions {
  url: string;
  /** BIP-39 mnemonic (12 or 24 words) used to derive the wallet. */
  mnemonic: string;
}

export async function loginWithPassword(
  _page: Page,
  _productName: string,
  _options: PasswordLoginOptions,
): Promise<void> {
  throw new NotImplementedForProduct(_productName as never, 'loginWithPassword');
}

export async function loginWithSIWE(
  _page: Page,
  _productName: string,
  _options: SIWELoginOptions,
): Promise<void> {
  throw new NotImplementedForProduct(_productName as never, 'loginWithSIWE');
}

export async function loginWithUCAN(
  _page: Page,
  _productName: string,
  _options: UCANLoginOptions,
): Promise<void> {
  throw new NotImplementedForProduct(_productName as never, 'loginWithUCAN');
}

export async function loginWithWeb3Wallet(
  _page: Page,
  _productName: string,
  _options: WalletLoginOptions,
): Promise<void> {
  throw new NotImplementedForProduct(_productName as never, 'loginWithWeb3Wallet');
}

/** Inject a bearer token as an Authorization header for the whole context. */
export async function setBearerCookie(
  context: BrowserContext,
  token: string,
  cookieName = 'authorization',
): Promise<void> {
  await context.addCookies([
    {
      name: cookieName,
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}
