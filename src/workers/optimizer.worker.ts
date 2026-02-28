
import { Player, Lineup } from '../../types';

// Helper to check if a player can fit into a specific DK slot
const canFitDK = (player: Player, slot: string): boolean => {
  const pos = player.position;
  switch (slot) {
    case 'PG': return pos.includes('PG');
    case 'SG': return pos.includes('SG');
    case 'SF': return pos.includes('SF');
    case 'PF': return pos.includes('PF');
    case 'C': return pos.includes('C');
    case 'G': return pos.includes('PG') || pos.includes('SG');
    case 'F': return pos.includes('SF') || pos.includes('PF');
    case 'UTIL': return true;
    default: return false;
  }
};

const DK_SLOTS = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'];

const makeRng = (seed: number) => {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
};

const solveLineup = (
  players: Player[], 
  config: any, 
  exposureMap: Record<string, number>,
  iteration: number,
  rng: () => number
): Lineup | null => {
  const { salaryCap, maxExposure, numLineups } = config;
  const remainingLineups = Math.max(1, (Number(numLineups) || 0) - iteration);
  
  // Greedy sort: prioritize raw projection (with exposure penalty),
  // then higher salary to avoid leaving excessive cap unused.
  const scoredPlayers = players.map((player) => {
    const exp = (exposureMap[player.id] || 0) / (iteration || 1);
    const maxExpRaw = Number((player as any).optimizerMaxExposure);
    const minExpRaw = Number((player as any).optimizerMinExposure);
    const maxExp = Number.isFinite(maxExpRaw) && maxExpRaw > 0 ? maxExpRaw : undefined;
    const minExp = Number.isFinite(minExpRaw) && minExpRaw > 0 ? minExpRaw : undefined;
    const maxLimit = Number.isFinite(Number(maxExp)) ? Number(maxExp) : maxExposure;
    const minLimit = Number.isFinite(Number(minExp)) ? Number(minExp) : 0;
    const expPct = exp * 100;
    const penalty = expPct > maxLimit ? 0.001 : 1;
    const minTarget = Number.isFinite(minExp)
      ? Math.ceil(((minExp || 0) / 100) * (Number(numLineups) || 0))
      : 0;
    const deficit = Math.max(0, minTarget - (exposureMap[player.id] || 0));
    const minBoost = expPct < minLimit ? 1.25 : 1;
    const deficitBonus = deficit > 0 ? (deficit / remainingLineups) * 2 : 0;
    const priority = Number((player as any).optimizerPriority ?? 0);
    const bonus = Number((player as any).optimizerBonus ?? 0);
    const ceiling = Number((player as any).ceiling ?? 0) || 0;
    const score = (priority * 1_000_000) + (bonus * 10_000) + ((player.projection + deficitBonus) * penalty * minBoost) + (ceiling * 2) + (rng() * 0.5);
    return { player, score };
  });

  const sortedPlayers = scoredPlayers
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.player.salary - a.player.salary;
    })
    .map((entry) => entry.player);

  const selectedPlayerIds: string[] = [];
  const slotMap: Record<string, string> = {};
  let currentSalary = 0;
  let currentProjection = 0;

  const lockedPlayers = players.filter((p) => (p as any).optimizerLocked);
  const slotOptionsByPlayer = lockedPlayers
    .map((player) => ({
      player,
      slots: DK_SLOTS.filter((slot) => canFitDK(player, slot)),
    }))
    .sort((a, b) => a.slots.length - b.slots.length);

  const assignLocked = (idx: number, usedSlots: Set<string>): boolean => {
    if (idx >= slotOptionsByPlayer.length) return true;
    const { player, slots } = slotOptionsByPlayer[idx];
    for (const slot of slots) {
      if (usedSlots.has(slot)) continue;
      if (selectedPlayerIds.includes(player.id)) continue;
      if (currentSalary + player.salary > salaryCap) continue;
      selectedPlayerIds.push(player.id);
      slotMap[slot] = player.id;
      usedSlots.add(slot);
      currentSalary += player.salary;
      currentProjection += player.projection;
      if (assignLocked(idx + 1, usedSlots)) return true;
      selectedPlayerIds.pop();
      delete slotMap[slot];
      usedSlots.delete(slot);
      currentSalary -= player.salary;
      currentProjection -= player.projection;
    }
    return false;
  };

  if (lockedPlayers.length > 0) {
    const ok = assignLocked(0, new Set<string>());
    if (!ok) return null;
  }

  const assignRequiredPlayers = (playersToAssign: Player[]): boolean => {
    const candidates = playersToAssign.filter((player) => !selectedPlayerIds.includes(player.id));
    if (candidates.length === 0) return true;

    const baselineSelectedCount = selectedPlayerIds.length;
    const baselineSalary = currentSalary;
    const baselineProjection = currentProjection;
    const baselineSlotMap = { ...slotMap };

    const slotOptions = candidates
      .map((player) => ({
        player,
        slots: DK_SLOTS.filter((slot) => canFitDK(player, slot)),
      }))
      .sort((a, b) => a.slots.length - b.slots.length);

    const usedSlots = new Set<string>(Object.keys(slotMap));

    const assign = (idx: number): boolean => {
      if (idx >= slotOptions.length) return true;
      const { player, slots } = slotOptions[idx];
      for (const slot of slots) {
        if (usedSlots.has(slot)) continue;
        if (selectedPlayerIds.includes(player.id)) continue;
        if (currentSalary + player.salary > salaryCap) continue;
        selectedPlayerIds.push(player.id);
        slotMap[slot] = player.id;
        usedSlots.add(slot);
        currentSalary += player.salary;
        currentProjection += player.projection;
        if (assign(idx + 1)) return true;
        selectedPlayerIds.pop();
        delete slotMap[slot];
        usedSlots.delete(slot);
        currentSalary -= player.salary;
        currentProjection -= player.projection;
      }
      return false;
    };

    const ok = assign(0);
    if (!ok) {
      selectedPlayerIds.length = baselineSelectedCount;
      currentSalary = baselineSalary;
      currentProjection = baselineProjection;
      Object.keys(slotMap).forEach((key) => delete slotMap[key]);
      Object.assign(slotMap, baselineSlotMap);
    }
    return ok;
  };

  if (Number(numLineups) > 0) {
    const deficitEntries = players
      .map((player) => {
        const minExpRaw = Number((player as any).optimizerMinExposure);
        if (!Number.isFinite(minExpRaw) || minExpRaw <= 0) return null;
        const minTarget = Math.ceil((minExpRaw / 100) * Number(numLineups));
        const current = exposureMap[player.id] || 0;
        const deficit = minTarget - current;
        if (deficit <= 0) return null;
        const mustInclude = deficit >= remainingLineups;
        return {
          player,
          deficit,
          mustInclude,
          priority: Number((player as any).optimizerPriority ?? 0),
          projection: player.projection,
        };
      })
      .filter(Boolean) as Array<{
        player: Player;
        deficit: number;
        mustInclude: boolean;
        priority: number;
        projection: number;
      }>;

    if (deficitEntries.length > 0) {
      const maxSlots = DK_SLOTS.length - selectedPlayerIds.length;
      const mustIncludePlayers = deficitEntries
        .filter((entry) => entry.mustInclude)
        .sort((a, b) => b.deficit - a.deficit)
        .map((entry) => entry.player);

      const totalDeficit = deficitEntries.reduce((sum, entry) => sum + entry.deficit, 0);
      const desiredCount = Math.max(mustIncludePlayers.length, Math.ceil(totalDeficit / remainingLineups));
      const extraCount = Math.max(0, Math.min(maxSlots - mustIncludePlayers.length, desiredCount - mustIncludePlayers.length));
      const extraCandidates = deficitEntries
        .filter((entry) => !entry.mustInclude)
        .sort((a, b) => {
          if (b.deficit !== a.deficit) return b.deficit - a.deficit;
          if (b.priority !== a.priority) return b.priority - a.priority;
          return b.projection - a.projection;
        })
        .map((entry) => entry.player);

      let extraLimit = Math.min(extraCount, extraCandidates.length);
      let assigned = false;
      while (!assigned) {
        let rotatedExtras = extraCandidates;
        if (extraCandidates.length > 1 && extraLimit > 0) {
          const offsetBase = iteration + Math.floor(rng() * extraCandidates.length);
          const offset = offsetBase % extraCandidates.length;
          rotatedExtras = [
            ...extraCandidates.slice(offset),
            ...extraCandidates.slice(0, offset),
          ];
        }
        const requiredPlayers = [
          ...mustIncludePlayers,
          ...rotatedExtras.slice(0, extraLimit),
        ];
        if (requiredPlayers.length === 0) {
          assigned = true;
          break;
        }
        const ok = assignRequiredPlayers(requiredPlayers);
        if (ok) {
          assigned = true;
          break;
        }
        if (extraLimit > 0) {
          extraLimit -= 1;
          continue;
        }
        return null;
      }
    }
  }

  // Simple backtracking or greedy with slot checking
  const shuffleTop = <T,>(arr: T[], topCount: number) => {
    const copy = [...arr];
    const n = Math.min(topCount, copy.length);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  const fillSlots = (slotIdx: number): boolean => {
    if (slotIdx === DK_SLOTS.length) {
      return (salaryCap - currentSalary) < 500;
    }

    const slot = DK_SLOTS[slotIdx];
    if (slotMap[slot]) return fillSlots(slotIdx + 1);

    const candidates = sortedPlayers.filter((player) => canFitDK(player, slot));
    const diversified = shuffleTop(candidates, 40);

    for (const player of diversified) {
      if (selectedPlayerIds.includes(player.id)) continue;
      if (currentSalary + player.salary > salaryCap) continue;

      // Try picking this player
      selectedPlayerIds.push(player.id);
      slotMap[slot] = player.id;
      currentSalary += player.salary;
      currentProjection += player.projection;

      if (fillSlots(slotIdx + 1)) return true;

      // Backtrack
      selectedPlayerIds.pop();
      delete slotMap[slot];
      currentSalary -= player.salary;
      currentProjection -= player.projection;
    }

    return false;
  };

  if (fillSlots(0)) {
    return {
      id: `opt_${iteration}_${Math.random().toString(36).substr(2, 5)}`,
      playerIds: selectedPlayerIds,
      players: [], // This will be hydrated later
      totalSalary: currentSalary,
      totalProjection: Number(currentProjection.toFixed(2)),
      lineupSource: 'optimizer'
    };
  }

  return null;
};

