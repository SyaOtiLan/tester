import type { Page } from '@playwright/test';
import { Wallet } from 'ethers';

const SHIM_SOURCE = `
(function () {
  if (window.ethereum && window.ethereum.__E2E_SHIM__) return;
  const ADDRESS = window.__E2E_WALLET_ADDRESS__;
  if (!ADDRESS) throw new Error('wallet address not injected');
  const listeners = {};
  const eth = {
    __E2E_SHIM__: true,
    isYeYing: true,
    isMetaMask: false,
    chainId: '0x1',
    selectedAddress: ADDRESS,
    networkVersion: '1',
    request: async ({ method, params }) => {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [ADDRESS];
        case 'eth_chainId':
          return eth.chainId;
        case 'net_version':
          return '1';
        case 'wallet_requestPermissions':
          return [{ parentCapability: 'eth_accounts', caveats: [], date: Date.now() }];
        case 'personal_sign': {
          const message = Array.isArray(params) ? params[0] : params;
          return await window.__e2e_signPersonal(String(message));
        }
        default:
          return null;
      }
    },
    on: (event, handler) => {
      (listeners[event] = listeners[event] || []).push(handler);
      return eth;
    },
    addListener: (event, handler) => eth.on(event, handler),
    removeListener: (event, handler) => {
      const arr = listeners[event] || [];
      const idx = arr.indexOf(handler);
      if (idx >= 0) arr.splice(idx, 1);
    },
    enable: async () => [ADDRESS],
  };
  window.ethereum = eth;
  window.yeying = eth;
})();
`;

declare global {
  interface Window {
    __E2E_WALLET_ADDRESS__?: string;
    __e2e_signPersonal?: (message: string) => Promise<string>;
  }
}

/** Inject an EIP-1193 provider whose signer stays in the Node test process. */
export async function injectWallet(page: Page, privateKey: string): Promise<string> {
  const wallet = new Wallet(privateKey);
  await page.exposeFunction('__e2e_signPersonal', async (message: string) =>
    wallet.signMessage(message),
  );
  await page.addInitScript({
    content: `window.__E2E_WALLET_ADDRESS__ = ${JSON.stringify(wallet.address)};\n${SHIM_SOURCE}`,
  });
  return wallet.address;
}
