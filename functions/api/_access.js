const CLERK_API_BASE = 'https://api.clerk.com';
const FREE_LOOKBACK_DAYS = 7;
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'on_trial', 'trialing', 'past_due']);

const textEncoder = new TextEncoder();

let jwksCache = {
  url: '',
  expiresAt: 0,
  keys: [],
};

let userCache = new Map();

const nowEpochMs = () => Date.now();

const base64UrlToUint8 = (value) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
};

const base64UrlToString = (value) => {
  const bytes = base64UrlToUint8(value);
  return new TextDecoder().decode(bytes);
};

const parseJsonSafe = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const parseCookieValue = (cookieHeader, key) => {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=');
    if (k === key) return decodeURIComponent(rest.join('='));
  }
  return null;
};

const getAuthToken = (request) => {
  const authorization = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch?.[1]) return bearerMatch[1].trim();
  const cookieHeader = request.headers.get('cookie') || request.headers.get('Cookie') || '';
  return parseCookieValue(cookieHeader, '__session');
};

const normalizeHost = (value) => {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
};

const decodeClerkHostFromPublishableKey = (publishableKey) => {
  const key = String(publishableKey || '').trim();
  if (!key) return null;
  const chunks = key.split('_');
  if (chunks.length < 3) return null;
  const encoded = chunks.slice(2).join('_');
  if (!encoded) return null;
  try {
    const raw = base64UrlToString(encoded).replace(/\$/g, '').trim();
    return normalizeHost(raw);
  } catch {
    return null;
  }
};

const resolveClerkFrontendHost = (env) => {
  return (
    normalizeHost(env.CLERK_FRONTEND_API) ||
    decodeClerkHostFromPublishableKey(env.CLERK_PUBLISHABLE_KEY) ||
    null
  );
};

const getJwksConfig = (env) => {
  const explicitJwks = String(env.CLERK_JWKS_URL || '').trim();
  const explicitIssuer = String(env.CLERK_ISSUER || '').trim();
  if (explicitJwks) {
    return {
      jwksUrl: explicitJwks,
      expectedIssuer: explicitIssuer || null,
    };
  }
  const host = resolveClerkFrontendHost(env);
  if (!host) return null;
  return {
    jwksUrl: `https://${host}/.well-known/jwks.json`,
    expectedIssuer: explicitIssuer || `https://${host}`,
  };
};

const getJwks = async (jwksUrl) => {
  if (jwksCache.url === jwksUrl && jwksCache.expiresAt > nowEpochMs() && Array.isArray(jwksCache.keys) && jwksCache.keys.length > 0) {
    return jwksCache.keys;
  }
  const resp = await fetch(jwksUrl, { cache: 'no-cache' });
  if (!resp.ok) throw new Error(`JWKS fetch failed (${resp.status})`);
  const body = await resp.json().catch(() => null);
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  if (keys.length === 0) throw new Error('JWKS has no keys');
  jwksCache = {
    url: jwksUrl,
    expiresAt: nowEpochMs() + 5 * 60 * 1000,
    keys,
  };
  return keys;
};

const verifyClerkJwt = async (token, env) => {
  const config = getJwksConfig(env);
  if (!config) {
    return { ok: false, reason: 'Missing Clerk JWKS config. Set CLERK_FRONTEND_API or CLERK_JWKS_URL.' };
  }

  const parts = String(token || '').split('.');
  if (parts.length !== 3) return { ok: false, reason: 'Malformed token' };
  const [encodedHeader, encodedPayload, encodedSig] = parts;
  const header = parseJsonSafe(base64UrlToString(encodedHeader));
  const payload = parseJsonSafe(base64UrlToString(encodedPayload));
  if (!header || !payload) return { ok: false, reason: 'Invalid token payload' };
  if (header.alg !== 'RS256') return { ok: false, reason: `Unsupported token alg: ${header.alg}` };

  const keys = await getJwks(config.jwksUrl);
  const jwk = keys.find((key) => key?.kid === header.kid && key?.kty === 'RSA');
  if (!jwk) return { ok: false, reason: 'No matching JWKS key' };

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signature = base64UrlToUint8(encodedSig);
  const signedContent = textEncoder.encode(`${encodedHeader}.${encodedPayload}`);
  const verified = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, signedContent);
  if (!verified) return { ok: false, reason: 'Invalid token signature' };

  const nowSec = Math.floor(nowEpochMs() / 1000);
  if (typeof payload.nbf === 'number' && nowSec < payload.nbf) return { ok: false, reason: 'Token not active yet' };
  if (typeof payload.exp === 'number' && nowSec >= payload.exp) return { ok: false, reason: 'Token expired' };
  if (config.expectedIssuer && payload.iss !== config.expectedIssuer) {
    return { ok: false, reason: 'Unexpected token issuer' };
  }

  return { ok: true, payload };
};

