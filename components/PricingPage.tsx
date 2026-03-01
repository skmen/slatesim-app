import React, { useState } from 'react';

// Lightweight placeholder icons (swap with Lucide/Heroicons if desired)
const CheckIcon = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const LockIcon = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const LightningIcon = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const ArrowLeftIcon = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

type Feature = { label: string; locked?: boolean };

const TierCard: React.FC<{
  name: string;
  price: string;
  billingText: string;
  description: string;
  ctaText: string;
  ctaVariant: 'solid' | 'outline';
  badge?: string;
  features: Feature[];
  emphasized?: boolean;
}> = ({ name, price, billingText, description, ctaText, ctaVariant, badge, features, emphasized }) => {
  return (
    <div
      className={`relative flex flex-col gap-4 rounded-xl border border-ink/10 bg-white/80 p-6 shadow-sm transition duration-300 ${
        emphasized ? 'scale-[1.01] border-drafting-orange/50 shadow-[0_10px_50px_-24px_rgba(0,0,0,0.5)] bg-white' : ''
      }`}
    >
      {badge && (
        <span className="absolute -top-3 right-4 rounded-full bg-drafting-orange px-3 py-1 text-[11px] font-black uppercase tracking-widest text-white shadow-lg">
          {badge}
        </span>
      )}

      <div className="flex items-center gap-2">
        <LightningIcon className="h-5 w-5 text-drafting-orange" />
        <p className="text-[11px] uppercase tracking-[0.22em] text-ink/60 font-black">{name}</p>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-4xl font-black text-ink">{price}</span>
        <span className="text-xs uppercase tracking-widest text-ink/50">{billingText}</span>
      </div>

      <p className="text-sm text-ink/70 leading-relaxed">{description}</p>

      <button
        className={`w-full rounded-lg border px-4 py-3 text-sm font-black uppercase tracking-widest transition-all ${
          ctaVariant === 'solid'
            ? 'bg-drafting-orange text-white border-drafting-orange shadow-[0_6px_20px_-10px_rgba(255,95,31,0.8)] hover:brightness-110'
            : 'border-ink/20 text-ink hover:border-drafting-orange hover:text-drafting-orange'
        }`}
      >
        {ctaText}
      </button>

      <div className="space-y-2 pt-2">
        {features.map((f) => (
          <div
            key={f.label}
            className={`flex items-center gap-3 rounded-lg px-2 py-1.5 ${
              f.locked ? 'text-ink/40' : 'text-ink'
            }`}
          >
            {f.locked ? (
              <LockIcon className="h-4 w-4 text-ink/30" />
            ) : (
              <CheckIcon className="h-4 w-4 text-emerald-600" />
            )}
            <span className="text-sm">{f.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const PricingPage: React.FC = () => {
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly');

  const toggle = () => setBilling((b) => (b === 'monthly' ? 'annual' : 'monthly'));

  return (
    <div className="min-h-screen bg-vellum text-ink font-sans">
      <div className="mx-auto max-w-5xl px-4 py-16">
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
          <h1 className="text-4xl md:text-5xl font-black leading-tight">Start Crushing the Field</h1>
          <p className="text-ink/70 max-w-3xl mx-auto text-lg">
            A basic optimizer is only as good as the numbers you feed it. Unlock 50,000 play-by-play simulations and find the ceiling outcomes linear models miss.
          </p>
        </header>

        <div className="flex items-center justify-center gap-3 mb-10">
          <span className={`text-sm font-bold ${billing === 'monthly' ? 'text-ink' : 'text-ink/40'}`}>Monthly</span>
          <button
            onClick={toggle}
            className="relative inline-flex h-8 w-16 items-center rounded-full bg-white border border-ink/10 shadow-inner transition-all"
          >
            <span
              className={`absolute h-6 w-6 rounded-full bg-drafting-orange shadow-[0_0_12px_rgba(255,95,31,0.6)] transition-all ${
                billing === 'annual' ? 'translate-x-8' : 'translate-x-1'
              }`}
            />
          </button>
          <span className={`text-sm font-bold ${billing === 'annual' ? 'text-ink' : 'text-ink/40'}`}>Annual</span>
          <span className="text-[11px] uppercase tracking-widest text-emerald-600 font-black bg-emerald-500/10 border border-emerald-500/40 px-2 py-1 rounded-lg">
            Save vs monthly
          </span>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <TierCard
            name="Scout"
            price="$0"
            billingText="Free forever, account required"
            description="Perfect for exploring the platform and checking historical data & projections."
            ctaText="Create Free Account"
            ctaVariant="outline"
            features={[
              { label: 'Game Matchup Info & Vegas Lines' },
              { label: 'Historical Slate Data, Projections & Backtesting' },
              { label: 'Basic Player Deep Dives' },
              { label: "Today's Live Projections", locked: true },
              { label: 'Rotational Visualizer & Synergies', locked: true },
              { label: 'DFS Lineup Optimizer', locked: true },
              { label: 'DraftKings CSV Export', locked: true },
            ]}
          />

          <TierCard
            name="Pro Data"
            price={billing === 'annual' ? '$399.99' : '$39.99'}
            billingText={billing === 'annual' ? 'per year, cancel anytime' : 'per month, cancel anytime'}
            description="Full access to our ML-driven projections and more."
            ctaText="Unlock Pro Data"
            ctaVariant="solid"
            badge="Most Popular"
            emphasized
            features={[
              { label: 'Everything from Scout' },
              { label: "Today's Live Projections updated frequently until lock" },
              { label: 'Player Signals and Rotational Visualizer' },
              { label: 'Optimizer (Up to 150 lineups)' },
            ]}
          />
        </div>
      </div>
    </div>
  );
};

export default PricingPage;
