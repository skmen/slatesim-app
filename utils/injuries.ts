import { Player } from '../types';
import { canonicalizeId, normalizeName } from './csvParser';

export interface InjuryInfo {
  status: string;
  reason?: string;
  isQuestionable: boolean;
}

export type InjuryLookup = Map<string, InjuryInfo>;

const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');

const readByNormalizedKey = (obj: any, keys: string[]): any => {
  if (!obj || typeof obj !== 'object') return undefined;
  const normalizedMap = new Map<string, string>();
  Object.keys(obj).forEach((key) => {
    normalizedMap.set(normalizeKey(key), key);
  });
  for (const key of keys) {
    const match = normalizedMap.get(normalizeKey(key));
    if (match) return obj[match];
  }
  return undefined;
};

const toStringValue = (value: any): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  if (typeof value === 'object') {
    const nested = readByNormalizedKey(value, ['label', 'name', 'status', 'code', 'abbr', 'abbreviation', 'short', 'description', 'text', 'value']);
    if (nested !== undefined) return toStringValue(nested);
  }
  return '';
};

const extractEntries = (payload: any): any[] => {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;

  const directCandidates = [
    payload.injuries,
    payload.injuryReport,
    payload.report,
    payload.entries,
    payload.items,
    payload.results,
    payload.players,
    payload.data,
    payload.playerInjuries,
    payload.injuryList,
    payload.data?.injuries,
    payload.data?.injuryReport,
    payload.data?.report,
    payload.data?.entries,
    payload.data?.items,
    payload.data?.results,
    payload.data?.players,
  ];

  for (const candidate of directCandidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate;
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      const values = Object.values(candidate).filter((v) => v && typeof v === 'object');
      if (values.length > 0) return values as any[];
    }
  }

  // Final fallback: if any top-level value is a non-empty array, return it directly
  // (avoids wrapping arrays-of-players as a single entry)
  const topValues = Object.values(payload);
  const firstArray = topValues.find((v) => Array.isArray(v) && (v as any[]).length > 0);
  if (firstArray) return firstArray as any[];

  const objectValues = topValues.filter((v) => v && typeof v === 'object' && !Array.isArray(v));
  if (objectValues.length > 0) return objectValues as any[];
  return [];
};

const extractName = (entry: any): string => {
  const direct = readByNormalizedKey(entry, [
    'player',
    'playername',
    'name',
    'athlete',
    'playerfullname',
    'fullname',
    'displayname',
  ]);
  const directName = toStringValue(direct);
  if (directName) return directName;

  const nestedPlayer = entry?.player ?? entry?.athlete ?? entry?.person ?? entry?.playerInfo ?? entry?.player_data;
  if (nestedPlayer && typeof nestedPlayer === 'object') {
    const nestedName = readByNormalizedKey(nestedPlayer, ['name', 'fullname', 'playername', 'displayname']);
    const nestedValue = toStringValue(nestedName);
    if (nestedValue) return nestedValue;
  }

  const firstName = toStringValue(readByNormalizedKey(entry, ['firstname', 'first', 'first_name']));
  const lastName = toStringValue(readByNormalizedKey(entry, ['lastname', 'last', 'last_name']));
  const combined = `${firstName} ${lastName}`.trim();
  if (combined) return combined;

  return '';
};

const extractStatus = (entry: any): string => {
  const status = readByNormalizedKey(entry, [
    'status',
    'injurystatus',
    'injury_status',
    'designation',
    'injurydesignation',
    'game_status',
    'gamestatus',
    'availability',
    'reportstatus',
  ]);
  return toStringValue(status);
};

const extractReason = (entry: any): string => {
  const reason = readByNormalizedKey(entry, ['reason']);
  const reasonText = toStringValue(reason);
  if (reasonText) return reasonText;

  const fallback = readByNormalizedKey(entry, ['injury', 'details', 'note', 'notes', 'comment', 'description', 'report']);
  return toStringValue(fallback);
};

const isQuestionableStatus = (entry: any, statusText: string): boolean => {
  const flag = readByNormalizedKey(entry, ['questionable', 'isquestionable']);
  if (flag === true || String(flag).toLowerCase() === 'true') return true;

  const normalized = statusText.toLowerCase();
  if (!normalized) return false;
  if (normalized.includes('questionable')) return true;

  const stripped = normalized.replace(/[^a-z]/g, '');
  return stripped === 'q';
};

const extractPlayerId = (entry: any): string => {
  const idRaw = readByNormalizedKey(entry, ['playerid', 'id', 'dkid', 'fdid', 'player_id']);
  const canonical = canonicalizeId(idRaw);
  return canonical || toStringValue(idRaw);
};

const tokenizeStatus = (status: string): string[] => {
  return String(status || '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .map((token) => token.trim())
    .filter(Boolean);
};

export const isUnavailableInjuryStatus = (status: string | undefined | null): boolean => {
  if (!status) return false;
  const tokens = tokenizeStatus(status);
  if (tokens.length === 0) return false;

  if (tokens.includes('doubtful')) return true;
  if (tokens.includes('out')) return true;
  if (tokens.length === 1 && (tokens[0] === 'o' || tokens[0] === 'd')) return true;
  return false;
};

export const shouldExcludePlayerForInjury = (info: InjuryInfo | undefined | null): boolean => {
  if (!info) return false;
  return isUnavailableInjuryStatus(info.status);
};

export const buildInjuryLookup = (payload: any): InjuryLookup => {
  const entries = extractEntries(payload);
  const lookup: InjuryLookup = new Map();

  const processEntry = (entry: any) => {
    if (!entry || typeof entry !== 'object') return;

    // If entry is an array (e.g. team-keyed format: {LAL: [...], BOS: [...]}),
    // recurse into each element rather than treating the array as a player object.
    if (Array.isArray(entry)) {
      entry.forEach(processEntry);
      return;
    }

    const name = extractName(entry);
    const status = extractStatus(entry);
    const reason = extractReason(entry);
    const isQuestionable = isQuestionableStatus(entry, status);

    if (!name || (!status && !isQuestionable)) return;

    const info: InjuryInfo = {
      status: status || 'Questionable',
      reason: reason || undefined,
      isQuestionable,
    };

    const normalizedName = normalizeName(name);
    if (normalizedName) lookup.set(normalizedName, info);

    const playerId = extractPlayerId(entry);
    if (playerId) lookup.set(playerId, info);
  };

  entries.forEach(processEntry);
  return lookup;
};

export const getPlayerInjuryInfo = (player: Player, lookup?: InjuryLookup | null): InjuryInfo | undefined => {
  if (!lookup || lookup.size === 0) return undefined;
  const byId = lookup.get(canonicalizeId(player.id)) ?? lookup.get(String(player.id));
  if (byId) return byId;

  const byName = lookup.get(normalizeName(player.name));
  return byName;
};

export const getInjuryInfoByName = (name: string, lookup?: InjuryLookup | null): InjuryInfo | undefined => {
  if (!lookup || lookup.size === 0 || !name) return undefined;
  return lookup.get(normalizeName(name));
};
