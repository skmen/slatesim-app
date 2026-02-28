import { describe, it, expect, vi, beforeEach } from 'vitest';
import { autoLoadReferencePack } from '../utils/assetLoader';

describe('Asset Loader Resolution', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });

  it('resolves deterministic sequence correctly', async () => {
    (fetch as any).mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: {} }) });
    const result = await autoLoadReferencePack({ dateStrings: ['2025-12-20'], defaultName: 'pipeline_default' });
    expect(result.ok).toBe(true);
    expect(result.pathsTried.length).toBeGreaterThan(1);
  });
});