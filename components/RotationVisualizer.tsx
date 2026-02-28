import React, { useMemo } from 'react';
import { Player } from '../types';
import { Clock } from 'lucide-react';

interface Props {
  player: Player;
  isHistorical: boolean;
}

interface RotationBlock {
  startMinute: number; // 0-12 relative to quarter start
  endMinute: number;   // 0-12 relative to quarter start
  minutes: number;     // Total minutes played in this block
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  fpts: number;
  quarter: number;     // The quarter number (1-4)
}

interface RotationGame {
  date: string;
  opponent: string;
  blocks: RotationBlock[];
}

export const RotationVisualizer: React.FC<Props> = ({ player }) => {
  const sortGamesByDateDesc = <T extends { date: string }>(games: T[]): T[] => {
    return [...games].sort((a, b) => {
      const da = Date.parse(a.date);
      const db = Date.parse(b.date);
      if (Number.isFinite(da) && Number.isFinite(db)) return db - da;
      return String(b.date).localeCompare(String(a.date));
    });
  };

  const games = useMemo<RotationGame[]>(() => {
    const fromPlayByPlay = Array.isArray(player.last5PlayByPlay) ? player.last5PlayByPlay : [];
    if (fromPlayByPlay.length > 0) {
      const mapped = fromPlayByPlay.slice(-5).map((game: any) => ({
        date: String(game?.date || '--'),
        opponent: String(game?.opponentTeamId || '--'),
        blocks: (Array.isArray(game?.chunks) ? game.chunks : []).map((chunk: any) => {
            const rawQuarter = Number(chunk?.quarter);
            const quarter = !isNaN(rawQuarter) && rawQuarter >= 1 && rawQuarter <= 4 ? rawQuarter : 1;
            const startMinute = Number(chunk?.startMinute) || 0;
            const endMinute = Number(chunk?.endMinute) || 0;
            return {
              startMinute: startMinute,
              endMinute: endMinute,
              minutes: Number(chunk?.minutesPlayed) || 0,
              pts: Number(chunk?.points) || 0,
              reb: Number(chunk?.rebounds) || 0,
              ast: Number(chunk?.assists) || 0,
              stl: Number(chunk?.steals) || 0,
              blk: Number(chunk?.blocks) || 0,
              fpts: Number(chunk?.fantasyPoints) || 0,
              quarter: quarter,
            };
          }),
      }));
      return sortGamesByDateDesc(mapped);
    }

    const rotations = Array.isArray(player.rotations) ? player.rotations : [];
    const fallbackHistory = sortGamesByDateDesc((player.history || [])).slice(0, 5);
    const gamesFromHistory = fallbackHistory.map((game) => ({
      date: game.date,
      opponent: game.opponent,
      blocks: rotations.map((rotation) => ({
        startMinute: (Number(rotation.startSec) || 0) / 60,
        endMinute: (Number(rotation.endSec) || 0) / 60,
        minutes: rotation.stats?.minutes || 0,
        pts: rotation.stats?.pts || 0,
        reb: rotation.stats?.reb || 0,
        ast: rotation.stats?.ast || 0,
        stl: rotation.stats?.stl || 0,
        blk: Number(rotation.stats?.blk) || 0,
        fpts: Number(rotation.stats?.fpts) || 0,
        quarter: !isNaN(Number(rotation.period)) && Number(rotation.period) >= 1 && Number(rotation.period) <= 4 ? Number(rotation.period) : 1,
      })),
    }));
    if (gamesFromHistory.length > 0) return gamesFromHistory;
    if (rotations.length > 0) {
      return [{
        date: '--',
        opponent: player.opponent || '--',
        blocks: rotations.map((rotation) => ({
          startMinute: (Number(rotation.startSec) || 0) / 60,
          endMinute: (Number(rotation.endSec) || 0) / 60,
          minutes: rotation.stats?.minutes || 0,
          pts: rotation.stats?.pts || 0,
          reb: rotation.stats?.reb || 0,
          ast: rotation.stats?.ast || 0,
          stl: rotation.stats?.stl || 0,
          blk: Number(rotation.stats?.blk) || 0,
          fpts: Number(rotation.stats?.fpts) || 0,
          quarter: !isNaN(Number(rotation.period)) && Number(rotation.period) >= 1 && Number(rotation.period) <= 4 ? Number(rotation.period) : 1,
        })),
      }];
    }
    return [];
  }, [player]);

  return (
    <div className="bg-white/40 rounded-sm border border-ink/10 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-drafting-orange" />
          <h3 className="text-xs font-black uppercase tracking-widest text-ink/60">Rotation Visualizer</h3>
        </div>
        <span className="text-[10px] font-mono font-bold text-drafting-orange uppercase">Last 5 Games</span>
      </div>

      <div className="space-y-4">
        {games.length === 0 && (
          <div className="h-20 flex items-center justify-center border border-dashed border-ink/20 rounded-sm bg-ink/5">
            <span className="text-[10px] font-bold text-ink/40 uppercase tracking-widest">No rotation data available</span>
          </div>
        )}
        {games.map((game, gameIndex) => (
          <div key={`${game.date}-${gameIndex}`}>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] font-bold text-ink/60">vs {game.opponent}</span>
              <span className="text-[10px] font-mono text-ink/40">{game.date}</span>
            </div>

            <div className="relative h-7 bg-ink/5 rounded-sm border border-ink/20">
              {[0, 1, 2, 3].map((quarterIndex) => (
                <div
                  key={quarterIndex}
                  className="absolute top-0 bottom-0 w-0.5 bg-ink/35 z-10 pointer-events-none"
                  style={{ left: `${quarterIndex * 25}%` }}
                />
              ))}
              {[1, 2, 3, 4].map((quarterIndex) => (
                <div
                  key={`quarter-box-${quarterIndex}`}
                  className="absolute top-0 bottom-0 border-r border-ink/20 z-[5] pointer-events-none"
                  style={{ left: `${(quarterIndex - 1) * 25}%`, width: '25%' }}
                />
              ))}

              {/* Quarter labels */}
              {[1, 2, 3, 4].map((quarterNum) => (
                <span
                  key={`label-${quarterNum}`}
                  className="absolute top-full mt-1 text-[8px] text-ink/40 font-mono -translate-x-1/2"
                  style={{ left: `${(quarterNum - 0.5) * 25}%` }}
                >
                  Q{quarterNum}
                </span>
              ))}

              <div className="absolute inset-0 overflow-visible">
                {game.blocks.map((block, idx) => {
                  const q = Math.min(4, Math.max(1, Number(block.quarter) || 1));
                  const startInQuarter = Math.min(12, Math.max(0, Number(block.startMinute) || 0));
                  const endInQuarter = Math.min(12, Math.max(0, Number(block.endMinute) || 0));
                  const windowStart = Math.min(startInQuarter, endInQuarter);
                  const windowEnd = Math.max(startInQuarter, endInQuarter);
                  const windowDuration = Math.max(0, windowEnd - windowStart);
                  const playedMinutes = Math.max(0, Number(block.minutes) || 0);

                  let displayStart = windowStart;
                  let displayEnd = windowEnd;

                  // If the block is a larger quarter window but minutes played is partial,
                  // anchor the highlight at the end of that window.
                  if (windowDuration > 0 && playedMinutes > 0 && playedMinutes < windowDuration) {
                    displayStart = windowEnd - playedMinutes;
                    displayEnd = windowEnd;
                  } else if (windowDuration === 0 && playedMinutes > 0) {
                    displayStart = windowStart;
                    displayEnd = Math.min(12, windowStart + playedMinutes);
                  }

                  const duration = Math.max(0, displayEnd - displayStart);
                  if (duration <= 0) return null;

                  const quarterStartPercentage = (q - 1) * 25;
                  const left = Math.max(0, quarterStartPercentage + (displayStart / 12) * 25);
                  const width = Math.max(0.5, (duration / 12) * 25);

                  return (
                    <div
                      key={idx}
                      className="absolute top-1 bottom-1 bg-drafting-orange/80 rounded-sm group cursor-help z-20"
                      style={{ left: `${left}%`, width: `${width}%` }}
                    >
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-50 p-2 bg-white border border-ink/20 rounded-md shadow-lg text-xs whitespace-nowrap">
                        <div className="font-bold text-center mb-1">Stint Stats</div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-mono">
                          <span>MIN:</span><span className="text-right font-bold">{block.minutes.toFixed(1)}</span>
                          <span>PTS:</span><span className="text-right font-bold">{block.pts}</span>
                          <span>REB:</span><span className="text-right font-bold">{block.reb}</span>
                          <span>AST:</span><span className="text-right font-bold">{block.ast}</span>
                          <span>STL:</span><span className="text-right font-bold">{block.stl}</span>
                          <span>BLK:</span><span className="text-right font-bold">{block.blk}</span>
                          <span>FPTS:</span><span className="text-right font-bold text-drafting-orange">{block.fpts.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