self.onmessage = (e: MessageEvent) => {
  const { players, config } = e.data;
  const { numLineups } = config;

  const results: Lineup[] = [];
  const exposureMap: Record<string, number> = {};
  const seen = new Set<string>();

  try {
    if (!Array.isArray(players) || players.length < DK_SLOTS.length) {
      self.postMessage({
        type: 'error',
        message: 'Optimizer pool too small after filters. Relax DvP/Leverage/usage-minute rules.'
      });
      return;
    }

    const missingSlot = DK_SLOTS.find((slot) => !players.some((player) => canFitDK(player, slot)));
    if (missingSlot) {
      self.postMessage({
        type: 'error',
        message: `No eligible players for ${missingSlot} after filters. Relax DvP/Leverage/usage-minute rules.`
      });
      return;
    }

    let attempts = 0;
    const maxAttempts = Math.max(numLineups * 120, 600);
    while (results.length < numLineups && attempts < maxAttempts) {
      const iteration = results.length;
      const rng = makeRng((iteration + 1) * 10007 + (attempts + 1) * 97);
      const lineup = solveLineup(players, config, exposureMap, iteration, rng);
      attempts += 1;
      
      if (!lineup) continue;
      const signature = [...lineup.playerIds].sort().join('|');
      if (seen.has(signature)) continue;
      seen.add(signature);

      results.push(lineup);
      // Update exposure
      lineup.playerIds.forEach(id => {
        exposureMap[id] = (exposureMap[id] || 0) + 1;
      });

      // Send progress
      self.postMessage({
        type: 'progress',
        progress: Math.round((results.length / numLineups) * 100),
        currentBest: lineup,
        lineupsFound: results.length
      });
    }

    self.postMessage({
      type: 'result',
      lineups: results
    });

  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown optimization error'
    });
  }
};
