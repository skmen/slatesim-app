import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { BarChart2, Database, LogOut, Cpu, Lock, Zap } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { useUser, ClerkProvider, useAuth as useClerkAuth } from "@clerk/clerk-react"; 
import { AppState, ViewState, ContestInput, ContestDerived, Entitlement, GameInfo } from './types';
import { parseProjections, parsePipelineJson, parseOptimizerLineups, parseUserLineupsRows, canonicalizeId, normalizeName } from './utils/csvParser';
import { buildInjuryLookup, InjuryLookup } from './utils/injuries';
import { buildStartingLineupLookup, StartingLineupLookup } from './utils/startingLineups';
import { DashboardView } from './components/DashboardView';
import { OptimizerView } from './components/OptimizerView';
import { deriveContest, DEFAULT_CONTEST, deriveGamesFromPlayers, recomputeLineupDisplay } from './utils/contest';
import { saveContestInput, loadContestInput, saveBeliefs, loadBeliefs } from './utils/storage';
import { loadSlateEcosystem } from './utils/assetLoader';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LineupProvider } from './context/LineupContext';
import { SplashLogin } from './components/SplashLogin';
import { LineupDrawer } from './components/LineupDrawer';

// ... (Keep existing INITIAL_STATE, IntegrityFooter, AppContent unchanged) ...
// TO SAVE SPACE, I AM RE-USING YOUR EXISTING APP LOGIC BELOW
// PLEASE ENSURE YOU KEEP YOUR 'AppContent', 'IntegrityFooter', AND 'INITIAL_STATE' DEFINITIONS HERE.
// I WILL PROVIDE THE FULL FILE CONTENT FOR SAFETY.

const INITIAL_STATE: AppState = {
  slate: {
    date: new Date().toISOString().split('T')[0],
    games: [],
    players: [],
    lineups: [],
  },
  contestState: {
    input: DEFAULT_CONTEST,
    derived: deriveContest(DEFAULT_CONTEST),
  },
  historicalRotations: null,
  historicalBoxscores: null,
  historicalStats: null,
  user: {
    username: 'Guest',
    entitlements: [],
    role: 'user',
  },
  view: ViewState.RESEARCH,
  loading: false,
  lastUpdated: 0,
};

const IntegrityFooter: React.FC = () => {
  const [time, setTime] = useState(new Date().toLocaleTimeString());
  useEffect(() => {
    const i = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(i);
  }, []);
  return (
    <footer className="w-full bg-black/40 border-t border-ink-border py-4 px-6 mt-12 backdrop-blur-md">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono">
        <div className="flex items-center gap-2">
          <Lock className="w-3 h-3 text-highlight" />
          <span>Slate Integrity Protocol</span>
          <span className="text-muted-slate">|</span>
          <span className="text-slate-400">Locked: {time}</span>
        </div>
      </div>
    </footer>
  );
};

const getLocalDateStr = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

const isDateBeforeToday = (dateStr: string): boolean => {
  const parts = String(dateStr || '').split('-');
  if (parts.length !== 3) return false;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;

  const input = new Date(y, m - 1, d);
  input.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return input < today;
};

