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
  'Research Page: full projections with export and filter',
  'Research Page: limited Player Deep Dive (DFS, STATS, DEPTH CHART)',
  'Compare Page',
  'Optimizer',
  'Entries',
  'Report Page',
];

export const PricingPage: React.FC = () => {
  const { isLoaded, isSignedIn, user } = useUser();
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alreadyActive = useMemo(() => {
    const metadata = (user?.publicMetadata || {}) as Record<string, any>;
    const role = String(metadata.role || '').toLowerCase();
    const status = String(metadata.subscriptionStatus || '').toLowerCase();
    return role === 'soft-launch' || metadata.softLaunchActive === true || ['active', 'on_trial', 'trialing', 'past_due'].includes(status);
  }, [user]);

  const beginCheckout = async () => {
    if (!isSignedIn || !user) return;
    setStartingCheckout(true);
    setError(null);
    try {
      const resp = await fetch('/api/lemon-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clerkUserId: user.id,
          email: user.primaryEmailAddress?.emailAddress || '',
          name: user.fullName || user.username || user.primaryEmailAddress?.emailAddress || 'SlateSim Member',
        }),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok || !payload?.url) {
        throw new Error(payload?.error || 'Failed to start checkout.');
      }
      window.location.assign(payload.url);
    } catch (err: any) {
      setError(err?.message || 'Failed to start checkout.');
      setStartingCheckout(false);
    }
  };

  return (
    <div className="min-h-screen bg-vellum text-ink font-sans">
      <div className="mx-auto max-w-4xl px-4 py-16">
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
            Introductory pricing at <span className="font-black text-ink">$10/week</span>. Cancel any time.
          </p>
        </header>

        <div className="mx-auto max-w-xl rounded-xl border border-drafting-orange/40 bg-white p-6 shadow-lg">
          <div className="inline-flex rounded-full bg-drafting-orange px-3 py-1 text-[11px] font-black uppercase tracking-widest text-white">
            Introductory
          </div>

          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-5xl font-black text-ink">$10</span>
            <span className="text-sm uppercase tracking-widest text-ink/50">per week</span>
          </div>
          <p className="mt-2 text-sm text-ink/70">
            One simple tier for the Soft Launch. Weekly billing through Lemon Squeezy.
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
              <div className="w-full rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-center text-sm font-black uppercase tracking-widest text-emerald-700">
                Soft Launch Active
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
            <p className="text-[11px] uppercase tracking-widest text-ink/50 text-center">
              Cancel any time from your billing portal or subscription emails.
            </p>
            {error && (
              <p className="text-xs text-red-600 text-center font-bold">{error}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PricingPage;
