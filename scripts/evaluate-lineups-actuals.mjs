#!/usr/bin/env node

import fs from 'node:fs';
import Papa from 'papaparse';

const SLOT_COLUMNS = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'];

const args = process.argv.slice(2);

const getArgValue = (name, fallback = '') => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1) return fallback;
  return args[idx + 1] || fallback;
};

const lineupsPath = getArgValue('lineups');
const actualsPath = getArgValue('actuals');
const threshold = Number(getArgValue('threshold', '330'));

if (!lineupsPath || !actualsPath) {
  console.error('Usage: node scripts/evaluate-lineups-actuals.mjs --lineups <lineups.csv> --actuals <actuals.csv> [--threshold 330]');
  process.exit(1);
}

const readCsv = (filePath) => {
  const content = fs.readFileSync(filePath, 'utf8');
  const parsed = Papa.parse(content, { header: true, skipEmptyLines: true });
  if (parsed.errors && parsed.errors.length > 0) {
    throw new Error(`CSV parse error in ${filePath}: ${parsed.errors[0].message}`);
  }
  return parsed.data || [];
};

const normalize = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const findColumn = (row, candidates) => {
  const normalizedMap = new Map();
  Object.keys(row || {}).forEach((k) => normalizedMap.set(normalize(k), k));
  for (const key of candidates) {
    const actualKey = normalizedMap.get(normalize(key));
    if (actualKey) return actualKey;
  }
  return '';
};

const actualRows = readCsv(actualsPath);
const lineupRows = readCsv(lineupsPath);

if (!actualRows.length || !lineupRows.length) {
  console.error('No rows found in one or both CSV files.');
  process.exit(1);
}

const idCol = findColumn(actualRows[0], ['Player ID', 'ID', 'playerId', 'player_id']);
const actualCol = findColumn(actualRows[0], ['Actual', 'Actual FPTS', 'FPTS', 'fantasyPoints', 'dk_fpts']);

if (!idCol || !actualCol) {
  console.error('Could not find player ID and actual FPTS columns in actuals CSV.');
  process.exit(1);
}

const actualMap = new Map();
actualRows.forEach((row) => {
  const playerId = String(row[idCol] || '').trim();
  if (!playerId) return;
  const value = Number(String(row[actualCol] || '').replace(/[^0-9.\-]/g, ''));
  actualMap.set(playerId, Number.isFinite(value) ? value : 0);
});

const firstLineupRow = lineupRows[0];
const lineupSlotKeys = SLOT_COLUMNS.map((slot) => findColumn(firstLineupRow, [slot])).filter(Boolean);
if (lineupSlotKeys.length !== SLOT_COLUMNS.length) {
  console.error('Lineups CSV must include columns PG, SG, SF, PF, C, G, F, UTIL.');
  process.exit(1);
}

const lineupScores = lineupRows.map((row, idx) => {
  const total = lineupSlotKeys.reduce((sum, slotKey) => {
    const playerId = String(row[slotKey] || '').trim();
    return sum + (actualMap.get(playerId) || 0);
  }, 0);
  return {
    index: idx + 1,
    score: Number(total.toFixed(2)),
  };
});

const hitCount = lineupScores.filter((row) => row.score >= threshold).length;
const hitRate = lineupScores.length > 0 ? (hitCount / lineupScores.length) * 100 : 0;
const avg = lineupScores.length > 0
  ? lineupScores.reduce((sum, row) => sum + row.score, 0) / lineupScores.length
  : 0;
const best = lineupScores.reduce((max, row) => Math.max(max, row.score), 0);

console.log('Offline Lineup Evaluation');
console.log(`Lineups: ${lineupScores.length}`);
console.log(`Average score: ${avg.toFixed(2)}`);
console.log(`Best score: ${best.toFixed(2)}`);
console.log(`Hit threshold (${threshold}+): ${hitCount} (${hitRate.toFixed(2)}%)`);
