
import { Lineup, Player } from '../../types';
import highsLoader from 'highs';
import highsWasmUrl from 'highs/runtime?url';

const DK_SLOTS = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'] as const;
const MAX_REMAINING_SALARY = 500;
const workerScope = self as any;

type Slot = (typeof DK_SLOTS)[number];
type StatConstraintMode = 'cash' | 'gpp';

interface OptimizerConfig {
  numLineups?: number;
  salaryCap?: number;
  maxExposure?: number;
  enableStatConstraints?: boolean;
  enable_stat_constraints?: boolean;
  statConstraintMode?: StatConstraintMode;
  mode?: StatConstraintMode | string;
  deltaFromBestProjection?: number;
  delta_from_best_projection?: number;
  minMinutesCore?: number;
  min_minutes_core?: number;
  minCountMinutesCore?: number;
  min_count_minutes_core?: number;
  maxCountLowMinutes?: number;
  max_count_low_minutes?: number;
  lowMinutesCutoff?: number;
  low_minutes_cutoff?: number;
}

interface RequestPayload {
  players: Player[];
  config?: OptimizerConfig;
}

interface AssignmentVar {
  name: string;
  playerIndex: number;
  slot: Slot;
}

interface LinearTerm {
  varName: string;
  coeff: number;
}

interface LinearConstraint {
  name: string;
  terms: LinearTerm[];
  sense: '<=' | '>=' | '=';
  rhs: number;
}

interface ModelBlueprint {
  objective: Map<string, number>;
  constraints: LinearConstraint[];
  binaries: string[];
  assignmentVars: AssignmentVar[];
  assignmentVarsByPlayer: Map<number, string[]>;
}

interface SolveResult {
  values: Map<string, number>;
  status: string;
  objectiveValue: number;
}

interface BuildContext {
  players: Player[];
  config: Required<Pick<OptimizerConfig, 'numLineups' | 'salaryCap' | 'maxExposure'>> & OptimizerConfig;
  lineupIndex: number;
  previousLineups: number[][];
  statSettings: StatConstraintSettings;
}

interface StatConstraintSettings {
  enable: boolean;
  mode: StatConstraintMode;
  deltaFromBestProjection: number;
  minMinutesCore: number;
  minCountMinutesCore: number;
  maxCountLowMinutes: number;
  lowMinutesCutoff: number;
}

interface StatConstraintRule {
  name: string;
  sense: '<=' | '>=';
  rhs: number;
  playerIndexes: number[];
}

interface RelaxedStatRule {
  rule: StatConstraintRule;
  required: number;
  available: number;
}

let highsModulePromise: Promise<any> | null = null;

const safeNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const normKey = (value: string): string => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const readByKeys = (obj: Record<string, any> | undefined, keys: string[]): any => {
  if (!obj || typeof obj !== 'object') return undefined;
  const keyMap = new Map<string, string>();
  Object.keys(obj).forEach((k) => keyMap.set(normKey(k), k));
  for (const key of keys) {
    const actualKey = keyMap.get(normKey(key));
    if (actualKey) return obj[actualKey];
  }
  return undefined;
};

