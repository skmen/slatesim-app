import React from 'react';
import { TierType, PosType } from '@/utils/classifyPlayers';

interface TierBadgeProps {
  tier: TierType;
  pos_primary: PosType;
  posReasoning?: string;
  size?: 'sm' | 'md';
}

const TIER_CONFIG: Record<TierType, { label: string; classes: string }> = {
  ELITE:           { label: 'Elite',       classes: 'bg-green-100 text-green-800 border-green-600' },
  SWEET_SPOT:      { label: 'Sweet Spot',  classes: 'bg-amber-100 text-amber-800 border-amber-600' },
  BROAD:           { label: 'Broad',       classes: 'bg-blue-100 text-blue-800 border-blue-600' },
  CAUTION:         { label: 'Caution',     classes: 'bg-orange-100 text-orange-800 border-orange-500' },
  OVERUSE_WARNING: { label: 'Overuse',     classes: 'bg-red-100 text-red-800 border-red-600' },
};

const TIER_TOOLTIPS: Record<TierType, string> = {
  ELITE: 'Elite tier players meet the strongest historical conditions for outperforming their projection by 8+ pts. Across 8 slates this combination produced a 40–60% hit rate depending on position — roughly 2–3x the baseline rate of 18–19%.',
  SWEET_SPOT: 'Sweet Spot players are in a position-specific zone that backtesting identified as outperforming the naive "high ownership = good" signal. For SGs this means 7–15% ownership (NOT 15%+). For Centers this means usage strictly between 22–28%. These picks require positional awareness.',
  BROAD: 'Broad filter players meet the baseline ownership + usage threshold (Own ≥ 3%, Usage ≥ 22%) that consistently outperforms across all positions. Hit rate is ~27–29% vs the 18–19% baseline. Lower conviction — useful for secondary lineup slots.',
  CAUTION: 'Caution players meet ownership thresholds on the surface, but backtesting shows this positional group underperforms. SGs at 15%+ ownership historically hit at only 20% — no better than the SG baseline. The market appears to overvalue chalk SGs. Proceed with eyes open.',
  OVERUSE_WARNING: 'These players have strong ownership projections but their usage rate exceeds the historical ceiling. Centers above 28% usage historically produced a 0% hit rate for exceeding projections by 8+ pts. Fade these regardless of ownership.',
};

export const TierBadge: React.FC<TierBadgeProps> = ({ tier, posReasoning, size = 'md' }) => {
  const config = TIER_CONFIG[tier];
  const tooltip = posReasoning || TIER_TOOLTIPS[tier];
  const sizeClasses = size === 'sm'
    ? 'text-[9px] px-1.5 py-0.5'
    : 'text-[10px] px-2 py-0.5';

  return (
    <span className="relative inline-flex items-center group">
      <span className={`inline-flex items-center font-black uppercase tracking-widest border rounded-sm ${sizeClasses} ${config.classes}`}>
        {config.label}
      </span>
      <span className="pointer-events-none absolute left-1/2 bottom-full z-30 mb-2 w-64 -translate-x-1/2 rounded-md bg-ink px-2.5 py-2 text-[11px] leading-snug text-vellum opacity-0 shadow-lg transition-opacity group-hover:opacity-100 text-left font-normal normal-case tracking-normal">
        {tooltip}
      </span>
    </span>
  );
};

// ─── Position badge ───────────────────────────────────────────────────────────

const POS_COLORS: Record<PosType, string> = {
  PG: 'bg-green-100 text-green-800 border-green-500',
  SG: 'bg-amber-100 text-amber-800 border-amber-500',
  SF: 'bg-blue-100 text-blue-800 border-blue-500',
  PF: 'bg-purple-100 text-purple-800 border-purple-500',
  C:  'bg-orange-100 text-orange-800 border-orange-500',
};

interface PosBadgeProps {
  pos: string;          // original display string e.g. "SG/SF"
  pos_primary: PosType; // for color
}

export const PosBadge: React.FC<PosBadgeProps> = ({ pos, pos_primary }) => (
  <span className={`inline-flex items-center text-[9px] font-black uppercase tracking-widest border rounded-sm px-1.5 py-0.5 ${POS_COLORS[pos_primary]}`}>
    {pos}
  </span>
);
