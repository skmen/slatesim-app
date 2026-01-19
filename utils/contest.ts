
import { ContestInput, ContestDerived, Player, GameInfo, Lineup, ContestState } from '../types';

export const DEFAULT_CONTEST: ContestInput = {
  contestName: "Main Slate",
  site: "DraftKings",
  fieldSize: 1000,
  entryFee: 10,
  maxEntries: 20,
  rakePct: 0.159,
  paidPctGuess: 0.22,
};

// Qualitative Thresholds
export const getContestViability = (lineup: Lineup) => {
  if ((lineup.missingCount || 0) > 0 || (lineup.players?.length || 0) < 8) {
    return { label: 'Incomplete', color: 'amber' };
  }
  const roi = lineup.simROI ?? 0;
  if (roi >= 10) return { label: 'High Value', color: 'emerald' };
  if (roi >= -5) return { label: 'Fair Value', color: 'amber' };
  return { label: 'Negative EV', color: 'red' };
};

export const getFieldAlignment = (lineup: Lineup) => {
  if ((lineup.missingCount || 0) > 0 || (lineup.players?.length || 0) < 8) {
    return { label: 'Unknown', color: 'amber' };
  }
  const own = lineup.totalOwnership ?? 0;
  if (own > 140) return { label: 'Chalky', color: 'red' };
  if (own < 90) return { label: 'Contrarian', color: 'emerald' };
  return { label: 'Balanced', color: 'blue' };
};

export const getUpsideQuality = (lineup: Lineup) => {
  if ((lineup.missingCount || 0) > 0 || (lineup.players?.length || 0) < 8) {
    return { label: 'Low Info', color: 'amber' };
  }
  const ceiling = lineup.totalCeiling ?? 0;
  const proj = lineup.totalProjection ?? 0;
  const ratio = proj > 0 ? ceiling / proj : 0;
  
  if (ratio > 1.45) return { label: 'High Ceiling', color: 'emerald' };
  if (ratio > 1.3) return { label: 'GPP Equity', color: 'blue' };
  return { label: 'Cash Safe', color: 'amber' };
};

export const formatMoney = (amount: number): string => {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
};

export const formatPct = (val: number, decimals = 1): string => {
  return `${(val * 100).toFixed(decimals)}%`;
};

export const assignDraftKingsSlots = (players: Player[]): { slotMap: Record<string, Player>, unassigned: Player[] } => {
  const DK_SLOTS = ['C', 'PG', 'SG', 'SF', 'PF', 'G', 'F', 'UTIL'];
  const slotMap: Record<string, Player> = {};
  let remainingPlayers = [...players];

  const isEligible = (p: Player, slot: string): boolean => {
    const pos = p.position.toUpperCase();
    if (slot === 'UTIL') return true;
    if (slot === 'G') return pos.includes('PG') || pos.includes('SG');
    if (slot === 'F') return pos.includes('SF') || pos.includes('PF');
    return pos.includes(slot);
  };

  const getEligibleSlotCount = (p: Player) => {
    return DK_SLOTS.filter(s => isEligible(p, s)).length;
  };

  remainingPlayers.sort((a, b) => {
    const countA = getEligibleSlotCount(a);
    const countB = getEligibleSlotCount(b);
    if (countA !== countB) return countA - countB;
    if (a.salary !== b.salary) return b.salary - a.salary;
    return a.name.localeCompare(b.name);
  });

  for (const slot of DK_SLOTS) {
    const idx = remainingPlayers.findIndex(p => isEligible(p, slot));
    if (idx !== -1) {
      slotMap[slot] = remainingPlayers[idx];
      remainingPlayers.splice(idx, 1);
    }
  }

  return { slotMap, unassigned: remainingPlayers };
};

export const getLineupSignal = (lineup: Lineup, contest?: ContestState): { status: 'green' | 'yellow' | 'red', label: string } => {
  if ((lineup.missingCount || 0) > 0 || (lineup.players?.length || 0) < 8) {
    return { status: 'red', label: 'Error' };
  }
  if (!contest) return { status: 'yellow', label: 'No Context' };
  
  const viability = getContestViability(lineup);
  if (viability.label === 'High Value') return { status: 'green', label: 'High EV' };
  if (viability.label === 'Negative EV') return { status: 'red', label: 'Bad Play' };
  return { status: 'yellow', label: 'Neutral' };
};

