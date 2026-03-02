import React, { useMemo } from 'react';
import { Player, GameInfo } from '../types';
import { BarChart2, AlertTriangle } from 'lucide-react';

interface Props {
  players: Player[];
  games: GameInfo[];
}

// Simple helper to bucket players by team
const groupByTeam = (players: Player[]) => {
  const map = new Map<string, Player[]>();
  players.forEach((p) => {
    if (!p.team) return;
    const key = p.team.toUpperCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  });
  return map;
};

const ReportView: React.FC<Props> = ({ players, games }) => {
  if (!Array.isArray(players) || !Array.isArray(games)) {
    return (
      <div className="min-h-screen bg-vellum text-ink p-4">
        <p className="text-sm text-ink/70">Report unavailable: no slate data loaded.</p>
      </div>
    );
  }
  const teamBuckets = useMemo(() => groupByTeam(players), [players]);

  // Compute per-team actual totals vs opponent
  const teamRows = useMemo(() => {
    if (!games || games.length === 0) return [];
    return games.map((g) => {
      const teamAPlayers = teamBuckets.get(g.teamA.abbreviation) || [];
      const teamBPlayers = teamBuckets.get(g.teamB.abbreviation) || [];
      const sumFpts = (list: Player[]) =>
        list.reduce((sum, p) => sum + (Number(p.actual ?? p.actualFpts ?? p.fpts ?? 0) || 0), 0);

      const aActual = sumFpts(teamAPlayers);
      const bActual = sumFpts(teamBPlayers);

      return {
        matchup: `${g.teamA.abbreviation} @ ${g.teamB.abbreviation}`,
        teamA: g.teamA.abbreviation,
        teamB: g.teamB.abbreviation,
        aActual,
        bActual,
        spread: g.spread,
        total: g.overUnder,
      };
    });
  }, [games, teamBuckets]);

  const Chart = ({ a, b, teamA, teamB }: { a: number; b: number; teamA: string; teamB: string }) => {
    const aVal = Number.isFinite(a) ? a : 0;
    const bVal = Number.isFinite(b) ? b : 0;
    const maxVal = Math.max(aVal, bVal, 1);
    const scale = (v: number) => (v / maxVal) * 100;
    return (
      <svg viewBox="0 0 320 140" className="w-full h-36">
        <rect x={40} y={20} width={100} height={scale(aVal)} rx={6} ry={6} fill="#0ea5e9" />
        <rect x={180} y={20} width={100} height={scale(bVal)} rx={6} ry={6} fill="#f97316" />
        <text x={90} y={15} textAnchor="middle" className="text-[10px] fill-ink">{teamA}</text>
        <text x={230} y={15} textAnchor="middle" className="text-[10px] fill-ink">{teamB}</text>
        <text x={90} y={scale(aVal) + 35} textAnchor="middle" className="text-[11px] fill-ink font-bold">{aVal.toFixed(1)} FPTS</text>
        <text x={230} y={scale(bVal) + 35} textAnchor="middle" className="text-[11px] fill-ink font-bold">{bVal.toFixed(1)} FPTS</text>
      </svg>
    );
  };

  return (
    <div className="min-h-screen bg-vellum text-ink p-4 space-y-6">
      <div className="flex items-center gap-3">
        <BarChart2 className="w-5 h-5 text-drafting-orange" />
        <h1 className="text-xl font-black uppercase tracking-widest">Projection vs Actual Report</h1>
      </div>
      <p className="text-sm text-ink/70 max-w-3xl">
        Quick look at how projections stacked up against actual fantasy points by team, alongside Vegas spread/total.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {teamRows.length === 0 && (
          <div className="p-4 bg-white border border-ink/10 rounded-xl text-ink/70">
            No games loaded for this slate. Load projections to view the report.
          </div>
        )}
        {teamRows.map((row) => (
          <div key={row.matchup} className="bg-white rounded-xl border border-ink/10 shadow-sm p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-ink">{row.matchup}</p>
                <p className="text-[11px] text-ink/60">Vegas: Spread {row.spread}, Total {row.total}</p>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-ink/60 uppercase tracking-widest">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
                Right vs Wrong
              </div>
            </div>

            <Chart a={row.aActual} b={row.bActual} teamA={row.teamA} teamB={row.teamB} />

            <div className="h-20 bg-white rounded-lg border border-ink/10 p-3 text-[12px] text-ink/80">
              <p className="font-bold text-ink mb-1">Vegas vs Result</p>
              <p>Actual FPTS — {row.teamA}: {row.aActual.toFixed(1)}, {row.teamB}: {row.bActual.toFixed(1)}</p>
              <p>Vegas: Spread {row.spread}, Total {row.total}</p>
              <p className="mt-1 flex items-center gap-1 text-amber-600"><AlertTriangle className="w-4 h-4" /> Replace with a richer chart as needed.</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ReportView;
