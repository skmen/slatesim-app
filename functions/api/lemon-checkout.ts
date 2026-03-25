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

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return json({}, 204);
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

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

  const baseUrl = (env.APP_BASE_URL || new URL(request.url).origin).replace(/\/$/, '');
  const redirectUrl = `${baseUrl}/?checkout=success`;

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

  try {
    const resp = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${lemonApiKey}`,
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
      },
      body: JSON.stringify(payload),
    });

    const result = await resp.json().catch(() => ({}));
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
      return json({ error: `Unable to create checkout session: ${details}` }, 502);
    }

    const checkoutUrl = result?.data?.attributes?.url;
    if (!checkoutUrl) {
      return json({ error: 'Checkout URL missing in Lemon Squeezy response.' }, 502);
    }

    return json({ ok: true, url: checkoutUrl });
  } catch (error: any) {
    console.error('[lemon-checkout] unexpected error:', error?.message || error);
    const message = String(error?.message || 'unknown');
    return json({ error: `Unexpected checkout error: ${message}` }, 500);
  }
};
