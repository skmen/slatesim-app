import React from 'react';
import { TierType } from '@/utils/classifyPlayers';

interface SummaryCounts {
  total: number;
  elite: number;
  sweet_spot: number;
  broad: number;
  caution: number;
}

interface SummaryCardsProps {
  counts: SummaryCounts;
}

interface CardConfig {
  label: string;
  value: number;
  bg: string;
  border: string;
  text: string;
  tooltip: string;
}

const InfoIcon: React.FC<{ tooltip: string }> = ({ tooltip }) => (
  <span className="relative inline-flex group ml-1">
    <span className="text-ink/40 text-[10px] font-normal cursor-help">ℹ</span>
    <span className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 w-64 -translate-x-1/2 rounded-md bg-ink px-2.5 py-2 text-[11px] leading-snug text-vellum opacity-0 shadow-lg transition-opacity group-hover:opacity-100 font-normal normal-case tracking-normal text-left">
      {tooltip}
    </span>
  </span>
);

export const SummaryCards: React.FC<SummaryCardsProps> = ({ counts }) => {
  const cards: CardConfig[] = [
    {
      label: 'Qualifying',
      value: counts.total,
      bg: 'bg-white/60',
      border: 'border-ink/15',
      text: 'text-ink',
      tooltip: 'Total players on this slate that meet at least one positional overperformance condition based on 8-slate backtesting data.',
    },
    {
      label: 'Elite',
      value: counts.elite,
      bg: 'bg-green-50',
      border: 'border-green-400',
      text: 'text-green-800',
      tooltip: 'Elite tier players meet the strongest historical conditions for outperforming their projection by 8+ pts. Across 8 slates this combination produced a 40–60% hit rate depending on position — roughly 2–3x the baseline rate of 18–19%.',
    },
    {
      label: 'Sweet Spot',
      value: counts.sweet_spot,
      bg: 'bg-amber-50',
      border: 'border-amber-400',
      text: 'text-amber-800',
      tooltip: 'Sweet Spot players are in a position-specific zone that backtesting identified as outperforming the naive "high ownership = good" signal. For SGs this means 7–15% ownership (NOT 15%+). For Centers this means usage strictly between 22–28%.',
    },
    {
      label: 'Broad',
      value: counts.broad,
      bg: 'bg-blue-50',
      border: 'border-blue-400',
      text: 'text-blue-800',
      tooltip: 'Broad filter players meet the baseline ownership + usage threshold (Own ≥ 3%, Usage ≥ 22%) that consistently outperforms across all positions. Hit rate is ~27–29% vs the 18–19% baseline.',
    },
    {
      label: 'Caution',
      value: counts.caution,
      bg: 'bg-orange-50',
      border: 'border-orange-400',
      text: 'text-orange-800',
      tooltip: 'Caution players meet ownership thresholds on the surface, but backtesting shows this positional group underperforms when highly owned. SGs at 15%+ ownership historically hit at only 20% — no better than the SG baseline.',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`${card.bg} border ${card.border} rounded-sm p-3 flex flex-col gap-1`}
        >
          <div className={`flex items-center text-[10px] font-black uppercase tracking-widest ${card.text}`}>
            {card.label}
            <InfoIcon tooltip={card.tooltip} />
          </div>
          <div className={`text-2xl font-black ${card.text}`}>{card.value}</div>
        </div>
      ))}
    </div>
  );
};
