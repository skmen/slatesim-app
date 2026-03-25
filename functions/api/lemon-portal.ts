import { resolveAccessContext } from './_access.js';

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
  CLERK_SECRET_KEY?: string;
}

const LEMON_ORDERS_LOGIN_URL = 'https://app.lemonsqueezy.com/my-orders/login';

const json = (payload: Record<string, any>, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });

const resolveWithSource = (pairs: Array<[string, string | undefined]>): { value: string; source: string | null } => {
  for (const [name, value] of pairs) {
    const trimmed = String(value || '').trim();
    if (trimmed.length > 0) return { value: trimmed, source: name };
  }
  return { value: '', source: null };
};

const clerkFetch = async (env: Env, path: string, init?: RequestInit): Promise<Response> => {
  return fetch(`https://api.clerk.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.CLERK_SECRET_KEY}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
};

const parseErrorDetail = async (resp: Response): Promise<string> => {
  const raw = await resp.text().catch(() => '');
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    const first = Array.isArray(parsed?.errors) ? parsed.errors[0] : null;
    return String(first?.detail || first?.title || parsed?.error || '').trim() || raw;
  } catch {
    return raw;
  }
};

const getSignedCandidate = (url: string | null): string | null => {
  const raw = String(url || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const hasSignature = parsed.searchParams.has('signature');
    const hasExpiry = parsed.searchParams.has('expires');
    if (hasSignature && hasExpiry) return parsed.toString();
    return null;
  } catch {
    return null;
  }
};

const getAnyCandidate = (url: string | null): string | null => {
  const raw = String(url || '').trim();
  return raw.length > 0 ? raw : null;
};

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return json({}, 204);
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  const apiKey = resolveWithSource([
    ['LEMON_SQUEEZY_API_STAGING', env.LEMON_SQUEEZY_API_STAGING],
    ['LEMONSQUEEZY_API_STAGING', env.LEMONSQUEEZY_API_STAGING],
    ['LEMONSQUEEZY_API_KEY', env.LEMONSQUEEZY_API_KEY],
  ]);
  const lemonApiKey = apiKey.value;

  if (!env.CLERK_SECRET_KEY) {
    return json(
      {
        error: 'Missing Lemon portal server configuration.',
        expected: {
          clerkSecret: ['CLERK_SECRET_KEY'],
        },
      },
      500,
    );
  }

  const access = await resolveAccessContext(request, env as any);
  if (!access?.authenticated || !access?.userId) {
    return json({ error: 'Unauthorized.' }, 401);
  }

  const role = String(access.role || 'user').toLowerCase();
  const isSubscriber = Boolean(access.paid || role === 'soft-launch' || role === 'beta-user');
  const isAdmin = role === 'admin';
  if (!isAdmin && !isSubscriber) {
    return json({ error: 'Membership management is only available to subscribed members and admins.' }, 403);
  }

  // If we cannot call Lemon API, use the generic login portal.
  if (!lemonApiKey) {
    return json({
      ok: true,
      url: LEMON_ORDERS_LOGIN_URL,
      signed: false,
      fallback: true,
      note: 'Lemon API key is unavailable, falling back to Lemon Orders login.',
      apiKeySource: null,
    });
  }

  const userResp = await clerkFetch(env, `/v1/users/${encodeURIComponent(access.userId)}`, { method: 'GET' });
  if (!userResp.ok) {
    const detail = await parseErrorDetail(userResp);
    return json({ error: `Unable to load user profile: ${detail || userResp.status}` }, 500);
  }
  const clerkUser = await userResp.json().catch(() => null);
  const metadata = clerkUser?.public_metadata && typeof clerkUser.public_metadata === 'object'
    ? clerkUser.public_metadata
    : {};
  const subscriptionId = String(metadata.lemonSubscriptionId || '').trim();

  if (!subscriptionId) {
    return json({
      ok: true,
      url: LEMON_ORDERS_LOGIN_URL,
      signed: false,
      fallback: true,
      note: 'No Lemon subscription id found on user metadata, using Lemon Orders login.',
      apiKeySource: apiKey.source,
    });
  }

  const lemonHeaders = {
    Authorization: `Bearer ${lemonApiKey}`,
    Accept: 'application/vnd.api+json',
    'Content-Type': 'application/vnd.api+json',
  };

  const lemonResp = await fetch(`https://api.lemonsqueezy.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'GET',
    headers: lemonHeaders,
  });
  const lemonBody = await lemonResp.json().catch(() => ({}));
  if (!lemonResp.ok) {
    const first = Array.isArray(lemonBody?.errors) ? lemonBody.errors[0] : null;
    const detail = String(first?.detail || first?.title || lemonBody?.error || '').trim();
    return json({
      ok: true,
      url: LEMON_ORDERS_LOGIN_URL,
      signed: false,
      fallback: true,
      note: `Unable to load subscription portal link; using Lemon Orders login. ${detail || `Lemon API ${lemonResp.status}`}`,
      upstreamStatus: lemonResp.status,
      apiKeySource: apiKey.source,
    });
  }

  const attrs = lemonBody?.data?.attributes || {};
  const subUrls = attrs?.urls || {};
  const customerId = String(attrs?.customer_id || '').trim();

  const subCustomerPortal = getAnyCandidate(subUrls?.customer_portal || null);
  const subUpdateCustomerPortal = getAnyCandidate(subUrls?.update_customer_portal || null);
  const subUpdatePayment = getAnyCandidate(subUrls?.update_payment_method || null);

  let portalUrl =
    getSignedCandidate(subUrls?.customer_portal || null) ||
    getSignedCandidate(subUrls?.update_customer_portal || null) ||
    getSignedCandidate(subUrls?.update_payment_method || null) ||
    null;

  // Fallback: customer object can also expose a portal URL.
  if (!portalUrl && customerId) {
    const customerResp = await fetch(`https://api.lemonsqueezy.com/v1/customers/${encodeURIComponent(customerId)}`, {
      method: 'GET',
      headers: lemonHeaders,
    });
    const customerBody = await customerResp.json().catch(() => ({}));
    if (customerResp.ok) {
      const customerUrls = customerBody?.data?.attributes?.urls || {};
      portalUrl =
        getSignedCandidate(customerUrls?.customer_portal || null) ||
        getSignedCandidate(customerUrls?.update_payment_method || null) ||
        null;
      if (!portalUrl) {
        portalUrl =
          getAnyCandidate(customerUrls?.customer_portal || null) ||
          getAnyCandidate(customerUrls?.update_payment_method || null) ||
          null;
      }
    }
  }

  if (!portalUrl) {
    portalUrl =
      subCustomerPortal ||
      subUpdateCustomerPortal ||
      subUpdatePayment ||
      LEMON_ORDERS_LOGIN_URL;
  }

  const signed = Boolean(getSignedCandidate(portalUrl));
  return json({
    ok: true,
    url: portalUrl,
    signed,
    fallback: portalUrl === LEMON_ORDERS_LOGIN_URL,
    note: signed ? null : 'Portal URL is unsigned; Lemon may require login/magic link.',
    apiKeySource: apiKey.source,
  });
};
