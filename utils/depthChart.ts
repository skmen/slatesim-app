export interface DepthChartRow {
  position: string;
  players: string[];
}

const normalizeToken = (value: string): string =>
  String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const readByNormalizedKey = (obj: any, keys: string[]): any => {
  if (!obj || typeof obj !== 'object') return undefined;
  const normalizedMap = new Map<string, string>();
  Object.keys(obj).forEach((key) => {
    normalizedMap.set(normalizeToken(key), key);
  });
  for (const key of keys) {
    const match = normalizedMap.get(normalizeToken(key));
    if (match) return obj[match];
  }
  return undefined;
};

const extractName = (entry: any): string => {
  if (entry === null || entry === undefined) return '';
  if (typeof entry === 'string' || typeof entry === 'number') return String(entry).trim();
  if (typeof entry !== 'object') return '';
  const direct = readByNormalizedKey(entry, ['name', 'player', 'playername', 'fullName', 'displayName', 'label']);
  if (direct) return String(direct).trim();
  const nested = entry.player || entry.person || entry.athlete;
  if (nested && typeof nested === 'object') {
    const nestedName = readByNormalizedKey(nested, ['name', 'fullName', 'displayName']);
    if (nestedName) return String(nestedName).trim();
  }
  return '';
};

const extractPlayersFromValue = (value: any): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map(extractName)
      .filter((name) => name.length > 0);
  }

  if (typeof value === 'object') {
    const nestedArray = value.players || value.depth || value.chart || value.list;
    if (Array.isArray(nestedArray)) return nestedArray.map(extractName).filter(Boolean);

    const keys = Object.keys(value);
    const priority = ['starter', 'first', '1', 'one', 'primary', 'backup', 'second', '2', 'two', 'third', '3', 'three', 'fourth', '4', 'four', 'fifth', '5', 'five'];
    const sortedKeys = [...keys].sort((a, b) => {
      const aIdx = priority.indexOf(a.toLowerCase());
      const bIdx = priority.indexOf(b.toLowerCase());
      if (aIdx !== -1 || bIdx !== -1) {
        const aRank = aIdx === -1 ? 999 : aIdx;
        const bRank = bIdx === -1 ? 999 : bIdx;
        return aRank - bRank;
      }
      const aNum = Number(a);
      const bNum = Number(b);
      if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
      return a.localeCompare(b);
    });

    const players = sortedKeys
      .map((key) => extractName(value[key]))
      .filter((name) => name.length > 0);

    if (players.length > 0) return players;
  }

  return [];
};

const findTeamNode = (payload: any, teamId: string): any | null => {
  if (!payload || !teamId) return null;
  const teamToken = normalizeToken(teamId);

  if (payload[teamId]) return payload[teamId];
  if (typeof payload === 'object' && !Array.isArray(payload)) {
    const keyMatch = Object.keys(payload).find((key) => normalizeToken(key) === teamToken);
    if (keyMatch) return payload[keyMatch];
  }

  const candidateArrays = [
    payload.teams,
    payload.data?.teams,
    payload.depthCharts,
    payload.depthcharts,
    payload.items,
    payload.results,
  ].filter((v) => Array.isArray(v));

  for (const list of candidateArrays) {
    for (const item of list) {
      const teamValue = readByNormalizedKey(item, ['team', 'teamId', 'teamAbbrev', 'abbr', 'abbreviation', 'shortName', 'name']);
      if (teamValue && normalizeToken(teamValue) === teamToken) return item;
    }
  }

  return null;
};

const extractChartObject = (teamNode: any): any => {
  if (!teamNode || typeof teamNode !== 'object') return null;
  return (
    teamNode.depthChart ||
    teamNode.depth_chart ||
    teamNode.chart ||
    teamNode.depth ||
    teamNode.positions ||
    teamNode.data ||
    teamNode
  );
};

export const getTeamDepthChartRows = (payload: any, teamId: string): DepthChartRow[] => {
  const teamNode = findTeamNode(payload, teamId);
  const chart = extractChartObject(teamNode || payload?.[teamId] || payload);
  if (!chart || typeof chart !== 'object') return [];

  if (Array.isArray(chart)) {
    const rows = chart
      .map((item) => {
        const position = String(readByNormalizedKey(item, ['position', 'pos', 'slot']) || '').toUpperCase();
        const players = extractPlayersFromValue(readByNormalizedKey(item, ['players', 'depth', 'chart', 'lineup']) ?? item.players);
        return position ? { position, players } : null;
      })
      .filter((row) => row && row.players.length > 0) as DepthChartRow[];
    return rows;
  }

  const knownPositions = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'];
  const keys = Object.keys(chart);
  const positionKeys = keys.filter((key) => {
    const normalized = normalizeToken(key);
    return knownPositions.includes(normalized);
  });

  if (positionKeys.length === 0) return [];

  const ordered = [...positionKeys].sort((a, b) => {
    const aIdx = knownPositions.indexOf(normalizeToken(a));
    const bIdx = knownPositions.indexOf(normalizeToken(b));
    if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });

  return ordered
    .map((key) => ({
      position: normalizeToken(key),
      players: extractPlayersFromValue(chart[key]),
    }))
    .filter((row) => row.players.length > 0);
};
