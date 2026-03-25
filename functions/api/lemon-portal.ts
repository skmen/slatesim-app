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

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'on_trial', 'trialing', 'past_due']);

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
  if (!lemonApiKey || !env.CLERK_SECRET_KEY) {
    return json(
      {
        error: 'Missing Lemon portal server configuration.',
        expected: {
          apiKey: ['LEMON_SQUEEZY_API_STAGING', 'LEMONSQUEEZY_API_STAGING', 'LEMONSQUEEZY_API_KEY'],
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

  const userResp = await clerkFetch(env, `/v1/users/${encodeURIComponent(access.userId)}`, { method: 'GET' });
  if (!userResp.ok) {
    const detail = await parseErrorDetail(userResp);
    return json({ error: `Unable to load user profile: ${detail || userResp.status}` }, 500);
  }

  const clerkUser = await userResp.json().catch(() => null);
  const metadata = clerkUser?.public_metadata && typeof clerkUser.public_metadata === 'object'
    ? clerkUser.public_metadata
    : {};

  const role = String(metadata.role || 'user').toLowerCase();
  const subscriptionStatus = String(
    metadata.subscriptionStatus ??
    metadata.lemonSubscriptionStatus ??
    metadata.billingStatus ??
    '',
  ).toLowerCase();
  const isSubscriber = Boolean(
    role === 'soft-launch' ||
    metadata.softLaunchActive === true ||
    ACTIVE_SUBSCRIPTION_STATUSES.has(subscriptionStatus),
  );
  const isAdmin = role === 'admin';
  if (!isAdmin && !isSubscriber) {
    return json({ error: 'Membership management is only available to subscribed members and admins.' }, 403);
  }

  const subscriptionId = String(metadata.lemonSubscriptionId || '').trim();
  if (!subscriptionId) {
    return json({ error: 'No active Lemon Squeezy subscription found for this account.' }, 400);
  }

  const lemonResp = await fetch(`https://api.lemonsqueezy.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${lemonApiKey}`,
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
    },
  });
  const lemonBody = await lemonResp.json().catch(() => ({}));
  if (!lemonResp.ok) {
    const first = Array.isArray(lemonBody?.errors) ? lemonBody.errors[0] : null;
    const detail = String(first?.detail || first?.title || lemonBody?.error || '').trim();
    return json(
      {
        error: `Unable to load membership portal: ${detail || `Lemon API ${lemonResp.status}`}`,
        upstreamStatus: lemonResp.status,
        apiKeySource: apiKey.source,
      },
      500,
    );
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

  // Fallback: customer object also exposes a pre-signed portal URL.
  if (!portalUrl && customerId) {
    const customerResp = await fetch(`https://api.lemonsqueezy.com/v1/customers/${encodeURIComponent(customerId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${lemonApiKey}`,
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
      },
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

  // Last resort to keep UX functional even when only unsigned URL is provided.
  if (!portalUrl) {
    portalUrl =
      subCustomerPortal ||
      subUpdateCustomerPortal ||
      subUpdatePayment ||
      null;
  }

  if (!portalUrl) {
    return json({ error: 'Membership portal URL missing from Lemon Squeezy response.', apiKeySource: apiKey.source }, 500);
  }

  const isSigned = Boolean(getSignedCandidate(portalUrl));
  return json({
    ok: true,
    url: portalUrl,
    signed: isSigned,
    note: isSigned ? null : 'Portal URL is unsigned; Lemon may require magic-link login.',
    apiKeySource: apiKey.source,
  });
};
