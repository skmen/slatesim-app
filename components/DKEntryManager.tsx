import React, { useState, useMemo, useRef, useEffect } from 'react';
import Papa from 'papaparse';
import { Upload, Lock, Unlock, Download, Save, Zap, ShieldCheck, ShieldAlert, X } from 'lucide-react';
import { Player, GameInfo, Lineup } from '../types';
import { PlayerDeepDive } from './PlayerDeepDive';
import { SavedLineupSet, loadSavedLineupSets, saveSavedLineupSets } from '../utils/savedLineups';
import { parseOptimizerLineups } from '../utils/csvParser';
import OptimizerWorker from '../src/workers/optimizer.worker.ts?worker&v=20260302-priorityreset2';

type Slot = 'PG' | 'SG' | 'SF' | 'PF' | 'C' | 'G' | 'F' | 'UTIL';

const SLOT_ORDER: Slot[] = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'];
const REQUIRED_COLS = ['Entry ID', 'Contest Name', 'Contest ID', 'Entry Fee', ...SLOT_ORDER];
const SALARY_CAP = 50000;
const ENTRY_MANAGER_SESSION_KEY = 'slatesim.entryManager.session.v1';

const getLocalDateStr = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const normalizeSlateType = (selectedSlate?: string | null): string => {
  const raw = String(selectedSlate || '');
  const base = raw.split('_')[0] || raw;
  const cleaned = base.toLowerCase().replace(/[^a-z]/g, '');
  if (cleaned.startsWith('early')) return 'early';
  if (cleaned.startsWith('main')) return 'main';
  if (cleaned.startsWith('turbo')) return 'turbo';
  if (cleaned.startsWith('night')) return 'night';
  return cleaned || 'slate';
};

interface Props {
  players: Player[];
  games: GameInfo[];
  showActuals?: boolean;
  slateDate?: string;
  selectedSlate?: string | null;
  deepDiveAllowedTabs?: Array<'dfs' | 'stats' | 'matchup' | 'synergy' | 'depth'>;
  isHistoricalMode?: boolean;
}

export type Entry = {
  entryId: string;
  contestName: string;
  contestId: string;
  entryFee: string;
  slots: Record<Slot, string>;
  projectedPoints?: number;
  currentPoints?: number;
  remainingSalary?: number;
};

interface EntryManagerSession {
  entries: Entry[];
  playerScores: Record<string, number>;
  manualLocks: string[];
  fileName: string;
  slateDate: string;
  updatedAt: number;
}

const parseGameTime = (timeStr: string): Date | null => {
  if (!timeStr) return null;
  const now = new Date();
  const timePart = timeStr.match(/(\d{1,2}:\d{2})\s*(AM|PM)/i);
  if (!timePart) return null;

  let [_, time, modifier] = timePart;
  let [hours, minutes] = time.split(':').map(Number);

  if (modifier.toUpperCase() === 'PM' && hours < 12) hours += 12;
  if (modifier.toUpperCase() === 'AM' && hours === 12) hours = 0;

  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
};

const formatPlayerName = (name: string) => {
    const parts = name.split(' ');
    if (parts.length < 2) return name;
    return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
};

const playerLabel = (player: Player): string => `${player.name} (${player.id})`;

const stripLockedTag = (value: string): string => {
  return String(value || '').replace(/\s*\(LOCKED\)\s*$/i, '').trim();
};

const stripOutTag = (value: string): string => {
  return String(value || '').replace(/\s*\(OUT\)\s*$/i, '').trim();
};

const stripSlotTags = (value: string): string => {
  return stripOutTag(stripLockedTag(value));
};

const isPlayerOut = (playerStr: string): boolean => {
  return /\(OUT\)/i.test(String(playerStr || ''));
};

const isEntryUnassigned = (entry: Entry): boolean => {
  return SLOT_ORDER.every((slot) => stripSlotTags(entry.slots[slot] || '') === '');
};

const getPlayerPositions = (player: Player): string[] => {
  return String(player.position || '')
    .split('/')
    .map((pos) => pos.trim().toUpperCase())
    .filter(Boolean);
};

const canPlayerFitSlot = (player: Player, slot: Slot): boolean => {
  const positions = getPlayerPositions(player);
  switch (slot) {
    case 'PG': return positions.includes('PG');
    case 'SG': return positions.includes('SG');
    case 'SF': return positions.includes('SF');
    case 'PF': return positions.includes('PF');
    case 'C': return positions.includes('C');
    case 'G': return positions.includes('PG') || positions.includes('SG');
    case 'F': return positions.includes('SF') || positions.includes('PF');
    case 'UTIL': return true;
    default: return false;
  }
};

const takeFirstEligible = (pool: Player[], predicate: (player: Player) => boolean): Player | null => {
  const idx = pool.findIndex(predicate);
  if (idx === -1) return null;
  return pool.splice(idx, 1)[0];
};

const lineupToSlots = (lineup: Lineup, playerById: Map<string, Player>): Record<Slot, string> => {
  const lineupPlayers =
    Array.isArray(lineup.players) && lineup.players.length > 0
      ? lineup.players
      : (lineup.playerIds || []).map((id) => playerById.get(id)).filter((player): player is Player => Boolean(player));
  const pool = [...lineupPlayers];
  const pick = (predicate: (player: Player) => boolean) => takeFirstEligible(pool, predicate);

  const pg = pick((player) => getPlayerPositions(player).includes('PG'));
  const sg = pick((player) => getPlayerPositions(player).includes('SG'));
  const sf = pick((player) => getPlayerPositions(player).includes('SF'));
  const pf = pick((player) => getPlayerPositions(player).includes('PF'));
  const c = pick((player) => getPlayerPositions(player).includes('C'));
  const g = pick((player) => {
    const positions = getPlayerPositions(player);
    return positions.includes('PG') || positions.includes('SG');
  });
  const f = pick((player) => {
    const positions = getPlayerPositions(player);
    return positions.includes('SF') || positions.includes('PF');
  });
  const util = pick(() => true);

  return {
    PG: pg ? playerLabel(pg) : '',
    SG: sg ? playerLabel(sg) : '',
    SF: sf ? playerLabel(sf) : '',
    PF: pf ? playerLabel(pf) : '',
    C: c ? playerLabel(c) : '',
    G: g ? playerLabel(g) : '',
    F: f ? playerLabel(f) : '',
    UTIL: util ? playerLabel(util) : '',
  };
};

