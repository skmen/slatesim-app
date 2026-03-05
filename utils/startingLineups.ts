import { Player } from '../types';
import { canonicalizeId, normalizeName } from './csvParser';

export interface StartingLineupInfo {
  status: 'confirmed' | 'expected';
  isConfirmed: boolean;
  isExpected: boolean;
}

export type StartingLineupLookup = Map<string, StartingLineupInfo>;

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, '');

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

const cleanPlayerName = (raw: string): string => {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const noParen = trimmed.replace(/\s*\([^)]*\)\s*$/g, '').trim();
  const noPrefix = noParen.replace(/^[A-Z]{1,4}\s*[:\-]\s*/g, '').trim();
  return noPrefix;
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
  const directName = cleanPlayerName(toStringValue(direct));
  if (directName) return directName;

  const nestedPlayer = entry?.player ?? entry?.athlete ?? entry?.person ?? entry?.playerInfo ?? entry?.player_data;
  if (nestedPlayer && typeof nestedPlayer === 'object') {
    const nestedName = readByNormalizedKey(nestedPlayer, ['name', 'fullname', 'playername', 'displayname']);
    const nestedValue = cleanPlayerName(toStringValue(nestedName));
    if (nestedValue) return nestedValue;
  }

  const firstName = toStringValue(readByNormalizedKey(entry, ['firstname', 'first', 'first_name']));
  const lastName = toStringValue(readByNormalizedKey(entry, ['lastname', 'last', 'last_name']));
  const combined = cleanPlayerName(`${firstName} ${lastName}`.trim());
  if (combined) return combined;

  return '';
};

const extractPlayerId = (entry: any): string => {
  const idRaw = readByNormalizedKey(entry, ['playerid', 'id', 'dkid', 'fdid', 'player_id']);
  const canonical = canonicalizeId(idRaw);
  return canonical || toStringValue(idRaw);
};

const normalizeStatus = (raw: any): 'confirmed' | 'expected' | '' => {
  const status = toStringValue(raw).toLowerCase();
  if (!status) return '';
  if (status.includes('confirm') || status === 'confirmed') return 'confirmed';
  if (status.includes('expected') || status.includes('projected') || status.includes('probable') || status === 'expected') {
    return 'expected';
  }
  if (status === 'c') return 'confirmed';
  if (status === 'e') return 'expected';
  return '';
};

const isTruthyFlag = (raw: any): boolean => {
  if (raw === true || raw === 1) return true;
  const text = toStringValue(raw).toLowerCase();
  if (!text) return false;
  return text === 'true' || text === '1' || text === 'yes' || text === 'y';
};

const readStatusFromEntry = (entry: any): 'confirmed' | 'expected' | '' => {
  const explicit = normalizeStatus(readByNormalizedKey(entry, [
    'status',
    'lineupStatus',
    'startingStatus',
    'confirmation',
    'state',
  ]));
  if (explicit) return explicit;

  const confirmedFlag = isTruthyFlag(
    readByNormalizedKey(entry, ['confirmed', 'isConfirmed', 'confirmedStarters', 'confirmedLineup', 'official'])
  );
  if (confirmedFlag) return 'confirmed';

  const expectedFlag = isTruthyFlag(
    readByNormalizedKey(entry, ['expected', 'isExpected', 'projected', 'probable', 'expectedLineup'])
  );
  if (expectedFlag) return 'expected';

  return '';
};

const extractEntries = (payload: any): any[] => {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;

  const candidates = [
    payload.startingLineups,
    payload.starting_lineups,
    payload.lineups,
    payload.startingLineup,
    payload.depth,
    payload.teams,
    payload.items,
    payload.results,
    payload.data?.startingLineups,
    payload.data?.starting_lineups,
    payload.data?.lineups,
    payload.data?.teams,
    payload.data?.items,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate;
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      const values = Object.values(candidate).filter((v) => v && typeof v === 'object');
      if (values.length > 0) return values as any[];
    }
  }

  const values = Object.values(payload).filter((v) => v && typeof v === 'object');
  if (values.length > 0) return values as any[];
  return [];
};

