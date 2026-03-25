import React, { useMemo, useState } from 'react';
import { SignInButton, useUser } from "@clerk/clerk-react";

const CheckIcon = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const ArrowLeftIcon = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

const FEATURES = [
  'Player and game research',
  'Player deep dives: Historical DFS stats, play by play data, depth charts',
  'Compare player stats',
  'Optimizer',
  'Manage DraftKings entries',
  "Projections performance report (How'd the projections do vs actual game)",
  'Enjoy this introductory offer for a limited time',
];

export const PricingPage: React.FC = () => {
  const { isLoaded, isSignedIn, user } = useUser();
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const metadata = (user?.publicMetadata || {}) as Record<string, any>;

  const alreadyActive = useMemo(() => {
    const role = String(metadata.role || '').toLowerCase();
    const status = String(metadata.subscriptionStatus ?? metadata.lemonSubscriptionStatus ?? '').toLowerCase();
    return role === 'soft-launch' || metadata.softLaunchActive === true || ['active', 'on_trial', 'trialing', 'past_due'].includes(status);
  }, [metadata]);
  const isAdmin = useMemo(() => String(metadata.role || '').toLowerCase() === 'admin', [metadata]);
  const canManageMembership = Boolean(isSignedIn && (alreadyActive || isAdmin));

  const beginCheckout = async () => {
    if (!isSignedIn || !user) return;
    setStartingCheckout(true);
    setError(null);
    try {
      const requestBody = JSON.stringify({
        clerkUserId: user.id,
        email: user.primaryEmailAddress?.emailAddress || '',
        name: user.fullName || user.username || user.primaryEmailAddress?.emailAddress || 'SlateSim Member',
      });

      const endpoints = ['/api/lemon-checkout'];
      const host = window.location.hostname.toLowerCase();
      if (host.startsWith('www.')) {
        endpoints.push(`https://${host.slice(4)}/api/lemon-checkout`);
      }

      let lastErr = 'Failed to start checkout.';
      for (const endpoint of endpoints) {
        try {
          const resp = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: requestBody,
          });
          const raw = await resp.text();
          let payload: any = {};
          try {
            payload = raw ? JSON.parse(raw) : {};
          } catch {
            payload = {};
          }

          if (resp.ok && payload?.url) {
            window.location.assign(payload.url);
            return;
          }

          const detail = String(payload?.error || raw || '').trim();
          const isGatewayHtml = /bad gateway|error code 502/i.test(detail);
          if (resp.status >= 500 && isGatewayHtml && endpoint !== endpoints[endpoints.length - 1]) {
            lastErr = `Gateway error via ${endpoint}, retrying alternate host...`;
            continue;
          }

          throw new Error(detail || `Failed to start checkout (HTTP ${resp.status}).`);
        } catch (err: any) {
          const message = String(err?.message || err || '').trim();
          lastErr = message || `Network error contacting ${endpoint}`;
          if (endpoint !== endpoints[endpoints.length - 1]) {
            continue;
          }
          throw new Error(lastErr);
        }
      }

      throw new Error(lastErr);
    } catch (err: any) {
      setError(err?.message || 'Failed to start checkout.');
      setStartingCheckout(false);
    }
  };

  const openMembershipPortal = async () => {
    if (!isSignedIn || !user) return;
    setOpeningPortal(true);
    setError(null);
    try {
      const resp = await fetch('/api/lemon-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const raw = await resp.text();
      let payload: any = {};
      try {
        payload = raw ? JSON.parse(raw) : {};
      } catch {
        payload = {};
      }
      if (!resp.ok || !payload?.url) {
        throw new Error(String(payload?.error || raw || `Unable to open membership portal (HTTP ${resp.status}).`).trim());
      }
      window.location.assign(payload.url);
      return;
    } catch (err: any) {
      setError(err?.message || 'Unable to open membership portal.');
    }
    setOpeningPortal(false);
  };

  return (
    <div className="min-h-screen bg-vellum text-ink font-sans flex flex-col">
      <div className="mx-auto w-full max-w-4xl px-4 py-16 flex-1">
        <div className="mb-6">
          <a
            href="/"
            className="inline-flex items-center gap-2 rounded-lg border border-ink/10 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-widest text-ink/70 hover:border-drafting-orange hover:text-drafting-orange transition-colors"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Back
          </a>
        </div>

        <header className="text-center space-y-4 mb-10">
          <p className="text-xs font-black uppercase tracking-[0.28em] text-drafting-orange">Pricing</p>
          <h1 className="text-4xl md:text-5xl font-black leading-tight">Soft Launch Membership</h1>
          <p className="text-ink/70 max-w-2xl mx-auto text-base">
            Introductory offer for our soft launch. Weekly billing. DraftKings support only.
          </p>
        </header>

        <div className="mx-auto max-w-xl rounded-xl border border-drafting-orange/40 bg-white p-6 shadow-lg">
          <div className="inline-flex rounded-full bg-drafting-orange px-3 py-1 text-[11px] font-black uppercase tracking-widest text-white">
            Introductory
          </div>

          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-5xl font-black text-ink">$12.99</span>
            <span className="text-sm uppercase tracking-widest text-ink/50">per week</span>
          </div>
          <p className="mt-2 text-sm text-ink/70">
            Introductory offer for our soft launch. Weekly billing. DraftKings support only.
          </p>

          <div className="mt-6 space-y-2">
            {FEATURES.map((feature) => (
              <div key={feature} className="flex items-start gap-3 rounded-lg px-2 py-1.5 text-ink">
                <CheckIcon className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                <span className="text-sm">{feature}</span>
              </div>
            ))}
          </div>

          <div className="mt-6 space-y-3">
            {!isLoaded ? (
              <button
                disabled
                className="w-full rounded-lg border border-ink/20 bg-white px-4 py-3 text-sm font-black uppercase tracking-widest text-ink/50"
              >
                Loading account...
              </button>
            ) : !isSignedIn ? (
              <SignInButton mode="modal">
                <button className="w-full rounded-lg border border-drafting-orange bg-drafting-orange px-4 py-3 text-sm font-black uppercase tracking-widest text-white hover:brightness-110 transition-all">
                  Sign In to Subscribe
                </button>
              </SignInButton>
            ) : alreadyActive ? (
              <div className="space-y-2">
                <div className="w-full rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-center text-sm font-black uppercase tracking-widest text-emerald-700">
                  Soft Launch Active
                </div>
                {canManageMembership && (
                  <button
                    onClick={openMembershipPortal}
                    disabled={openingPortal}
                    className="w-full rounded-lg border border-ink/20 bg-white px-4 py-3 text-sm font-black uppercase tracking-widest text-ink hover:border-drafting-orange hover:text-drafting-orange transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {openingPortal ? 'Opening Portal...' : 'Manage Membership'}
                  </button>
                )}
              </div>
            ) : (
              <button
                onClick={beginCheckout}
                disabled={startingCheckout}
                className="w-full rounded-lg border border-drafting-orange bg-drafting-orange px-4 py-3 text-sm font-black uppercase tracking-widest text-white hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {startingCheckout ? 'Starting Checkout...' : 'Subscribe with Lemon Squeezy'}
              </button>
            )}
            {!alreadyActive && canManageMembership && (
              <button
                onClick={openMembershipPortal}
                disabled={openingPortal}
                className="w-full rounded-lg border border-ink/20 bg-white px-4 py-3 text-sm font-black uppercase tracking-widest text-ink hover:border-drafting-orange hover:text-drafting-orange transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {openingPortal ? 'Opening Portal...' : 'Manage Membership'}
              </button>
            )}
            <p className="text-[11px] uppercase tracking-widest text-ink/50 text-center">
              Cancel any time from your billing portal or subscription emails.
            </p>
            {error && (
              <p className="text-xs text-red-600 text-center font-bold">{error}</p>
            )}
          </div>
        </div>
      </div>
      <footer className="pb-8 text-center">
        <div className="flex items-center justify-center gap-2 text-[11px] font-black uppercase tracking-widest">
          <a href="/terms" className="text-ink/60 hover:text-drafting-orange transition-colors">
            Terms of Service
          </a>
          <span className="text-ink/40">|</span>
          <a href="/privacy" className="text-ink/60 hover:text-drafting-orange transition-colors">
            Privacy Policy
          </a>
        </div>
      </footer>
    </div>
  );
};

export default PricingPage;
