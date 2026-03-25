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
  LEMONSQUEEZY_STORE_ID?: string;
  LEMON_SQUEEZY_STORE_ID?: string;
  LEMONSQUEEZY_SOFT_LAUNCH_VARIANT_ID?: string;
  LEMON_SQUEEZY_SOFT_LAUNCH_VARIANT_ID?: string;
  LEMONSQUEEZY_VARIANT_ID?: string;
  LEMON_SQUEEZY_VARIANT_ID?: string;
  CLERK_SECRET_KEY?: string;
}

const ACTIVE_STATUSES = new Set(['active', 'on_trial', 'trialing', 'past_due']);

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

const parseJsonSafe = async (resp: Response): Promise<any> => {
  const raw = await resp.text().catch(() => '');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const getUserEmails = (clerkUser: any): string[] => {
  const out = new Set<string>();
  const add = (value: any) => {
    const email = String(value || '').trim().toLowerCase();
    if (email) out.add(email);
  };
  add(clerkUser?.email_address);
  add(clerkUser?.primary_email_address?.email_address);
  if (Array.isArray(clerkUser?.email_addresses)) {
    clerkUser.email_addresses.forEach((entry: any) => add(entry?.email_address));
  }
  return Array.from(out);
};

const pickBestActiveSubscription = (subs: any[], preferredVariantId: string | null): any | null => {
  const active = subs.filter((sub) => {
    const status = String(sub?.attributes?.status || '').toLowerCase();
    return ACTIVE_STATUSES.has(status);
  });
  if (active.length === 0) return null;

  if (preferredVariantId) {
    const preferred = active.find((sub) => String(sub?.attributes?.variant_id || '').trim() === preferredVariantId);
    if (preferred) return preferred;
  }

  return active[0];
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
    return json({
      error: 'Missing lemon sync server configuration.',
      expected: {
        apiKey: ['LEMON_SQUEEZY_API_STAGING', 'LEMONSQUEEZY_API_STAGING', 'LEMONSQUEEZY_API_KEY'],
        clerkSecret: ['CLERK_SECRET_KEY'],
      },
    }, 500);
  }

  const access = await resolveAccessContext(request, env as any);
  if (!access?.authenticated || !access?.userId) {
    return json({ error: 'Unauthorized.' }, 401);
  }

  const storeId = resolveWithSource([
    ['LEMONSQUEEZY_STORE_ID', env.LEMONSQUEEZY_STORE_ID],
    ['LEMON_SQUEEZY_STORE_ID', env.LEMON_SQUEEZY_STORE_ID],
  ]).value || null;
  const preferredVariantId = resolveWithSource([
    ['LEMONSQUEEZY_SOFT_LAUNCH_VARIANT_ID', env.LEMONSQUEEZY_SOFT_LAUNCH_VARIANT_ID],
    ['LEMON_SQUEEZY_SOFT_LAUNCH_VARIANT_ID', env.LEMON_SQUEEZY_SOFT_LAUNCH_VARIANT_ID],
    ['LEMONSQUEEZY_VARIANT_ID', env.LEMONSQUEEZY_VARIANT_ID],
    ['LEMON_SQUEEZY_VARIANT_ID', env.LEMON_SQUEEZY_VARIANT_ID],
  ]).value || null;

  const userResp = await clerkFetch(env, `/v1/users/${encodeURIComponent(access.userId)}`, { method: 'GET' });
  if (!userResp.ok) {
    return json({ error: 'Unable to load Clerk user profile.' }, 500);
  }
  const clerkUser = await parseJsonSafe(userResp);
  const emails = getUserEmails(clerkUser);
  if (emails.length === 0) {
    return json({ ok: true, synced: false, reason: 'No email address available on user profile.' });
  }

  const headers = {
    Authorization: `Bearer ${lemonApiKey}`,
    Accept: 'application/vnd.api+json',
    'Content-Type': 'application/vnd.api+json',
  };

  const allSubs: any[] = [];
  for (const email of emails) {
    const query = new URLSearchParams();
    query.set('filter[user_email]', email);
    if (storeId) query.set('filter[store_id]', storeId);
    query.set('page[size]', '100');

    const resp = await fetch(`https://api.lemonsqueezy.com/v1/subscriptions?${query.toString()}`, {
      method: 'GET',
      headers,
    });
    const body = await parseJsonSafe(resp);
    if (!resp.ok) continue;
    if (Array.isArray(body?.data)) allSubs.push(...body.data);
  }

  const best = pickBestActiveSubscription(allSubs, preferredVariantId);
  if (!best) {
    return json({
      ok: true,
      synced: false,
      reason: 'No active subscription found in Lemon Squeezy for this user email.',
      checkedEmails: emails,
      apiKeySource: apiKey.source,
    });
  }

  const attrs = best?.attributes || {};
  const status = String(attrs?.status || '').toLowerCase() || 'active';
  const isActive = ACTIVE_STATUSES.has(status);
  if (!isActive) {
    return json({
      ok: true,
      synced: false,
      reason: `Found subscription ${best?.id} but status is ${status}.`,
      apiKeySource: apiKey.source,
    });
  }

  const currentMeta = clerkUser?.public_metadata && typeof clerkUser.public_metadata === 'object'
    ? { ...clerkUser.public_metadata }
    : {};
  const currentRole = String(currentMeta.role || 'user').toLowerCase();
  const nextRole = currentRole === 'admin' ? 'admin' : 'soft-launch';

  const nextMeta = {
    ...currentMeta,
    role: nextRole,
    softLaunchActive: true,
    subscriptionStatus: status,
    lemonSubscriptionStatus: status,
    lemonSubscriptionId: String(best?.id || '').trim() || currentMeta.lemonSubscriptionId || null,
    lemonVariantId: String(attrs?.variant_id || '').trim() || currentMeta.lemonVariantId || null,
    lemonRenewsAt: attrs?.renews_at || currentMeta.lemonRenewsAt || null,
    lemonEndsAt: attrs?.ends_at || currentMeta.lemonEndsAt || null,
    lemonLastEvent: currentMeta.lemonLastEvent || 'manual_sync',
    lemonLastSyncedAt: new Date().toISOString(),
  };

  const patchResp = await clerkFetch(env, `/v1/users/${encodeURIComponent(access.userId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ public_metadata: nextMeta }),
  });
  if (!patchResp.ok) {
    const detail = await patchResp.text().catch(() => '');
    return json({ error: `Failed to update Clerk metadata: ${detail || patchResp.status}` }, 500);
  }

  return json({
    ok: true,
    synced: true,
    userId: access.userId,
    matchedEmail: String(attrs?.user_email || '').trim().toLowerCase() || null,
    subscriptionId: String(best?.id || '').trim() || null,
    status,
    apiKeySource: apiKey.source,
  });
};
