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
  LEMONSQUEEZY_WEBHOOK_SECRET: string;
  CLERK_SECRET_KEY: string;
}

const json = (payload: Record<string, any>, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Signature',
    },
  });

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');

const hmacSha256Hex = async (secret: string, payload: string): Promise<string> => {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return toHex(new Uint8Array(sig));
};

const secureEquals = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const isActiveStatus = (status: string): boolean =>
  ['active', 'on_trial', 'trialing', 'past_due'].includes(status);

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

const resolveClerkUser = async (
  env: Env,
  preferredId: string | null,
  email: string | null,
): Promise<any | null> => {
  if (preferredId) {
    const byIdResp = await clerkFetch(env, `/v1/users/${encodeURIComponent(preferredId)}`, { method: 'GET' });
    if (byIdResp.ok) {
      return byIdResp.json();
    }
  }

  if (email) {
    const byEmailResp = await clerkFetch(
      env,
      `/v1/users?limit=1&email_address[]=${encodeURIComponent(email)}`,
      { method: 'GET' },
    );
    if (byEmailResp.ok) {
      const users = await byEmailResp.json();
      if (Array.isArray(users) && users.length > 0) return users[0];
    }
  }

  return null;
};

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return json({}, 204);
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  if (!env.LEMONSQUEEZY_WEBHOOK_SECRET || !env.CLERK_SECRET_KEY) {
    return json({ error: 'Missing webhook server configuration.' }, 500);
  }

  const rawBody = await request.text();
  const incomingSig = request.headers.get('X-Signature') || request.headers.get('x-signature') || '';
  const expectedSig = await hmacSha256Hex(env.LEMONSQUEEZY_WEBHOOK_SECRET, rawBody);
  if (!incomingSig || !secureEquals(incomingSig, expectedSig)) {
    return json({ error: 'Invalid signature.' }, 401);
  }

  let payload: any = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const eventName = String(payload?.meta?.event_name || '').toLowerCase();
  if (!eventName.startsWith('subscription_')) {
    return json({ ok: true, ignored: true });
  }

  const attributes = payload?.data?.attributes || {};
  const custom = payload?.meta?.custom_data || {};
  const subscriptionId = String(payload?.data?.id || '').trim() || null;
  const variantId = String(attributes?.variant_id || '').trim() || null;
  const status = String(attributes?.status || '').toLowerCase();
  const email = String(attributes?.user_email || attributes?.customer_email || '').trim().toLowerCase() || null;
  const clerkUserId = String(custom?.clerk_user_id || custom?.clerkUserId || '').trim() || null;

  let isSubscriberActive = isActiveStatus(status);
  if (eventName === 'subscription_cancelled' || eventName === 'subscription_expired') {
    isSubscriberActive = false;
  }

  try {
    const user = await resolveClerkUser(env, clerkUserId, email);
    if (!user?.id) {
      console.warn('[lemon-webhook] no matching Clerk user', { clerkUserId, email, eventName, subscriptionId });
      return json({ ok: true, matchedUser: false });
    }

    const publicMetadata = user.public_metadata && typeof user.public_metadata === 'object'
      ? { ...user.public_metadata }
      : {};
    const currentRole = String(publicMetadata.role || 'user').toLowerCase();
    const nextRole = currentRole === 'admin'
      ? 'admin'
      : (isSubscriberActive ? 'soft-launch' : 'user');

    const nextPublicMetadata = {
      ...publicMetadata,
      role: nextRole,
      softLaunchActive: isSubscriberActive,
      subscriptionStatus: status || (isSubscriberActive ? 'active' : 'inactive'),
      lemonSubscriptionStatus: status || (isSubscriberActive ? 'active' : 'inactive'),
      lemonSubscriptionId: subscriptionId || publicMetadata.lemonSubscriptionId || null,
      lemonVariantId: variantId || publicMetadata.lemonVariantId || null,
      lemonRenewsAt: attributes?.renews_at || publicMetadata.lemonRenewsAt || null,
      lemonEndsAt: attributes?.ends_at || publicMetadata.lemonEndsAt || null,
      lemonLastEvent: eventName,
      lemonLastSyncedAt: new Date().toISOString(),
    };

    const updateResp = await clerkFetch(env, `/v1/users/${encodeURIComponent(user.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ public_metadata: nextPublicMetadata }),
    });

    if (!updateResp.ok) {
      const details = await updateResp.text();
      console.error('[lemon-webhook] Clerk update failed', details);
      return json({ error: 'Failed to sync user metadata.' }, 502);
    }

    return json({ ok: true, matchedUser: true, userId: user.id, active: isSubscriberActive });
  } catch (error: any) {
    console.error('[lemon-webhook] unexpected error:', error?.message || error);
    return json({ error: 'Webhook processing error.' }, 500);
  }
};
