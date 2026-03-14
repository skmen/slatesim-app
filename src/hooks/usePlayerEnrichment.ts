import { useState, useEffect, useCallback } from 'react';
import type { Player } from '../../types';
import {
  fetchPlayerEnrichment,
  mergeEnrichmentOntoPlayers,
  type PlayerEnrichmentFile,
} from '../lib/enrichmentClient';

interface PlayerEnrichmentState {
  enrichment: PlayerEnrichmentFile | null;
  isLoading: boolean;
  coveragePct: number;
  modelVersion: string | null;
  lspTrainedAt: string | null;
  warnings: string[];
}

const DEFAULT_STATE: PlayerEnrichmentState = {
  enrichment: null,
  isLoading: false,
  coveragePct: 0,
  modelVersion: null,
  lspTrainedAt: null,
  warnings: [],
};

export function usePlayerEnrichment(slateDate: string | null): {
  state: PlayerEnrichmentState;
  mergePlayers: (players: Player[]) => Player[];
} {
  const [state, setState] = useState<PlayerEnrichmentState>(DEFAULT_STATE);

  useEffect(() => {
    if (!slateDate) {
      setState(DEFAULT_STATE);
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, isLoading: true }));

    fetchPlayerEnrichment(slateDate).then((enrichment) => {
      if (cancelled) return;
      if (!enrichment) {
        setState(DEFAULT_STATE);
        return;
      }
      setState({
        enrichment,
        isLoading: false,
        coveragePct: enrichment.coverage_pct,
        modelVersion: enrichment.model_version,
        lspTrainedAt: enrichment.lsp_trained_at,
        warnings: enrichment.warnings ?? [],
      });
    });

    return () => {
      cancelled = true;
    };
  }, [slateDate]);

  const mergePlayers = useCallback(
    (players: Player[]): Player[] => {
      if (!state.enrichment) return players;
      return mergeEnrichmentOntoPlayers(players, state.enrichment);
    },
    [state.enrichment],
  );

  return { state, mergePlayers };
}
