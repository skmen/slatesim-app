import type { Player } from '../../types';

export interface PlayerEnrichmentEntry {
  player_id: string;
  player_name: string;
  model_projection: number;
  overperform_proba: number;
  true_shot_quality: number;
  paint_gravity_score: number;
  xfg_pct: number | null;
  vlm_coverage: boolean;
  vlm_note: string | null;
}

export interface PlayerEnrichmentFile {
  slate_date: string;
  generated_at: string;
  model_version: string;
  lsp_trained_at: string | null;
  coverage_pct: number;
  players: Record<string, PlayerEnrichmentEntry>;
  warnings: string[];
}

export async function fetchPlayerEnrichment(
  slateDate: string,
): Promise<PlayerEnrichmentFile | null> {
  const base = (import.meta as any).env?.VITE_R2_BASE_URL;
  if (!base) {
    console.warn('[enrichmentClient] VITE_R2_BASE_URL is not set — skipping enrichment fetch');
    return null;
  }
  const url = `${base}/${slateDate}/player_enrichment.json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`[enrichmentClient] fetch ${url} returned ${res.status} — no enrichment`);
      return null;
    }
    const data = await res.json();
    return data as PlayerEnrichmentFile;
  } catch (err) {
    clearTimeout(timer);
    console.warn('[enrichmentClient] fetch failed or timed out:', err);
    return null;
  }
}

export function mergeEnrichmentOntoPlayers(
  players: Player[],
  enrichment: PlayerEnrichmentFile,
): Player[] {
  return players.map((player) => {
    const entry =
      enrichment.players[player.id] ??
      enrichment.players[(player as any).player_id];
    if (!entry) return player;
    return {
      ...player,
      modelProjection: entry.model_projection,
      overperformProba: entry.overperform_proba,
      trueShotQuality: entry.true_shot_quality,
      paintGravityScore: entry.paint_gravity_score,
      xfgPct: entry.xfg_pct ?? undefined,
      vlmCoverage: entry.vlm_coverage,
      vlmNote: entry.vlm_note,
    };
  });
}
