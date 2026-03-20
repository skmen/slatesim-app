import React, { useState, useMemo } from 'react';
import { Star, AlertTriangle } from 'lucide-react';
import {
  classifyAllPlayers,
  ClassifiedPlayer,
  RawPlayerRow,
} from '@/utils/classifyPlayers';
import { SummaryCards } from './slate/SummaryCards';
import { FilterBar, PosFilter, TierFilter } from './slate/FilterBar';
import { PlayerTable } from './slate/PlayerTable';
import { OveruseWarning } from './slate/OveruseWarning';
import { Player } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SlateRecommendationsProps {
  players: Player[];
  showActuals?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fuzzyMatch(haystack: string, needle: string): boolean {
  if (!needle) return true;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function playersToRawRows(players: Player[]): RawPlayerRow[] {
  return players.map((p) => ({
    Player: p.name,
    Team: p.team,
    OPP: p.opponent ?? '',
    Pos: p.position,
    Salary: p.salary ?? 0,
    Value: p.value ?? 0,
    Own: p.ownership ?? 0,
    Usage: p.usageRate ?? 0,
    Min: p.minutesProjection ?? 0,
    Proj: p.projection ?? 0,
    Ceiling: p.ceiling ?? 0,
    Floor: p.floor ?? 0,
    Lev_Score: 0,
    Boom: null,
    Bust: null,
    Actual: p.actual ?? null,
  }));
}

// ─── Main component ───────────────────────────────────────────────────────────

export const SlateRecommendations: React.FC<SlateRecommendationsProps> = ({ players, showActuals }) => {
  // ── Filter state ──────────────────────────────────────────────────────────
  const [posFilter, setPosFilter] = useState<PosFilter>('ALL');
  const [tierFilter, setTierFilter] = useState<TierFilter>('ALL');
  const [salaryRange, setSalaryRange] = useState<[number, number]>([3000, 15000]);
  const [searchQuery, setSearchQuery] = useState('');

  // ── Classify from slate players ───────────────────────────────────────────
  const classifiedData = useMemo<ClassifiedPlayer[]>(() => {
    if (!players || players.length === 0) return [];
    const rows = playersToRawRows(players);
    return classifyAllPlayers(rows);
  }, [players]);

  // ── Salary bounds derived from data ───────────────────────────────────────
  const salaryBounds = useMemo<[number, number]>(() => {
    if (classifiedData.length === 0) return [3000, 15000];
    const salaries = classifiedData.map((p) => p.Salary);
    return [
      Math.floor(Math.min(...salaries) / 100) * 100,
      Math.ceil(Math.max(...salaries) / 100) * 100,
    ];
  }, [classifiedData]);

  // Reset salary range when data changes
  const effectiveSalaryRange = useMemo<[number, number]>(() => {
    if (salaryRange[0] === 3000 && salaryRange[1] === 15000 && classifiedData.length > 0) {
      return salaryBounds;
    }
    return salaryRange;
  }, [salaryRange, salaryBounds, classifiedData]);

  // ── Derived data ──────────────────────────────────────────────────────────

  const overusePlayers = useMemo(
    () => classifiedData.filter((p) => p.classification.tier === 'OVERUSE_WARNING'),
    [classifiedData],
  );

  const mainPlayers = useMemo(
    () => classifiedData.filter((p) => p.classification.tier !== 'OVERUSE_WARNING'),
    [classifiedData],
  );

  const filteredPlayers = useMemo(() => {
    return mainPlayers.filter((p) => {
      if (posFilter !== 'ALL' && p.pos_primary !== posFilter) return false;
      if (tierFilter !== 'ALL' && p.classification.tier !== tierFilter) return false;
      if (p.Salary < effectiveSalaryRange[0] || p.Salary > effectiveSalaryRange[1]) return false;
      if (searchQuery && !fuzzyMatch(p.Player, searchQuery)) return false;
      return true;
    });
  }, [mainPlayers, posFilter, tierFilter, effectiveSalaryRange, searchQuery]);

  const counts = useMemo(() => {
    const all = classifiedData.filter((p) => p.classification.tier !== 'OVERUSE_WARNING');
    return {
      total: all.length,
      elite: all.filter((p) => p.classification.tier === 'ELITE').length,
      sweet_spot: all.filter((p) => p.classification.tier === 'SWEET_SPOT').length,
      broad: all.filter((p) => p.classification.tier === 'BROAD').length,
      caution: all.filter((p) => p.classification.tier === 'CAUTION').length,
    };
  }, [classifiedData]);

  const hasData = classifiedData.length > 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 pb-8">
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Star className="w-4 h-4 text-drafting-orange" />
            <h1 className="text-[11px] font-black uppercase tracking-widest text-drafting-orange">
              Slate Recommendations
            </h1>
          </div>
          <p className="text-[13px] text-ink/60 mt-1">
            Players meeting historical overperformance criteria
          </p>
        </div>

        {hasData && (
          <span className="text-[10px] font-black uppercase tracking-widest text-ink/50 border border-ink/15 rounded-sm px-2 py-1 shrink-0">
            {counts.total} qualifying
          </span>
        )}
      </div>

      {/* ── Disclaimer ──────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3 border border-amber-200 bg-amber-50 rounded-sm px-4 py-3">
        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <p className="text-[12px] text-amber-800 leading-relaxed">
          <span className="font-black uppercase tracking-widest">What this is not — </span>
          This is a probabilistic filter, not a guarantee. Elite tier means ~40–60% of players in that bucket historically beat projection by 8+ pts — the other 40–60% did not. Use in combination with game theory, matchup analysis, and lineup construction strategy.
        </p>
      </div>

      {/* ── No data state ────────────────────────────────────────────────── */}
      {!hasData && (
        <div className="border border-ink/10 bg-white/40 rounded-sm px-4 py-8 text-center">
          <p className="text-[12px] text-ink/50">No qualifying players found in the current slate.</p>
          <p className="text-[11px] text-ink/35 mt-1">Load a slate with ownership and usage projections to see recommendations.</p>
        </div>
      )}

      {/* ── Data loaded ──────────────────────────────────────────────────── */}
      {hasData && (
        <div className="space-y-4">
          <SummaryCards counts={counts} />

          <FilterBar
            posFilter={posFilter}
            tierFilter={tierFilter}
            salaryRange={effectiveSalaryRange}
            salaryBounds={salaryBounds}
            searchQuery={searchQuery}
            onPosChange={setPosFilter}
            onTierChange={setTierFilter}
            onSalaryChange={setSalaryRange}
            onSearchChange={setSearchQuery}
          />

          <PlayerTable players={filteredPlayers} showActuals={showActuals} />

          <OveruseWarning players={overusePlayers} />
        </div>
      )}
    </div>
  );
};

export default SlateRecommendations;
