import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { BarChart2, ChevronLeft, ChevronRight, List, LogOut, Zap, GitCompare } from 'lucide-react';
import { useUser } from "@clerk/clerk-react"; 
import { AppState, ViewState, ContestInput, ContestDerived, Entitlement, GameInfo } from './types';
import { parseProjections, parsePipelineJson, parseOptimizerLineups, parseUserLineupsRows, canonicalizeId, normalizeName } from './utils/csvParser';
import { buildInjuryLookup, getPlayerInjuryInfo, InjuryLookup, shouldExcludePlayerForInjury } from './utils/injuries';
import { buildStartingLineupLookup, StartingLineupLookup } from './utils/startingLineups';
import { DashboardView } from './components/DashboardView';
import { OptimizerView } from './components/OptimizerView';
import { deriveContest, DEFAULT_CONTEST, deriveGamesFromPlayers, recomputeLineupDisplay } from './utils/contest';
import { saveContestInput, loadContestInput, saveBeliefs, loadBeliefs } from './utils/storage';
import { loadSlateEcosystem } from './utils/assetLoader';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LineupProvider } from './context/LineupContext';
import { SplashLogin } from './components/SplashLogin';
import { PricingPage } from './components/PricingPage';
import { TermsPage } from './components/TermsPage';
import { PrivacyPage } from './components/PrivacyPage';
import { LineupDrawer } from './components/LineupDrawer';
import DKEntryManager from './components/DKEntryManager';
import ReportView from './components/ReportView';
import { CompareView } from './components/CompareView';
import { SlateSimLogo } from './components/SlateSimLogo';

// Simple error boundary to prevent report page from blanking the UI
class ErrorBoundary extends React.Component<{ fallback: React.ReactNode }, { hasError: boolean }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: any) {
    console.error('ErrorBoundary caught error', err);
  }
  render() {
    if (this.state.hasError) return this.props.fallback as any;
    return this.props.children as any;
  }
}

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

const ENTRY_MANAGER_SESSION_KEY = 'slatesim.entryManager.session.v1';

const IntegrityFooter: React.FC<{ withBottomNav?: boolean }> = ({ withBottomNav = false }) => {
  return (
    <footer className={`w-full bg-black/40 border-t border-ink-border py-4 px-6 mt-12 backdrop-blur-md ${withBottomNav ? 'mb-24 sm:mb-20' : ''}`}>
      <div className="max-w-7xl mx-auto flex items-center justify-center text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono">
        <div className="flex items-center gap-2 text-[11px]">
          <a
            href="/terms"
            className="text-slate-300 hover:text-drafting-orange transition-colors"
          >
            Terms of Service
          </a>
          <span className="text-slate-500">|</span>
          <a
            href="/privacy"
            className="text-slate-300 hover:text-drafting-orange transition-colors"
          >
            Privacy Policy
          </a>
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

const getPreviewMaxDateStr = (): string => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - 1);
  return getLocalDateStr(d);
};

const getPreviewMinDateStr = (): string => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - 7);
  return getLocalDateStr(d);
};

const parseLocalDate = (dateStr: string): Date | null => {
  const parts = String(dateStr || '').split('-');
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const parsed = new Date(y, m - 1, d);
  if (!Number.isFinite(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
};

const fetchAvailableSlates = async (date: string): Promise<string[]> => {
  try {
    const resp = await fetch(`/api/slates?date=${date}`, { cache: 'no-cache' });
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data.slates) ? data.slates : [];
  } catch {
    return [];
  }
};

const isDateBeforeToday = (dateStr: string): boolean => {
  const input = parseLocalDate(dateStr);
  if (!input) return false;
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

const normalizeTeamKey = (value: any): string =>
  String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const getGamePairKey = (game: GameInfo): string => {
  const teamA = normalizeTeamKey(game?.teamA?.teamId ?? game?.teamA?.abbreviation);
  const teamB = normalizeTeamKey(game?.teamB?.teamId ?? game?.teamB?.abbreviation);
  if (!teamA || !teamB) return '';
  return [teamA, teamB].sort((a, b) => a.localeCompare(b)).join('_vs_');
};

const parseExpectedGameCount = (slateFolder?: string | null): number | null => {
  const text = String(slateFolder || '');
  const match = text.match(/(\d+)G/i);
  if (!match) return null;
  const count = Number(match[1]);
  return Number.isFinite(count) && count > 0 ? count : null;
};

const pickGamesByPlayerTeamWeight = (games: GameInfo[], players: any[], targetCount: number): GameInfo[] => {
  if (targetCount <= 0 || games.length <= targetCount) return games;

  const teamWeights = new Map<string, number>();
  players.forEach((player) => {
    const rawTeam = (player as any)?.team ?? (player as any)?.teamId;
    const team = normalizeTeamKey(rawTeam);
    if (!team) return;
    teamWeights.set(team, (teamWeights.get(team) || 0) + 1);
  });

  const ranked = games
    .map((game) => {
      const teamA = normalizeTeamKey(game?.teamA?.teamId ?? game?.teamA?.abbreviation);
      const teamB = normalizeTeamKey(game?.teamB?.teamId ?? game?.teamB?.abbreviation);
      const weight = (teamWeights.get(teamA) || 0) + (teamWeights.get(teamB) || 0);
      return { game, weight, overUnder: Number(game?.overUnder) || 0 };
    })
    .sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      return b.overUnder - a.overUnder;
    });

  const selected = ranked.slice(0, targetCount).map((entry) => entry.game);
  if (selected.length < targetCount) return games;
  return selected;
};

