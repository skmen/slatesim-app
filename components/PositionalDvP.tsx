import React, { useEffect, useMemo, useState } from 'react';
import { Player, GameInfo } from '../types';
import { Shield, TrendingDown, TrendingUp } from 'lucide-react';

interface Props {
  players: Player[];
  games: GameInfo[];
}

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

export const PositionalDvP: React.FC<Props> = ({ players, games }) => {
  const teamOptions = useMemo(() => {
    const teamMap = new Map<string, string>();
    if (games.length > 0) {
      games.forEach((game) => {
        teamMap.set(game.teamA.teamId, game.teamA.abbreviation || game.teamA.teamId);
        teamMap.set(game.teamB.teamId, game.teamB.abbreviation || game.teamB.teamId);
      });
    } else {
      players.forEach((player) => {
        const team = String(player.team || '').toUpperCase();
        if (team) teamMap.set(team, team);
      });
    }
    return Array.from(teamMap.entries())
      .map(([teamId, abbreviation]) => ({ teamId, abbreviation }))
      .sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));
  }, [games, players]);

  const [selectedTeam, setSelectedTeam] = useState('');

  useEffect(() => {
    if (teamOptions.length === 0) {
      setSelectedTeam('');
      return;
    }
    if (!teamOptions.some((team) => team.teamId === selectedTeam)) {
      setSelectedTeam(teamOptions[0].teamId);
    }
  }, [teamOptions, selectedTeam]);

  const selectedOpponents = useMemo(() => {
    if (!selectedTeam) return [];

    if (games.length > 0) {
      return games
        .filter((game) => game.teamA.teamId === selectedTeam || game.teamB.teamId === selectedTeam)
        .map((game) => (game.teamA.teamId === selectedTeam ? game.teamB : game.teamA));
    }

    const opponentIds = Array.from(
      new Set(
        players
          .filter((player) => player.team === selectedTeam && player.opponent)
          .map((player) => String(player.opponent).toUpperCase())
      )
    );

    return opponentIds.map((teamId) => ({
      teamId,
      abbreviation: teamId,
      name: teamId,
      seasonStats: {
        pace: 100,
        offensiveEfficiency: 112,
        defensiveEfficiency: 112,
      },
      positionalDvP: {},
    }));
  }, [games, players, selectedTeam]);

  const dvpData = useMemo(() => {
    return POSITIONS.map((position) => {
      const opponentRanks = selectedOpponents
        .map((team) => Number(team.positionalDvP?.[position]?.rank))
        .filter((rank) => Number.isFinite(rank) && rank > 0);

      const playerFallbackRanks = players
        .filter((player) => player.team === selectedTeam && player.position.includes(position))
        .map((player) => Number(player.dvpRank))
        .filter((rank) => Number.isFinite(rank) && rank > 0);

      const ranks = opponentRanks.length > 0 ? opponentRanks : playerFallbackRanks;
      const rank = ranks.length > 0
        ? ranks.reduce((sum, next) => sum + next, 0) / ranks.length
        : null;

      const status = rank === null
        ? 'neutral'
        : rank >= 22
          ? 'easy'
          : rank <= 10
            ? 'hard'
            : 'neutral';

      return {
        position,
        rank,
        status,
      };
    });
  }, [players, selectedOpponents, selectedTeam]);

  const opponentLabel = selectedOpponents.length > 0
    ? selectedOpponents.map((team) => team.abbreviation || team.teamId).join(', ')
    : '--';

  return (
    <div className="bg-white/40 rounded-sm border border-ink/10 p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Shield className="w-4 h-4 text-drafting-orange" />
        <h3 className="text-xs font-black uppercase tracking-widest text-ink/60">Positional DvP</h3>
      </div>

      <div className="mb-4">
        <label className="block text-[9px] font-black text-ink/40 uppercase tracking-widest mb-1">
          Team
        </label>
        <select
          value={selectedTeam}
          onChange={(e) => setSelectedTeam(e.target.value)}
          className="w-full bg-white/60 border border-ink/20 rounded-sm px-3 py-2 text-xs font-bold text-ink uppercase tracking-widest focus:border-drafting-orange outline-none"
        >
          {teamOptions.map((team) => (
            <option key={team.teamId} value={team.teamId}>
              {team.abbreviation}
            </option>
          ))}
        </select>
        <p className="mt-2 text-[9px] text-ink/40 font-mono uppercase tracking-wider">
          Opponent: {opponentLabel}
        </p>
      </div>

      <div className="space-y-3">
        {dvpData.map((item) => (
          <div key={item.position} className="flex items-center justify-between group">
            <div className="flex items-center gap-3">
              <span className="w-8 text-[10px] font-black text-ink/40 font-mono">{item.position}</span>
              <div className="h-1.5 w-24 bg-ink/10 rounded-sm overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    item.status === 'easy'
                      ? 'bg-emerald-600'
                      : item.status === 'hard'
                        ? 'bg-red-600'
                        : 'bg-drafting-orange'
                  }`}
                  style={{ width: `${((item.rank ?? 15) / 30) * 100}%` }}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono font-bold text-ink">
                {item.rank === null ? 'Rank --' : `Rank ${item.rank.toFixed(1)}`}
              </span>
              {item.status === 'easy' ? (
                <TrendingUp className="w-3 h-3 text-emerald-600" />
              ) : item.status === 'hard' ? (
                <TrendingDown className="w-3 h-3 text-red-600" />
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-ink/10">
        <p className="text-[9px] text-ink/40 italic font-mono uppercase tracking-tighter">
          * Lower rank indicates tougher defensive matchup
        </p>
      </div>
    </div>
  );
};
