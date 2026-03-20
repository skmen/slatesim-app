// utils/classifyPlayers.ts
// Pure utility — no React dependencies. Fully testable in isolation.

export type TierType = 'ELITE' | 'SWEET_SPOT' | 'BROAD' | 'CAUTION' | 'OVERUSE_WARNING';
export type PosType = 'PG' | 'SG' | 'SF' | 'PF' | 'C';

export interface RawPlayerRow {
  Player: string;
  Team: string;
  OPP: string;
  Pos: string;
  Salary: number;
  Value: number;
  Own: number;
  Usage: number;
  Min: number;
  Proj: number;
  Ceiling: number;
  Floor: number;
  Lev_Score: number;
  Boom: number | null;
  Bust: number | null;
  [key: string]: any;
}

export interface ClassificationResult {
  tier: TierType;
  condition: string;
  historicalRate: string;
  posReasoning: string;
}

export interface ClassifiedPlayer extends RawPlayerRow {
  pos_primary: PosType;
  ceil_gap: number;
  classification: ClassificationResult;
}

// ─── Position Normalization ───────────────────────────────────────────────────

const POS_MAP: Record<string, PosType> = {
  PG: 'PG', 'PG/SG': 'PG', 'PG/SF': 'PG',
  SG: 'SG', 'SG/SF': 'SG',
  SF: 'SF', 'SF/PF': 'SF',
  PF: 'PF', 'PF/C': 'PF',
  C: 'C',
};

export function normalizePosition(pos: string): PosType | null {
  const trimmed = pos.trim();
  return POS_MAP[trimmed] ?? null;
}

// ─── Classification Logic ─────────────────────────────────────────────────────
// Rules evaluated in priority order: OVERUSE_WARNING first, then ELITE, SWEET_SPOT, BROAD, CAUTION

export function classifyPlayer(row: RawPlayerRow, pos_primary: PosType): ClassificationResult | null {
  const { Own, Usage } = row;

  switch (pos_primary) {
    case 'PG': {
      // OVERUSE_WARNING: none defined for PG
      if (Own >= 15 && Usage >= 28) {
        return {
          tier: 'ELITE',
          condition: 'Own 15%+ & Usage 28%+ (PG elite)',
          historicalRate: '~60%',
          posReasoning: 'PG with 15%+ ownership and 28%+ usage hit at 60% across 8 slates — the strongest single combination in the dataset.',
        };
      }
      if (Own >= 3 && Usage >= 22) {
        return {
          tier: 'BROAD',
          condition: 'Own 3%+ & Usage 22%+ (PG broad)',
          historicalRate: '~29%',
          posReasoning: 'PG meeting the general ownership + usage threshold. ~29% hit rate vs 18–19% baseline.',
        };
      }
      return null;
    }

    case 'SG': {
      // OVERUSE_WARNING: none defined for SG
      if (Own >= 15 && Usage >= 22) {
        return {
          tier: 'CAUTION',
          condition: 'Own 15%+ & Usage 22%+ (SG caution)',
          historicalRate: '~20%',
          posReasoning: 'High-chalk SGs are overvalued by the market. Despite 15%+ ownership, this group hits at only ~20% — no better than baseline. The market appears to misprice chalk SGs.',
        };
      }
      if (Own >= 7 && Own < 15 && Usage >= 22) {
        return {
          tier: 'SWEET_SPOT',
          condition: 'Own 7–14% & Usage 22%+ (SG sweet spot)',
          historicalRate: '~27%',
          posReasoning: 'SGs in the 7–15% ownership range are the positional sweet spot. The 15%+ tier paradoxically underperforms — this mid-ownership band is where the edge lives.',
        };
      }
      if (Own >= 3 && Own < 7 && Usage >= 22) {
        return {
          tier: 'BROAD',
          condition: 'Own 3–6% & Usage 22%+ (SG broad)',
          historicalRate: '~19%',
          posReasoning: 'Low-ownership SG with adequate usage. Minimal lift over baseline (~19%), included for completeness at the fringes.',
        };
      }
      return null;
    }

    case 'SF': {
      // OVERUSE_WARNING: none defined for SF
      if (Usage >= 28 && Usage <= 35 && Own >= 3) {
        return {
          tier: 'ELITE',
          condition: 'Usage 28–35% & Own 3%+ (SF elite)',
          historicalRate: '~50%',
          posReasoning: 'SF usage in the 28–35% range is the strongest usage-alone signal across any position — ~50% hit rate. Ownership acts as a minimum qualifier (3%+).',
        };
      }
      if (Own >= 3 && Usage >= 22) {
        return {
          tier: 'BROAD',
          condition: 'Own 3%+ & Usage 22%+ (SF broad)',
          historicalRate: '~29%',
          posReasoning: 'SF meeting the standard broad threshold. ~29% hit rate vs 18–19% baseline — solid lift, lower conviction than elite usage band.',
        };
      }
      return null;
    }

    case 'PF': {
      // OVERUSE_WARNING: none defined for PF
      if (Own >= 15 && Usage >= 22) {
        return {
          tier: 'ELITE',
          condition: 'Own 15%+ & Usage 22%+ (PF elite)',
          historicalRate: '~40%',
          posReasoning: 'PF mirrors PG in signal strength — 15%+ ownership with adequate usage hits at ~40%. Ownership is the primary driver at this position.',
        };
      }
      if (Own >= 3 && Usage >= 22) {
        return {
          tier: 'BROAD',
          condition: 'Own 3%+ & Usage 22%+ (PF broad)',
          historicalRate: '~25%',
          posReasoning: 'PF meeting the general threshold. ~25% hit rate vs 18–19% baseline.',
        };
      }
      return null;
    }

    case 'C': {
      // OVERUSE_WARNING must be checked FIRST
      if (Own >= 3 && Usage >= 28) {
        return {
          tier: 'OVERUSE_WARNING',
          condition: 'Own 3%+ & Usage 28%+ (C overuse)',
          historicalRate: '~0%',
          posReasoning: 'Centers above 28% usage historically produced a 0% hit rate for 8+ pt overperformance. This is the hardest positional ceiling in the dataset — usage this high is unsustainably expensive and kills efficiency.',
        };
      }
      if (Own >= 3 && Usage >= 22 && Usage < 28) {
        return {
          tier: 'SWEET_SPOT',
          condition: 'Own 3%+ & Usage 22–27% (C sweet spot)',
          historicalRate: '~31%',
          posReasoning: 'Centers with usage strictly between 22–28% are in the sweet spot. Above 28% the hit rate historically drops to 0%. This is the hardest positional ceiling in the dataset — stay under.',
        };
      }
      return null;
    }
  }
}

