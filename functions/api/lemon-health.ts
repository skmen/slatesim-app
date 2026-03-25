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
  LEMONSQUEEZY_WEBHOOK_SECRET?: string;
  CLERK_SECRET_KEY?: string;
  APP_BASE_URL?: string;
}

const json = (payload: Record<string, any>, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });

const present = (value?: string): boolean => String(value || '').trim().length > 0;

const resolveWithSource = (pairs: Array<[string, string | undefined]>): { value: string; source: string | null } => {
  for (const [name, value] of pairs) {
    const trimmed = String(value || '').trim();
    if (trimmed.length > 0) return { value: trimmed, source: name };
  }
  return { value: '', source: null };
};

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return json({}, 204);
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);

  const apiKey = resolveWithSource([
    ['LEMON_SQUEEZY_API_STAGING', env.LEMON_SQUEEZY_API_STAGING],
    ['LEMONSQUEEZY_API_STAGING', env.LEMONSQUEEZY_API_STAGING],
    ['LEMONSQUEEZY_API_KEY', env.LEMONSQUEEZY_API_KEY],
  ]);
  const storeId = resolveWithSource([
    ['LEMONSQUEEZY_STORE_ID', env.LEMONSQUEEZY_STORE_ID],
    ['LEMON_SQUEEZY_STORE_ID', env.LEMON_SQUEEZY_STORE_ID],
  ]);
  const variantId = resolveWithSource([
    ['LEMONSQUEEZY_SOFT_LAUNCH_VARIANT_ID', env.LEMONSQUEEZY_SOFT_LAUNCH_VARIANT_ID],
    ['LEMON_SQUEEZY_SOFT_LAUNCH_VARIANT_ID', env.LEMON_SQUEEZY_SOFT_LAUNCH_VARIANT_ID],
    ['LEMONSQUEEZY_VARIANT_ID', env.LEMONSQUEEZY_VARIANT_ID],
    ['LEMON_SQUEEZY_VARIANT_ID', env.LEMON_SQUEEZY_VARIANT_ID],
  ]);

  const checks = {
    apiKeyPresent: present(apiKey.value),
    apiKeySource: apiKey.source,
    storeIdPresent: present(storeId.value),
    storeIdSource: storeId.source,
    variantIdPresent: present(variantId.value),
    variantIdSource: variantId.source,
    webhookSecretPresent: present(env.LEMONSQUEEZY_WEBHOOK_SECRET),
    clerkSecretPresent: present(env.CLERK_SECRET_KEY),
    appBaseUrlPresent: present(env.APP_BASE_URL),
  };

  const missing: string[] = [];
  if (!checks.apiKeyPresent) missing.push('apiKey');
  if (!checks.storeIdPresent) missing.push('storeId');
  if (!checks.variantIdPresent) missing.push('variantId');
  if (!checks.webhookSecretPresent) missing.push('webhookSecret');
  if (!checks.clerkSecretPresent) missing.push('clerkSecret');

  return json({
    ok: missing.length === 0,
    missing,
    checks,
    expected: {
      apiKey: ['LEMON_SQUEEZY_API_STAGING', 'LEMONSQUEEZY_API_STAGING', 'LEMONSQUEEZY_API_KEY'],
      storeId: ['LEMONSQUEEZY_STORE_ID', 'LEMON_SQUEEZY_STORE_ID'],
      variantId: [
        'LEMONSQUEEZY_SOFT_LAUNCH_VARIANT_ID',
        'LEMON_SQUEEZY_SOFT_LAUNCH_VARIANT_ID',
        'LEMONSQUEEZY_VARIANT_ID',
        'LEMON_SQUEEZY_VARIANT_ID',
      ],
      webhookSecret: ['LEMONSQUEEZY_WEBHOOK_SECRET'],
      clerkSecret: ['CLERK_SECRET_KEY'],
      appBaseUrl: ['APP_BASE_URL (recommended)'],
    },
  });
};
