import { describe, expect, it } from 'vitest';
import { loadSlateEcosystem } from '../utils/assetLoader';

const jsonResponse = (payload: any, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('loadSlateEcosystem starting lineup resolution', () => {
  it('prefers slate-scoped starting lineups and does not backfill stale previous-date data', async () => {
    const seenUrls: string[] = [];

    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      seenUrls.push(url);

      if (url.startsWith('/api/projections?date=2026-03-19&slate=Main_1900')) {
        return jsonResponse({ players: [] }, 200);
      }

      if (url.includes('/api/decrypt?file=injuries&date=2026-03-19')) return jsonResponse({}, 200);
      if (url.includes('/api/decrypt?file=nba_depth_charts&date=2026-03-19')) return jsonResponse({}, 200);
      if (url.includes('/api/decrypt?file=stats&date=2026-03-19&slate=Main_1900')) return jsonResponse({}, 200);

      // Current date lineup files are missing.
      if (url.includes('/api/decrypt?file=nba_starting_lineups&date=2026-03-19&slate=Main_1900')) return jsonResponse({}, 404);
      if (url.includes('/api/decrypt?file=nba_starting_lineups&date=2026-03-19')) return jsonResponse({}, 404);
      if (url.includes('/api/decrypt?file=lineup&date=2026-03-19')) return jsonResponse({}, 404);
      if (url.includes('/api/decrypt?file=lineups&date=2026-03-19')) return jsonResponse({}, 404);
      if (url.includes('/api/decrypt?file=starting_lineups&date=2026-03-19')) return jsonResponse({}, 404);

      // Previous date data exists but must not be used.
      if (url.includes('/api/decrypt?file=nba_starting_lineups&date=2026-03-18')) {
        return jsonResponse({ stale: true }, 200);
      }

      return jsonResponse({}, 404);
    };

    const result = await loadSlateEcosystem({
      targetDate: '2026-03-19',
      slateFolder: 'Main_1900',
      includeHistory: false,
      fetcher,
    });

    expect(result.ok).toBe(true);
    expect(result.data.startingLineups).toBeNull();
    expect(
      seenUrls.some((url) =>
        url.includes('/api/decrypt?file=nba_starting_lineups&date=2026-03-18')
      )
    ).toBe(false);
  });

  it('loads same-day slate-scoped nba_starting_lineups when available', async () => {
    const seenUrls: string[] = [];

    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      seenUrls.push(url);

      if (url.startsWith('/api/projections?date=2026-03-19&slate=Main_1900')) {
        return jsonResponse({ players: [] }, 200);
      }

      if (url.includes('/api/decrypt?file=injuries&date=2026-03-19')) return jsonResponse({}, 200);
      if (url.includes('/api/decrypt?file=nba_depth_charts&date=2026-03-19')) return jsonResponse({}, 200);
      if (url.includes('/api/decrypt?file=stats&date=2026-03-19&slate=Main_1900')) return jsonResponse({}, 200);

      if (url.includes('/api/decrypt?file=nba_starting_lineups&date=2026-03-19&slate=Main_1900')) {
        return jsonResponse(
          {
            DET: { players: ['daniss jenkins'], status: 'expected' },
            WAS: { players: ['bub carrington'], status: 'confirmed' },
          },
          200
        );
      }

      return jsonResponse({}, 404);
    };

    const result = await loadSlateEcosystem({
      targetDate: '2026-03-19',
      slateFolder: 'Main_1900',
      includeHistory: false,
      fetcher,
    });

    expect(result.ok).toBe(true);
    expect(result.data.startingLineups).toBeTruthy();
    expect(
      seenUrls.some((url) =>
        url.includes('/api/decrypt?file=nba_starting_lineups&date=2026-03-19&slate=Main_1900')
      )
    ).toBe(true);
  });
});