const resolveSlateGames = (providedGames: GameInfo[], players: any[], teams: any[], slateFolder?: string | null): GameInfo[] => {
  const fallbackGames = deriveGamesFromPlayers(players, teams || []);
  const expectedCount = parseExpectedGameCount(slateFolder);

  if (providedGames.length === 0) {
    if (!expectedCount) return fallbackGames;
    return pickGamesByPlayerTeamWeight(fallbackGames, players, expectedCount);
  }
  if (fallbackGames.length === 0) {
    if (!expectedCount) return providedGames;
    return pickGamesByPlayerTeamWeight(providedGames, players, expectedCount);
  }

  const allowedKeys = new Set(
    fallbackGames
      .map(getGamePairKey)
      .filter(Boolean)
  );
  if (allowedKeys.size === 0) {
    if (!expectedCount) return providedGames;
    return pickGamesByPlayerTeamWeight(providedGames, players, expectedCount);
  }

  const scopedGames = providedGames.filter((game) => allowedKeys.has(getGamePairKey(game)));
  let resolved = providedGames;
  if (scopedGames.length === 0) {
    resolved = providedGames.length === fallbackGames.length ? providedGames : fallbackGames;
  } else if (scopedGames.length < providedGames.length) {
    resolved = scopedGames;
  }

  if (!expectedCount) return resolved;
  return pickGamesByPlayerTeamWeight(resolved, players, expectedCount);
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
      const projectionMatchesActual =
        Number.isFinite(projectionNum) &&
        Number.isFinite(fpts) &&
        Math.abs(projectionNum - fpts) < 0.001;

      return {
        date,
        opponent,
        minutes,
        fpts,
        projection: Number.isFinite(projectionNum) && !projectionMatchesActual ? projectionNum : fallbackProjection,
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
    <button onClick={() => setView(targetView)} className={`flex flex-col items-center gap-1 p-1.5 sm:p-2 min-w-[52px] sm:min-w-[64px] rounded-lg transition-colors ${view === targetView ? 'text-ink bg-ink/10 font-bold' : 'text-ink/40 hover:bg-ink/5'}`}>
      <Icon className="w-5 h-5" />
      <span className="text-[10px] font-black uppercase tracking-tighter">{label}</span>
    </button>
  );
};