const loadEntryManagerSession = (): EntryManagerSession | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(ENTRY_MANAGER_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      playerScores: parsed.playerScores && typeof parsed.playerScores === 'object' ? parsed.playerScores : {},
      manualLocks: Array.isArray(parsed.manualLocks) ? parsed.manualLocks : [],
      fileName: String(parsed.fileName || ''),
      slateDate: String(parsed.slateDate || ''),
      updatedAt: Number.isFinite(Number(parsed.updatedAt)) ? Number(parsed.updatedAt) : Date.now(),
    };
  } catch {
    return null;
  }
};

const saveEntryManagerSession = (session: EntryManagerSession) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(ENTRY_MANAGER_SESSION_KEY, JSON.stringify(session));
  } catch (error) {
    console.warn('Failed to persist entry manager session', error);
  }
};

const clearEntryManagerSession = () => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(ENTRY_MANAGER_SESSION_KEY);
};

export const DKEntryManager: React.FC<Props> = ({ players, games, showActuals = false, slateDate = '', selectedSlate = null, deepDiveAllowedTabs, isHistoricalMode = false }) => {
  const [entries, setEntries] = useState<Entry[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lineupFileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{ entryIdx: number; slot: Slot } | null>(null);
  const [showCandidates, setShowCandidates] = useState(false);
  const [deepDivePlayer, setDeepDivePlayer] = useState<Player | null>(null);
  const [manualLocks, setManualLocks] = useState<Set<string>>(new Set());
  const [playerScores, setPlayerScores] = useState<Record<string, number>>({});
  const [loadedFileName, setLoadedFileName] = useState('');
  const [sessionSavedAt, setSessionSavedAt] = useState<number | null>(null);
  const [showImportLineupsModal, setShowImportLineupsModal] = useState(false);
  const [savedLineupSets, setSavedLineupSets] = useState<SavedLineupSet[]>([]);
  const [isLateSwapRunning, setIsLateSwapRunning] = useState(false);
  const [lateSwapProgress, setLateSwapProgress] = useState<{ current: number; total: number } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const playerRefs = useRef<Record<string, HTMLDivElement>>({});

  const gameStartedCache = useMemo(() => {
    const cache = new Map<string, boolean>();
    // In historical mode all games are treated as not-started so admin can freely toggle locks
    if (isHistoricalMode) {
      games.forEach((game) => {
        cache.set(game.teamA.abbreviation, false);
        cache.set(game.teamB.abbreviation, false);
      });
      return cache;
    }
    const now = new Date();
    games.forEach((game) => {
      const gameTime = parseGameTime(game.gameTime);
      const started = gameTime ? now >= gameTime : false;
      cache.set(game.teamA.abbreviation, started);
      cache.set(game.teamB.abbreviation, started);
    });
    return cache;
  }, [games, isHistoricalMode]);

  const playerMap = useMemo(() => {
    const map = new Map<string, Player>();
    players.forEach(p => {
      map.set(p.id, p);
      map.set(`${p.name} (${p.id})`, p);
      map.set(`${p.name} (${p.id})`.toLowerCase(), p);
      map.set(p.name.toLowerCase(), p);
    });
    return map;
  }, [players]);

  const getPlayerFromString = (playerStr: string): Player | undefined => {
    const raw = String(playerStr || '').trim();
    if (!raw) return undefined;

    const normalized = stripSlotTags(raw);
    const idMatch = normalized.match(/\((\d+)\)/);
    if (idMatch?.[1]) {
      const byId = playerMap.get(idMatch[1]);
      if (byId) return byId;
    }

    const direct = playerMap.get(normalized) || playerMap.get(normalized.toLowerCase());
    if (direct) return direct;

    const nameOnly = normalized.replace(/\(\d+\)/g, '').trim().toLowerCase();
    if (!nameOnly) return undefined;
    return playerMap.get(nameOnly);
  };

  const isGameStarted = (teamAbbr: string): boolean => !!gameStartedCache.get(teamAbbr.toUpperCase());

  const isGameManuallyLocked = (game: GameInfo): boolean =>
    manualLocks.has(game.teamA.abbreviation) || manualLocks.has(game.teamB.abbreviation);

  const isPlayerLocked = (playerString: string): boolean => {
    if (/\(LOCKED\)/i.test(String(playerString || ''))) return true;
    const player = getPlayerFromString(playerString);
    if (!player) return false;
    if (isGameStarted(player.team)) return true;
    
    const game = games.find(g => g.teamA.abbreviation === player.team || g.teamB.abbreviation === player.team);
    return game ? isGameManuallyLocked(game) : false;
  };

  const computeEntryMetrics = (slots: Record<Slot, string>, scores: Record<string, number> = playerScores) => {
    let currentPoints = 0;
    let projectedPoints = 0;
    let salary = 0;

    SLOT_ORDER.forEach((slot) => {
      const player = getPlayerFromString(slots[slot]);
      if (!player) return;
      salary += player.salary || 0;
      const score = scores[player.id] || player.projection || 0;
      if (isPlayerLocked(slots[slot])) {
        currentPoints += score;
      }
      projectedPoints += score;
    });

    return {
      currentPoints,
      projectedPoints,
      remainingSalary: SALARY_CAP - salary,
    };
  };

  const hydrateEntry = (entry: Entry, scores: Record<string, number> = playerScores): Entry => {
    const metrics = computeEntryMetrics(entry.slots, scores);
    return {
      ...entry,
      ...metrics,
    };
  };

  useEffect(() => {
    setSavedLineupSets(loadSavedLineupSets());
  }, [showImportLineupsModal]);

  useEffect(() => {
    const session = loadEntryManagerSession();
    if (!session) return;
    if (session.slateDate && slateDate && session.slateDate !== slateDate) return;
    setPlayerScores(session.playerScores || {});
    setManualLocks(new Set(session.manualLocks || []));
    setLoadedFileName(session.fileName || '');
    setSessionSavedAt(session.updatedAt || null);
    setEntries((session.entries || []).map((entry) => hydrateEntry(entry, session.playerScores || {})));
  }, [slateDate]);

  useEffect(() => {
    if (!loadedFileName || entries.length === 0) return;
    saveEntryManagerSession({
      entries,
      playerScores,
      manualLocks: Array.from(manualLocks),
      fileName: loadedFileName,
      slateDate,
      updatedAt: Date.now(),
    });
  }, [entries, loadedFileName, manualLocks, playerScores, slateDate]);

  useEffect(() => {
    setEntries((prev) => {
      if (prev.length === 0) return prev;
      return prev.map((entry) => hydrateEntry(entry));
    });
  }, [games, manualLocks, playerScores, players]);
  
  const handleCsv = (file: File) => {
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: (result) => {
        const rows = result.data as string[][];
        const newEntries: Entry[] = [];
        const newPlayerScores: Record<string, number> = {};

        // Build the slate player set from the DK CSV's own player pool columns
        // (col 16 = numeric ID, col 18 = salary). This is the authoritative source
        // for who is actually on the slate — not the projections file.
        const dkSlatePlayerIds = new Set<string>();
        rows.forEach((row) => {
          const id = String(row[16] || '').trim();
          const salary = Number(String(row[18] || '0').replace(/[^0-9]/g, ''));
          if (/^\d+$/.test(id) && salary > 0) dkSlatePlayerIds.add(id);
        });

        const markOutIfNeeded = (rawSlot: string): string => {
          const raw = rawSlot.trim();
          if (!raw) return '';
          const idMatch = raw.match(/\((\d+)\)/);
          const playerId = idMatch?.[1];
          // If the DK CSV has a player pool, use it as the authority.
          // If the player is in the DK slate with a salary they are NOT out.
          if (dkSlatePlayerIds.size > 0) {
            if (playerId && dkSlatePlayerIds.has(playerId)) return raw;
            return `${raw} (OUT)`;
          }
          // Fallback: check the projections playerMap (original behaviour)
          const found = playerId
            ? playerMap.get(playerId) ?? playerMap.get(raw) ?? playerMap.get(raw.toLowerCase())
            : playerMap.get(raw) ?? playerMap.get(raw.toLowerCase());
          if (!found || Number(found.salary) === 0) return `${raw} (OUT)`;
          return raw;
        };

        rows.forEach((row) => {
          const firstCell = String(row[0] || '').trim().toLowerCase();
          if (firstCell === 'entry id') return;
          if (row[0] && row[2]) { // Entry row
            const rawSlots = [row[4], row[5], row[6], row[7], row[8], row[9], row[10], row[11]];
            const slots: Record<Slot, string> = {
              PG: markOutIfNeeded(rawSlots[0] || ''),
              SG: markOutIfNeeded(rawSlots[1] || ''),
              SF: markOutIfNeeded(rawSlots[2] || ''),
              PF: markOutIfNeeded(rawSlots[3] || ''),
              C:  markOutIfNeeded(rawSlots[4] || ''),
              G:  markOutIfNeeded(rawSlots[5] || ''),
              F:  markOutIfNeeded(rawSlots[6] || ''),
              UTIL: markOutIfNeeded(rawSlots[7] || ''),
            };
            newEntries.push({
              entryId: row[0],
              contestName: row[1],
              contestId: row[2],
              entryFee: row[3],
              slots,
            });
          } else if (!row[0] && !row[2] && row[14]) { // Player score row
            const playerId = row[15];
            const score = parseFloat(row[21]);
            if (playerId && !isNaN(score)) {
              newPlayerScores[playerId] = score;
            }
          }
        });

        const updatedEntries = newEntries.map((entry) => hydrateEntry(entry, newPlayerScores));
        setPlayerScores(newPlayerScores);
        setEntries(updatedEntries);
        setLoadedFileName(file.name);
        const savedAt = Date.now();
        setSessionSavedAt(savedAt);
        saveEntryManagerSession({
          entries: updatedEntries,
          playerScores: newPlayerScores,
          manualLocks: Array.from(manualLocks),
          fileName: file.name,
          slateDate,
          updatedAt: savedAt,
        });
      },
      error: (err) => {
        console.error('CSV parse error', err);
        alert('Failed to parse DKEntries.csv');
      },
    });
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleCsv(file);
  };

  const downloadCsv = () => {
    if (!entries.length) return;
    const rows = entries.map((en) => {
      const row: Record<string, string> = { 'Entry ID': en.entryId, 'Contest Name': en.contestName, 'Contest ID': en.contestId, 'Entry Fee': en.entryFee };
      SLOT_ORDER.forEach((s) => { row[s] = stripSlotTags(en.slots[s] || ''); });
      return row;
    });
    const csv = Papa.unparse(rows, { columns: REQUIRED_COLS });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const datePart = /^\d{4}-\d{2}-\d{2}$/.test(String(slateDate)) ? String(slateDate) : getLocalDateStr(new Date());
    const slateType = normalizeSlateType(selectedSlate);
    a.href = url;
    a.download = `Contest_Entries_${datePart}_${slateType}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveCurrentSession = () => {
    if (!loadedFileName || entries.length === 0) return;
    const savedAt = Date.now();
    saveEntryManagerSession({
      entries,
      playerScores,
      manualLocks: Array.from(manualLocks),
      fileName: loadedFileName,
      slateDate,
      updatedAt: savedAt,
    });
    setSessionSavedAt(savedAt);
  };

  const clearLoadedEntries = () => {
    setEntries([]);
    setPlayerScores({});
    setManualLocks(new Set());
    setLoadedFileName('');
    setSessionSavedAt(null);
    clearEntryManagerSession();
    setShowCandidates(false);
    setSelectedSlot(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const savedLineupSetsForDate = useMemo(() => {
    if (!slateDate) return savedLineupSets;
    return savedLineupSets.filter((set) => set.slateDate === slateDate);
  }, [savedLineupSets, slateDate]);

  const persistSavedLineupSets = (nextSets: SavedLineupSet[]) => {
    setSavedLineupSets(nextSets);
    saveSavedLineupSets(nextSets);
  };

  const applySavedLineupSetToEntries = (savedSet: SavedLineupSet) => {
    if (!entries.length || savedSet.lineups.length === 0) return;
    const unassignedEntryIndexes = entries
      .map((entry, idx) => (isEntryUnassigned(entry) ? idx : -1))
      .filter((idx) => idx >= 0);
    const targetIndexes = unassignedEntryIndexes.length > 0
      ? unassignedEntryIndexes
      : entries.map((_, idx) => idx);
    const applyCount = Math.min(savedSet.lineups.length, targetIndexes.length);
    if (applyCount <= 0) return;

    const nextEntries = [...entries];
    for (let lineupIdx = 0; lineupIdx < applyCount; lineupIdx += 1) {
      const entryIdx = targetIndexes[lineupIdx];
      const sourceLineup = savedSet.lineups[lineupIdx];
      const slots = lineupToSlots(sourceLineup, playerMap);
      nextEntries[entryIdx] = hydrateEntry({
        ...nextEntries[entryIdx],
        slots,
      });
    }
    setEntries(nextEntries);
    setShowImportLineupsModal(false);
  };

  const handleLineupImport = async (file: File) => {
    try {
      const parsedLineups = await parseOptimizerLineups(file, players);
      const validLineups = parsedLineups.filter((lineup) => Array.isArray(lineup.playerIds) && lineup.playerIds.length > 0);
      if (validLineups.length === 0) {
        alert('No valid lineups were found in the selected file.');
        return;
      }

      const now = Date.now();
      const baseName = String(file.name || 'Imported Lineups').replace(/\.[^.]+$/, '');
      const normalizedLineups: Lineup[] = validLineups.map((lineup, idx) => ({
        id: lineup.id || `imported_${now}_${idx + 1}`,
        playerIds: [...lineup.playerIds],
        totalSalary: Number.isFinite(Number(lineup.totalSalary)) ? Number(lineup.totalSalary) : 0,
        totalProjection: Number.isFinite(Number(lineup.totalProjection)) ? Number(lineup.totalProjection) : 0,
        lineupSource: 'optimizer',
      }));
      const savedSet: SavedLineupSet = {
        id: `saved_${now}_${Math.random().toString(36).slice(2, 8)}`,
        name: baseName || 'Imported Lineups',
        slateDate: slateDate || '',
        salaryCap: SALARY_CAP,
        createdAt: now,
        lineups: normalizedLineups,
      };

      const nextSets = [savedSet, ...loadSavedLineupSets()];
      persistSavedLineupSets(nextSets);

      if (entries.length > 0) {
        applySavedLineupSetToEntries(savedSet);
        alert(`Imported ${savedSet.lineups.length} lineups and loaded them into your entries.`);
      } else {
        alert(`Imported ${savedSet.lineups.length} lineups and saved them to Saved Lineups.`);
      }
    } catch (error) {
      console.error('Failed to import lineups file', error);
      alert('Failed to import lineups CSV. Please confirm it includes lineup slot columns (PG, SG, SF, PF, C, G, F, UTIL).');
    } finally {
      if (lineupFileInputRef.current) lineupFileInputRef.current.value = '';
    }
  };

  const onLineupFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void handleLineupImport(file);
    }
  };

  const runSingleLineupOptimization = (pool: Player[]): Promise<Lineup | null> => {
    return new Promise((resolve) => {
      const worker = new OptimizerWorker();
      let finished = false;

      const finish = (lineup: Lineup | null) => {
        if (finished) return;
        finished = true;
        worker.terminate();
        resolve(lineup);
      };

      worker.onmessage = (event: MessageEvent) => {
        const msg = event.data;
        if (msg?.type === 'result') {
          const lineup = Array.isArray(msg.lineups) && msg.lineups.length > 0 ? msg.lineups[0] : null;
          finish(lineup);
          return;
        }
        if (msg?.type === 'error') {
          finish(null);
        }
      };

      worker.onerror = () => finish(null);
      worker.postMessage({
        players: pool,
        config: {
          numLineups: 1,
          salaryCap: SALARY_CAP,
          maxExposure: 100,
        },
      });
    });
  };

  const buildLateSwapPool = (entry: Entry): Player[] => {
    const lockedPlayerIds = new Set<string>();
    SLOT_ORDER.forEach((slot) => {
      const playerStr = entry.slots[slot];
      if (!playerStr || !isPlayerLocked(playerStr)) return;
      // Locked+OUT means the game started but the player didn't play.
      // Don't force the optimizer to include them — they're not available.
      if (isPlayerOut(playerStr)) return;
      const player = getPlayerFromString(playerStr);
      if (player?.id) lockedPlayerIds.add(player.id);
    });

    const lockedTeams = new Set<string>();
    games.forEach((game) => {
      const isLockedGame =
        isGameStarted(game.teamA.abbreviation) ||
        isGameStarted(game.teamB.abbreviation) ||
        isGameManuallyLocked(game);
      if (!isLockedGame) return;
      lockedTeams.add(String(game.teamA.abbreviation || '').toUpperCase());
      lockedTeams.add(String(game.teamB.abbreviation || '').toUpperCase());
    });

    return players
      .filter((player) => Number(player.salary) > 0 && Number(player.projection) > 0)
      .map((player) => {
        const playerTeam = String(player.team || '').toUpperCase();
        const isLockedPlayer = lockedPlayerIds.has(player.id);
        const isExcluded = !isLockedPlayer && lockedTeams.has(playerTeam);
        return {
          ...player,
          optimizerLocked: isLockedPlayer,
          optimizerExcluded: isExcluded,
        };
      });
  };

  const assignOptimizedLineupToEntry = (entry: Entry, optimized: Lineup): Record<Slot, string> | null => {
    const optimizedPlayers = (optimized.playerIds || [])
      .map((id) => playerMap.get(id))
      .filter((player): player is Player => Boolean(player));
    if (optimizedPlayers.length === 0) return null;

    const nextSlots: Record<Slot, string> = { ...entry.slots };
    const lockedSlots = new Set<Slot>();
    const usedPlayerIds = new Set<string>();

    SLOT_ORDER.forEach((slot) => {
      const existing = entry.slots[slot];
      if (existing && isPlayerLocked(existing)) {
        // Keep locked slots regardless of whether the player is in the pool.
        // A locked+OUT player (game started, player didn't play) can't be swapped.
        nextSlots[slot] = existing;
        lockedSlots.add(slot);
        const existingPlayer = getPlayerFromString(existing);
        if (existingPlayer?.id) usedPlayerIds.add(existingPlayer.id);
      } else {
        nextSlots[slot] = '';
      }
    });

    const unlockedSlots = SLOT_ORDER.filter((slot) => !lockedSlots.has(slot));
    if (unlockedSlots.length === 0) return nextSlots;

    const optimizedById = new Map<string, Player>();
    optimizedPlayers.forEach((player) => {
      if (!usedPlayerIds.has(player.id)) {
        optimizedById.set(player.id, player);
      }
    });

    const fallbackPlayers: Player[] = unlockedSlots
      .filter((slot) => !isPlayerOut(entry.slots[slot]))
      .map((slot) => getPlayerFromString(entry.slots[slot]))
      .filter((player): player is Player => Boolean(player))
      .filter((player) => !usedPlayerIds.has(player.id));

    const candidateOrder = [
      ...Array.from(optimizedById.values()),
      ...fallbackPlayers.filter((player) => !optimizedById.has(player.id)),
    ];

    const currentAssignment = new Map<Slot, Player>();
    const assignmentUsedIds = new Set<string>(usedPlayerIds);

    const backtrack = (slotIndex: number): boolean => {
      if (slotIndex >= unlockedSlots.length) return true;
      const slot = unlockedSlots[slotIndex];
      const eligibleCandidates = candidateOrder
        .filter((player) => !assignmentUsedIds.has(player.id))
        .filter((player) => canPlayerFitSlot(player, slot))
        .sort((a, b) => {
          const aFromOptimized = optimizedById.has(a.id) ? 1 : 0;
          const bFromOptimized = optimizedById.has(b.id) ? 1 : 0;
          if (aFromOptimized !== bFromOptimized) return bFromOptimized - aFromOptimized;
          return Number(b.projection || 0) - Number(a.projection || 0);
        });

      for (const player of eligibleCandidates) {
        currentAssignment.set(slot, player);
        assignmentUsedIds.add(player.id);
        if (backtrack(slotIndex + 1)) return true;
        assignmentUsedIds.delete(player.id);
        currentAssignment.delete(slot);
      }

      return false;
    };

    const assigned = backtrack(0);
    if (!assigned) return null;

    unlockedSlots.forEach((slot) => {
      const player = currentAssignment.get(slot);
      nextSlots[slot] = player ? playerLabel(player) : '';
    });

    // Final salary cap check — optimizer players are always within budget, but
    // any fallback (original entry) players that slipped in might push over.
    const totalSalary = SLOT_ORDER.reduce((sum, slot) => {
      const player = getPlayerFromString(nextSlots[slot]);
      return sum + Number(player?.salary || 0);
    }, 0);
    if (totalSalary > SALARY_CAP) return null;

    return nextSlots;
  };

  const openSwapModal = (entryIdx: number, slot: Slot) => {
    const current = entries[entryIdx]?.slots[slot] || '';
    if (current && isPlayerLocked(current)) return;
    setSelectedSlot({ entryIdx, slot });
    setShowCandidates(true);
  };

  const applySwap = (playerName: string) => {
    if (!selectedSlot) return;
    setEntries((prev) =>
      prev.map((en, idx) => {
        if (idx !== selectedSlot.entryIdx) return en;
        const newSlots = { ...en.slots, [selectedSlot.slot]: playerName };
        return hydrateEntry({ ...en, slots: newSlots });
      })
    );
    setShowCandidates(false);
  };
  
  const candidatePlayers = useMemo(() => {
    if (!selectedSlot) return [];
    const positions: string[] = (() => {
      switch (selectedSlot.slot) {
        case 'G': return ['PG', 'SG'];
        case 'F': return ['SF', 'PF'];
        case 'UTIL': return ['PG', 'SG', 'SF', 'PF', 'C'];
        default: return [selectedSlot.slot];
      }
    })();
    return players
      .filter(p => p.position && positions.some(pos => p.position.includes(pos)))
      .sort((a,b) => b.salary - a.salary);
  }, [selectedSlot, players]);

  useEffect(() => {
    if (showCandidates && selectedSlot && scrollContainerRef.current) {
      const remainingSalary = entries[selectedSlot.entryIdx].remainingSalary || 0;
      const playerOut = getPlayerFromString(entries[selectedSlot.entryIdx].slots[selectedSlot.slot]);
      const budget = remainingSalary + (playerOut?.salary || 0);
      const bestFit = candidatePlayers.find(p => p.salary <= budget) || candidatePlayers[0];
      const container = scrollContainerRef.current;
      const targetEl = bestFit ? playerRefs.current[bestFit.id] : null;
      if (targetEl && container) {
        const offset = targetEl.offsetTop - container.offsetTop;
        container.scrollTo({ top: offset, behavior: 'smooth' });
      }
    }
  }, [showCandidates, selectedSlot, candidatePlayers, entries]);

  const currentLineupSalary = useMemo(() => {
    if (!selectedSlot) return 0;
    const entry = entries[selectedSlot.entryIdx];
    return SLOT_ORDER.reduce((sum, s) => sum + (getPlayerFromString(entry.slots[s])?.salary || 0), 0);
  }, [selectedSlot, entries, playerMap]);

  const toggleManualLock = (game: GameInfo) => {
    setManualLocks(prev => {
        const next = new Set(prev);
        const isLocked = isGameManuallyLocked(game);
        [game.teamA.abbreviation, game.teamB.abbreviation].forEach(abbr => {
            if(isLocked) next.delete(abbr);
            else next.add(abbr);
        });
        return next;
    });
  }

  const runLateSwap = async () => {
    if (isLateSwapRunning || entries.length === 0) return;
    setIsLateSwapRunning(true);
    setLateSwapProgress({ current: 0, total: entries.length });

    try {
      const nextEntries: Entry[] = [];
      let optimizedCount = 0;

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        setLateSwapProgress({ current: i + 1, total: entries.length });

        const pool = buildLateSwapPool(entry);
        const optimized = await runSingleLineupOptimization(pool);
        if (!optimized) {
          nextEntries.push(entry);
          continue;
        }

        const reassignedSlots = assignOptimizedLineupToEntry(entry, optimized);
        if (!reassignedSlots) {
          nextEntries.push(entry);
          continue;
        }

        nextEntries.push(hydrateEntry({ ...entry, slots: reassignedSlots }));
        optimizedCount += 1;
      }

      setEntries(nextEntries);
      if (optimizedCount === 0) {
        alert('No entries were updated. Check locks/constraints for feasibility.');
      }
    } catch (error) {
      console.error('Late swap optimization failed', error);
      alert('Late swap optimization failed. Please try again.');
    } finally {
      setIsLateSwapRunning(false);
      setLateSwapProgress(null);
    }
  };

  return (
    <div className="flex flex-col h-full space-y-6 pb-24 bg-vellum text-black">
      {/* Top Header */}
      <div className="flex-shrink-0 bg-white border-b border-ink/10 p-4 flex flex-wrap items-center gap-3 shadow-sm rounded-b-lg">
        <div>
          <h1 className="text-xl font-black uppercase tracking-wider text-black">Entry Manager</h1>
          <p className="text-sm text-black/60">{entries.length} Entries Loaded</p>
        </div>
        <input ref={lineupFileInputRef} type="file" accept=".csv" className="hidden" onChange={onLineupFileChange} />
        <button
          type="button"
          onClick={() => lineupFileInputRef.current?.click()}
          className="px-3 py-1.5 rounded-sm border border-ink/20 text-[10px] font-black uppercase tracking-widest text-black hover:border-drafting-orange transition-all"
        >
          <Upload className="inline-block w-3 h-3 mr-1.5" />
          Import Lineups CSV
        </button>
        <button
          type="button"
          onClick={() => {
            setSavedLineupSets(loadSavedLineupSets());
            setShowImportLineupsModal(true);
          }}
          className="px-3 py-1.5 rounded-sm border border-ink/20 text-[10px] font-black uppercase tracking-widest text-black hover:border-drafting-orange transition-all"
        >
          Saved Lineups
        </button>
        <div className="ml-auto flex flex-col items-end gap-1.5">
          <button
            onClick={runLateSwap}
            disabled={isLateSwapRunning || entries.length === 0}
            className="px-4 py-2 rounded-lg bg-drafting-orange text-white font-bold text-sm uppercase tracking-widest shadow hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Zap className="inline-block w-4 h-4 mr-2"/>
            {isLateSwapRunning ? 'Optimizing...' : 'Run Late Swap'}
          </button>
          {lateSwapProgress && (
            <div className="w-full min-w-[160px]">
              <div className="flex justify-between text-[10px] font-mono text-black/50 mb-0.5">
                <span>Entry {lateSwapProgress.current} of {lateSwapProgress.total}</span>
                <span>{Math.round((lateSwapProgress.current / lateSwapProgress.total) * 100)}%</span>
              </div>
              <div className="h-1.5 bg-ink/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-drafting-orange rounded-full transition-all duration-200"
                  style={{ width: `${(lateSwapProgress.current / lateSwapProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {loadedFileName && (
        <div className="flex items-center justify-between bg-white border border-ink/10 rounded-lg px-4 py-2 shadow-sm">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[11px] font-black uppercase tracking-widest text-black/70">File</span>
            <span className="text-sm font-mono font-bold text-black truncate">{loadedFileName}</span>
            <button
              type="button"
              onClick={clearLoadedEntries}
              className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-ink/20 text-black/60 hover:text-red-600 hover:border-red-600/40 transition-colors"
              title="Clear loaded entries"
              aria-label="Clear loaded entries"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            {sessionSavedAt && (
              <span className="text-[10px] font-mono text-black/50">Saved {new Date(sessionSavedAt).toLocaleTimeString()}</span>
            )}
            <button
              type="button"
              onClick={saveCurrentSession}
              className="px-3 py-1.5 rounded-sm border border-ink/20 text-[10px] font-black uppercase tracking-widest text-black hover:border-drafting-orange transition-all"
            >
              <Save className="inline-block w-3 h-3 mr-1.5" />
              Save
            </button>
            <button
              type="button"
              onClick={downloadCsv}
              className="px-3 py-1.5 rounded-sm bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-all"
            >
              <Download className="inline-block w-3 h-3 mr-1.5" />
              Download Entries
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        {/* Left Panel: Slate Controls */}
        <div className="w-full md:w-[18%] md:flex-shrink-0 bg-white border-b md:border-b-0 md:border-r border-ink/10 p-4 md:overflow-y-auto rounded-lg shadow-sm">
          <h2 className="text-lg font-bold uppercase tracking-wider text-black mb-3">Slate Controls</h2>
          <div className="flex md:flex-col gap-3 overflow-x-auto pb-1 md:pb-0">
              {games.map(game => {
                  const isLive = isGameStarted(game.teamA.abbreviation) || isGameStarted(game.teamB.abbreviation);
                  const isUpcoming = !isLive;
                  const manuallyLocked = isGameManuallyLocked(game);

                  return (
                      <div key={game.matchupKey} className="bg-vellum p-3 rounded-lg border border-ink/10 min-w-[160px] md:min-w-0">
                          <div className="flex items-center justify-between">
                            <div>
                                <span className={`px-2 py-1 rounded-full text-xs font-bold uppercase ${isLive ? 'bg-red-100 text-red-700' : 'bg-emerald-600 text-white'}`}>
                                    {isLive ? 'Live' : 'Upcoming'}
                                </span>
                                <p className="text-sm font-bold text-black mt-1">{game.teamA.abbreviation} vs {game.teamB.abbreviation}</p>
                                <p className="text-xs text-black/60">{game.gameTime}</p>
                            </div>
                            {isLive ? (
                                <div className="p-2 rounded-full bg-red-100 text-red-600" title="Game in progress — players auto-locked">
                                    <Lock className="w-5 h-5"/>
                                </div>
                            ) : (
                                <button onClick={() => toggleManualLock(game)} className={`p-2 rounded-full transition-colors ${manuallyLocked ? 'bg-blue-100 text-blue-700' : 'bg-white border border-ink/10 text-black hover:border-drafting-orange'}`}>
                                    {manuallyLocked ? <Lock className="w-5 h-5"/> : <Unlock className="w-5 h-5"/>}
                                </button>
                            )}
                          </div>
                      </div>
                  )
              })}
          </div>
        </div>

        {/* Right Panel: Entry Inspector */}
        <div className="flex-1 p-4 overflow-y-auto">
            {entries.length === 0 ? (
                <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="h-full flex items-center justify-center border-4 border-dashed border-ink/20 rounded-xl text-black/50 hover:border-drafting-orange hover:text-black transition-all cursor-pointer bg-white"
                >
                    <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={onFileChange} />
                    <div className="text-center">
                        <Upload className="w-12 h-12 mx-auto mb-2 text-drafting-orange"/>
                        <h3 className="text-lg font-bold uppercase text-black">Load Entries CSV</h3>
                        <p className="text-black/60">Drop a file or click here to get started.</p>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    {entries.map((entry, idx) => (
                        <div key={entry.entryId} className="bg-white rounded-xl border border-ink/10 shadow-sm">
                            <div className="p-3 border-b border-ink/10 flex justify-between items-center">
                                <div>
                                    <p className="text-sm font-bold text-black truncate">{entry.contestName}</p>
                                    <p className="text-xs text-black/60 font-mono">
                                      Current: {entry.currentPoints?.toFixed(2)} | Proj: {entry.projectedPoints?.toFixed(2)} | Rem. Salary: ${entry.remainingSalary?.toLocaleString()}
                                    </p>
                                </div>
                                <div className="text-[11px] text-black/60 font-mono"></div>
                            </div>
                            <div className="p-3 space-y-2">
                                {SLOT_ORDER.map(slot => {
                                    const playerStr = entry.slots[slot];
                                    const isOut = isPlayerOut(playerStr);
                                    const player = getPlayerFromString(playerStr);
                                    const locked = isPlayerLocked(playerStr);
                                    const proj = player ? (playerScores[player.id] || player.projection || 0) : 0;
                                    const salaryK = player ? `$${(player.salary / 1000).toFixed(1)}k` : null;
                                    // For OUT players not in the pool, extract display name from the raw string
                                    const outDisplayName = isOut && !player
                                      ? playerStr
                                          .replace(/\s*\(OUT\)\s*/gi, '')
                                          .replace(/\s*\(LOCKED\)\s*/gi, '')
                                          .replace(/\s*\(\d+\)\s*/g, '')
                                          .trim()
                                      : null;
                                    return (
                                        <div
                                          key={slot}
                                          onClick={() => !locked && openSwapModal(idx, slot)}
                                          className={`relative flex items-center justify-between rounded border px-2 py-1.5 ${locked ? 'bg-ink/5 border-ink/10' : isOut ? 'bg-red-50 border-red-200 hover:border-red-400 cursor-pointer' : 'bg-vellum border-ink/10 hover:border-drafting-orange cursor-pointer'}`}
                                        >
                                          <div className="flex items-center gap-3 w-full">
                                            <span className="text-[10px] font-black uppercase text-black/60 min-w-[28px]">{slot}</span>
                                            {player && isOut ? (
                                              <div className="flex items-center w-full min-w-0 gap-2">
                                                <span className="text-[11px] font-bold text-black/40 line-through truncate flex-1 min-w-0">{formatPlayerName(player.name)}</span>
                                                <span className="text-[9px] font-black bg-red-100 text-red-700 px-1 rounded uppercase tracking-wider whitespace-nowrap">OUT</span>
                                                {salaryK && <span className="text-[11px] text-black/40 font-mono whitespace-nowrap">{salaryK}</span>}
                                              </div>
                                            ) : outDisplayName ? (
                                              <div className="flex items-center w-full min-w-0 gap-2">
                                                <span className="text-[11px] font-bold text-black/40 line-through truncate flex-1 min-w-0">{outDisplayName}</span>
                                                <span className="text-[9px] font-black bg-red-100 text-red-700 px-1 rounded uppercase tracking-wider whitespace-nowrap">OUT</span>
                                              </div>
                                            ) : player ? (
                                              <div className="flex items-center w-full min-w-0 gap-2">
                                                <span className={`text-[11px] font-bold text-black truncate flex-1 min-w-0 ${locked ? 'opacity-70' : ''}`}>{formatPlayerName(player.name)}</span>
                                                {salaryK && <span className="text-[11px] text-black/70 font-mono whitespace-nowrap">{salaryK}</span>}
                                                <span className="text-[11px] text-black/70 font-mono ml-auto whitespace-nowrap">{locked ? 'Current' : 'Proj'}: {proj.toFixed(2)}</span>
                                              </div>
                                            ) : (
                                              <span className="text-black/40 text-[11px] font-mono flex-1">Empty</span>
                                            )}
                                          </div>
                                          {locked && (
                                            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                              <Lock className="w-4 h-4 text-black/55" />
                                            </div>
                                          )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
      </div>

      {showCandidates && selectedSlot && (
        <div className="fixed inset-0 z-[120] bg-vellum/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div ref={scrollContainerRef} className="bg-vellum rounded-xl border border-ink/10 w-full max-w-3xl max-h-[80vh] overflow-hidden shadow-2xl flex flex-col">
            <div className="p-4 border-b border-ink/10 flex items-center justify-between flex-shrink-0">
                <div>
                    <h3 className="text-lg font-black uppercase tracking-wider text-drafting-orange">Swap {selectedSlot.slot}</h3>
                    <p className="text-sm text-black/70 font-mono">Remaining Salary: ${(SALARY_CAP - currentLineupSalary).toLocaleString()}</p>
                </div>
              <button onClick={() => setShowCandidates(false)} className="p-2 text-black/50 hover:text-black transition-colors rounded-full"><X className="w-5 h-5"/></button>
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-ink/10">
              {candidatePlayers.map((p) => {
                const locked = isPlayerLocked(`${p.name} (${p.id})`);
                const playerOut = getPlayerFromString(entries[selectedSlot.entryIdx].slots[selectedSlot.slot]);
                const salaryAfterSwap = currentLineupSalary - (playerOut?.salary || 0) + p.salary;
                const canAfford = salaryAfterSwap <= SALARY_CAP;
                
                return (
                  <div key={p.id} ref={el => playerRefs.current[p.id] = el!} className="flex items-center justify-between px-4 py-3 hover:bg-white">
                    <div>
                      <button className="text-lg font-black text-black text-left hover:underline" onClick={() => setDeepDivePlayer(p)}>
                        {p.name}
                      </button>
                      <span className="text-sm text-black/60 ml-3 font-mono">
                        {p.team} - {p.position} - ${p.salary?.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      {locked ? <ShieldAlert className="w-5 h-5 text-red-600"/> : <ShieldCheck className="w-5 h-5 text-emerald-600"/>}
                      <button
                        className="px-4 py-2 rounded bg-drafting-orange text-white text-xs font-bold uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition-colors"
                        disabled={locked || !canAfford}
                        onClick={() => applySwap(`${p.name} (${p.id})`)}
                      >
                        Swap In
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {showImportLineupsModal && (
        <div className="fixed inset-0 z-[125] bg-vellum/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-vellum rounded-xl border border-ink/10 w-full max-w-2xl max-h-[80vh] overflow-hidden shadow-2xl flex flex-col">
            <div className="p-4 border-b border-ink/10 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black uppercase tracking-wider text-drafting-orange">Import Saved Lineups</h3>
                <p className="text-xs text-black/70 font-mono mt-1">
                  {entries.length > 0
                    ? 'Select a saved lineup set to map lineups across your entries.'
                    : 'No entries loaded yet. You can still import lineup files, and they will be saved here.'}
                </p>
              </div>
              <button onClick={() => setShowImportLineupsModal(false)} className="p-2 text-black/50 hover:text-black transition-colors rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-ink/10">
              {savedLineupSetsForDate.length === 0 ? (
                <div className="p-8 text-center text-black/50 font-bold uppercase tracking-widest text-sm">
                  No saved lineups available for this slate.
                </div>
              ) : (
                savedLineupSetsForDate.map((savedSet) => (
                  <div key={savedSet.id} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-black truncate">{savedSet.name}</p>
                      <p className="text-xs text-black/60 font-mono">
                        {savedSet.lineups.length} lineups • {new Date(savedSet.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => applySavedLineupSetToEntries(savedSet)}
                      disabled={entries.length === 0}
                      className="px-4 py-2 rounded bg-drafting-orange text-white text-xs font-bold uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition-colors"
                    >
                      Apply
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {deepDivePlayer && (
        <PlayerDeepDive
          player={deepDivePlayer}
          players={players}
          games={games}
          onClose={() => setDeepDivePlayer(null)}
          isHistorical={false}
          showActuals={showActuals}
          depthCharts={undefined}
          injuryLookup={undefined}
          startingLineupLookup={undefined}
          allowedTabs={deepDiveAllowedTabs}
        />
      )}
    </div>
  );
};

export default DKEntryManager;
