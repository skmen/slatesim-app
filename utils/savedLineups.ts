import { Lineup } from '../types';

export interface SavedLineupSet {
  id: string;
  name: string;
  slateDate: string;
  salaryCap: number;
  createdAt: number;
  lineups: Lineup[];
}

const SAVED_LINEUPS_STORAGE_KEY = 'slatesim.savedLineupSets.v1';

const sanitizeLineup = (lineup: Lineup, index: number): Lineup => {
  return {
    id: lineup.id || `lineup_${index + 1}`,
    playerIds: Array.isArray(lineup.playerIds) ? [...lineup.playerIds] : [],
    totalSalary: Number.isFinite(Number(lineup.totalSalary)) ? Number(lineup.totalSalary) : 0,
    totalProjection: Number.isFinite(Number(lineup.totalProjection)) ? Number(lineup.totalProjection) : 0,
    lineupSource: 'optimizer',
  };
};

const sanitizeSavedSet = (raw: any): SavedLineupSet | null => {
  if (!raw || typeof raw !== 'object') return null;
  const lineups = Array.isArray(raw.lineups) ? raw.lineups.map((lineup: Lineup, idx: number) => sanitizeLineup(lineup, idx)) : [];
  if (lineups.length === 0) return null;
  return {
    id: String(raw.id || `saved_${Date.now()}`),
    name: String(raw.name || 'Saved Lineups'),
    slateDate: String(raw.slateDate || ''),
    salaryCap: Number.isFinite(Number(raw.salaryCap)) ? Number(raw.salaryCap) : 50000,
    createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now(),
    lineups,
  };
};

export const loadSavedLineupSets = (): SavedLineupSet[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SAVED_LINEUPS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((set) => sanitizeSavedSet(set))
      .filter((set): set is SavedLineupSet => Boolean(set));
  } catch {
    return [];
  }
};

export const saveSavedLineupSets = (sets: SavedLineupSet[]) => {
  if (typeof window === 'undefined') return;
  try {
    const sanitized = sets
      .map((set) => sanitizeSavedSet(set))
      .filter((set): set is SavedLineupSet => Boolean(set));
    localStorage.setItem(SAVED_LINEUPS_STORAGE_KEY, JSON.stringify(sanitized));
  } catch (error) {
    console.warn('Failed to persist saved lineups', error);
  }
};