const readByNormalizedKey = (obj: any, keys: string[]): any => {
  if (!obj || typeof obj !== 'object') return undefined;
  const normalizedMap = new Map<string, string>();
  Object.keys(obj).forEach((key) => {
    normalizedMap.set(key.toLowerCase().replace(/[^a-z0-9]/g, ''), key);
  });
  for (const key of keys) {
    const match = normalizedMap.get(key.toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (match) return obj[match];
  }
  return undefined;
};

const toNum = (v: any, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const extractRecords = (payload: any): any[] => {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;

  const candidates = [
    payload.players,
    payload.projections,
    payload.rotations,
    payload.playerRotations,
    payload.byPlayer,
    payload.data?.byPlayer,
    payload.data?.players,
    payload.data?.projections,
    payload.data?.rotations,
    payload.data?.playerRotations,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate;
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      const values = Object.values(candidate).filter((v) => v && typeof v === 'object');
      if (values.length > 0) return values as any[];
    }
  }

  if (Array.isArray(payload.games)) {
    const fromGames = payload.games
      .flatMap((game: any) => {
        if (Array.isArray(game?.players)) return game.players;
        if (Array.isArray(game?.rotations)) return game.rotations;
        return [];
      })
      .filter((v: any) => v && typeof v === 'object');
    if (fromGames.length > 0) return fromGames;
  }

  if (payload.data && Array.isArray(payload.data.games)) {
    const fromDataGames = payload.data.games
      .flatMap((game: any) => {
        if (Array.isArray(game?.players)) return game.players;
        if (Array.isArray(game?.rotations)) return game.rotations;
        return [];
      })
      .filter((v: any) => v && typeof v === 'object');
    if (fromDataGames.length > 0) return fromDataGames;
  }

  const objectValues = Object.values(payload).filter((v) => v && typeof v === 'object');
  if (objectValues.length > 0) return objectValues as any[];
  return [];
};

const extractLast5PlayByPlay = (record: any): any[] => {
  const direct = [
    record?.last5PlayByPlay,
    record?.playByPlay,
    record?.play_by_play,
    readByNormalizedKey(record, ['last5playbyplay', 'playbyplay']),
  ].find((value) => Array.isArray(value));
  return Array.isArray(direct) ? direct : [];
};

const extractRotations = (record: any): any[] => {
  const direct = [
    record?.rotations,
    record?.rotationStints,
    record?.stints,
    readByNormalizedKey(record, ['rotations', 'rotationstints', 'stints']),
  ].find((value) => Array.isArray(value));
  if (Array.isArray(direct) && direct.length > 0) return direct;

  const pbp = extractLast5PlayByPlay(record);
  if (pbp.length === 0) return [];
  const latestChunks = Array.isArray(pbp[pbp.length - 1]?.chunks) ? pbp[pbp.length - 1].chunks : [];
  return latestChunks.map((chunk: any) => ({
    period: toNum(chunk?.quarter, 1),
    startSec: Math.max(0, Math.round(toNum(chunk?.startMinute, 0) * 60)),
    endSec: Math.max(0, Math.round(toNum(chunk?.endMinute, 0) * 60)),
    stats: {
      minutes: toNum(chunk?.minutesPlayed, 0),
      pts: toNum(chunk?.points, 0),
      reb: toNum(chunk?.rebounds, 0),
      ast: toNum(chunk?.assists, 0),
      stl: toNum(chunk?.steals, 0),
      blk: toNum(chunk?.blocks, 0),
      to: toNum(chunk?.turnovers, 0),
      fpts: toNum(chunk?.fantasyPoints, 0),
    },
  }));
};

const extractActual = (record: any): number | undefined => {
  const raw = record?.actual ??
    record?.actualFpts ??
    record?.actual_fpts ??
    record?.fpts ??
    record?.fantasyPoints ??
    readByNormalizedKey(record, ['actual', 'actualfpts', 'actualfptsdk', 'fpts', 'fantasypoints']);
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

const extractHistoricalLogs = (record: any): any[] => {
  if (!record || typeof record !== 'object') return [];
  const direct = [
    record?.historicalGameLogs,
    record?.historicalGameLog,
    record?.historical_game_log,
    record?.gameLog,
    record?.gamelog,
    readByNormalizedKey(record, ['historicalgamelogs', 'historicalgamelog', 'historicalgamelog', 'gamelog']),
  ].find((value) => Array.isArray(value) || (value && typeof value === 'object'));
  if (Array.isArray(direct)) return direct;
  if (direct && typeof direct === 'object') {
    return Object.values(direct).filter((v) => v && typeof v === 'object') as any[];
  }
  return [];
};

const normalizeHistoricalLogs = (logs: any[], fallbackProjection: number): any[] => {
  return logs
    .map((game: any) => {
      const date = String(game?.date ?? game?.gameDate ?? readByNormalizedKey(game, ['date', 'gamedate']) ?? '');
      if (!date) return null;

      const opponent = String(
        game?.opponentTeamId ??
        game?.opponent ??
        game?.opp ??
        readByNormalizedKey(game, ['opponentteamid', 'opponent', 'opp']) ??
        '--'
      );
      const minutes = toNum(
        game?.minutes ??
        game?.mins ??
        game?.min ??
        game?.minutesPlayed ??
        readByNormalizedKey(game, ['minutes', 'mins', 'min', 'minutesplayed']),
        0
      );
      const fpts = toNum(
        game?.fantasyPoints ??
        game?.fpts ??
        game?.actual ??
        game?.actualFpts ??
        readByNormalizedKey(game, ['fantasypoints', 'fpts', 'actual', 'actualfpts']),
        0
      );
      const projectionRaw =
        game?.projection ??
        game?.projectedFantasyPoints ??
        game?.proj ??
        readByNormalizedKey(game, ['projection', 'projectedfantasypoints', 'proj']);
      const projectionNum = Number(projectionRaw);

      return {
        date,
        opponent,
        minutes,
        fpts,
        projection: Number.isFinite(projectionNum) ? projectionNum : fallbackProjection,
      };
    })
    .filter((game): game is any => game !== null);
};

const extractStatsProfile = (record: any): Record<string, number | string> | undefined => {
  if (!record || typeof record !== 'object') return undefined;
  const direct = record?.stats ?? readByNormalizedKey(record, ['stats']);
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
    return direct as Record<string, number | string>;
  }
  return undefined;
};

const mergeHistoricalDataIntoPlayers = (
  players: any[],
  rotationsPayload: any,
  boxscoresPayload: any,
  statsPayload: any
): any[] => {
  const rotationRecords = extractRecords(rotationsPayload);
  const boxscoreRecords = extractRecords(boxscoresPayload);
  const statsRecords = extractRecords(statsPayload);

  const rotationsById = new Map<string, any>();
  const rotationsByNameTeam = new Map<string, any>();
  const rotationsByName = new Map<string, any>();
  rotationRecords.forEach((record) => {
    const rawId = record?.playerId ?? record?.id ?? record?.ID ?? readByNormalizedKey(record, ['playerid', 'id']);
    const id = canonicalizeId(rawId);
    const name = String(record?.name ?? record?.playerName ?? readByNormalizedKey(record, ['name', 'playername']) ?? '');
    const team = String(record?.teamId ?? record?.team ?? record?.TeamAbbrev ?? readByNormalizedKey(record, ['teamid', 'team', 'teamabbrev']) ?? '').toUpperCase();
    const normalizedName = normalizeName(name);
    const key = `${normalizedName}::${team}`;
    if (id) rotationsById.set(id, record);
    if (normalizedName) rotationsByNameTeam.set(key, record);
    if (normalizedName) rotationsByName.set(normalizedName, record);
  });

  const boxscoresById = new Map<string, any>();
  const boxscoresByNameTeam = new Map<string, any>();
  const boxscoresByName = new Map<string, any>();
  boxscoreRecords.forEach((record) => {
    const rawId = record?.playerId ?? record?.id ?? record?.ID ?? readByNormalizedKey(record, ['playerid', 'id']);
    const id = canonicalizeId(rawId);
    const name = String(record?.name ?? record?.playerName ?? readByNormalizedKey(record, ['name', 'playername']) ?? '');
    const team = String(record?.teamId ?? record?.team ?? record?.TeamAbbrev ?? readByNormalizedKey(record, ['teamid', 'team', 'teamabbrev']) ?? '').toUpperCase();
    const normalizedName = normalizeName(name);
    const key = `${normalizedName}::${team}`;
    if (id) boxscoresById.set(id, record);
    if (normalizedName) boxscoresByNameTeam.set(key, record);
    if (normalizedName) boxscoresByName.set(normalizedName, record);
  });

  const statsById = new Map<string, any>();
  const statsByNameTeam = new Map<string, any>();
  const statsByName = new Map<string, any>();
  statsRecords.forEach((record) => {
    const rawId = record?.playerId ?? record?.id ?? record?.ID ?? readByNormalizedKey(record, ['playerid', 'id']);
    const id = canonicalizeId(rawId);
    const name = String(record?.name ?? record?.playerName ?? readByNormalizedKey(record, ['name', 'playername']) ?? '');
    const team = String(record?.teamId ?? record?.team ?? record?.TeamAbbrev ?? readByNormalizedKey(record, ['teamid', 'team', 'teamabbrev']) ?? '').toUpperCase();
    const normalizedName = normalizeName(name);
    const key = `${normalizedName}::${team}`;
    if (id) statsById.set(id, record);
    if (normalizedName) statsByNameTeam.set(key, record);
    if (normalizedName) statsByName.set(normalizedName, record);
  });

  return players.map((player) => {
    const playerId = canonicalizeId(player?.id);
    const playerKey = `${normalizeName(player?.name || '')}::${String(player?.team || '').toUpperCase()}`;

    const normalizedPlayerName = normalizeName(player?.name || '');
    const rotationRecord =
      (playerId && rotationsById.get(playerId)) ||
      rotationsByNameTeam.get(playerKey) ||
      rotationsByName.get(normalizedPlayerName);
    const boxRecord =
      (playerId && boxscoresById.get(playerId)) ||
      boxscoresByNameTeam.get(playerKey) ||
      boxscoresByName.get(normalizedPlayerName);
    const statsRecord =
      (playerId && statsById.get(playerId)) ||
      statsByNameTeam.get(playerKey) ||
      statsByName.get(normalizedPlayerName);

    const mergedLast5 = Array.isArray(player?.last5PlayByPlay) && player.last5PlayByPlay.length > 0
      ? player.last5PlayByPlay
      : extractLast5PlayByPlay(rotationRecord);

    const mergedRotations = Array.isArray(player?.rotations) && player.rotations.length > 0
      ? player.rotations
      : extractRotations(rotationRecord);

    const mergedActual = player?.actual ?? extractActual(rotationRecord) ?? extractActual(boxRecord);
    const boxscoreLogs = normalizeHistoricalLogs(
      extractHistoricalLogs(boxRecord),
      Number(player?.projection) || 0
    );
    const rawHistoricalGameLogs = extractHistoricalLogs(boxRecord);
    const mergedHistory = boxscoreLogs.length > 0
      ? boxscoreLogs
      : (Array.isArray(player?.history) ? player.history : []);
    const mergedStatsProfile = extractStatsProfile(statsRecord) ?? player?.statsProfile;

    return {
      ...player,
      last5PlayByPlay: mergedLast5,
      rotations: mergedRotations,
      actual: mergedActual,
      history: mergedHistory,
      historicalGameLogsRaw: rawHistoricalGameLogs.length > 0
        ? rawHistoricalGameLogs
        : (Array.isArray(player?.historicalGameLogsRaw) ? player.historicalGameLogsRaw : []),
      statsProfile: mergedStatsProfile,
    };
  });
};

const NavItem = ({ label, icon: Icon, targetView, entitlement, setView, view, hasEntitlement }: { label: string, icon: any, targetView: ViewState, entitlement?: Entitlement, setView: (view: ViewState) => void, view: ViewState, hasEntitlement: (entitlement: Entitlement) => boolean }) => {
  const isGated = entitlement && !hasEntitlement(entitlement);
  if (isGated) return null;
  
  return (
    <button onClick={() => setView(targetView)} className={`flex flex-col items-center gap-1 p-2 min-w-[64px] rounded-lg transition-colors ${view === targetView ? 'text-ink bg-ink/10 font-bold' : 'text-ink/40 hover:bg-ink/5'}`}>
      <Icon className="w-5 h-5" />
      <span className="text-[10px] font-black uppercase tracking-tighter">{label}</span>
    </button>
  );
};

const AppContent: React.FC = () => {
  const { user, logout, hasEntitlement } = useAuth();
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [view, setView] = useState<ViewState>(ViewState.RESEARCH);
  const [loading, setLoading] = useState(false);
  const [isHistorical, setIsHistorical] = useState(false);
  const [selectedDate, setSelectedDate] = useState(getLocalDateStr(new Date()));
  const [injuryLookup, setInjuryLookup] = useState<InjuryLookup>(new Map());
  const [dataLastModified, setDataLastModified] = useState<string | null>(null);
  const [depthCharts, setDepthCharts] = useState<any | null>(null);
  const [startingLineupLookup, setStartingLineupLookup] = useState<StartingLineupLookup>(new Map());
  const formattedLastModified = useMemo(() => {
    if (!dataLastModified) return null;
    const parsed = new Date(dataLastModified);
    if (!Number.isFinite(parsed.getTime())) return dataLastModified;
    return parsed.toLocaleString();
  }, [dataLastModified]);

  useEffect(() => {
    const initApp = async () => {
      setLoading(true);
      const savedContest = loadContestInput();
      
      const loadResult = await loadSlateEcosystem({
        targetDate: selectedDate,
        includeHistory: true,
      });
      if (loadResult.errors) {
        console.warn('Slate ecosystem load warnings:', loadResult.errors, loadResult.loadedFrom);
      }

      if (!loadResult.ok || !loadResult.data?.slate) {
        alert(`No slate data found in database for ${selectedDate}`);
        // Reset state but preserve user and view
        setState(prev => ({
          ...INITIAL_STATE,
          user: prev.user,
          view: prev.view,
        }));
        setInjuryLookup(new Map());
        setDataLastModified(null);
        setDepthCharts(null);
        setStartingLineupLookup(new Map());
        setLoading(false);
        return;
      }

      const refData = parsePipelineJson(loadResult.data.slate);
      let refPlayers = refData.referencePlayers || [];
      refPlayers = mergeHistoricalDataIntoPlayers(
        refPlayers,
        loadResult.data.history?.rotations,
        loadResult.data.history?.boxscores,
        loadResult.data.history?.stats
      );
      
      let games: GameInfo[] = [];
      if (refData.games && refData.games.length > 0) {
        games = refData.games;
      } else {
        games = deriveGamesFromPlayers(refPlayers, refData.teams || []);
      }

      // Hydrate opponent data
      const gameMap = new Map<string, GameInfo>();
      games.forEach(g => {
        gameMap.set(g.teamA.teamId, g);
        gameMap.set(g.teamB.teamId, g);
      });

      refPlayers = refPlayers.map(p => {
        if (p.opponent) return p;
        const game = gameMap.get(p.team);
        if (game) {
          const opponentId = game.teamA.teamId === p.team ? game.teamB.teamId : game.teamA.teamId;
          return { ...p, opponent: opponentId };
        }
        return p;
      });

      const finalLineups = refData.referenceLineups || [];
      
      let contestState = refData.contestState;
      if (!contestState && savedContest) {
        contestState = { input: savedContest, derived: deriveContest(savedContest) };
      }

      setState(prev => ({
        ...prev,
        slate: {
          date: selectedDate,
          games,
          players: refPlayers,
          lineups: finalLineups,
        },
        historicalRotations: loadResult.data.history?.rotations ?? null,
        historicalBoxscores: loadResult.data.history?.boxscores ?? null,
        historicalStats: loadResult.data.history?.stats ?? null,
        contestState: contestState || { input: DEFAULT_CONTEST, derived: deriveContest(DEFAULT_CONTEST) },
        lastUpdated: Date.now(),
      }));
      setInjuryLookup(buildInjuryLookup(loadResult.data.injuries));
      setDataLastModified(loadResult.lastModified?.latest ?? null);
      setDepthCharts(loadResult.data.depthCharts ?? null);
      setStartingLineupLookup(buildStartingLineupLookup(loadResult.data.startingLineups));

      setLoading(false);
    };

    initApp();
  }, [selectedDate]);

  useEffect(() => {
    setIsHistorical(isDateBeforeToday(state.slate.date));
  }, [state.slate.date]);

  useEffect(() => { saveContestInput(state.contestState.input); }, [state.contestState.input]);

  const computedLineups = useMemo(
    () => recomputeLineupDisplay(state.slate.lineups, state.contestState, state.slate.players),
    [state.slate.lineups, state.slate.players, state.contestState.input]
  );

  const onDropMain = useCallback(async (acceptedFiles: File[]) => {
    if (!hasEntitlement('admin_panel')) return;
    const file = acceptedFiles[0];
    if (!file) return;
    setLoading(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        const refData = parsePipelineJson(content);
        let refPlayers = refData.referencePlayers || [];
        
        let games: GameInfo[] = [];
        if (refData.games && refData.games.length > 0) {
          games = refData.games;
        } else {
          games = deriveGamesFromPlayers(refPlayers, refData.teams || []);
        }

        const gameMap = new Map<string, GameInfo>();
        games.forEach(g => {
          gameMap.set(g.teamA.teamId, g);
          gameMap.set(g.teamB.teamId, g);
        });

        refPlayers = refPlayers.map(p => {
          if (p.opponent) return p;
          const game = gameMap.get(p.team);
          if (!game) return p;
          const opponentId = game.teamA.teamId === p.team ? game.teamB.teamId : game.teamA.teamId;
          return { ...p, opponent: opponentId };
        });

        setState(prev => ({
          ...prev,
          slate: {
            ...prev.slate,
            date: new Date().toISOString().split('T')[0],
            games,
            players: refPlayers,
            lineups: refData.referenceLineups || [],
          },
          contestState: refData.contestState || prev.contestState,
        }));
        if (refData.contestState) {
          setState(prev => ({ ...prev, contestState: refData.contestState }));
        }
        setDataLastModified(null);
        setDepthCharts(null);
        setStartingLineupLookup(new Map());
      } catch (err) { alert("Data Error: Failed to parse lineup pack."); }
      setLoading(false);
    };
    reader.readAsText(file);
  }, [hasEntitlement]);

  const onBeliefUpload = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    setLoading(true);
    try {
      const newBeliefPlayers = await parseProjections(file);
      saveBeliefs(newBeliefPlayers, file.name);
      setState(prev => ({ ...prev, slate: { ...prev.slate, players: newBeliefPlayers } }));
    } catch (e) { alert("Import Error: Failed to update projections."); }
    setLoading(false);
  }, []);

  const onLineupUpload = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    setLoading(true);
    try {
      const previewText = await file.slice(0, 4096).text();
      const headers = previewText.toLowerCase();
      const isOptimizer = headers.includes('pg') && headers.includes('util');

      if (isOptimizer) {
         if (!state.slate.players || state.slate.players.length === 0) {
            throw new Error("Standby: Projection data not loaded.");
         }
         const loaded = await parseOptimizerLineups(file, state.slate.players);
         setState(prev => ({ ...prev, slate: { ...prev.slate, lineups: loaded } }));
      } else {
         const loaded = await parseUserLineupsRows(file);
         setState(prev => ({ ...prev, slate: { ...prev.slate, lineups: loaded } }));
      }
    } catch (e: any) { alert(e.message || "I/O Error: Failed to parse upload."); }
    setLoading(false);
  }, [state.slate.players]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop: onDropMain, 
    accept: { 'application/json': ['.json'] }, 
    multiple: false 
  } as any);

  

  return (
    <div className="min-h-screen font-sans bg-vellum text-ink flex flex-col selection:bg-drafting-orange selection:text-white">
      <header className="bg-vellum/80 border-b border-ink/10 sticky top-0 z-50 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 cursor-pointer p-2 rounded-sm" onClick={() => setView(ViewState.RESEARCH)}>
              <div className="bg-drafting-orange p-1.5 rounded-sm"><Cpu className="w-5 h-5 text-white" /></div>
              <h1 className="font-black text-xl tracking-tighter leading-none italic uppercase text-ink">SLATE<span className="text-drafting-orange">SIM</span></h1>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-ink/60 uppercase tracking-widest">Slate Date</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-vellum border border-ink/20 rounded-sm px-2 py-1 text-xs font-bold text-ink outline-none focus:border-drafting-orange"
              />
              <span className="text-[10px] font-black text-ink/40 uppercase tracking-widest">Actuals limited to Deep Dive</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end mr-2">
              <span className="text-[10px] font-bold text-ink uppercase tracking-tighter">{user?.username}</span>
              <span className="text-[9px] font-bold text-ink/70 uppercase tracking-widest">
                Updated: {formattedLastModified ?? '—'}
              </span>
              <span className="text-[8px] font-black text-drafting-orange uppercase opacity-80">{user?.role}</span>
            </div>
            {hasEntitlement('admin_panel') && (
              <button onClick={() => setView(ViewState.LOAD)} className="text-[9px] font-black text-drafting-orange border border-drafting-orange/20 px-2 py-1 rounded uppercase tracking-widest hover:bg-drafting-orange/10 transition-all font-mono">UPDATE_DATA</button>
            )}
            <button onClick={logout} className="p-2 rounded-full hover:bg-red-500/10 text-ink/40 hover:text-red-600 transition-colors"><LogOut className="w-5 h-5" /></button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto px-4 py-6 w-full">
        {view === ViewState.LOAD && hasEntitlement('admin_panel') && (
          <div className="max-w-xl mx-auto space-y-8 mt-6 pb-24">
            <div {...getRootProps()} className={`border-2 border-dashed rounded-2xl p-12 text-center transition-all cursor-pointer ${isDragActive ? 'border-drafting-orange bg-drafting-orange/5' : 'border-ink/20 hover:border-drafting-orange bg-white/40'}`}>
              <input {...getInputProps()} />
              <div className="bg-drafting-orange/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-drafting-orange/20"><Database className="w-8 h-8 text-drafting-orange" /></div>
              <p className="font-bold text-lg mb-1 uppercase tracking-tight italic text-ink">Initialize Physics Core (JSON)</p>
              <p className="text-xs text-ink/60 font-mono italic tracking-tighter">Upload authoritative baseline and field metadata</p>
            </div>
          </div>
        )}

        {view === ViewState.RESEARCH && (
          <DashboardView
            players={state.slate.players}
            games={state.slate.games || []}
            isHistorical={isHistorical}
            showActuals={false}
            injuryLookup={injuryLookup}
            depthCharts={depthCharts}
            startingLineupLookup={startingLineupLookup}
          />
        )}
        {view === ViewState.OPTIMIZER && (
          <OptimizerView
            players={state.slate.players}
            games={state.slate.games}
            slateDate={state.slate.date}
            showActuals={false}
            injuryLookup={injuryLookup}
            startingLineupLookup={startingLineupLookup}
          />
        )}
      </main>

      <IntegrityFooter />
      <LineupDrawer players={state.slate.players} showActuals={false} />

      <nav className="fixed bottom-0 left-0 right-0 bg-white/80 border-t border-ink/10 px-6 py-2 pb-safe z-40 shadow-2xl backdrop-blur-md">
           <div className="flex justify-around items-center max-w-lg mx-auto">
              <NavItem label="Research" icon={BarChart2} targetView={ViewState.RESEARCH} setView={setView} view={view} hasEntitlement={hasEntitlement} />
              <NavItem label="Optimizer" icon={Zap} targetView={ViewState.OPTIMIZER} setView={setView} view={view} hasEntitlement={hasEntitlement} />
           </div>
      </nav>

      {loading && (
        <div className="fixed inset-0 bg-vellum/60 flex items-center justify-center z-[100] backdrop-blur-md">
            <div className="bg-white p-6 rounded-xl shadow-2xl flex flex-col items-center border border-ink/10">
                <div className="w-8 h-8 border-4 border-drafting-orange border-t-transparent animate-spin mb-4"></div>
                <p className="font-black text-xs uppercase tracking-[0.2em] text-drafting-orange animate-pulse">Running Field Stress Test...</p>
            </div>
        </div>
      )}
    </div>
  );
};

// --- AUTH SHELL FIX ---
// Handles the case where Clerk hangs indefinitely due to blocked workers.
const AuthShell: React.FC = () => {
  const { isLoaded, isSignedIn } = useUser();

  if (!isLoaded) {
    return (
      <div className="fixed inset-0 bg-main flex flex-col items-center justify-center">
        <div className="w-8 h-8 border-4 border-highlight border-t-transparent animate-spin mb-4" />
        <p className="text-highlight font-mono text-[10px] uppercase tracking-widest animate-pulse">
          Connecting to Secure Gateway...
        </p>
      </div>
    );
  }

  if (isSignedIn) {
    return <AppContent />;
  }

  return <SplashLogin />;
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <LineupProvider>
        <AuthShell />
      </LineupProvider>
    </AuthProvider>
  );
};

export default App;
