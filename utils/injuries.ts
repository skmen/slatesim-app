import { Player } from '../types';
import { canonicalizeId, normalizeName } from './csvParser';

export interface InjuryInfo {
  status: string;
  reason?: string;
  isQuestionable: boolean;
  team?: string;
}

export type InjuryLookup = Map<string, InjuryInfo>;

const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');
const normalizeTeamToken = (value: any): string => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').trim();

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

const extractTeam = (entry: any): string => {
  const direct = readByNormalizedKey(entry, [
    'teamid',
    'team',
    'teamabbr',
    'teamabbrev',
    'teamabbreviation',
    'team_code',
    'teamcode',
    'abbr',
  ]);
  const directTeam = normalizeTeamToken(toStringValue(direct));
  if (directTeam) return directTeam;

  const teamObj = entry?.team;
  if (teamObj && typeof teamObj === 'object') {
    const nested = readByNormalizedKey(teamObj, ['id', 'abbr', 'abbreviation', 'teamabbr', 'teamid', 'name']);
    const nestedTeam = normalizeTeamToken(toStringValue(nested));
    if (nestedTeam) return nestedTeam;
  }

  return '';
};

const tokenizeStatus = (status: string): string[] => {
  return String(status || '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .map((token) => token.trim())
    .filter(Boolean);
};

const hasSingleToken = (tokens: string[], token: string): boolean => tokens.length === 1 && tokens[0] === token;

export const isOutInjuryStatus = (status: string | undefined | null): boolean => {
  if (!status) return false;
  const tokens = tokenizeStatus(status);
  if (tokens.length === 0) return false;
  if (tokens.includes('out') || tokens.includes('inactive')) return true;
  if (hasSingleToken(tokens, 'o')) return true;
  return false;
};

export const isDoubtfulInjuryStatus = (status: string | undefined | null): boolean => {
  if (!status) return false;
  const tokens = tokenizeStatus(status);
  if (tokens.length === 0) return false;
  if (tokens.includes('doubtful')) return true;
  if (hasSingleToken(tokens, 'd')) return true;
  return false;
};

export const isQuestionableInjuryStatus = (status: string | undefined | null): boolean => {
  if (!status) return false;
  const tokens = tokenizeStatus(status);
  if (tokens.length === 0) return false;
  if (tokens.includes('questionable') || tokens.includes('gtd')) return true;
  if (hasSingleToken(tokens, 'q')) return true;
  return false;
};

export const isUnavailableInjuryStatus = (status: string | undefined | null): boolean => {
  if (!status) return false;
  if (isOutInjuryStatus(status)) return true;
  if (isDoubtfulInjuryStatus(status)) return true;
  return false;
};

export const shouldExcludePlayerForInjury = (info: InjuryInfo | undefined | null): boolean => {
  if (!info) return false;
  return isUnavailableInjuryStatus(info.status);
};

export const buildInjuryLookup = (payload: any): InjuryLookup => {
  const entries = extractEntries(payload);
  const lookup: InjuryLookup = new Map();

  const makeNameTeamKey = (name: string, team: string): string => {
    const normalizedName = normalizeName(name);
    const normalizedTeam = normalizeTeamToken(team);
    return normalizedName && normalizedTeam ? `${normalizedName}::${normalizedTeam}` : '';
  };

  const statusRank = (info: InjuryInfo): number => {
    if (isOutInjuryStatus(info.status)) return 4;
    if (isDoubtfulInjuryStatus(info.status)) return 3;
    if (info.isQuestionable || isQuestionableInjuryStatus(info.status)) return 2;
    if (String(info.status || '').trim()) return 1;
    return 0;
  };

  const shouldReplaceInfo = (current: InjuryInfo | undefined, next: InjuryInfo): boolean => {
    if (!current) return true;
    const currentRank = statusRank(current);
    const nextRank = statusRank(next);
    if (nextRank !== currentRank) return nextRank > currentRank;
    if (!current.reason && !!next.reason) return true;
    if (!current.team && !!next.team) return true;
    return false;
  };

  const setLookup = (key: string, info: InjuryInfo) => {
    if (!key) return;
    const existing = lookup.get(key);
    if (shouldReplaceInfo(existing, info)) {
      lookup.set(key, info);
    }
  };

  if (typeof window !== 'undefined' && (window as any).__SLATESIM_DEBUG_INJURIES__) {
    console.log('[injuries] payload top-level keys:', payload ? Object.keys(payload) : null);
    console.log('[injuries] entries count:', entries.length);
    if (entries.length > 0) console.log('[injuries] first entry sample:', JSON.stringify(entries[0]).slice(0, 300));
  }

  const processEntry = (entry: any) => {
    if (!entry || typeof entry !== 'object') return;

    // If entry is an array (e.g. team-keyed format: {LAL: [...], BOS: [...]}),
    // recurse into each element rather than treating the array as a player object.
    if (Array.isArray(entry)) {
      entry.forEach(processEntry);
      return;
    }

    // If this entry looks like a team container (has a player list but no name/status),
    // recurse into the player list rather than treating it as a player record.
    const playerList =
      entry.players || entry.injuries || entry.athletes || entry.roster || entry.members;
    if (Array.isArray(playerList) && playerList.length > 0) {
      const hasPlayerName = !!extractName(entry);
      if (!hasPlayerName) {
        playerList.forEach(processEntry);
        return;
      }
    }

    const name = extractName(entry);
    const status = extractStatus(entry);
    const reason = extractReason(entry);
    const isQuestionable = isQuestionableStatus(entry, status);
    const team = extractTeam(entry);

    if (!name || (!status && !isQuestionable)) return;

    const info: InjuryInfo = {
      status: status || 'Questionable',
      reason: reason || undefined,
      isQuestionable,
      team: team || undefined,
    };

    const normalizedName = normalizeName(name);
    if (normalizedName) setLookup(normalizedName, info);

    // Also store a first+last-only variant for names with middle names/words,
    // so depth chart lookups succeed even when sources use different name formats.
    const nameParts = name.trim().split(/\s+/).filter(Boolean);
    if (nameParts.length >= 3) {
      const firstLast = normalizeName(`${nameParts[0]} ${nameParts[nameParts.length - 1]}`);
      if (firstLast && firstLast !== normalizedName) {
        setLookup(firstLast, info);
      }
    }

    const nameTeamKey = makeNameTeamKey(name, team);
    if (nameTeamKey) setLookup(nameTeamKey, info);

    const playerId = extractPlayerId(entry);
    if (playerId) setLookup(playerId, info);
  };

  entries.forEach(processEntry);

  if (typeof window !== 'undefined' && (window as any).__SLATESIM_DEBUG_INJURIES__) {
    console.log('[injuries] lookup size:', lookup.size);
    console.log('[injuries] first 10 keys:', [...lookup.keys()].slice(0, 10));
  }

  return lookup;
};

export const getPlayerInjuryInfo = (player: Player, lookup?: InjuryLookup | null): InjuryInfo | undefined => {
  if (!lookup || lookup.size === 0) return undefined;
  const byId = lookup.get(canonicalizeId(player.id)) ?? lookup.get(String(player.id));
  if (byId) return byId;

  const byNameTeam = lookup.get(`${normalizeName(player.name)}::${normalizeTeamToken((player as any).team)}`);
  if (byNameTeam) return byNameTeam;

  const byName = lookup.get(normalizeName(player.name));
  return byName;
};

export const getInjuryInfoByName = (name: string, lookup?: InjuryLookup | null, team?: string): InjuryInfo | undefined => {
  if (!lookup || lookup.size === 0 || !name) return undefined;
  const byNameTeam = team ? lookup.get(`${normalizeName(name)}::${normalizeTeamToken(team)}`) : undefined;
  if (byNameTeam) return byNameTeam;
  return lookup.get(normalizeName(name));
};
