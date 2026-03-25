type PagesFunction<Env = any> = (context: {
  request: Request;
  env: Env;
  params: any;
  waitUntil: (promise: Promise<any>) => void;
  next: (request?: Request | string) => Promise<Response>;
  functionPath: string;
  data: Record<string, unknown>;
}) => Response | Promise<Response>;

interface Env {
  LEMONSQUEEZY_API_KEY?: string;
  LEMON_SQUEEZY_API_STAGING?: string;
  LEMONSQUEEZY_API_STAGING?: string;
  LEMONSQUEEZY_STORE_ID?: string;
  LEMON_SQUEEZY_STORE_ID?: string;
  LEMONSQUEEZY_SOFT_LAUNCH_VARIANT_ID?: string;
  LEMON_SQUEEZY_SOFT_LAUNCH_VARIANT_ID?: string;
  LEMONSQUEEZY_VARIANT_ID?: string;
  LEMON_SQUEEZY_VARIANT_ID?: string;
  APP_BASE_URL?: string;
}

interface CheckoutRequestBody {
  clerkUserId?: string;
  email?: string;
  name?: string;
}

const json = (payload: Record<string, any>, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });

const normalizeBaseUrl = (input: string, fallbackOrigin: string): string => {
  const raw = String(input || '').trim();
  if (!raw) return fallbackOrigin.replace(/\/$/, '');

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).origin.replace(/\/$/, '');
  } catch {
    return fallbackOrigin.replace(/\/$/, '');
  }
};

const summarizeLemonResponse = async (resp: Response): Promise<{ status: number; ok: boolean; detail: string | null }> => {
  const raw = await resp.text().catch(() => '');
  let payload: any = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }

  const firstError = Array.isArray(payload?.errors) ? payload.errors[0] : null;
  const detail = String(
    [
      firstError?.title,
      firstError?.detail,
      typeof payload?.error === 'string' ? payload.error : '',
    ]
      .filter(Boolean)
      .join(' - '),
  ).trim();

  return {
    status: resp.status,
    ok: resp.ok,
    detail: detail || null,
  };
};

