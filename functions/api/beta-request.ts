// This is a Cloudflare Pages Function. It runs on the edge, close to your users.
// It's used to securely handle the "beta request" form submissions.

// Environment variables that need to be set in your Cloudflare Pages project settings:
// - RESEND_API_KEY: Your API key from Resend (resend.com)
// - BETA_NOTIFY_EMAIL: The email address where you want to receive notifications (e.g., your personal email)
// - BETA_FROM_EMAIL: A verified "from" email address on your Resend account (e.g., beta@yourdomain.com)

// Fix: Add type definition for Cloudflare PagesFunction to resolve "Cannot find name 'PagesFunction'" error.
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
  RESEND_API_KEY: string;
  BETA_NOTIFY_EMAIL: string;
  BETA_FROM_EMAIL: string;
}

interface BetaRequestBody {
  email?: string;
  honeypot?: string;
  ts?: number;
  source?: string;
}

// Basic email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  // Set CORS headers to allow requests from your domain
  const headers = new Headers({
    'Access-Control-Allow-Origin': '*', // Or lock down to your specific domain
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  });

  // Handle CORS preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  // Only allow POST requests
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers,
    });
  }

  try {
    const body: BetaRequestBody = await request.json();

    // 1. Honeypot check for simple bot prevention
    if (body.honeypot) {
      // It's a bot, pretend it was successful but do nothing.
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    // 2. Validate email
    const email = body.email;
    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email)) {
      return new Response(JSON.stringify({ error: 'Invalid email address provided.' }), {
        status: 400,
        headers,
      });
    }

    // 3. Check for required environment variables
    if (!env.RESEND_API_KEY || !env.BETA_NOTIFY_EMAIL || !env.BETA_FROM_EMAIL) {
        console.error("Missing environment variables for email notification.");
        return new Response(JSON.stringify({ error: 'Server configuration error.' }), { status: 500, headers });
    }

    // 4. Send email using Resend API
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.BETA_FROM_EMAIL,
        to: env.BETA_NOTIFY_EMAIL,
        subject: '🚀 New SlateSim Beta Request!',
        html: `
          <p>You have a new beta access request for SlateSim.</p>
          <ul>
            <li><strong>Email:</strong> ${email}</li>
            <li><strong>Timestamp:</strong> ${new Date(body.ts || Date.now()).toUTCString()}</li>
            <li><strong>Source:</strong> ${body.source || 'Unknown'}</li>
          </ul>
        `,
      }),
    });

    if (!resendResponse.ok) {
      const errorBody = await resendResponse.text();
      console.error('Resend API error:', errorBody);
      throw new Error(`Resend API failed with status ${resendResponse.status}`);
    }

    // 5. Return success response
    return new Response(JSON.stringify({ ok: true }), { headers });

  } catch (error) {
    console.error('Error processing beta request:', error);
    return new Response(JSON.stringify({ error: 'An internal error occurred.' }), {
      status: 500,
      headers,
    });
  }
};
