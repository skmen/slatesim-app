import React, { useState, useMemo } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { ClassifiedPlayer, TierType, sortPlayers } from '@/utils/classifyPlayers';
import { TierBadge, PosBadge } from './TierBadge';

interface PlayerTableProps {
  players: ClassifiedPlayer[];
  showActuals?: boolean;
}

type SortCol =
  | 'Player' | 'Pos' | 'Team' | 'OPP' | 'Salary'
  | 'Own' | 'Usage' | 'Proj' | 'Ceiling' | 'ceil_gap'
  | 'Floor' | 'Actual' | 'Tier';

const InfoIcon: React.FC<{ tooltip: string }> = ({ tooltip }) => (
  <span className="relative inline-flex group ml-1">
    <span className="text-ink/30 text-[9px] cursor-help leading-none">ℹ</span>
    <span className="pointer-events-none absolute left-1/2 bottom-full z-30 mb-2 w-64 -translate-x-1/2 rounded-md bg-ink px-2.5 py-2 text-[11px] leading-snug text-vellum opacity-0 shadow-lg transition-opacity group-hover:opacity-100 font-normal normal-case tracking-normal text-left">
      {tooltip}
    </span>
  </span>
);

interface ColDef {
  key: SortCol;
  label: string;
  tooltip: string;
  align?: 'right';
  sortable?: boolean;
}

const COLUMNS: ColDef[] = [
  { key: 'Player',   label: 'Player',  tooltip: 'Player name.',                                                                   sortable: true },
  { key: 'Pos',      label: 'Pos',     tooltip: 'DraftKings position. Dual-position players (e.g. SG/SF) are classified by primary position.', sortable: true },
  { key: 'Team',     label: 'Team',    tooltip: 'Team abbreviation.',                                                              sortable: true },
  { key: 'OPP',      label: 'OPP',     tooltip: 'Opponent abbreviation.',                                                          sortable: true },
  { key: 'Salary',   label: 'Salary',  tooltip: 'DraftKings salary.',                                                              align: 'right', sortable: true },
  { key: 'Own',      label: 'Own%',    tooltip: 'Projected ownership percentage. Ownership combined with usage is the strongest predictor of outperformance in backtesting.', align: 'right', sortable: true },
  { key: 'Usage',    label: 'Usg%',    tooltip: 'Projected usage rate — the percentage of team plays a player is involved in while on the floor. Key threshold: ≥22%, with position-specific ceilings (Centers must be under 28%).', align: 'right', sortable: true },
  { key: 'Proj',     label: 'Proj',    tooltip: 'Model projected fantasy points for this slate.',                                  align: 'right', sortable: true },
  { key: 'Ceiling',  label: 'Ceil',    tooltip: 'Upside ceiling projection — the score this player could achieve in an optimal game.',  align: 'right', sortable: true },
  { key: 'ceil_gap', label: 'Ceiling Gap', tooltip: 'Ceiling Gap = Ceiling minus Projection. Measures available upside. The 16–20 pt gap range correlated with highest overperformance rates (31%). Gaps above 20 may reflect inflated ceilings.', align: 'right', sortable: true },
  { key: 'Floor',    label: 'Floor',   tooltip: 'Downside floor projection — the score this player is likely to exceed even in a poor game.',  align: 'right', sortable: true },
  { key: 'Tier',     label: 'Tier',    tooltip: 'Hover the badge to see position-specific reasoning.', sortable: true },
];

// ─── Ceiling gap mini bar ──────────────────────────────────────────────────────

