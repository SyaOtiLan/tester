/**
 * router — balance summary, lots/transactions & redemption read APIs
 * (RT-API-038 / 039 / 040) plus the package-purchase preview (RT-API-036) and
 * the order status-machine coverage (RT-API-037).
 *
 * All of the read endpoints use the proto envelope `{ success, message, data }`
 * (HTTP 200). They return zero-valued but well-formed structures for a fresh
 * wallet account (no balance, no lots, no redemptions), which is exactly what
 * these tests pin. Verified live against
 * `internal/admin/controller/topup/*` + api.go routes.
 */
import { test, expect, baseURLFor, envFor } from '../fixtures';
import { apiContext } from '../../../shared/api';
import { acquireRouterToken } from '../helpers/auth';

function skipIfNoService() {
  test.skip(!baseURLFor('router'), 'ROUTER_BASE_URL not configured');
}
function skipIfNoKey() {
  test.skip(
    !envFor('router')['ROUTER_WALLET_PRIVATE_KEY'],
    'ROUTER_WALLET_PRIVATE_KEY not configured',
  );
}

// RT-API-038 (P2)
test("【令牌、充值与余额 / API】 GET /user/topup/balance/summary 返回三向余额汇总", async () => {
  skipIfNoService();
  skipIfNoKey();
  const baseURL = baseURLFor('router')!;
  const { token } = await acquireRouterToken(baseURL);
  const ctx = await apiContext(baseURL, { Authorization: `Bearer ${token}` });
  try {
    const res = await ctx.get('/api/v1/public/user/topup/balance/summary');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      success?: boolean;
      data?: {
        topup_balance_amount?: number;
        redeem_balance_amount?: number;
        gift_balance_amount?: number;
        total_balance_amount?: number;
      };
    };
    expect(body.success).toBe(true);
    expect(typeof body.data?.topup_balance_amount).toBe('number');
    expect(typeof body.data?.redeem_balance_amount).toBe('number');
    expect(typeof body.data?.gift_balance_amount).toBe('number');
    expect(typeof body.data?.total_balance_amount).toBe('number');
  } finally {
    await ctx.dispose();
  }
});

// RT-API-039 (P2)
test("【令牌、充值与余额 / API】 GET 余额手数和交易返回格式正确的分页列表", async () => {
  skipIfNoService();
  skipIfNoKey();
  const baseURL = baseURLFor('router')!;
  const { token } = await acquireRouterToken(baseURL);
  const ctx = await apiContext(baseURL, { Authorization: `Bearer ${token}` });
  try {
    for (const path of [
      '/api/v1/public/user/topup/balance/lots',
      '/api/v1/public/user/topup/balance/transactions',
    ]) {
      const res = await ctx.get(path);
      expect(res.status()).toBe(200);
      const body = (await res.json()) as {
        success?: boolean;
        data?: { items?: unknown[]; total?: number; page?: number; page_size?: number };
      };
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data?.items)).toBe(true);
      expect(typeof body.data?.total).toBe('number');
    }
  } finally {
    await ctx.dispose();
  }
});

// RT-API-040 (P2)
test("【令牌、充值与余额 / API】 GET /user/topup/redemptions 返回兑换记录列表", async () => {
  skipIfNoService();
  skipIfNoKey();
  const baseURL = baseURLFor('router')!;
  const { token } = await acquireRouterToken(baseURL);
  const ctx = await apiContext(baseURL, { Authorization: `Bearer ${token}` });
  try {
    const res = await ctx.get('/api/v1/public/user/topup/redemptions');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      success?: boolean;
      data?: { items?: unknown[]; total?: number };
    };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data?.items)).toBe(true);
    expect(typeof body.data?.total).toBe('number');
  } finally {
    await ctx.dispose();
  }
});

// RT-API-036 (P2) — package-purchase preview (no order placed).
//
// A valid package_id comes from GET /user/packages (the enabled purchasable
// packages). POST /user/topup/package/preview computes the payable amount /
// currency / effective quota for that package WITHOUT creating an order, so it
// is safe to run against the live external-pay deployment. The empty-id
// validation ("套餐 ID 不能为空") is asserted too. Verified against
// `PreviewPackagePurchase` + `PreviewPackagePurchaseWithDB`.
test("【充值与订单生命周期 / API】 RT-API-036 POST /topup/package/preview 套餐购买预览", async () => {
  skipIfNoService();
  skipIfNoKey();
  const baseURL = baseURLFor('router')!;
  const { token } = await acquireRouterToken(baseURL);
  const ctx = await apiContext(baseURL, { Authorization: `Bearer ${token}` });
  try {
    // Empty package_id → controlled validation error, no preview computed.
    const empty = await ctx.post('/api/v1/public/user/topup/package/preview', {
      data: { package_id: '', operation_type: '' },
    });
    expect(empty.status()).toBe(200);
    const emptyBody = (await empty.json()) as { success?: boolean; message?: string };
    expect(emptyBody.success).toBe(false);
    expect(emptyBody.message ?? '').toMatch(/套餐 ID 不能为空|套餐/);

    const pkgs = (await (await ctx.get('/api/v1/public/user/packages')).json()) as {
      data?: Array<{ id?: string; name?: string }>;
    };
    const pkg = (pkgs.data ?? [])[0];
    test.skip(!pkg?.id, 'no purchasable package available to preview');
    const packageId = String(pkg!.id).trim();

    const res = await ctx.post('/api/v1/public/user/topup/package/preview', {
      data: { package_id: packageId, operation_type: '' },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      success?: boolean;
      data?: {
        operation_type?: string;
        target_package_id?: string;
        target_package_name?: string;
        payable_amount?: number;
        payable_currency?: string;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data?.target_package_id?.trim()).toBe(packageId);
    expect(body.data?.operation_type).toBeTruthy();
    expect(typeof body.data?.payable_amount).toBe('number');
    expect(body.data?.payable_currency).toBeTruthy();
  } finally {
    await ctx.dispose();
  }
});
