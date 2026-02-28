import React, { useMemo } from 'react';
import { Player, GameInfo } from '../types';
import { Swords, Users, Zap } from 'lucide-react';

interface Props {
  players: Player[];
  games: GameInfo[];
  selectedMatchupKey: string;
  selectedTeams: string[];
  onSelectAllMatchups: () => void;
  onToggleMatchup: (matchupKey: string) => void;
  onToggleTeam: (teamId: string) => void;
}

export const MatchupEngine: React.FC<Props> = ({
  players,
  games,
  selectedMatchupKey,
  selectedTeams,
  onSelectAllMatchups,
  onToggleMatchup,
  onToggleTeam,
}) => {
  const ALL_MATCHUPS_KEY = 'ALL_MATCHUPS';

  const formatGameTimeET = (value: string | undefined): string => {
    if (!value) return 'TBD';
    const raw = String(value).trim();
    if (!raw) return 'TBD';
    if (/(ET|EST|EDT)$/i.test(raw)) {
      return raw.replace(/\b(EST|EDT)\b/i, 'ET');
    }
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) {
      const time = new Date(parsed).toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
      });
      return `${time} ET`;
    }
    if (/\bAM\b|\bPM\b/i.test(raw)) return `${raw} ET`;
    return raw;
  };

  const clamp = (val: number, min: number, max: number) => Math.min(max, Math.max(min, val));

  const getPaceColor = (pace: number) => {
    const t = clamp((pace - 90) / 13, 0, 1);
    // Interpolate from blue to red without passing through green.
    const start = { r: 37, g: 99, b: 235 }; // blue-600
    const end = { r: 239, g: 68, b: 68 }; // red-500
    const r = Math.round(start.r + (end.r - start.r) * t);
    const g = Math.round(start.g + (end.g - start.g) * t);
    const b = Math.round(start.b + (end.b - start.b) * t);
    return `rgb(${r}, ${g}, ${b})`;
  };

  const getPaceWidth = (pace: number) => {
    const t = clamp((pace - 90) / 13, 0, 1);
    return `${(t * 100).toFixed(0)}%`;
  };

  const matchupStats = useMemo(() => {
    return games
      .map((game) => {
        const pace =
          ((game.teamA?.seasonStats?.pace || 100) + (game.teamB?.seasonStats?.pace || 100)) / 2;
        const hasVegasOdds = game.overUnder > 0 && game.spread !== 0;
        return {
          ...game,
          pace,
          hasVegasOdds,
        };
      })
      .sort((a, b) => b.overUnder - a.overUnder);
  }, [games]);

  return (
    <div className="bg-white/40 rounded-sm border border-ink/10 p-3 shadow-sm mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Swords className="w-4 h-4 text-drafting-orange" />
        <h3 className="text-xs font-black uppercase tracking-widest text-ink/60">Matchup Engine</h3>
      </div>

      <div className="flex overflow-x-auto gap-3 pb-2 snap-x scrollbar-hide">
        <div
          onClick={onSelectAllMatchups}
          className={`flex-shrink-0 w-40 bg-white/40 rounded-sm p-2 border transition-colors cursor-pointer snap-start flex flex-col justify-center items-center ${
            selectedMatchupKey === ALL_MATCHUPS_KEY && selectedTeams.length === 0
              ? 'border-drafting-orange bg-drafting-orange/5'
              : 'border-ink/10 hover:border-drafting-orange/30'
          }`}
        >
          <Users className="w-5 h-5 text-ink/40 mb-1.5" />
          <span className="text-[11px] font-black uppercase tracking-widest text-ink/60">All Matchups</span>
        </div>

        {matchupStats.map((match) => {
          const isSelected = selectedMatchupKey === match.matchupKey;
          const teamASelected = selectedTeams.includes(match.teamA.teamId);
          const teamBSelected = selectedTeams.includes(match.teamB.teamId);

          const isDoubleDigitSpread = Number.isFinite(match.spread) && Math.abs(match.spread) >= 10;
          return (
            <div
              key={match.matchupKey}
              onClick={() => onToggleMatchup(match.matchupKey)}
              className={`flex-shrink-0 ${isDoubleDigitSpread ? 'w-64' : 'w-56'} bg-white/40 rounded-sm p-2.5 border transition-colors cursor-pointer snap-start ${
                isSelected ? 'border-drafting-orange bg-drafting-orange/5' : 'border-ink/10 hover:border-drafting-orange/30'
              }`}
            >
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-1 text-sm font-black italic text-ink">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleTeam(match.teamA.teamId);
                    }}
                    className={`transition-colors ${
                      teamASelected ? 'text-white bg-drafting-orange px-1.5 py-0.5 rounded-sm' : 'text-ink hover:text-drafting-orange'
                    }`}
                  >
                    {match.teamA.abbreviation}
                  </button>
                  <span className="text-[10px] text-ink/40 font-mono">@</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleTeam(match.teamB.teamId);
                    }}
                    className={`transition-colors ${
                      teamBSelected ? 'text-white bg-drafting-orange px-1.5 py-0.5 rounded-sm' : 'text-ink hover:text-drafting-orange'
                    }`}
                  >
                    {match.teamB.abbreviation}
                  </button>
                </div>

                <div className="text-[10px] font-black text-ink/50 uppercase tracking-widest">
                  {formatGameTimeET(match.gameTime)}
                </div>
              </div>

              <div className="space-y-2">
                {match.hasVegasOdds ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="relative bg-ink/5 rounded-sm p-1.5 border border-ink/10">
                      <span className="absolute -top-2 left-3 bg-vellum px-1 text-[11px] font-mono font-black text-ink/40 uppercase translate-y-[2px]">
                        Total
                      </span>
                      <div className="pt-2 text-[14px] font-black text-ink">{match.overUnder.toFixed(1)}</div>
                    </div>
                    <div className="relative bg-ink/5 rounded-sm p-1.5 border border-ink/10">
                      <span className="absolute -top-2 left-3 bg-vellum px-1 text-[11px] font-mono font-black text-ink/40 uppercase translate-y-[2px]">
                        Spread
                      </span>
                      <div className="pt-2 text-[14px] font-black text-ink">
                        {match.spread > 0 ? '+' : ''}{match.spread.toFixed(1)}
                        {(() => {
                          if (match.spread === 0) return null;
                          const team = match.spread < 0 ? match.teamA.abbreviation : match.teamB.abbreviation;
                          return ` (${team})`;
                        })()}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-ink/5 rounded-sm p-2 border border-ink/10 text-[10px] font-black text-ink/50 uppercase text-center tracking-wide">
                    Vegas odds not available
                  </div>
                )}
                <div className="relative bg-ink/5 rounded-sm p-1.5 border border-ink/10 space-y-1">
                  <span className="absolute -top-2 left-3 bg-vellum px-1 text-[11px] font-mono font-black text-ink/40 uppercase translate-y-[2px] flex items-center gap-1">
                    Pace
                    {match.pace > 100 && <Zap className="w-3 h-3 text-drafting-orange" />}
                  </span>
                  <div className="pt-1" />
                  <div className="h-4.5 bg-ink/10 overflow-hidden">
                    <div
                      className="h-full transition-all flex items-center justify-end pr-2"
                      style={{
                        width: getPaceWidth(match.pace),
                        background: getPaceColor(match.pace),
                      }}
                    >
                      <span className="text-[14px] font-black text-white">{match.pace.toFixed(1)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
