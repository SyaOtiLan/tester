export type ProductName =
  | 'warehouse'
  | 'node'
  | 'router'
  | 'chat'
  | 'social'
  | 'project'
  | 'knowledge'
  | 'marketplace'
  | 'books'
  | 'orchestrator'
  | 'wallet';

export const PRODUCT_NAMES: readonly ProductName[] = [
  'warehouse',
  'node',
  'router',
  'chat',
  'social',
  'project',
  'knowledge',
  'marketplace',
  'books',
  'orchestrator',
  'wallet',
] as const;

/** Per-product baseURL env-var key. */
export function baseURLKey(product: ProductName): string {
  return `${product.toUpperCase()}_BASE_URL`;
}

/** Marker used to flag a helper that is intentionally not implemented for a product. */
export class NotImplementedForProduct extends Error {
  constructor(product: ProductName, helper: string) {
    super(`Helper "${helper}" is not implemented for product "${product}".`);
    this.name = 'NotImplementedForProduct';
  }
}
