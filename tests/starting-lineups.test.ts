import { describe, expect, it } from 'vitest';
import { buildStartingLineupLookup, getStartingLineupInfoByName } from '../utils/startingLineups';

describe('startingLineups parser', () => {
  it('parses both teams from nested matchup containers with s/starters keys', () => {
    const payload = {
      lineups: {
        'ATL@BOS': {
          ATL: {
            s: [
              { name: 'Trae Young' },
              { name: 'Dyson Daniels' },
            ],
          },
          BOS: {
            starters: [
              { name: 'Jrue Holiday', status: 'confirmed' },
              { name: 'Jayson Tatum' },
            ],
          },
        },
      },
    };

    const lookup = buildStartingLineupLookup(payload);
    const trae = getStartingLineupInfoByName('Trae Young', lookup);
    const jrue = getStartingLineupInfoByName('Jrue Holiday', lookup);
    const tatum = getStartingLineupInfoByName('Jayson Tatum', lookup);

    expect(trae?.isExpected).toBe(true);
    expect(jrue?.isConfirmed).toBe(true);
    expect(tatum?.isExpected).toBe(true);
  });

  it('accepts S/s starter status tags as expected starters', () => {
    const payload = [
      { name: 'Stephen Curry', lineupStatus: 's' },
      { name: 'Draymond Green', status: 'S' },
      { name: 'Andrew Wiggins', tag: 'starter' },
    ];

    const lookup = buildStartingLineupLookup(payload);

    expect(getStartingLineupInfoByName('Stephen Curry', lookup)?.isExpected).toBe(true);
    expect(getStartingLineupInfoByName('Draymond Green', lookup)?.isExpected).toBe(true);
    expect(getStartingLineupInfoByName('Andrew Wiggins', lookup)?.isExpected).toBe(true);
  });

  it('does not downgrade confirmed status when expected appears later', () => {
    const payload = [
      { confirmedStarters: ['LeBron James'] },
      { expectedStarters: ['LeBron James'] },
    ];

    const lookup = buildStartingLineupLookup(payload);
    expect(getStartingLineupInfoByName('LeBron James', lookup)?.isConfirmed).toBe(true);
  });
});
