import { useCallback } from 'react';
import type { Lineup, Player } from '../../types';

const LINEUP_SIZE = 8;
const SPACING_PAINT_THRESHOLD = 0.60;
const SPACING_SHOT_THRESHOLD = 0.60;
const SPACING_BONUS_POINTS = 1.25;
const SPACING_MIN_SHOOTERS_PER_TEAM = 2;

export function useLineupScoring(): {
  scoreLineups: (lineups: Lineup[], playerPool?: Player[]) => Lineup[];
} {
  const scoreLineups = useCallback((lineups: Lineup[], playerPool?: Player[]): Lineup[] => {
    const poolById = playerPool
      ? new Map(playerPool.map((p) => [p.id, p]))
      : null;

    const scored = lineups.map((lineup): Lineup => {
      const players: Player[] =
        lineup.players && lineup.players.length > 0
          ? lineup.players
          : poolById
          ? lineup.playerIds.map((id) => poolById.get(id)).filter((p): p is Player => Boolean(p))
          : [];

      // model_score: sum of modelProjection, falling back to projection
      let modelScore = 0;
      for (const p of players) {
        modelScore +=
          p.modelProjection != null ? p.modelProjection : (p.projection ?? 0);
      }

      // overperform_proba: mean across lineup, default missing to 0.5
      const overperformProba =
        players.length > 0
          ? players.reduce((sum, p) => sum + (p.overperformProba ?? 0.5), 0) /
            players.length
          : 0;

      // vlm_coverage: fraction of players with vlmCoverage === true
      const vlmCoverage =
        players.length > 0
          ? players.filter((p) => p.vlmCoverage === true).length / LINEUP_SIZE
          : 0;

      // spacing bonus detection
      const paintAnchors = players.filter(
        (p) => (p.paintGravityScore ?? 0) >= SPACING_PAINT_THRESHOLD,
      );
      const shooters = players.filter(
        (p) => (p.trueShotQuality ?? 0) >= SPACING_SHOT_THRESHOLD,
      );

      let spacingBonusApplied = false;
      let paintAnchor: string | null = null;

      const anchorTeams = new Set(paintAnchors.map((p) => p.team));
      for (const team of anchorTeams) {
        const teamShooters = shooters.filter((p) => p.team === team);
        if (teamShooters.length >= SPACING_MIN_SHOOTERS_PER_TEAM) {
          spacingBonusApplied = true;
          const topAnchor = paintAnchors
            .filter((p) => p.team === team)
            .sort((a, b) => (b.paintGravityScore ?? 0) - (a.paintGravityScore ?? 0))[0];
          paintAnchor = topAnchor?.name ?? null;
          break;
        }
      }

      const finalModelScore = spacingBonusApplied
        ? modelScore + SPACING_BONUS_POINTS
        : modelScore;

      // vlmNotes: collect non-null vlmNote strings
      const vlmNotes = players
        .map((p) => p.vlmNote)
        .filter((n): n is string => typeof n === 'string' && n.length > 0);

      return {
        ...lineup,
        modelScore: finalModelScore,
        overperformProba,
        vlmCoverage,
        spacingBonusApplied,
        paintAnchor,
        vlmNotes: vlmNotes.length > 0 ? vlmNotes : undefined,
      };
    });

    // sort by modelScore descending
    scored.sort((a, b) => (b.modelScore ?? 0) - (a.modelScore ?? 0));
    return scored;
  }, []);

  return { scoreLineups };
}