const AdminPagePanel: React.FC<{
  view: ViewState;
  setView: (view: ViewState) => void;
  selectedDate: string;
}> = ({ view, setView, selectedDate }) => {
  const appLinks: Array<{ label: string; target: ViewState }> = [
    { label: 'Research', target: ViewState.RESEARCH },
    { label: 'Compare', target: ViewState.COMPARE },
    { label: 'Optimizer', target: ViewState.OPTIMIZER },
    { label: 'Entries', target: ViewState.ENTRY_MANAGER },
    { label: 'Report', target: ViewState.REPORT },
  ];
  const routeLinks = [
    { label: 'Landing', href: '/' },
    { label: 'Preview', href: '/preview' },
    { label: 'Pricing', href: '/pricing' },
    { label: 'Terms', href: '/terms' },
    { label: 'Privacy', href: '/privacy' },
  ];

  return (
    <aside className="hidden lg:block">
      <div className="sticky top-24 rounded-sm border border-ink/15 bg-white/70 backdrop-blur-sm p-3 space-y-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-drafting-orange">Admin Panel</p>
          <p className="text-[10px] text-ink/60">Quick page access</p>
        </div>
        <div className="space-y-1">
          <p className="text-[9px] font-black uppercase tracking-widest text-ink/50">App Views</p>
          {appLinks.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => setView(item.target)}
              className={`w-full text-left rounded-sm border px-2 py-1.5 text-[10px] font-black uppercase tracking-widest transition-colors ${
                view === item.target
                  ? 'border-drafting-orange bg-drafting-orange text-white'
                  : 'border-ink/15 bg-white text-ink/70 hover:border-drafting-orange/40 hover:text-drafting-orange'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="space-y-1">
          <p className="text-[9px] font-black uppercase tracking-widest text-ink/50">Public Routes</p>
          {routeLinks.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="block rounded-sm border border-ink/15 bg-white px-2 py-1.5 text-[10px] font-black uppercase tracking-widest text-ink/70 hover:border-drafting-orange/40 hover:text-drafting-orange transition-colors"
            >
              {item.label}
            </a>
          ))}
        </div>
        <p className="text-[9px] text-ink/50">Slate date: {selectedDate}</p>
      </div>
    </aside>
  );
};

const MembershipGateCard: React.FC<{ title: string; body: string }> = ({ title, body }) => (
  <div className="max-w-2xl mx-auto mt-12 rounded-sm border border-ink/10 bg-white/55 p-6 shadow-sm">
    <div className="inline-flex items-center gap-2 rounded-sm border border-drafting-orange/30 bg-drafting-orange/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-drafting-orange">
      Soft Launch
    </div>
    <h3 className="mt-3 text-lg font-black uppercase tracking-tight text-ink">{title}</h3>
    <p className="mt-2 text-sm text-ink/70">{body}</p>
    <a
      href="/pricing"
      className="mt-4 inline-flex rounded-sm border border-drafting-orange bg-drafting-orange px-4 py-2 text-xs font-black uppercase tracking-widest text-white hover:brightness-110 transition-all"
    >
      Upgrade to Soft Launch - $10/week
    </a>
  </div>
);

const AppContent: React.FC<{ previewMode?: boolean }> = ({ previewMode = false }) => {
  const { user, logout, hasEntitlement } = useAuth();
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [view, setView] = useState<ViewState>(ViewState.RESEARCH);
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [isHistorical, setIsHistorical] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => (
    previewMode ? getPreviewMaxDateStr() : getLocalDateStr(new Date())
  ));
  const previousSelectedDateRef = useRef(selectedDate);
  const latestInitRequestRef = useRef(0);
  const [showActuals, setShowActuals] = useState(true);
  const [injuryLookup, setInjuryLookup] = useState<InjuryLookup>(new Map());
  const [dataLastModified, setDataLastModified] = useState<string | null>(null);
  const [depthCharts, setDepthCharts] = useState<any | null>(null);
  const [startingLineupLookup, setStartingLineupLookup] = useState<StartingLineupLookup>(new Map());
  const [availableSlates, setAvailableSlates] = useState<string[]>([]);
  const [selectedSlate, setSelectedSlate] = useState<string | null>(null);
  const [slateGameCounts, setSlateGameCounts] = useState<Record<string, number>>({});
  const slateDateRef = useRef<string | null>(null);
  const todayStr = useMemo(() => getLocalDateStr(new Date()), []);
  const previewMaxDate = useMemo(() => getPreviewMaxDateStr(), []);
  const previewMinDate = useMemo(() => getPreviewMinDateStr(), []);
  const canUseResearchTools = hasEntitlement('full_research_tools');
  const freeUserMinDate = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 7);
    return getLocalDateStr(d);
  }, []);
  const freeUserMaxDate = todayStr;
  const clampSelectableDate = useCallback((dateStr: string): string => {
    if (!previewMode && canUseResearchTools) return dateStr;
    const parsed = parseLocalDate(dateStr);
    const minDate = parseLocalDate(previewMode ? previewMinDate : freeUserMinDate);
    const maxDate = parseLocalDate(previewMode ? previewMaxDate : freeUserMaxDate);
    const fallbackDate = previewMode ? previewMaxDate : freeUserMaxDate;
    if (!parsed || !minDate || !maxDate) return fallbackDate;
    if (parsed < minDate) return previewMode ? previewMinDate : freeUserMinDate;
    if (parsed > maxDate) return previewMode ? previewMaxDate : freeUserMaxDate;
    return getLocalDateStr(parsed);
  }, [canUseResearchTools, freeUserMaxDate, freeUserMinDate, previewMode, previewMaxDate, previewMinDate]);
  const shiftSelectedDate = useCallback((deltaDays: number) => {
    setSelectedDate((prev) => {
      const base = parseLocalDate(prev);
      if (!base) return prev;
      const next = new Date(base);
      next.setDate(next.getDate() + deltaDays);
      const nextStr = getLocalDateStr(next);
      return clampSelectableDate(nextStr);
    });
  }, [clampSelectableDate]);
  const allowHistoricalActuals = useMemo(() => isDateBeforeToday(selectedDate), [selectedDate]);
  const effectiveShowActuals = showActuals && allowHistoricalActuals;
  const canShiftPrev = useMemo(() => {
    if (previewMode) return selectedDate > previewMinDate;
    if (!canUseResearchTools) return selectedDate > freeUserMinDate;
    return true;
  }, [canUseResearchTools, freeUserMinDate, previewMode, previewMinDate, selectedDate]);
  const canShiftNext = useMemo(() => {
    if (previewMode) return selectedDate < previewMaxDate;
    if (!canUseResearchTools) return selectedDate < freeUserMaxDate;
    return true;
  }, [canUseResearchTools, freeUserMaxDate, previewMaxDate, previewMode, selectedDate]);
  const formattedLastModified = useMemo(() => {
    if (!dataLastModified) return null;
    const parsed = new Date(dataLastModified);
    if (!Number.isFinite(parsed.getTime())) return dataLastModified;
    return parsed.toLocaleString();
  }, [dataLastModified]);

  const displayedUpdated = useMemo(() => {
    if (formattedLastModified) return formattedLastModified;
    return '—';
  }, [formattedLastModified]);
  const canAccessCompare = hasEntitlement('access_compare');
  const canAccessOptimizer = hasEntitlement('access_optimizer');
  const canAccessEntries = hasEntitlement('access_entries');
  const canAccessReport = hasEntitlement('access_report');
  const isAdmin = user?.role === 'admin';
  const roleLabel = useMemo(() => {
    if (!user?.role) return '';
    if (user.role === 'soft-launch') return 'member';
    return user.role;
  }, [user?.role]);
  const deepDiveAllowedTabs = useMemo(() => {
    if (user?.role !== 'soft-launch') return undefined;
    return ['dfs', 'stats', 'depth'] as Array<'dfs' | 'stats' | 'matchup' | 'synergy' | 'depth'>;
  }, [user?.role]);
  const dateInputMin = previewMode ? previewMinDate : (canUseResearchTools ? undefined : freeUserMinDate);
  const dateInputMax = previewMode ? previewMaxDate : (canUseResearchTools ? undefined : freeUserMaxDate);

  useEffect(() => {
    const previousDate = previousSelectedDateRef.current;
    if (previousDate && previousDate !== selectedDate) {
      localStorage.removeItem(ENTRY_MANAGER_SESSION_KEY);
    }
    previousSelectedDateRef.current = selectedDate;
  }, [selectedDate]);

  useEffect(() => {
    if (!previewMode && canUseResearchTools) return;
    setSelectedDate((prev) => clampSelectableDate(prev));
    if (previewMode) setView(ViewState.RESEARCH);
  }, [canUseResearchTools, previewMode, clampSelectableDate]);

  useEffect(() => {
    let cancelled = false;

    const hydrateSlateCounts = async () => {
      if (availableSlates.length === 0) {
        setSlateGameCounts({});
        return;
      }

      const baseCounts: Record<string, number> = {};
      availableSlates.forEach((slate) => {
        const parsedCount = parseExpectedGameCount(slate);
        if (parsedCount) baseCounts[slate] = parsedCount;
      });
      setSlateGameCounts(baseCounts);

      const missingCounts = availableSlates.filter((slate) => !baseCounts[slate]);
      if (missingCounts.length === 0) return;

      const resolved = await Promise.all(
        missingCounts.map(async (slate) => {
          try {
            const resp = await fetch(`/api/projections?date=${selectedDate}&slate=${encodeURIComponent(slate)}`, { cache: 'no-cache' });
            if (!resp.ok) return [slate, null] as const;
            const payload = await resp.json();
            const parsed = parsePipelineJson(payload);
            const slateGames = resolveSlateGames(parsed.games || [], parsed.referencePlayers || [], parsed.teams || [], slate);
            return [slate, slateGames.length > 0 ? slateGames.length : null] as const;
          } catch {
            return [slate, null] as const;
          }
        })
      );

      if (cancelled) return;
      const fetchedCounts: Record<string, number> = {};
      resolved.forEach(([slate, count]) => {
        if (count && count > 0) fetchedCounts[slate] = count;
      });
      if (Object.keys(fetchedCounts).length > 0) {
        setSlateGameCounts((prev) => ({ ...prev, ...fetchedCounts }));
      }
    };

    hydrateSlateCounts();
    return () => {
      cancelled = true;
    };
  }, [availableSlates, selectedDate]);

  useEffect(() => {
    if (!selectedSlate) return;
    const count = state.slate.games.length;
    if (!count) return;
    setSlateGameCounts((prev) => {
      if (prev[selectedSlate] === count) return prev;
      return { ...prev, [selectedSlate]: count };
    });
  }, [selectedSlate, state.slate.games.length]);

  useEffect(() => {
    if (view === ViewState.SLATE_NEWS) {
      setView(ViewState.RESEARCH);
    }
  }, [view]);

  useEffect(() => {
    if (!loading) {
      setLoadingProgress(0);
      return;
    }

    setLoadingProgress(10);
    const interval = window.setInterval(() => {
      setLoadingProgress((prev) => {
        if (prev >= 92) return prev;
        const step = 2 + Math.random() * 6;
        return Math.min(92, prev + step);
      });
    }, 180);

    return () => window.clearInterval(interval);
  }, [loading]);

  useEffect(() => {
    const initApp = async () => {
      const requestId = ++latestInitRequestRef.current;
      setLoading(true);

      // When the date changes, re-discover available slates and reset selection
      let slateToUse = selectedSlate;
      if (slateDateRef.current !== selectedDate) {
        const slates = await fetchAvailableSlates(selectedDate);
        if (requestId !== latestInitRequestRef.current) return;
        slateDateRef.current = selectedDate;
        setAvailableSlates(slates);
        const defaultSlate = slates.find((s) => /^main/i.test(s)) ?? slates[0] ?? null;
        slateToUse = defaultSlate;
        if (defaultSlate !== selectedSlate) {
          setSelectedSlate(defaultSlate);
          // The state update will re-trigger this effect with the correct slate;
          // bail out of this run to avoid a double-load.
          setLoading(false);
          return;
        }
      }

      const savedContest = loadContestInput();

      const loadResult = await loadSlateEcosystem({
        targetDate: selectedDate,
        slateFolder: slateToUse ?? undefined,
        includeHistory: true,
      });
      if (requestId !== latestInitRequestRef.current) return;
      if (loadResult.errors) {
        console.warn('Slate ecosystem load warnings:', loadResult.errors, loadResult.loadedFrom);
      }

      if (!loadResult.ok || !loadResult.data?.slate) {
        if (requestId !== latestInitRequestRef.current) return;
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
      
      const games = resolveSlateGames(refData.games || [], refPlayers, refData.teams || [], selectedSlate);

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

      const nextInjuryLookup = buildInjuryLookup(loadResult.data.injuries);
      const filteredPlayers = refPlayers.filter((player) => {
        const injuryInfo = getPlayerInjuryInfo(player, nextInjuryLookup);
        return !shouldExcludePlayerForInjury(injuryInfo);
      });
      if (requestId !== latestInitRequestRef.current) return;

      setState(prev => ({
        ...prev,
        slate: {
          date: selectedDate,
          games,
          players: filteredPlayers,
          lineups: finalLineups,
        },
        historicalRotations: loadResult.data.history?.rotations ?? null,
        historicalBoxscores: loadResult.data.history?.boxscores ?? null,
        historicalStats: loadResult.data.history?.stats ?? null,
        contestState: contestState || { input: DEFAULT_CONTEST, derived: deriveContest(DEFAULT_CONTEST) },
        lastUpdated: Date.now(),
      }));
      setInjuryLookup(nextInjuryLookup);
      setDataLastModified(loadResult.lastModified?.latest ?? null);
      setDepthCharts(loadResult.data.depthCharts ?? null);
      setStartingLineupLookup(buildStartingLineupLookup(loadResult.data.startingLineups));

      if (requestId !== latestInitRequestRef.current) return;
      setLoading(false);
    };

    initApp();
  }, [selectedDate, selectedSlate]);

  useEffect(() => {
    setIsHistorical(isDateBeforeToday(state.slate.date));
  }, [state.slate.date]);

  useEffect(() => { saveContestInput(state.contestState.input); }, [state.contestState.input]);

  const computedLineups = useMemo(
    () => recomputeLineupDisplay(state.slate.lineups, state.contestState, state.slate.players),
    [state.slate.lineups, state.slate.players, state.contestState.input]
  );

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

  return (
    <div className="min-h-screen font-sans bg-vellum text-ink flex flex-col selection:bg-drafting-orange selection:text-white">
      <header className="bg-vellum/80 border-b border-ink/10 sticky top-0 z-50 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4">
          {/* Main row */}
          <div className="h-12 sm:h-16 flex items-center justify-between gap-2 sm:gap-4">
            <div className="flex items-center gap-2 sm:gap-4">
              <div className="flex items-center gap-2 cursor-pointer p-2 rounded-sm" onClick={() => setView(ViewState.RESEARCH)}>
                <SlateSimLogo />
              </div>
              {/* Date controls — desktop only */}
              <div className="hidden sm:flex items-center gap-2">
                <span className="text-[10px] font-black text-ink/60 uppercase tracking-widest">Date</span>
                <button
                  type="button"
                  onClick={() => shiftSelectedDate(-1)}
                  disabled={!canShiftPrev}
                  className="inline-flex items-center justify-center bg-vellum border border-ink/20 rounded-sm w-7 h-7 text-ink/70 hover:text-drafting-orange hover:border-drafting-orange transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Previous day"
                  title="Previous day"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <input
                  type="date"
                  value={selectedDate}
                  min={dateInputMin}
                  max={dateInputMax}
                  onChange={(e) => setSelectedDate(clampSelectableDate(e.target.value))}
                  className="bg-vellum border border-ink/20 rounded-sm px-2 py-1 text-xs font-bold text-ink outline-none focus:border-drafting-orange"
                />
                <button
                  type="button"
                  onClick={() => shiftSelectedDate(1)}
                  disabled={!canShiftNext}
                  className="inline-flex items-center justify-center bg-vellum border border-ink/20 rounded-sm w-7 h-7 text-ink/70 hover:text-drafting-orange hover:border-drafting-orange transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Next day"
                  title="Next day"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setShowActuals((prev) => !prev)}
                  disabled={!allowHistoricalActuals}
                  className="text-[10px] font-black border border-ink/20 px-2 py-1 rounded uppercase tracking-widest text-ink/60 hover:text-drafting-orange hover:border-drafting-orange transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {!allowHistoricalActuals ? 'Actuals Unavailable' : (showActuals ? 'Hide Actuals' : 'Reveal Actuals')}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              {!previewMode && (
                <div className="hidden sm:flex flex-col items-end mr-2">
                  <span className="text-[10px] font-bold text-ink uppercase tracking-tighter">{user?.username}</span>
                  <span className="text-[9px] font-bold text-ink/70 uppercase tracking-widest">
                    Updated: {displayedUpdated}
                  </span>
                  <span className="text-[8px] font-black text-drafting-orange uppercase opacity-80">{roleLabel}</span>
                </div>
              )}
              {!previewMode && !canUseResearchTools && (
                <a
                  href="/pricing"
                  className="hidden sm:inline-flex text-[9px] font-black text-white bg-drafting-orange border border-drafting-orange px-2 py-1 rounded uppercase tracking-widest hover:brightness-110 transition-all"
                >
                  UPGRADE PLAN
                </a>
              )}
              {previewMode && (
                <div className="hidden sm:block text-[9px] font-black uppercase tracking-widest text-ink/50">
                  Preview • Last 7 Days
                </div>
              )}
              {previewMode ? (
                <a
                  href="/"
                  className="px-3 py-1.5 rounded-sm border border-ink/20 text-[10px] font-black uppercase tracking-widest text-ink/60 hover:border-drafting-orange/40 hover:text-ink transition-all"
                >
                  Back
                </a>
              ) : (
                <button onClick={logout} className="p-2 rounded-full hover:bg-red-500/10 text-ink/40 hover:text-red-600 transition-colors"><LogOut className="w-5 h-5" /></button>
              )}
            </div>
          </div>
          {/* Mobile date row */}
          <div className="flex sm:hidden items-center justify-between pb-2 gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => shiftSelectedDate(-1)}
                disabled={!canShiftPrev}
                className="inline-flex items-center justify-center bg-vellum border border-ink/20 rounded-sm w-7 h-7 text-ink/70 hover:text-drafting-orange hover:border-drafting-orange transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Previous day"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <input
                type="date"
                value={selectedDate}
                min={dateInputMin}
                max={dateInputMax}
                onChange={(e) => setSelectedDate(clampSelectableDate(e.target.value))}
                className="bg-vellum border border-ink/20 rounded-sm px-2 py-1 text-xs font-bold text-ink outline-none focus:border-drafting-orange"
              />
              <button
                type="button"
                onClick={() => shiftSelectedDate(1)}
                disabled={!canShiftNext}
                className="inline-flex items-center justify-center bg-vellum border border-ink/20 rounded-sm w-7 h-7 text-ink/70 hover:text-drafting-orange hover:border-drafting-orange transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Next day"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              {allowHistoricalActuals && (
                <button
                  onClick={() => setShowActuals((prev) => !prev)}
                  className="text-[10px] font-black border border-ink/20 px-2 py-1 rounded uppercase tracking-widest text-ink/60 hover:text-drafting-orange hover:border-drafting-orange transition-all"
                >
                  {showActuals ? 'Hide Actuals' : 'Actuals'}
                </button>
              )}
              {!previewMode && (
                <div className="flex items-center gap-2">
                  {!canUseResearchTools && (
                    <a
                      href="/pricing"
                      className="text-[8px] font-black text-white bg-drafting-orange border border-drafting-orange px-2 py-1 rounded uppercase tracking-widest hover:brightness-110 transition-all"
                    >
                      Upgrade Plan
                    </a>
                  )}
                  <div className="flex flex-col items-end">
                    <span className="text-[9px] font-bold text-ink uppercase tracking-tighter">{user?.username}</span>
                    <span className="text-[8px] font-bold text-ink/60 uppercase tracking-widest truncate max-w-[110px]">Upd: {displayedUpdated}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto px-4 pt-6 pb-24 sm:pb-8 w-full">
        <div className={isAdmin && !previewMode ? 'lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-6' : ''}>
          {isAdmin && !previewMode && (
            <AdminPagePanel
              view={view}
              setView={setView}
              selectedDate={selectedDate}
            />
          )}
          <div className="min-w-0">
            {view === ViewState.RESEARCH && (
              <DashboardView
                players={state.slate.players}
                games={state.slate.games || []}
                isHistorical={isHistorical}
                showActuals={effectiveShowActuals}
                injuryLookup={injuryLookup}
                depthCharts={depthCharts}
                startingLineupLookup={startingLineupLookup}
                previewMode={previewMode}
                hideSignalColumn={previewMode}
                slateDate={state.slate.date}
                availableSlates={availableSlates}
                selectedSlate={selectedSlate}
                slateGameCounts={slateGameCounts}
                onSelectSlate={setSelectedSlate}
                canUseResearchTools={canUseResearchTools}
                deepDiveAllowedTabs={deepDiveAllowedTabs}
              />
            )}
            {!previewMode && view === ViewState.COMPARE && (
              canAccessCompare ? (
                <CompareView
                  players={state.slate.players}
                  games={state.slate.games}
                  showActuals={effectiveShowActuals}
                />
              ) : (
                <MembershipGateCard
                  title="Compare Page Is In Soft Launch"
                  body="Upgrade to Soft Launch to unlock cross-player and matchup comparison workflows."
                />
              )
            )}
            {!previewMode && view === ViewState.OPTIMIZER && (
              canAccessOptimizer ? (
                <OptimizerView
                  players={state.slate.players}
                  games={state.slate.games}
                  slateDate={state.slate.date}
                  showActuals={effectiveShowActuals}
                  injuryLookup={injuryLookup}
                  depthCharts={depthCharts}
                  startingLineupLookup={startingLineupLookup}
                  deepDiveAllowedTabs={deepDiveAllowedTabs}
                />
              ) : (
                <MembershipGateCard
                  title="Optimizer Is In Soft Launch"
                  body="Upgrade to Soft Launch to run optimizer builds and advanced lineup generation."
                />
              )
            )}
            {!previewMode && view === ViewState.ENTRY_MANAGER && (
              canAccessEntries ? (
                selectedDate === getLocalDateStr(new Date()) ? (
                  <DKEntryManager
                    players={state.slate.players}
                    games={state.slate.games}
                    showActuals={effectiveShowActuals}
                    slateDate={state.slate.date}
                    deepDiveAllowedTabs={deepDiveAllowedTabs}
                  />
                ) : (
                  <div className="max-w-2xl mx-auto mt-12 rounded-sm border border-ink/10 bg-white/55 p-6 text-sm text-ink/70">
                    Entries are available only for today&apos;s slate.
                  </div>
                )
              ) : (
                <MembershipGateCard
                  title="Entries Is In Soft Launch"
                  body="Upgrade to Soft Launch to use DK entry management and import/export workflows."
                />
              )
            )}
            {!previewMode && view === ViewState.REPORT && (
              canAccessReport ? (
                <ErrorBoundary fallback={<div className="p-4 text-ink">Report unavailable: component error.</div>}>
                  <ReportView
                    players={state.slate.players || []}
                    games={state.slate.games || []}
                    slateDate={state.slate.date}
                    hideBestPossibleLineup={user?.role === 'soft-launch'}
                    deepDiveAllowedTabs={deepDiveAllowedTabs}
                  />
                </ErrorBoundary>
              ) : (
                <MembershipGateCard
                  title="Report Page Is In Soft Launch"
                  body="Upgrade to Soft Launch to unlock post-slate reporting and accuracy breakdowns."
                />
              )
            )}
          </div>
        </div>
      </main>

      <IntegrityFooter withBottomNav={!previewMode} />
      {!previewMode && <LineupDrawer players={state.slate.players} showActuals={effectiveShowActuals} />}

      {!previewMode && (
        <nav className="fixed bottom-0 left-0 right-0 bg-white/80 border-t border-ink/10 px-2 sm:px-6 py-2 pb-safe z-40 shadow-2xl backdrop-blur-md">
          <div className="flex justify-around items-center max-w-2xl mx-auto">
            <NavItem label="Research" icon={BarChart2} targetView={ViewState.RESEARCH} setView={setView} view={view} hasEntitlement={hasEntitlement} />
            <NavItem label="Compare" icon={GitCompare} targetView={ViewState.COMPARE} entitlement="access_compare" setView={setView} view={view} hasEntitlement={hasEntitlement} />
            <NavItem label="Optimizer" icon={Zap} targetView={ViewState.OPTIMIZER} entitlement="access_optimizer" setView={setView} view={view} hasEntitlement={hasEntitlement} />
            {selectedDate === getLocalDateStr(new Date()) && (
              <NavItem label="Entries" icon={List} targetView={ViewState.ENTRY_MANAGER} entitlement="access_entries" setView={setView} view={view} hasEntitlement={hasEntitlement} />
            )}
            <NavItem label="Report" icon={BarChart2} targetView={ViewState.REPORT} entitlement="access_report" setView={setView} view={view} hasEntitlement={hasEntitlement} />
          </div>
        </nav>
      )}

      {loading && (
        <div className="fixed inset-0 bg-vellum/60 flex items-center justify-center z-[100] backdrop-blur-md">
            <div className="bg-white p-6 rounded-xl shadow-2xl border border-ink/10 w-full max-w-sm">
                <p className="text-[11px] font-black uppercase tracking-widest text-ink/60 mb-2">loading ...</p>
                <div className="h-2 w-full rounded-full bg-ink/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-drafting-orange via-amber-400 to-drafting-orange transition-[width] duration-200 ease-out"
                    style={{ width: `${loadingProgress}%` }}
                  />
                </div>
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
  const isPricingRoute = typeof window !== 'undefined' && window.location.pathname === '/pricing';
  const isPreviewRoute = typeof window !== 'undefined' && window.location.pathname === '/preview';
  const isTermsRoute = typeof window !== 'undefined' && window.location.pathname === '/terms';
  const isPrivacyRoute = typeof window !== 'undefined' && window.location.pathname === '/privacy';

  // Public pricing page (no auth required)
  if (isPricingRoute) {
    return <PricingPage />;
  }

  // Public preview route (research only, last 7 days)
  if (isPreviewRoute) {
    return <AppContent previewMode />;
  }

  // Public terms page (no auth required)
  if (isTermsRoute) {
    return <TermsPage />;
  }

  // Public privacy page (no auth required)
  if (isPrivacyRoute) {
    return <PrivacyPage />;
  }

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
