import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp, ChevronDown, X, Trash2, UserPlus } from 'lucide-react';
import { useLineup } from '../context/LineupContext';
import { Player, Slot } from '../types';
import { PlayerSelectionModal } from './PlayerSelectionModal';


interface LineupDrawerProps {
  players: Player[];
  showActuals: boolean;
}

export const LineupDrawer: React.FC<LineupDrawerProps> = ({ players, showActuals }) => {
  const { slots, totalProjectedFpts, remainingSalary, removePlayer, resetLineup, addPlayerToSlot } = useLineup();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  const handleSlotClick = (slot: Slot) => {
    if (!slots[slot]) {
      setSelectedSlot(slot);
      setIsModalOpen(true);
    }
  };

  const handlePlayerSelect = (player: Player) => {
    if (selectedSlot) {
      addPlayerToSlot(player, selectedSlot);
    }
    setIsModalOpen(false);
    setSelectedSlot(null);
  };


  const slotOrder: Slot[] = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'];

  const isSalaryOver = remainingSalary < 0;

  return (
    <div className="fixed bottom-16 left-0 right-0 z-40 px-4 pb-2 pointer-events-none">
      <div className="max-w-lg ml-auto pointer-events-auto">
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="bg-white/90 backdrop-blur-md border border-ink/10 rounded-t-lg shadow-2xl overflow-hidden mb-[-1px]"
            >
              {/* Expanded Header */}
              <div className="p-3 border-b border-ink/10 bg-vellum/40 flex justify-between items-center">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-drafting-orange">DraftKings Lineup</h3>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={resetLineup}
                    className="p-1.5 hover:bg-red-600/10 text-red-600 rounded-lg transition-colors"
                    title="Reset Lineup"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => setIsExpanded(false)}
                    className="p-1.5 hover:bg-ink/5 text-ink/40 rounded-lg transition-colors"
                  >
                    <ChevronDown className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Slots List */}
              <div className="max-h-[60vh] overflow-y-auto no-scrollbar py-1">
                {slotOrder.map((slot) => {
                  const player = slots[slot];
                  return (
                    <div key={slot} onClick={() => handleSlotClick(slot as Slot)} className="flex items-center justify-between px-4 py-2 border-b border-ink/5 last:border-0 hover:bg-ink/5 transition-colors cursor-pointer">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="w-8 text-[10px] font-black text-ink/40 font-mono">{slot}</div>
                        <div className="flex flex-col truncate">
                          {player ? (
                            <>
                              <span className="text-xs font-bold text-ink truncate">{player.name}</span>
                              <span className="text-[9px] font-mono text-ink/40 uppercase">{player.team} | ${player.salary.toLocaleString()}</span>
                            </>
                          ) : (
                            <span className="text-xs font-bold text-ink/30 italic">Empty Slot</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        {player && (
                          <>
                            <div className="text-right">
                              <div className="text-[10px] font-black text-drafting-orange font-mono">{player.projection.toFixed(2)}</div>
                              <div className="text-[8px] text-ink/40 uppercase font-bold">Proj</div>
                            </div>
                            {showActuals && (player.actual !== undefined || player.actualFpts !== undefined || player.fpts !== undefined) && (
                              <div className="text-right">
                                <div className="text-[10px] font-black text-blueprint font-mono">{(player.actual || player.actualFpts || player.fpts).toFixed(2)}</div>
                                <div className="text-[8px] text-ink/40 uppercase font-bold">Act</div>
                              </div>
                            )}
                            <button 
                              onClick={() => removePlayer(slot)}
                              className="p-1 hover:bg-red-600/10 text-red-600/60 hover:text-red-600 rounded transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {isModalOpen && selectedSlot && (
          <PlayerSelectionModal 
            players={players}
            position={selectedSlot}
            remainingSalary={remainingSalary}
            onSelect={handlePlayerSelect}
            onClose={() => setIsModalOpen(false)}
          />
        )}

        {/* Collapsed Bar */}
        <motion.div 
          onClick={() => setIsExpanded(!isExpanded)}
          className={`bg-drafting-orange border border-drafting-orange ${isExpanded ? 'rounded-b-lg' : 'rounded-lg'} shadow-xl p-3 flex items-center justify-between cursor-pointer hover:border-drafting-orange/80 transition-all`}
        >
          <div className="flex items-center gap-3">
            <span className="text-xs font-black uppercase tracking-widest text-white">Lineup</span>
          </div>

          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className={`text-xs font-black font-mono ${totalProjectedFpts > 0 ? 'text-white' : 'text-white/60'}`}>
                {totalProjectedFpts.toFixed(2)}
              </div>
              <div className="text-[8px] text-white/60 uppercase font-bold tracking-tighter">Proj Fpts</div>
            </div>

            {/* Optional Act Fpts if data exists in any slot */}
            {showActuals && (Object.values(slots) as (Player | null)[]).some(p => p && (p.actual !== undefined || p.actualFpts !== undefined || p.fpts !== undefined)) && (
              <div className="text-center">
                <div className="text-xs font-black font-mono text-white">
                  {(Object.values(slots) as (Player | null)[]).reduce<number>((acc, p) => acc + (p?.actual || p?.actualFpts || p?.fpts || 0), 0).toFixed(2)}
                </div>
                <div className="text-[8px] text-white/60 uppercase font-bold tracking-tighter">Act Fpts</div>
              </div>
            )}

            <div className="text-center">
              <div className={`text-xs font-black font-mono ${isSalaryOver ? 'text-white' : 'text-white'}`}>
                ${remainingSalary.toLocaleString()}
              </div>
              <div className="text-[8px] text-white/60 uppercase font-bold tracking-tighter">Rem. Salary</div>
            </div>

            {!isExpanded && <ChevronUp className="w-4 h-4 text-white/60" />}
          </div>
        </motion.div>
      </div>
    </div>
  );
};