const GapBar: React.FC<{ gap: number }> = ({ gap }) => {
  const clamped = Math.min(Math.max(gap, 0), 30);
  const pct = (clamped / 30) * 100;
  const color = gap >= 16 ? 'bg-green-400' : gap >= 12 ? 'bg-amber-400' : 'bg-ink/20';

  return (
    <div className="flex items-center gap-1.5 justify-end">
      <span className="text-[11px] font-mono">{gap.toFixed(1)}</span>
      <div className="w-12 h-1.5 bg-ink/10 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

// ─── Ownership color ──────────────────────────────────────────────────────────

function ownColor(own: number): string {
  if (own >= 20) return 'text-green-700 font-bold';
  if (own >= 10) return 'text-green-600';
  if (own >= 5)  return 'text-ink';
  return 'text-ink/50';
}

// ─── Caution row style ────────────────────────────────────────────────────────

function rowStyle(tier: TierType): string {
  if (tier === 'CAUTION') return 'border-l-2 border-amber-400 opacity-80';
  return '';
}

// ─── Sort header ──────────────────────────────────────────────────────────────

const SortHeader: React.FC<{
  col: ColDef;
  sortCol: SortCol;
  sortDir: 'asc' | 'desc';
  onSort: (col: SortCol) => void;
}> = ({ col, sortCol, sortDir, onSort }) => {
  const active = sortCol === col.key;
  return (
    <th
      onClick={() => col.sortable !== false && onSort(col.key)}
      className={`${col.align === 'right' ? 'text-right' : 'text-left'} py-2 px-2 text-[9px] font-black uppercase tracking-widest text-ink/50 select-none whitespace-nowrap ${col.sortable !== false ? 'cursor-pointer hover:text-ink' : ''} ${active ? 'text-ink' : ''}`}
    >
      <span className="inline-flex items-center gap-0.5">
        {col.label}
        <InfoIcon tooltip={col.tooltip} />
        {active && sortDir === 'asc' && <ChevronUp className="w-3 h-3" />}
        {active && sortDir === 'desc' && <ChevronDown className="w-3 h-3" />}
      </span>
    </th>
  );
};

// ─── Why column ───────────────────────────────────────────────────────────────

const WhyCell: React.FC<{ condition: string; historicalRate: string; posReasoning: string }> = ({
  condition,
  historicalRate,
  posReasoning,
}) => (
  <td className="py-2 px-2">
    <span className="relative inline-flex group">
      <span className="text-[10px] text-ink/60 cursor-help">
        {condition}
        <span className="text-ink/40 ml-1">({historicalRate})</span>
      </span>
      <span className="pointer-events-none absolute left-0 bottom-full z-30 mb-2 w-72 rounded-md bg-ink px-2.5 py-2 text-[11px] leading-snug text-vellum opacity-0 shadow-lg transition-opacity group-hover:opacity-100 font-normal normal-case tracking-normal text-left">
        {posReasoning}
        <br /><span className="text-vellum/60 text-[10px]">Historical hit rate: {historicalRate}</span>
      </span>
    </span>
  </td>
);

// ─── Main component ───────────────────────────────────────────────────────────

export const PlayerTable: React.FC<PlayerTableProps> = ({ players, showActuals }) => {
  const [sortCol, setSortCol] = useState<SortCol>('Tier');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const handleSort = (col: SortCol) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const sorted = useMemo(
    () => sortPlayers(players, sortCol, sortDir),
    [players, sortCol, sortDir],
  );

  if (sorted.length === 0) {
    return (
      <div className="text-center py-12 text-ink/40 text-sm">
        No players match the current filters.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-sm border border-ink/10 bg-white/50">
      <table className="w-full min-w-[900px] border-collapse">
        <thead className="border-b border-ink/10 bg-white/60 sticky top-0">
          <tr>
            {COLUMNS.map((col) => (
              <SortHeader
                key={col.key}
                col={col}
                sortCol={sortCol}
                sortDir={sortDir}
                onSort={handleSort}
              />
            ))}
            {showActuals && (
              <SortHeader
                col={{ key: 'Actual', label: 'Actual', tooltip: 'Actual fantasy points scored.', align: 'right', sortable: true }}
                sortCol={sortCol}
                sortDir={sortDir}
                onSort={handleSort}
              />
            )}
            <th className="text-left py-2 px-2 text-[9px] font-black uppercase tracking-widest text-ink/50 whitespace-nowrap">
              Why
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => (
            <tr
              key={`${p.Player}-${i}`}
              className={`border-b border-ink/5 last:border-b-0 hover:bg-ink/5 transition-colors ${rowStyle(p.classification.tier)}`}
            >
              {/* Player */}
              <td className="py-2 px-2">
                <span className="text-[12px] font-bold text-ink">{p.Player}</span>
              </td>

              {/* Pos */}
              <td className="py-2 px-2">
                <PosBadge pos={p.Pos} pos_primary={p.pos_primary} />
              </td>

              {/* Team */}
              <td className="py-2 px-2 text-[11px] font-black uppercase tracking-widest text-ink/70">
                {p.Team}
              </td>

              {/* OPP */}
              <td className="py-2 px-2 text-[11px] text-ink/40">
                {p.OPP}
              </td>

              {/* Salary */}
              <td className="py-2 px-2 text-right text-[11px] font-mono text-ink/70">
                ${p.Salary.toLocaleString()}
              </td>

              {/* Own% */}
              <td className={`py-2 px-2 text-right text-[11px] font-mono ${ownColor(p.Own)}`}>
                {p.Own.toFixed(1)}%
              </td>

              {/* Usage% */}
              <td className="py-2 px-2 text-right">
                <span className={`text-[11px] font-mono ${p.Usage >= 22 && p.Usage < 28 ? 'text-blueprint font-bold' : p.Usage >= 28 ? 'text-red-600 font-bold' : 'text-ink/60'}`}>
                  {p.Usage.toFixed(1)}%
                </span>
              </td>

              {/* Proj */}
              <td className="py-2 px-2 text-right text-[12px] font-bold text-ink font-mono">
                {p.Proj.toFixed(1)}
              </td>

              {/* Ceil */}
              <td className="py-2 px-2 text-right text-[11px] font-mono text-ink/70">
                {p.Ceiling.toFixed(1)}
              </td>

              {/* Ceiling Gap */}
              <td className="py-2 px-2">
                <GapBar gap={p.ceil_gap} />
              </td>

              {/* Floor */}
              <td className="py-2 px-2 text-right text-[11px] font-mono text-ink/50">
                {p.Floor.toFixed(1)}
              </td>

              {/* Actuals (historical only) */}
              {showActuals && (
                <td className="py-2 px-2 text-right text-[11px] font-mono">
                  {p.Actual != null
                    ? <span className={p.Actual >= p.Proj ? 'text-green-600 font-bold' : 'text-red-500'}>{Number(p.Actual).toFixed(1)}</span>
                    : <span className="text-ink/30">—</span>
                  }
                </td>
              )}

              {/* Tier */}
              <td className="py-2 px-2">
                <TierBadge
                  tier={p.classification.tier}
                  pos_primary={p.pos_primary}
                  posReasoning={p.classification.posReasoning}
                />
              </td>

              {/* Why */}
              <WhyCell
                condition={p.classification.condition}
                historicalRate={p.classification.historicalRate}
                posReasoning={p.classification.posReasoning}
              />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
