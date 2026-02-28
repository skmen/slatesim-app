import React, { createContext, useContext, useState, useMemo, useCallback } from 'react';
import { Player, Slot } from '../types';

export interface LineupState {
  slots: Record<Slot, Player | null>;
  totalProjectedFpts: number;
  remainingSalary: number;
}

interface LineupContextType extends LineupState {
  addPlayer: (player: Player) => boolean;
  addPlayerToSlot: (player: Player, slot: Slot) => boolean;
  removePlayer: (slot: Slot) => void;
  resetLineup: () => void;
  isPlayerInLineup: (playerId: string) => boolean;
}

const LineupContext = createContext<LineupContextType | undefined>(undefined);

const SALARY_CAP = 50000;
const SLOTS: Slot[] = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'];

export const LineupProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [slots, setSlots] = useState<Record<Slot, Player | null>>({
    PG: null,
    SG: null,
    SF: null,
    PF: null,
    C: null,
    G: null,
    F: null,
    UTIL: null,
  });

  const isPlayerInLineup = useCallback((playerId: string) => {
    return (Object.values(slots) as (Player | null)[]).some(p => p?.id === playerId);
  }, [slots]);

  const addPlayer = useCallback((player: Player) => {
    if (isPlayerInLineup(player.id)) return false;

    const pos = player.position; // e.g., "PG" or "PG/SG"
    const positions = pos.split('/');

    // Logic to find the best slot
    // 1. Check primary slots
    if (positions.includes('PG') && !slots.PG) {
      setSlots(prev => ({ ...prev, PG: player }));
      return true;
    }
    if (positions.includes('SG') && !slots.SG) {
      setSlots(prev => ({ ...prev, SG: player }));
      return true;
    }
    if (positions.includes('SF') && !slots.SF) {
      setSlots(prev => ({ ...prev, SF: player }));
      return true;
    }
    if (positions.includes('PF') && !slots.PF) {
      setSlots(prev => ({ ...prev, PF: player }));
      return true;
    }
    if (positions.includes('C') && !slots.C) {
      setSlots(prev => ({ ...prev, C: player }));
      return true;
    }

    // 2. Check Guard/Forward slots
    if ((positions.includes('PG') || positions.includes('SG')) && !slots.G) {
      setSlots(prev => ({ ...prev, G: player }));
      return true;
    }
    if ((positions.includes('SF') || positions.includes('PF')) && !slots.F) {
      setSlots(prev => ({ ...prev, F: player }));
      return true;
    }

    // 3. Check Utility slot
    if (!slots.UTIL) {
      setSlots(prev => ({ ...prev, UTIL: player }));
      return true;
    }

    return false;
  }, [slots, isPlayerInLineup]);

  const addPlayerToSlot = useCallback((player: Player, slot: Slot) => {
    if (isPlayerInLineup(player.id)) return false;
    setSlots(prev => ({ ...prev, [slot]: player }));
    return true;
  }, [isPlayerInLineup]);

  const removePlayer = useCallback((slot: Slot) => {
    setSlots(prev => ({ ...prev, [slot]: null }));
  }, []);

  const resetLineup = useCallback(() => {
    setSlots({
      PG: null,
      SG: null,
      SF: null,
      PF: null,
      C: null,
      G: null,
      F: null,
      UTIL: null,
    });
  }, []);

  const totalProjectedFpts = useMemo(() => {
    return (Object.values(slots) as (Player | null)[]).reduce<number>((acc, p) => acc + (p?.projection || 0), 0);
  }, [slots]);

  const remainingSalary = useMemo(() => {
    const totalSalary = (Object.values(slots) as (Player | null)[]).reduce<number>((acc, p) => acc + (p?.salary || 0), 0);
    return SALARY_CAP - totalSalary;
  }, [slots]);

  const value = {
    slots,
    totalProjectedFpts,
    remainingSalary,
    addPlayer,
    addPlayerToSlot,
    removePlayer,
    resetLineup,
    isPlayerInLineup,
  };

  return <LineupContext.Provider value={value}>{children}</LineupContext.Provider>;
};

export const useLineup = () => {
  const context = useContext(LineupContext);
  if (context === undefined) {
    throw new Error('useLineup must be used within a LineupProvider');
  }
  return context;
};