const extractPlayersFromValue = (value: any): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => extractName(item) || cleanPlayerName(toStringValue(item)))
      .filter((name) => name.length > 0);
  }
  if (typeof value === 'object') {
    const nested = readByNormalizedKey(value, ['players', 'starters', 'lineup', 'startingLineup', 'starting_lineup']);
    if (nested) return extractPlayersFromValue(nested);
    const values = Object.values(value)
      .map((item) => extractName(item) || cleanPlayerName(toStringValue(item)))
      .filter(Boolean) as string[];
    if (values.length > 0) return values;
  }
  if (typeof value === 'boolean') return [];
  const asString = toStringValue(value);
  const cleaned = cleanPlayerName(asString);
  return cleaned ? [cleaned] : [];
};

const addPlayersWithEmbeddedStatus = (
  lookup: StartingLineupLookup,
  value: any,
  fallbackStatus: 'confirmed' | 'expected' | ''
) => {
  if (!value) return;

  const visit = (node: any) => {
    if (!node) return;

    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    if (typeof node === 'object') {
      const nested = readByNormalizedKey(node, ['players', 'starters', 'lineup', 'startingLineup', 'starting_lineup']);
      if (nested) {
        visit(nested);
        return;
      }

      const name = extractName(node);
      const id = extractPlayerId(node);
      const status = readStatusFromEntry(node) || fallbackStatus;
      if (name && status) {
        addPlayerToLookup(lookup, name, id, status);
        return;
      }

      Object.values(node).forEach(visit);
      return;
    }

    if (!fallbackStatus) return;
    const cleaned = cleanPlayerName(toStringValue(node));
    if (cleaned) addPlayerToLookup(lookup, cleaned, '', fallbackStatus);
  };

  visit(value);
};

const addPlayerToLookup = (lookup: StartingLineupLookup, name: string, id: string, status: 'confirmed' | 'expected') => {
  const info: StartingLineupInfo = {
    status,
    isConfirmed: status === 'confirmed',
    isExpected: status === 'expected',
  };
  const normalizedName = normalizeName(name);
  if (normalizedName) lookup.set(normalizedName, info);
  if (id) lookup.set(id, info);
};

export const buildStartingLineupLookup = (payload: any): StartingLineupLookup => {
  const lookup: StartingLineupLookup = new Map();
  const entries = extractEntries(payload);

  entries.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;

    const entryName = extractName(entry);
    const entryId = extractPlayerId(entry);
    const entryStatus = readStatusFromEntry(entry);
    const startersValue = readByNormalizedKey(entry, [
      'starters',
      'startinglineup',
      'starting_lineup',
      'lineup',
      'players',
      'startingfive',
      'starting_five',
    ]);

    // Only treat entry-level name/status as player data when it's not a team-level lineup container.
    if (entryName && entryStatus && !startersValue) {
      addPlayerToLookup(lookup, entryName, entryId, entryStatus);
    }

    const confirmedList = extractPlayersFromValue(
      readByNormalizedKey(entry, [
        'confirmedStarters',
        'confirmedLineup',
        'confirmedStartingLineup',
        'confirmedPlayers',
        'confirmed',
      ])
    );
    confirmedList.forEach((name) => addPlayerToLookup(lookup, name, '', 'confirmed'));

    const expectedList = extractPlayersFromValue(
      readByNormalizedKey(entry, [
        'expectedStarters',
        'expectedLineup',
        'expectedStartingLineup',
        'projectedStarters',
        'projectedLineup',
        'expected',
        'projected',
        'probable',
      ])
    );
    expectedList.forEach((name) => addPlayerToLookup(lookup, name, '', 'expected'));

    const starters = extractPlayersFromValue(startersValue);
    const starterFallbackStatus: 'confirmed' | 'expected' = entryStatus || 'expected';

    if (starters.length > 0) {
      starters.forEach((name) => addPlayerToLookup(lookup, name, '', starterFallbackStatus));
    } else if (startersValue) {
      addPlayersWithEmbeddedStatus(lookup, startersValue, starterFallbackStatus);
    }
  });

  return lookup;
};

export const getPlayerStartingLineupInfo = (
  player: Player,
  lookup?: StartingLineupLookup | null
): StartingLineupInfo | undefined => {
  if (!lookup || lookup.size === 0) return undefined;
  const byId = lookup.get(canonicalizeId(player.id)) ?? lookup.get(String(player.id));
  if (byId) return byId;
  return lookup.get(normalizeName(player.name));
};

export const getStartingLineupInfoByName = (
  name: string,
  lookup?: StartingLineupLookup | null
): StartingLineupInfo | undefined => {
  if (!lookup || lookup.size === 0 || !name) return undefined;
  return lookup.get(normalizeName(name));
};