// ─── CSV Parsing ──────────────────────────────────────────────────────────────

function parseNum(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  const n = parseFloat(String(val).replace(/[$,%]/g, ''));
  return isNaN(n) ? 0 : n;
}

function parseNullableNum(val: any): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = parseFloat(String(val).replace(/[$,%]/g, ''));
  return isNaN(n) ? null : n;
}

export function parseCSV(csvText: string): RawPlayerRow[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));

  // Normalize "Lev Score" → "Lev_Score"
  const normHeaders = headers.map((h) => (h === 'Lev Score' ? 'Lev_Score' : h));

  return lines.slice(1).map((line) => {
    // Handle quoted fields with commas
    const values: string[] = [];
    let inQuote = false;
    let current = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        values.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    values.push(current.trim());

    const row: Record<string, any> = {};
    normHeaders.forEach((h, i) => {
      row[h] = values[i] ?? '';
    });

    return {
      Player: String(row['Player'] || ''),
      Team: String(row['Team'] || ''),
      OPP: String(row['OPP'] || ''),
      Pos: String(row['Pos'] || ''),
      Salary: parseNum(row['Salary']),
      Value: parseNum(row['Value']),
      Own: parseNum(row['Own']),
      Usage: parseNum(row['Usage']),
      Min: parseNum(row['Min']),
      Proj: parseNum(row['Proj']),
      Ceiling: parseNum(row['Ceiling']),
      Floor: parseNum(row['Floor']),
      Lev_Score: parseNum(row['Lev_Score']),
      Boom: parseNullableNum(row['Boom']),
      Bust: parseNullableNum(row['Bust']),
      // Pass through any extra columns
      ...Object.fromEntries(
        Object.entries(row).filter(([k]) => !['Player','Team','OPP','Pos','Salary','Value','Own','Usage','Min','Proj','Ceiling','Floor','Lev_Score','Boom','Bust'].includes(k))
      ),
    } as RawPlayerRow;
  }).filter((r) => r.Player !== '');
}

// ─── Classify All ─────────────────────────────────────────────────────────────

export function classifyAllPlayers(rows: RawPlayerRow[]): ClassifiedPlayer[] {
  const results: ClassifiedPlayer[] = [];

  for (const row of rows) {
    const pos_primary = normalizePosition(row.Pos);
    if (!pos_primary) continue;

    const classification = classifyPlayer(row, pos_primary);
    if (!classification) continue;

    results.push({
      ...row,
      pos_primary,
      ceil_gap: row.Ceiling - row.Proj,
      classification,
    });
  }

  return results;
}

// ─── Sorting ──────────────────────────────────────────────────────────────────

const TIER_ORDER: Record<TierType, number> = {
  ELITE: 0,
  SWEET_SPOT: 1,
  BROAD: 2,
  CAUTION: 3,
  OVERUSE_WARNING: 4,
};

export function sortPlayers(
  players: ClassifiedPlayer[],
  col: string,
  dir: 'asc' | 'desc',
): ClassifiedPlayer[] {
  return [...players].sort((a, b) => {
    let aVal: any;
    let bVal: any;

    if (col === 'Tier') {
      aVal = TIER_ORDER[a.classification.tier];
      bVal = TIER_ORDER[b.classification.tier];
      if (aVal === bVal) {
        // secondary: Proj desc
        return b.Proj - a.Proj;
      }
    } else if (col === 'Player') {
      aVal = a.Player;
      bVal = b.Player;
    } else if (col === 'Pos') {
      aVal = a.pos_primary;
      bVal = b.pos_primary;
    } else {
      aVal = (a as any)[col] ?? 0;
      bVal = (b as any)[col] ?? 0;
    }

    if (typeof aVal === 'string') {
      return dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    return dir === 'asc' ? aVal - bVal : bVal - aVal;
  });
}
