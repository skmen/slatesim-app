import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface Section {
  title: string;
  content: string;
}

const SECTIONS: Section[] = [
  {
    title: 'Research basis',
    content: 'Classifications are derived from backtesting across 8 DFS slates (1,045 player-slate observations). The target variable was whether a player exceeded their projected fantasy total by 8 or more points. The baseline hit rate across all players was 18–19%.',
  },
  {
    title: 'Position-specific signals',
    content: `Ownership and usage correlations (r ≈ +0.18 to +0.27 depending on position) were the strongest predictors found. Key findings:
• PG + PF: monotonic ownership gradient — 15%+ own hits at 40–60%
• SG: ownership gradient breaks at 15%+ — the 7–15% range is optimal
• SF: usage in the 28–35% zone is the primary signal (50% hit rate)
• C: hard usage ceiling at 28% — above this the hit rate drops to 0%`,
  },
  {
    title: 'Ceiling Gap',
    content: 'The 16–20 pt ceiling gap range showed the highest overperformance rates (31%) vs gaps below 12 pts (10%) or above 20 pts (15%). Overly large gaps may reflect inflated ceilings on volatile players.',
  },
  {
    title: 'What this is not',
    content: 'This is a probabilistic filter, not a guarantee. Elite tier means ~40–60% of players in that bucket historically beat projection by 8+ pts — the other 40–60% did not. Use in combination with game theory, matchup analysis, and lineup construction strategy.',
  },
];

const AccordionItem: React.FC<{ section: Section }> = ({ section }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-ink/10 last:border-b-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between py-3 px-4 text-left hover:bg-ink/5 transition-colors"
      >
        <span className="text-[11px] font-black uppercase tracking-widest text-ink/70">{section.title}</span>
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-ink/40 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-ink/40 shrink-0" />
        )}
      </button>
      {open && (
        <div className="px-4 pb-4">
          <p className="text-[12px] text-ink/70 leading-relaxed whitespace-pre-line">{section.content}</p>
        </div>
      )}
    </div>
  );
};

export const MethodologyAccordion: React.FC = () => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-ink/10 rounded-sm bg-white/40">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-ink/5 transition-colors"
      >
        <span className="text-[11px] font-black uppercase tracking-widest text-ink/60">How this works</span>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-ink/40" />
        ) : (
          <ChevronRight className="w-4 h-4 text-ink/40" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-ink/10">
          {SECTIONS.map((s) => (
            <AccordionItem key={s.title} section={s} />
          ))}
        </div>
      )}
    </div>
  );
};
