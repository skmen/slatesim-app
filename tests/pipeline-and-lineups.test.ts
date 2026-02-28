
import { describe, it, expect } from 'vitest';
import { parsePipelineJson, parseOptimizerLineupsFromText, safeJsonParse } from '../utils/csvParser';

const MOCK_PIPELINE = {
  data: {
    projections: [
      { Name: "Cade Cunningham", ID: "1630595", Team: "DET", Salary: 10600, DK_FPTS_PROJ: 55 },
      { Name: "Jared McCain", ID: "1642272", Team: "PHI", Salary: 4200, DK_FPTS_PROJ: 27 },
      { Name: "Buddy Hield", ID: "1627741", Team: "GSW", Salary: 4100, DK_FPTS_PROJ: 25 },
      { Name: "Anthony Davis", ID: "203076", Team: "LAL", Salary: 9000, DK_FPTS_PROJ: 41 },
      { Name: "Derik Queen", ID: "1642852", Team: "MD", Salary: 7100, DK_FPTS_PROJ: 38 },
      { Name: "Bub Carrington", ID: "1642267", Team: "WAS", Salary: 5100, DK_FPTS_PROJ: 31 },
      { Name: "Herbert Jones", ID: "1630529", Team: "NOP", Salary: 4200, DK_FPTS_PROJ: 26 },
      { Name: "Brandin Podziemski", ID: "1641764", Team: "GSW", Salary: 5600, DK_FPTS_PROJ: 30 }
    ]
  }
};

const MOCK_CSV = `Lineup_ID,PG,SG,SF,PF,C,G,F,UTIL,EV,TailScore
1,1641764,1642272,1627741,203076,1642852,1642267,1630529,1630595,275,362`;

describe('Slate Sim Authoritative Data Layer', () => {
  it('parses pipeline and extracts reference players', () => {
    const result = parsePipelineJson(JSON.stringify(MOCK_PIPELINE));
    expect(result.referencePlayers.length).toBe(8);
    expect(result.referencePlayers.find(p => p.id === "1630595")).toBeDefined();
  });

  it('handles NaN and Infinity in JSON string', () => {
    const jsonWithNan = '{"rank": NaN, "roi": Infinity}';
    const parsed = safeJsonParse(jsonWithNan);
    expect(parsed.rank).toBe(null);
    expect(parsed.roi).toBe(null);
  });

  it('hydrates optimizer CSV using authoritative numeric IDs', () => {
    const { referencePlayers } = parsePipelineJson(JSON.stringify(MOCK_PIPELINE));
    const lineups = parseOptimizerLineupsFromText(MOCK_CSV, referencePlayers);
    expect(lineups.length).toBe(1);
    expect(lineups[0].players?.length).toBe(8);
    expect(lineups[0].playerIds.length).toBe(8);
    // Verify player object is hydrated
    expect(lineups[0].players?.[0].name).toBe("Brandin Podziemski");
  });

  it('handles float/numeric variations in player IDs', () => {
    const { referencePlayers } = parsePipelineJson(JSON.stringify(MOCK_PIPELINE));
    const csvFloats = `Lineup_ID,PG,SG,SF,PF,C,G,F,UTIL\n1,1641764.0,1642272.0,1627741,203076,1642852,1642267,1630529,1630595`;
    const lineups = parseOptimizerLineupsFromText(csvFloats, referencePlayers);
    expect(lineups[0].playerIds.length).toBe(8);
    expect(lineups[0].playerIds[0]).toBe("1641764");
  });
});