const readFromPlayer = (player: Player, keys: string[]): any => {
  const sources = [
    player as Record<string, any>,
    (player as any).slateData,
    (player as any).advancedMetrics,
    (player as any).statsProfile,
  ];
  for (const source of sources) {
    const value = readByKeys(source, keys);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

const readNumericMaybe = (player: Player, keys: string[]): number | undefined => {
  const raw = readFromPlayer(player, keys);
  if (raw === undefined || raw === null || raw === '') return undefined;
  const numeric = Number(typeof raw === 'string' ? raw.replace('%', '') : raw);
  return Number.isFinite(numeric) ? numeric : undefined;
};

const readString = (player: Player, keys: string[]): string => {
  const raw = readFromPlayer(player, keys);
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

const parsePositions = (position: string): string[] => {
  return String(position || '')
    .split(/[\/,\s]+/)
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean);
};

const canFitDK = (player: Player, slot: Slot): boolean => {
  const pos = parsePositions(player.position);
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

const normalizeOwnership = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value <= 1) return clamp(value * 100, 0, 100);
  return clamp(value, 0, 100);
};

const normalizePercentMaybe = (value: number | undefined): number | undefined => {
  if (!Number.isFinite(Number(value))) return undefined;
  const n = Number(value);
  return n <= 1 ? n * 100 : n;
};

const leverageTierToScoreMaybe = (player: Player): number | undefined => {
  const numericTier = readNumericMaybe(player, ['leverageScore', 'leverage_tier_score', 'leverageTierNumeric']);
  if (Number.isFinite(Number(numericTier))) return Number(numericTier);

  const tierRaw = readString(player, [
    'leverageTier',
    'signalLeverageTier',
    'signal_leverage_tier',
    'leverage_tier',
    'LEVERAGE_TIER',
  ]).toLowerCase();

  if (!tierRaw) return undefined;
  if (tierRaw.includes('strong') && tierRaw.includes('positive')) return 3;
  if (tierRaw.includes('strong') && tierRaw.includes('negative')) return -3;
  if (tierRaw.includes('positive')) return 2;
  if (tierRaw.includes('negative')) return -2;
  if (tierRaw.includes('neutral')) return 1;
  if (tierRaw.includes('fade')) return -2;
  if (tierRaw.includes('core')) return 2;
  return undefined;
};

const leverageTierToScore = (player: Player): number => leverageTierToScoreMaybe(player) ?? 0;


const formatCoeff = (value: number): string => {
  const rounded = Math.abs(value) < 1e-10 ? 0 : value;
  const txt = rounded.toFixed(8);
  return txt.replace(/\.?0+$/, '');
};

const formatExpression = (terms: LinearTerm[]): string => {
  const compact = terms.filter((term) => Math.abs(term.coeff) > 1e-10);
  if (compact.length === 0) return '0';

  return compact
    .map((term, idx) => {
      const sign = term.coeff >= 0 ? (idx === 0 ? '' : ' + ') : (idx === 0 ? '- ' : ' - ');
      const absCoeff = Math.abs(term.coeff);
      const coeffText = Math.abs(absCoeff - 1) < 1e-10 ? '' : `${formatCoeff(absCoeff)} `;
      return `${sign}${coeffText}${term.varName}`;
    })
    .join('');
};

const buildLp = (model: ModelBlueprint): string => {
  const objectiveTerms = Array.from(model.objective.entries()).map(([varName, coeff]) => ({ varName, coeff }));
  const lines: string[] = [];

  lines.push('Maximize');
  lines.push(` obj: ${formatExpression(objectiveTerms)}`);
  lines.push('Subject To');
  model.constraints.forEach((constraint) => {
    lines.push(` ${constraint.name}: ${formatExpression(constraint.terms)} ${constraint.sense} ${formatCoeff(constraint.rhs)}`);
  });

  lines.push('Binary');
  model.binaries.forEach((binaryName) => lines.push(` ${binaryName}`));
  lines.push('End');

  return lines.join('\n');
};

const withDefaultConfig = (config?: OptimizerConfig): Required<Pick<OptimizerConfig, 'numLineups' | 'salaryCap' | 'maxExposure'>> & OptimizerConfig => {
  const statModeRaw = String((config as any)?.statConstraintMode ?? (config as any)?.mode ?? 'gpp').toLowerCase();
  const statMode: StatConstraintMode = statModeRaw === 'cash' ? 'cash' : 'gpp';
  const enableStatRaw = (config as any)?.enableStatConstraints ?? (config as any)?.enable_stat_constraints;
  const enableStatConstraints = enableStatRaw === undefined ? true : Boolean(enableStatRaw);
  const deltaRaw = (config as any)?.deltaFromBestProjection ?? (config as any)?.delta_from_best_projection ?? (config as any)?.upsideDelta ?? 8;
  const minCoreRaw = (config as any)?.minMinutesCore ?? (config as any)?.min_minutes_core;
  const minCountCoreRaw = (config as any)?.minCountMinutesCore ?? (config as any)?.min_count_minutes_core;
  const maxLowRaw = (config as any)?.maxCountLowMinutes ?? (config as any)?.max_count_low_minutes;
  const lowCutoffRaw = (config as any)?.lowMinutesCutoff ?? (config as any)?.low_minutes_cutoff;

  return {
    numLineups: Math.max(1, Math.floor(safeNumber(config?.numLineups, 20))),
    salaryCap: Math.max(1, Math.floor(safeNumber(config?.salaryCap, 50000))),
    maxExposure: clamp(safeNumber(config?.maxExposure, 100), 0, 100),
    enableStatConstraints,
    enable_stat_constraints: enableStatConstraints,
    statConstraintMode: statMode,
    mode: statMode,
    deltaFromBestProjection: Math.max(0, safeNumber(deltaRaw, 8)),
    delta_from_best_projection: Math.max(0, safeNumber(deltaRaw, 8)),
    minMinutesCore: Math.max(0, safeNumber(minCoreRaw, 28)),
    min_minutes_core: Math.max(0, safeNumber(minCoreRaw, 28)),
    minCountMinutesCore: Math.max(0, Math.floor(safeNumber(minCountCoreRaw, statMode === 'cash' ? 7 : 6))),
    min_count_minutes_core: Math.max(0, Math.floor(safeNumber(minCountCoreRaw, statMode === 'cash' ? 7 : 6))),
    maxCountLowMinutes: Math.max(0, Math.floor(safeNumber(maxLowRaw, statMode === 'cash' ? 0 : 1))),
    max_count_low_minutes: Math.max(0, Math.floor(safeNumber(maxLowRaw, statMode === 'cash' ? 0 : 1))),
    lowMinutesCutoff: Math.max(0, safeNumber(lowCutoffRaw, 20)),
    low_minutes_cutoff: Math.max(0, safeNumber(lowCutoffRaw, 20)),
  };
};

const getStatConstraintSettings = (config: Required<Pick<OptimizerConfig, 'numLineups' | 'salaryCap' | 'maxExposure'>> & OptimizerConfig): StatConstraintSettings => {
  const modeRaw = String(config.statConstraintMode ?? config.mode ?? 'gpp').toLowerCase();
  const mode: StatConstraintMode = modeRaw === 'cash' ? 'cash' : 'gpp';
  return {
    enable: config.enableStatConstraints !== false,
    mode,
    deltaFromBestProjection: Math.max(0, safeNumber(config.deltaFromBestProjection ?? config.delta_from_best_projection, 8)),
    minMinutesCore: Math.max(0, safeNumber(config.minMinutesCore ?? config.min_minutes_core, 28)),
    minCountMinutesCore: Math.max(
      0,
      Math.floor(safeNumber(config.minCountMinutesCore ?? config.min_count_minutes_core, mode === 'cash' ? 7 : 6)),
    ),
    maxCountLowMinutes: Math.max(
      0,
      Math.floor(safeNumber(config.maxCountLowMinutes ?? config.max_count_low_minutes, mode === 'cash' ? 0 : 1)),
    ),
    lowMinutesCutoff: Math.max(0, safeNumber(config.lowMinutesCutoff ?? config.low_minutes_cutoff, 20)),
  };
};

const getHighsModule = async (): Promise<any> => {
  if (!highsModulePromise) {
    highsModulePromise = Promise.resolve(
      highsLoader({
        locateFile: (file: string) => (file.endsWith('.wasm') ? highsWasmUrl : file),
      }),
    );
  }
  return highsModulePromise;
};

const runHighsSolve = async (lpText: string): Promise<any> => {
  const highs = await getHighsModule();
  if (!highs || typeof highs.solve !== 'function') {
    throw new Error('Failed to initialize HiGHS solver.');
  }
  return highs.solve(lpText);
};

const solveLp = async (model: ModelBlueprint): Promise<SolveResult> => {
  const lpText = buildLp(model);
  let solution: any;
  try {
    solution = await runHighsSolve(lpText);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const isRuntimeCrash = details.toLowerCase().includes('indirect call to null');
    if (isRuntimeCrash) {
      // Recover from occasional wasm/runtime corruption by forcing a fresh module instance.
      highsModulePromise = null;
      try {
        solution = await runHighsSolve(lpText);
      } catch (retryError) {
        const retryDetails = retryError instanceof Error ? retryError.message : String(retryError);
        throw new Error(`HiGHS solve failed after retry: ${retryDetails}`);
      }
    } else {
      throw new Error(`HiGHS solve failed: ${details}`);
    }
  }

  const status = String(solution?.Status ?? 'Unknown');
  const statusLc = status.toLowerCase();
  if (statusLc.includes('infeasible') || statusLc.includes('unbounded') || statusLc.includes('error') || statusLc.includes('empty')) {
    return {
      values: new Map<string, number>(),
      status,
      objectiveValue: Number.NaN,
    };
  }
  const columns = solution?.Columns ?? {};
  const values = new Map<string, number>();
  model.binaries.forEach((name) => {
    values.set(name, safeNumber(columns?.[name]?.Primal, 0));
  });
  let objectiveValue = safeNumber(solution?.ObjectiveValue, Number.NaN);
  if (!Number.isFinite(objectiveValue)) objectiveValue = 0;

  return { values, status, objectiveValue };
};

const addConstraint = (constraints: LinearConstraint[], name: string, terms: LinearTerm[], sense: LinearConstraint['sense'], rhs: number) => {
  constraints.push({ name, terms, sense, rhs });
};

const buildLineupSignature = (playerIndexes: number[]): string => {
  return [...new Set(playerIndexes)].sort((a, b) => a - b).join('_');
};

const buildBaseModel = (context: BuildContext): ModelBlueprint => {
  const { players, config } = context;
  const constraints: LinearConstraint[] = [];
  const assignmentVars: AssignmentVar[] = [];
  const assignmentVarsByPlayer = new Map<number, string[]>();
  const assignmentVarsBySlot = new Map<Slot, string[]>();
  DK_SLOTS.forEach((slot) => assignmentVarsBySlot.set(slot, []));

  players.forEach((player, playerIndex) => {
    DK_SLOTS.forEach((slot) => {
      if (!canFitDK(player, slot)) return;
      const varName = `x_p${playerIndex}_${slot}`;
      assignmentVars.push({ name: varName, playerIndex, slot });
      if (!assignmentVarsByPlayer.has(playerIndex)) assignmentVarsByPlayer.set(playerIndex, []);
      assignmentVarsByPlayer.get(playerIndex)!.push(varName);
      assignmentVarsBySlot.get(slot)!.push(varName);
    });
  });

  DK_SLOTS.forEach((slot) => {
    const vars = assignmentVarsBySlot.get(slot) || [];
    if (vars.length === 0) {
      throw new Error(`No eligible players for ${slot}.`);
    }
    addConstraint(
      constraints,
      `slot_${slot}`,
      vars.map((v) => ({ varName: v, coeff: 1 })),
      '=',
      1,
    );
  });

  const forceInclude = new Set<number>();
  const forceExclude = new Set<number>();

  players.forEach((player, idx) => {
    const varNames = assignmentVarsByPlayer.get(idx) || [];
    if (varNames.length === 0) return;

    const isLocked = Boolean((player as any).optimizerLocked);
    const isExcluded = Boolean((player as any).optimizerExcluded || (player as any).excluded);
    if (isExcluded) forceExclude.add(idx);
    if (isLocked) forceInclude.add(idx);

    if (forceInclude.has(idx) && forceExclude.has(idx)) {
      throw new Error(`Exposure/lock conflict for ${player.name}.`);
    }
  });

  if (forceInclude.size > DK_SLOTS.length) {
    throw new Error(`Locked players exceed ${DK_SLOTS.length} roster slots.`);
  }

  players.forEach((player, idx) => {
    const varNames = assignmentVarsByPlayer.get(idx) || [];
    if (varNames.length === 0) return;

    const terms = varNames.map((varName) => ({ varName, coeff: 1 }));
    if (forceInclude.has(idx) && !forceExclude.has(idx)) {
      addConstraint(constraints, `player_${idx}_force_in`, terms, '=', 1);
      return;
    }
    if (forceExclude.has(idx)) {
      addConstraint(constraints, `player_${idx}_force_out`, terms, '=', 0);
      return;
    }
    addConstraint(constraints, `player_${idx}_unique`, terms, '<=', 1);
  });

  addConstraint(
    constraints,
    'salary_cap',
    assignmentVars.map((variable) => ({
      varName: variable.name,
      coeff: Math.max(0, safeNumber(players[variable.playerIndex].salary, 0)),
    })),
    '<=',
    config.salaryCap,
  );

  addConstraint(
    constraints,
    'salary_floor',
    assignmentVars.map((variable) => ({
      varName: variable.name,
      coeff: Math.max(0, safeNumber(players[variable.playerIndex].salary, 0)),
    })),
    '>=',
    Math.max(0, config.salaryCap - MAX_REMAINING_SALARY),
  );

  context.previousLineups.forEach((prevLineup, lineupIdx) => {
    const terms: LinearTerm[] = [];
    [...new Set(prevLineup)].forEach((playerIdx) => {
      (assignmentVarsByPlayer.get(playerIdx) || []).forEach((varName) => {
        terms.push({ varName, coeff: 1 });
      });
    });
    if (terms.length > 0) {
      addConstraint(constraints, `nodup_${lineupIdx}`, terms, '<=', DK_SLOTS.length - 1);
    }
  });

  const binaries = [...assignmentVars.map((v) => v.name)];

  return {
    objective: new Map<string, number>(),
    constraints,
    binaries,
    assignmentVars,
    assignmentVarsByPlayer,
  };
};

const readPercentMaybe = (player: Player, keys: string[]): number | undefined => {
  return normalizePercentMaybe(readNumericMaybe(player, keys));
};

const getUSGPctMaybe = (player: Player): number | undefined => {
  return readPercentMaybe(player, ['USG_pct', 'USG%', 'usg_pct', 'usageRate', 'usage_rate', 'usage', 'USG']);
};

const getASTPctMaybe = (player: Player): number | undefined => {
  return readPercentMaybe(player, ['AST_pct', 'AST%', 'ast_pct', 'assist_rate', 'assistRate']);
};

const getREBPctMaybe = (player: Player): number | undefined => {
  return readPercentMaybe(player, ['REB_pct', 'REB%', 'reb_pct', 'rebound_rate', 'reboundRate']);
};

const getOwnershipPctMaybe = (player: Player): number | undefined => {
  const own = readNumericMaybe(player, ['ownership', 'projectedOwnership', 'projOwnership', 'own', 'OWN']);
  if (!Number.isFinite(Number(own))) return undefined;
  return normalizeOwnership(Number(own));
};

const getASTMaybe = (player: Player): number | undefined => {
  return readNumericMaybe(player, ['AST', 'ast', 'assists', 'assist', 'ASTS']);
};

const getREBMaybe = (player: Player): number | undefined => {
  return readNumericMaybe(player, ['REB', 'reb', 'rebounds', 'rebound']);
};

const getBLKMaybe = (player: Player): number | undefined => {
  return readNumericMaybe(player, ['BLK', 'blk', 'blocks', 'block']);
};

const getSTLMaybe = (player: Player): number | undefined => {
  return readNumericMaybe(player, ['STL', 'stl', 'steals', 'steal']);
};

const getFTAMaybe = (player: Player): number | undefined => {
  return readNumericMaybe(player, ['FTA', 'fta', 'freeThrowsAttempted', 'ft_attempts']);
};

const getMinutesMaybe = (player: Player): number | undefined => {
  return readNumericMaybe(player, ['minutes', 'minutesProjection', 'projMinutes', 'projectedMinutes', 'min']);
};

const buildStatConstraintRules = (context: BuildContext): StatConstraintRule[] => {
  const { players, statSettings } = context;
  if (!statSettings.enable) return [];

  const qualifying = (predicate: (player: Player) => boolean): number[] => {
    return players.map((player, idx) => ({ player, idx })).filter((entry) => predicate(entry.player)).map((entry) => entry.idx);
  };

  const rules: StatConstraintRule[] = [];

  rules.push({
    name: 'core_minutes_count',
    sense: '>=',
    rhs: statSettings.minCountMinutesCore,
    playerIndexes: qualifying((player) => {
      const min = getMinutesMaybe(player);
      return Number.isFinite(Number(min)) && Number(min) >= statSettings.minMinutesCore;
    }),
  });

  rules.push({
    name: 'low_minutes_limit',
    sense: '<=',
    rhs: statSettings.maxCountLowMinutes,
    playerIndexes: qualifying((player) => {
      const min = getMinutesMaybe(player);
      return Number.isFinite(Number(min)) && Number(min) < statSettings.lowMinutesCutoff;
    }),
  });

  rules.push({
    name: 'at_least_one_primary_playmaker',
    sense: '>=',
    rhs: 1,
    playerIndexes: qualifying((player) => {
      if (!canFitDK(player, 'PG')) return false;
      const astPct = getASTPctMaybe(player);
      const ast = getASTMaybe(player);
      return (Number.isFinite(Number(astPct)) && Number(astPct) >= 35)
        || (Number.isFinite(Number(ast)) && Number(ast) >= 10);
    }),
  });

  rules.push({
    name: 'center_rebound_or_block_anchor',
    sense: '>=',
    rhs: 1,
    playerIndexes: qualifying((player) => {
      if (!canFitDK(player, 'C')) return false;
      const reb = getREBMaybe(player);
      const rebPct = getREBPctMaybe(player);
      const blk = getBLKMaybe(player);
      return (Number.isFinite(Number(reb)) && Number(reb) >= 11)
        || (Number.isFinite(Number(rebPct)) && Number(rebPct) >= 22)
        || (Number.isFinite(Number(blk)) && Number(blk) >= 2);
    }),
  });

  if (statSettings.mode === 'gpp') {
    rules.push({
      name: 'two_high_usage_players',
      sense: '>=',
      rhs: 2,
      playerIndexes: qualifying((player) => {
        const usg = getUSGPctMaybe(player);
        return Number.isFinite(Number(usg)) && Number(usg) >= 28;
      }),
    });

    rules.push({
      name: 'five_moderate_usage_players',
      sense: '>=',
      rhs: 5,
      playerIndexes: qualifying((player) => {
        const usg = getUSGPctMaybe(player);
        return Number.isFinite(Number(usg)) && Number(usg) >= 20;
      }),
    });

    rules.push({
      name: 'two_stock_guys',
      sense: '>=',
      rhs: 2,
      playerIndexes: qualifying((player) => {
        const stl = getSTLMaybe(player);
        const blk = getBLKMaybe(player);
        if (!Number.isFinite(Number(stl)) || !Number.isFinite(Number(blk))) return false;
        return Number(stl) + Number(blk) >= 2;
      }),
    });

    rules.push({
      name: 'two_fta_ceiling_players',
      sense: '>=',
      rhs: 2,
      playerIndexes: qualifying((player) => {
        const fta = getFTAMaybe(player);
        return Number.isFinite(Number(fta)) && Number(fta) >= 6;
      }),
    });

    rules.push({
      name: 'limit_high_owned',
      sense: '<=',
      rhs: 3,
      playerIndexes: qualifying((player) => {
        const own = getOwnershipPctMaybe(player);
        return Number.isFinite(Number(own)) && Number(own) >= 25;
      }),
    });

    rules.push({
      name: 'require_some_low_owned',
      sense: '>=',
      rhs: 2,
      playerIndexes: qualifying((player) => {
        const own = getOwnershipPctMaybe(player);
        return Number.isFinite(Number(own)) && Number(own) <= 10;
      }),
    });

    rules.push({
      name: 'require_two_high_leverage',
      sense: '>=',
      rhs: 2,
      playerIndexes: qualifying((player) => {
        const lev = leverageTierToScoreMaybe(player);
        return Number.isFinite(Number(lev)) && Number(lev) >= 2;
      }),
    });
  }

  return rules;
};

const relaxStatRules = (
  rules: StatConstraintRule[],
  forceExclude: Set<number>,
): { rules: StatConstraintRule[]; relaxed: RelaxedStatRule[] } => {
  const relaxed: RelaxedStatRule[] = [];
  const nextRules: StatConstraintRule[] = [];

  for (const rule of rules) {
    const activeIndexes = rule.playerIndexes.filter((idx) => !forceExclude.has(idx));
    if (activeIndexes.length === 0) {
      continue;
    }

    if (rule.sense === '>=') {
      const effectiveRhs = Math.min(rule.rhs, activeIndexes.length);
      if (effectiveRhs <= 0) continue;
      if (effectiveRhs < rule.rhs) {
        relaxed.push({
          rule,
          required: rule.rhs,
          available: activeIndexes.length,
        });
      }
      nextRules.push({
        ...rule,
        rhs: effectiveRhs,
        playerIndexes: activeIndexes,
      });
      continue;
    }

    nextRules.push({
      ...rule,
      playerIndexes: activeIndexes,
    });
  }

  return { rules: nextRules, relaxed };
};

const applyStatConstraintRules = (
  model: ModelBlueprint,
  rules: StatConstraintRule[],
  forceExclude: Set<number>,
): { relaxed: Array<{ name: string; required: number; available: number; applied: number }>; names: string[] } => {
  const normalized = relaxStatRules(rules, forceExclude);
  const relaxed: Array<{ name: string; required: number; available: number; applied: number }> = [];
  const names: string[] = [];

  for (const entry of normalized.relaxed) {
    relaxed.push({
      name: entry.rule.name,
      required: entry.required,
      available: entry.available,
      applied: Math.min(entry.required, entry.available),
    });
  }

  for (const rule of normalized.rules) {
    const terms: LinearTerm[] = [];
    rule.playerIndexes.forEach((idx) => {
      (model.assignmentVarsByPlayer.get(idx) || []).forEach((varName) => {
        terms.push({ varName, coeff: 1 });
      });
    });

    if (terms.length === 0) {
      continue;
    }

    names.push(rule.name);
    addConstraint(model.constraints, `stat_${rule.name}`, terms, rule.sense, rule.rhs);
  }

  return { relaxed, names };
};

const evaluateStatConstraintRules = (
  selectedIndexes: number[],
  rules: StatConstraintRule[],
): { ok: boolean; failing: string[] } => {
  const selectedSet = new Set<number>(selectedIndexes);
  const failing: string[] = [];

  for (const rule of rules) {
    const count = rule.playerIndexes.reduce((sum, idx) => sum + (selectedSet.has(idx) ? 1 : 0), 0);
    if (rule.sense === '>=' && count < rule.rhs) failing.push(rule.name);
    if (rule.sense === '<=' && count > rule.rhs) failing.push(rule.name);
  }

  return { ok: failing.length === 0, failing };
};

const getLeverageTierPriority = (player: Player): number => {
  const tier = readString(player, [
    'signalLeverageTier',
    'signal_leverage_tier',
    'LEVERAGE_TIER',
    'leverageTier',
    'leverage_tier',
    'leverageTierLabel',
    'leverageTierName',
  ]).toLowerCase();

  if (!tier) return 2;
  if (tier.includes('elite')) return 5;
  if (tier.includes('strong boost') || (tier.includes('strong') && tier.includes('positive'))) return 4;
  if (tier === 'boost' || tier.includes('positive') || tier.includes('core')) return 3;
  if (tier.includes('strong fade') || (tier.includes('strong') && tier.includes('negative'))) return 0;
  if (tier === 'fade' || tier.includes('negative')) return 1;
  if (tier.includes('neutral')) return 2;
  return 2;
};

const getSignalTierPriority = (player: Player): number => {
  const tier = readString(player, [
    'DEF_SIGNAL_ONOFF_IMPACT_TIER',
    'def_signal_onoff_impact_tier',
    'onOffImpactTier',
    'signalTier',
    'signal_tier',
    'signal',
  ]).toLowerCase();

  if (tier) {
    if (tier.includes('strong boost')) return 3;
    if (tier === 'boost' || tier.includes('boost')) return 2;
    if (tier.includes('strong fade')) return 0;
    if (tier === 'fade' || tier.includes('fade')) return 1;
    if (tier.includes('neutral')) return 2;
  }

  const impactFp = readNumericMaybe(player, [
    'DEF_SIGNAL_ONOFF_IMPACT_FP',
    'def_signal_onoff_impact_fp',
    'onOffImpactFp',
    'signalImpactFp',
  ]);
  if (!Number.isFinite(Number(impactFp))) return 2;
  const impact = Number(impactFp);
  if (impact >= 1.0) return 3;
  if (impact >= 0.15) return 2;
  if (impact <= -1.0) return 0;
  if (impact < -0.15) return 1;
  return 2;
};

const getCeilingTieBreaker = (player: Player): number => {
  return Math.max(0, safeNumber(readNumericMaybe(player, [
    'ceiling',
    'ceilingProjection',
    'ceilingProj',
    'projectedCeiling',
    'fptsCeiling',
    'dkCeiling',
  ]), 0));
};

const getValueTieBreaker = (player: Player): number => {
  const explicit = readNumericMaybe(player, [
    'value',
    'val',
    'projectionPerK',
    'projPerK',
    'fptsPerK',
  ]);
  if (Number.isFinite(Number(explicit))) return Math.max(0, Number(explicit));
  const salary = Math.max(0, safeNumber(player.salary, 0));
  if (salary <= 0) return 0;
  return (Math.max(0, safeNumber(player.projection, 0)) / salary) * 1000;
};

const getPriorityScore = (player: Player): number => {
  const leveragePriority = getLeverageTierPriority(player);
  const signalPriority = getSignalTierPriority(player);
  // Primary rank by leverage+signal combo; ties break on ceiling/value/usage/minutes.
  const comboPriority = leveragePriority * 10 + signalPriority;
  const ceiling = getCeilingTieBreaker(player);
  const value = getValueTieBreaker(player);
  const usage = Math.max(0, safeNumber(getUSGPctMaybe(player), 0));
  const minutes = Math.max(0, safeNumber(getMinutesMaybe(player), 0));
  const projection = Math.max(0, safeNumber(player.projection, 0));

  return (comboPriority * 100000)
    + (ceiling * 100)
    + (value * 50)
    + (usage * 5)
    + (minutes * 2)
    + projection;
};

const setObjectiveByPriority = (model: ModelBlueprint, players: Player[]) => {
  model.objective.clear();
  model.assignmentVars.forEach((variable) => {
    model.objective.set(variable.name, Math.max(0, getPriorityScore(players[variable.playerIndex])));
  });
};

const addProjectionFloorConstraint = (model: ModelBlueprint, players: Player[], projectionFloor: number) => {
  addConstraint(
    model.constraints,
    'projection_floor',
    model.assignmentVars.map((variable) => ({
      varName: variable.name,
      coeff: Math.max(0, safeNumber(players[variable.playerIndex].projection, 0)),
    })),
    '>=',
    projectionFloor,
  );
};

const decodeLineup = (
  solution: SolveResult,
  model: ModelBlueprint,
  players: Player[],
  lineupIndex: number,
): { lineup: Lineup; selectedIndexes: number[] } | null => {
  if (!solution.values || solution.values.size === 0) return null;

  const slotToPlayerIndex = new Map<Slot, number>();
  model.assignmentVars.forEach((variable) => {
    const value = safeNumber(solution.values.get(variable.name), 0);
    if (value > 0.5) {
      slotToPlayerIndex.set(variable.slot, variable.playerIndex);
    }
  });

  if (slotToPlayerIndex.size !== DK_SLOTS.length) return null;

  const orderedIndexes = DK_SLOTS.map((slot) => slotToPlayerIndex.get(slot)).filter((idx): idx is number => idx !== undefined);
  const uniqueIndexes = Array.from(new Set(orderedIndexes));
  if (uniqueIndexes.length !== DK_SLOTS.length) return null;

  const lineupPlayers = uniqueIndexes.map((idx) => players[idx]);
  const totalSalary = lineupPlayers.reduce((sum, player) => sum + Math.max(0, safeNumber(player.salary, 0)), 0);
  const totalProjection = lineupPlayers.reduce((sum, player) => sum + Math.max(0, safeNumber(player.projection, 0)), 0);

  return {
    lineup: {
      id: `opt_${lineupIndex}_${uniqueIndexes.join('_')}`,
      playerIds: lineupPlayers.map((player) => player.id),
      players: [],
      totalSalary,
      totalProjection: Number(totalProjection.toFixed(2)),
      lineupSource: 'optimizer',
    },
    selectedIndexes: uniqueIndexes,
  };
};

const getForcedSets = (context: BuildContext): { forceInclude: Set<number>; forceExclude: Set<number> } => {
  const { players } = context;
  const forceInclude = new Set<number>();
  const forceExclude = new Set<number>();

  players.forEach((player, idx) => {
    if (!DK_SLOTS.some((slot) => canFitDK(player, slot))) return;

    const isLocked = Boolean((player as any).optimizerLocked);
    const isExcluded = Boolean((player as any).optimizerExcluded || (player as any).excluded);
    if (isExcluded) forceExclude.add(idx);
    if (isLocked) forceInclude.add(idx);

    if (forceInclude.has(idx) && forceExclude.has(idx)) {
      throw new Error(`Exposure/lock conflict for ${player.name}.`);
    }
  });

  return { forceInclude, forceExclude };
};

const buildLineupFromIndexes = (players: Player[], selectedIndexes: number[], lineupIndex: number): Lineup => {
  const lineupPlayers = selectedIndexes.map((idx) => players[idx]);
  const totalSalary = lineupPlayers.reduce((sum, player) => sum + Math.max(0, safeNumber(player.salary, 0)), 0);
  const totalProjection = lineupPlayers.reduce((sum, player) => sum + Math.max(0, safeNumber(player.projection, 0)), 0);

  return {
    id: `opt_fb_${lineupIndex}_${selectedIndexes.join('_')}`,
    playerIds: lineupPlayers.map((player) => player.id),
    players: [],
    totalSalary,
    totalProjection: Number(totalProjection.toFixed(2)),
    lineupSource: 'optimizer',
  };
};

const searchFallbackLineup = (
  context: BuildContext,
  scoreByPlayer: number[],
  projectionFloor: number,
  statRules: StatConstraintRule[] = [],
): { lineup: Lineup; selectedIndexes: number[] } | null => {
  const { players, config, lineupIndex } = context;
  const minTotalSalary = Math.max(0, config.salaryCap - MAX_REMAINING_SALARY);
  const { forceInclude, forceExclude } = getForcedSets(context);
  const previousSignatures = new Set(context.previousLineups.map((lineup) => buildLineupSignature(lineup)));

  if (forceInclude.size > DK_SLOTS.length) return null;

  const validIndexes = players
    .map((_, idx) => idx)
    .filter((idx) => !forceExclude.has(idx))
    .filter((idx) => DK_SLOTS.some((slot) => canFitDK(players[idx], slot)));

  if (validIndexes.length < DK_SLOTS.length) return null;

  const immediateInfeasible = statRules
    .filter((rule) => rule.sense === '>=')
    .find((rule) => rule.playerIndexes.length < rule.rhs);
  if (immediateInfeasible) return null;

  const ordered = [...validIndexes].sort((a, b) => {
    const scoreDiff = safeNumber(scoreByPlayer[b], 0) - safeNumber(scoreByPlayer[a], 0);
    if (Math.abs(scoreDiff) > 1e-9) return scoreDiff;
    const projDiff = safeNumber(players[b].projection, 0) - safeNumber(players[a].projection, 0);
    if (Math.abs(projDiff) > 1e-9) return projDiff;
    const salaryDiff = safeNumber(players[b].salary, 0) - safeNumber(players[a].salary, 0);
    if (Math.abs(salaryDiff) > 1e-9) return salaryDiff;
    return a - b;
  });

  const offset = ordered.length > 0 ? lineupIndex % ordered.length : 0;
  const rotated = offset > 0 ? [...ordered.slice(offset), ...ordered.slice(0, offset)] : ordered;

  const slotToPlayer = new Map<Slot, number>();
  const usedPlayers = new Set<number>();
  let totalSalary = 0;
  let totalProjection = 0;
  let chosen = false;
  let nodeVisits = 0;
  const maxNodeVisits = 200000;

  const applySelection = (slot: Slot, playerIndex: number, add: boolean) => {
    const salary = Math.max(0, safeNumber(players[playerIndex].salary, 0));
    const projection = Math.max(0, safeNumber(players[playerIndex].projection, 0));
    if (add) {
      slotToPlayer.set(slot, playerIndex);
      usedPlayers.add(playerIndex);
      totalSalary += salary;
      totalProjection += projection;
    } else {
      slotToPlayer.delete(slot);
      usedPlayers.delete(playerIndex);
      totalSalary -= salary;
      totalProjection -= projection;
    }
  };

  const forcedIndexes = Array.from(forceInclude).filter((idx) => !forceExclude.has(idx));
  forcedIndexes.sort((a, b) => {
    const aSlots = DK_SLOTS.filter((slot) => canFitDK(players[a], slot)).length;
    const bSlots = DK_SLOTS.filter((slot) => canFitDK(players[b], slot)).length;
    return aSlots - bSlots;
  });

  const fillOpenSlots = (slotIdx: number): boolean => {
    nodeVisits += 1;
    if (nodeVisits > maxNodeVisits) return false;

    if (slotIdx >= DK_SLOTS.length) {
      const selectedIndexes = DK_SLOTS.map((slot) => slotToPlayer.get(slot)).filter((idx): idx is number => idx !== undefined);
      if (selectedIndexes.length !== DK_SLOTS.length) return false;
      if (totalSalary > config.salaryCap) return false;
      if (totalSalary < minTotalSalary) return false;
      if (totalProjection < projectionFloor) return false;
      if (previousSignatures.has(buildLineupSignature(selectedIndexes))) return false;
      if (statRules.length > 0) {
        const statCheck = evaluateStatConstraintRules(selectedIndexes, statRules);
        if (!statCheck.ok) return false;
      }
      chosen = true;
      return true;
    }

    const slot = DK_SLOTS[slotIdx];
    if (slotToPlayer.has(slot)) return fillOpenSlots(slotIdx + 1);

    for (const playerIndex of rotated) {
      if (usedPlayers.has(playerIndex)) continue;
      if (!canFitDK(players[playerIndex], slot)) continue;
      const nextSalary = totalSalary + Math.max(0, safeNumber(players[playerIndex].salary, 0));
      if (nextSalary > config.salaryCap) continue;

      applySelection(slot, playerIndex, true);
      if (fillOpenSlots(slotIdx + 1)) return true;
      applySelection(slot, playerIndex, false);
    }

    return false;
  };

  const placeForcedPlayers = (idx: number): boolean => {
    if (idx >= forcedIndexes.length) return fillOpenSlots(0);
    const playerIndex = forcedIndexes[idx];
    const eligibleSlots = DK_SLOTS.filter((slot) => !slotToPlayer.has(slot) && canFitDK(players[playerIndex], slot));

    for (const slot of eligibleSlots) {
      const nextSalary = totalSalary + Math.max(0, safeNumber(players[playerIndex].salary, 0));
      if (nextSalary > config.salaryCap) continue;
      applySelection(slot, playerIndex, true);
      if (placeForcedPlayers(idx + 1)) return true;
      applySelection(slot, playerIndex, false);
    }

    return false;
  };

  const ok = placeForcedPlayers(0);
  if (!ok || !chosen) return null;

  const selectedIndexes = DK_SLOTS.map((slot) => slotToPlayer.get(slot)).filter((idx): idx is number => idx !== undefined);
  if (selectedIndexes.length !== DK_SLOTS.length) return null;
  return {
    lineup: buildLineupFromIndexes(players, selectedIndexes, lineupIndex),
    selectedIndexes,
  };
};

const solveLineupFallback = (context: BuildContext): { lineup: Lineup; selectedIndexes: number[] } | null => {
  const { players } = context;
  const priorityScore = players.map((player) => Math.max(0, getPriorityScore(player)));
  return searchFallbackLineup(context, priorityScore, 0);
};

const solveLineup = async (context: BuildContext): Promise<{ lineup: Lineup; selectedIndexes: number[] } | null> => {
  const baseModel = buildBaseModel(context);
  const { players } = context;

  setObjectiveByPriority(baseModel, players);
  const solved = await solveLp(baseModel);
  return decodeLineup(solved, baseModel, players, context.lineupIndex);
};

const buildLineups = async (payload: RequestPayload): Promise<Lineup[]> => {
  const players = Array.isArray(payload.players) ? payload.players : [];
  const config = withDefaultConfig(payload.config);
  const statSettings = {
    ...getStatConstraintSettings(config),
    enable: false,
  };

  if (players.length < DK_SLOTS.length) {
    throw new Error('Optimizer pool too small after filters.');
  }

  for (const slot of DK_SLOTS) {
    if (!players.some((player) => canFitDK(player, slot))) {
      throw new Error(`No eligible players for ${slot}.`);
    }
  }

  const lineups: Lineup[] = [];
  const previousLineups: number[][] = [];
  let attempts = 0;
  const maxAttempts = Math.max(config.numLineups * 8, 80);
  let lastSolveError = '';
  while (lineups.length < config.numLineups && attempts < maxAttempts) {
    attempts += 1;
    const lineupIndex = lineups.length;
    const context: BuildContext = {
      players,
      config,
      lineupIndex,
      previousLineups,
      statSettings,
    };

    let solved: { lineup: Lineup; selectedIndexes: number[] } | null = null;
    try {
      solved = await solveLineup(context);
    } catch (error) {
      lastSolveError = error instanceof Error ? error.message : String(error);
      solved = null;
    }
    if (!solved) {
      solved = solveLineupFallback(context);
    }
    if (!solved) {
      break;
    }

    lineups.push(solved.lineup);
    previousLineups.push([...solved.selectedIndexes]);

    workerScope.postMessage({
      type: 'progress',
      progress: Math.round(((lineupIndex + 1) / config.numLineups) * 100),
      currentBest: solved.lineup,
      lineupsFound: lineups.length,
    });
  }

  if (lineups.length === 0 && lastSolveError) {
    throw new Error(lastSolveError);
  }

  return lineups;
};

workerScope.onmessage = async (event: MessageEvent<RequestPayload>) => {
  try {
    const lineups = await buildLineups(event.data || { players: [] });
    workerScope.postMessage({ type: 'result', lineups });
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown optimization error',
    });
  }
};