const parseLemonBody = async (resp: Response): Promise<any> => {
  const raw = await resp.text().catch(() => '');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  let stage = 'start';
  try {
    if (request.method === 'OPTIONS') return json({}, 204);
    if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

    stage = 'resolve_config';
    const resolve = (...values: Array<string | undefined>): string =>
      String(values.find((v) => String(v || '').trim().length > 0) || '').trim();

    const lemonApiKey = String(
      env.LEMONSQUEEZY_API_KEY ||
      env.LEMON_SQUEEZY_API_STAGING ||
      env.LEMONSQUEEZY_API_STAGING ||
      '',
    ).trim();
    const storeId = resolve(env.LEMONSQUEEZY_STORE_ID, env.LEMON_SQUEEZY_STORE_ID);
    const variantId = resolve(
      env.LEMONSQUEEZY_SOFT_LAUNCH_VARIANT_ID,
      env.LEMON_SQUEEZY_SOFT_LAUNCH_VARIANT_ID,
      env.LEMONSQUEEZY_VARIANT_ID,
      env.LEMON_SQUEEZY_VARIANT_ID,
    );

    const missing: string[] = [];
    if (!lemonApiKey) missing.push('apiKey');
    if (!storeId) missing.push('storeId');
    if (!variantId) missing.push('variantId');
    if (missing.length > 0) {
      return json(
        {
          error: 'Missing Lemon Squeezy server configuration.',
          missing,
          expected: {
            apiKey: ['LEMONSQUEEZY_API_KEY', 'LEMON_SQUEEZY_API_STAGING', 'LEMONSQUEEZY_API_STAGING'],
            storeId: ['LEMONSQUEEZY_STORE_ID', 'LEMON_SQUEEZY_STORE_ID'],
            variantId: [
              'LEMONSQUEEZY_SOFT_LAUNCH_VARIANT_ID',
              'LEMON_SQUEEZY_SOFT_LAUNCH_VARIANT_ID',
              'LEMONSQUEEZY_VARIANT_ID',
              'LEMON_SQUEEZY_VARIANT_ID',
            ],
          },
        },
        500,
      );
    }

    stage = 'parse_body';
    let body: CheckoutRequestBody = {};
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body.' }, 400);
    }

    const clerkUserId = String(body.clerkUserId || '').trim();
    const email = String(body.email || '').trim();
    const name = String(body.name || '').trim();
    if (!clerkUserId || !email) {
      return json({ error: 'Missing required user fields.' }, 400);
    }

    stage = 'build_payload';
    const requestOrigin = new URL(request.url).origin;
    const baseUrl = normalizeBaseUrl(env.APP_BASE_URL || requestOrigin, requestOrigin);
    const redirectUrl = `${baseUrl}/?checkout=success`;
    const requestUrl = new URL(request.url);

    const payload = {
      data: {
        type: 'checkouts',
        attributes: {
          checkout_options: {
            embed: false,
            media: true,
            logo: true,
          },
          checkout_data: {
            email,
            name: name || email,
            custom: {
              clerk_user_id: clerkUserId,
              plan: 'soft-launch',
            },
          },
          product_options: {
            redirect_url: redirectUrl,
          },
        },
        relationships: {
          store: {
            data: {
              type: 'stores',
              id: storeId,
            },
          },
          variant: {
            data: {
              type: 'variants',
              id: variantId,
            },
          },
        },
      },
    };

    stage = 'dry_run_check';
    const dryRun = requestUrl.searchParams.get('dry') === '1' || request.headers.get('x-lemon-dry-run') === '1';
    if (dryRun) {
      return json({
        ok: true,
        dryRun: true,
        stage,
        config: {
          hasApiKey: lemonApiKey.length > 0,
          storeId,
          variantId,
          baseUrl,
          redirectUrl,
        },
      });
    }

    stage = 'resource_probe';
    const probe = requestUrl.searchParams.get('probe') === '1' || request.headers.get('x-lemon-probe') === '1';
    if (probe) {
      const headers = {
        Authorization: `Bearer ${lemonApiKey}`,
        Accept: 'application/vnd.api+json',
      };
      const [storeResp, variantResp] = await Promise.all([
        fetch(`https://api.lemonsqueezy.com/v1/stores/${encodeURIComponent(storeId)}`, { method: 'GET', headers }),
        fetch(`https://api.lemonsqueezy.com/v1/variants/${encodeURIComponent(variantId)}`, { method: 'GET', headers }),
      ]);

      const storeBody = await parseLemonBody(storeResp.clone());
      const variantBody = await parseLemonBody(variantResp.clone());
      const store = await summarizeLemonResponse(storeResp);
      const variant = await summarizeLemonResponse(variantResp);

      const variantProductId = String(variantBody?.data?.attributes?.product_id || '').trim() || null;
      let product: { status: number; ok: boolean; detail: string | null; productId: string | null; storeId: string | null } | null = null;
      if (variantProductId) {
        const productResp = await fetch(
          `https://api.lemonsqueezy.com/v1/products/${encodeURIComponent(variantProductId)}`,
          { method: 'GET', headers },
        );
        const productBody = await parseLemonBody(productResp.clone());
        const productSummary = await summarizeLemonResponse(productResp);
        product = {
          ...productSummary,
          productId: String(productBody?.data?.id || '').trim() || null,
          storeId: String(productBody?.data?.attributes?.store_id || '').trim() || null,
        };
      }

      return json({
        ok: store.ok && variant.ok,
        probe: true,
        storeId,
        variantId,
        store,
        variant,
        resolved: {
          storeIdFromApi: String(storeBody?.data?.id || '').trim() || null,
          variantIdFromApi: String(variantBody?.data?.id || '').trim() || null,
          variantProductId,
          product,
          variantBelongsToStore: product?.storeId ? String(product.storeId) === String(storeId) : null,
        },
      });
    }

    stage = 'create_checkout';
    const controller = new AbortController();
    const timeoutMs = 12000;
    const timer = setTimeout(() => controller.abort('lemon-timeout'), timeoutMs);
    let resp: Response;
    try {
      resp = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${lemonApiKey}`,
          Accept: 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (fetchError: any) {
      const reason = String(fetchError?.message || fetchError || 'unknown');
      const isAbort = fetchError?.name === 'AbortError';
      return json(
        {
          error: isAbort
            ? `Lemon API timeout after ${timeoutMs}ms`
            : `Lemon API network error: ${reason}`,
          stage,
        },
        500,
      );
    } finally {
      clearTimeout(timer);
    }

    stage = 'parse_checkout_response';
    const rawResult = await resp.text().catch(() => '');
    let result: any = {};
    try {
      result = rawResult ? JSON.parse(rawResult) : {};
    } catch {
      result = {};
    }

    if (!resp.ok) {
      const firstError = Array.isArray(result?.errors) ? result.errors[0] : null;
      const detailText = String(
        [
          firstError?.title,
          firstError?.detail,
          typeof result?.error === 'string' ? result.error : '',
        ]
          .filter(Boolean)
          .join(' - '),
      ).trim();
      const details = detailText || `Lemon Squeezy request failed (${resp.status})`;
      console.error('[lemon-checkout] failed:', details);
      return json({ error: `Unable to create checkout session: ${details}`, stage, upstreamStatus: resp.status }, 500);
    }

    stage = 'extract_checkout_url';
    const checkoutUrl = result?.data?.attributes?.url;
    if (!checkoutUrl) {
      return json({ error: 'Checkout URL missing in Lemon Squeezy response.', stage }, 500);
    }

    return json({ ok: true, url: checkoutUrl });
  } catch (error: any) {
    console.error('[lemon-checkout] unexpected error', {
      stage,
      message: error?.message || String(error),
      stack: error?.stack || null,
    });
    const message = String(error?.message || 'unknown');
    return json({ error: `Unexpected checkout error at ${stage}: ${message}` }, 500);
  }
};
