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

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return json({}, 204);
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

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

  return json({
    ok: true,
    url: LEMON_ORDERS_LOGIN_URL,
    signed: false,
    note: 'Users can manage or cancel subscriptions from this Lemon Orders login portal.',
  });
};