const verifyTokenViaClerkApi = async (token, env) => {
  if (!env.CLERK_SECRET_KEY || !token) return { ok: false, reason: 'Missing CLERK_SECRET_KEY' };
  try {
    const resp = await fetch(`${CLERK_API_BASE}/v1/sessions/verify`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CLERK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token }),
    });
    if (!resp.ok) {
      return { ok: false, reason: `Clerk verify endpoint returned ${resp.status}` };
    }
    const body = await resp.json().catch(() => null);
    const userId = String(
      body?.sub ??
      body?.user_id ??
      body?.userId ??
      body?.claims?.sub ??
      body?.data?.sub ??
      body?.data?.user_id ??
      '',
    ).trim();
    if (!userId) return { ok: false, reason: 'Verify response missing user id' };
    return { ok: true, payload: { sub: userId, iss: body?.iss || body?.claims?.iss || null } };
  } catch (err) {
    return { ok: false, reason: `Clerk verify request failed: ${err?.message || 'error'}` };
  }
};

const fetchClerkUser = async (env, userId) => {
  if (!env.CLERK_SECRET_KEY || !userId) return null;
  const cached = userCache.get(userId);
  if (cached && cached.expiresAt > nowEpochMs()) return cached.user;

  const resp = await fetch(`${CLERK_API_BASE}/v1/users/${encodeURIComponent(userId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${env.CLERK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!resp.ok) return null;
  const user = await resp.json().catch(() => null);
  if (!user) return null;
  userCache.set(userId, { user, expiresAt: nowEpochMs() + 60 * 1000 });
  if (userCache.size > 300) {
    userCache = new Map(Array.from(userCache.entries()).slice(-200));
  }
  return user;
};

const normalizeRoleAndPaid = (metadata) => {
  const meta = metadata && typeof metadata === 'object' ? metadata : {};
  const metadataRole = String(meta.role || '').toLowerCase() || 'user';
  const subscriptionStatus = String(
    meta.subscriptionStatus ??
    meta.lemonSubscriptionStatus ??
    meta.billingStatus ??
    '',
  ).toLowerCase();
  const softLaunchActive = Boolean(
    meta.softLaunchActive === true ||
    meta.isPaidSubscriber === true ||
    ACTIVE_SUBSCRIPTION_STATUSES.has(subscriptionStatus),
  );

  let role = metadataRole;
  if (role !== 'admin') {
    if (softLaunchActive) role = 'soft-launch';
    else if (role === 'soft-launch') role = 'user';
  }

  const paid = role === 'admin' || role === 'beta-user' || role === 'soft-launch';
  return { role, paid };
};

const parseIsoDateUtc = (dateStr) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return null;
  const [y, m, d] = String(dateStr).split('-').map((v) => Number(v));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== (m - 1) ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
};

const getUtcStartOfToday = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

export const isDateAllowedForAccess = (dateStr, access) => {
  const parsed = parseIsoDateUtc(dateStr);
  if (!parsed) return false;
  if (access?.paid) return true;
  const today = getUtcStartOfToday();
  const minDate = new Date(today);
  minDate.setUTCDate(minDate.getUTCDate() - FREE_LOOKBACK_DAYS);
  // Free/preview access excludes today's date.
  return parsed >= minDate && parsed < today;
};

export const getDefaultCorsHeaders = () => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
});

export const resolveAccessContext = async (request, env) => {
  const token = getAuthToken(request);
  if (!token) return { authenticated: false, role: 'user', paid: false, reason: 'No auth token' };

  let verification;
  try {
    verification = await verifyClerkJwt(token, env);
  } catch (err) {
    return { authenticated: false, role: 'user', paid: false, reason: `Token verification failed: ${err?.message || 'error'}` };
  }
  if (!verification.ok) {
    const apiVerification = await verifyTokenViaClerkApi(token, env);
    if (apiVerification.ok) {
      verification = apiVerification;
    } else {
      return { authenticated: false, role: 'user', paid: false, reason: verification.reason || apiVerification.reason || 'Invalid token' };
    }
  }

  const userId = String(verification.payload?.sub || '').trim();
  if (!userId) return { authenticated: false, role: 'user', paid: false, reason: 'Token missing sub' };

  const clerkUser = await fetchClerkUser(env, userId);
  const metadata = clerkUser?.public_metadata || {};
  const roleAndPaid = normalizeRoleAndPaid(metadata);
  return {
    authenticated: true,
    userId,
    role: roleAndPaid.role,
    paid: roleAndPaid.paid,
    reason: 'Verified',
  };
};

export const buildDateForbiddenResponse = (dateStr, headers) => {
  return new Response(
    JSON.stringify({
      error: `Access limited for ${dateStr}. Free access is limited to the last ${FREE_LOOKBACK_DAYS} days excluding today.`,
      code: 'DATE_RESTRICTED',
    }),
    { status: 403, headers: { 'Content-Type': 'application/json', ...headers } },
  );
};