export function recomputeLineupDisplay(
  lineups: Lineup[],
  contestState?: ContestState,
  referencePlayers?: Player[]
): Lineup[] {
  const entryFee = contestState?.input.entryFee || 0;

  return lineups.map(l => {
    const updatedLineup = { ...l };
    const simEV = l.simEV !== undefined ? l.simEV : l.simMeanScore;
    if (simEV !== undefined && entryFee > 0) {
      updatedLineup.simROI = (simEV / entryFee) * 100;
    }

    if (l.players && l.players.length > 0) {
      let currentOwnSum = l.players.reduce((sum, p) => sum + (p.ownership || 0), 0);
      let currentCeilSum = l.players.reduce((sum, p) => sum + (p.ceiling || 0), 0);

      if ((currentOwnSum === 0 || currentCeilSum === 0) && referencePlayers && referencePlayers.length > 0) {
        let hydratedOwn = 0;
        let hydratedCeil = 0;
        let matchedCount = 0;

        l.players.forEach(p => {
          const normP = p.name.toLowerCase().replace(/[^a-z]/g, '');
          const ref = referencePlayers.find(rp => 
            rp.id === p.id || 
            (rp.name.toLowerCase().replace(/[^a-z]/g, '') === normP && rp.team.toUpperCase() === p.team.toUpperCase())
          );

          if (ref) {
            hydratedOwn += (ref.ownership || 0);
            hydratedCeil += (ref.ceiling || 0);
            matchedCount++;
          } else {
            hydratedOwn += (p.ownership || 0);
            hydratedCeil += (p.ceiling || 0);
          }
        });

        if (matchedCount > 0) {
          updatedLineup.totalOwnership = hydratedOwn;
          updatedLineup.totalCeiling = hydratedCeil;
        } else {
          updatedLineup.totalOwnership = currentOwnSum;
          updatedLineup.totalCeiling = currentCeilSum;
        }
      } else {
        updatedLineup.totalOwnership = currentOwnSum;
        updatedLineup.totalCeiling = currentCeilSum;
      }
    }
    return updatedLineup;
  });
}

export const deriveGamesFromPlayers = (players: Player[]): GameInfo[] => {
  const matchups = new Map<string, GameInfo>();
  players.forEach(p => {
    const team = p.team?.toUpperCase();
    const opp = p.opponent?.toUpperCase();
    if (team && opp && opp !== 'UNK' && team !== opp) {
      const sortedTeams = [team, opp].sort();
      const key = sortedTeams.join('_vs_');
      if (!matchups.has(key)) {
        matchups.set(key, { matchupKey: key, teamA: sortedTeams[0], teamB: sortedTeams[1] });
      }
    }
  });
  return Array.from(matchups.values()).sort((a, b) => a.matchupKey.localeCompare(b.matchupKey));
};

export const deriveContest = (input: ContestInput): ContestDerived => {
  const { fieldSize, entryFee, rakePct, paidPctGuess, prizePoolOverride, maxEntries } = input;
  const totalEntryFees = fieldSize * entryFee;
  const prizePool = prizePoolOverride !== undefined && prizePoolOverride > 0 ? prizePoolOverride : totalEntryFees * (1 - rakePct);
  const effectiveRakePct = prizePoolOverride !== undefined && totalEntryFees > 0 ? 1 - (prizePool / totalEntryFees) : rakePct;
  const portfolioCoveragePct = fieldSize > 0 ? maxEntries / fieldSize : 0;
  const estimatedPaidPlaces = Math.floor(fieldSize * paidPctGuess);
  const expectedFieldLossLabel = `Field Loss: ~${formatPct(effectiveRakePct)}`;
  return {
    totalEntryFees, prizePool, rakePct: effectiveRakePct, expectedFieldLossPct: effectiveRakePct,
    expectedFieldLossLabel, portfolioCoveragePct, estimatedPaidPlaces, estimatedMinCash: entryFee * 2,
    notes: []
  };
};

export const CONTEST_PRESETS = [
  { name: "Quarter Jukebox", site: "DraftKings", entryFee: 0.25, fieldSize: 4756, maxEntries: 20, rakePct: 0.159 },
  { name: "Milly Maker", site: "DraftKings", entryFee: 20, fieldSize: 200000, maxEntries: 150, rakePct: 0.16 },
  { name: "Single Entry (mid)", site: "DraftKings", entryFee: 12, fieldSize: 2500, maxEntries: 1, rakePct: 0.15 }
];
