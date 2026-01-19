import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Lineup, ContestState, Player, SlateStats, GameInfo, Entitlement } from '../types';
import { useAuth } from '../context/AuthContext';
import { 
  Copy, 
  CheckCircle, 
  RefreshCw, 
  ChevronLeft, 
  ChevronRight, 
  Settings, 
  X, 
  Edit3, 
  Search, 
  Download, 
  Target as TargetIcon,
  Play
} from 'lucide-react';
import { assignDraftKingsSlots, getContestViability, getFieldAlignment, getUpsideQuality, DEFAULT_CONTEST } from '../utils/contest';
import { ContestForm } from './ContestForm';
import { ContestSummary } from './ContestSummary';

interface Props {
  lineups: Lineup[];
  playerPool: Player[];
  contestState?: ContestState;
  onLineupUpload: (files: File[]) => void;
  onContestChange: (input: any) => void;
  hasAutoLoadedReferencePack?: boolean;
  referencePackPath?: string;
  referenceMeta?: any;
  slateStats?: SlateStats;
  games?: GameInfo[];
}

const DK_NBA_HEADER = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'];
const SALARY_CAP = 50000;

const isPosValid = (slot: string, playerPos: string): boolean => {
  const p = playerPos.toUpperCase();
  if (slot === 'PG') return p.includes('PG');
  if (slot === 'SG') return p.includes('SG');
  if (slot === 'SF') return p.includes('SF');
  if (slot === 'PF') return p.includes('PF');
  if (slot === 'C') return p.includes('C');
  if (slot === 'G') return p.includes('PG') || p.includes('SG');
  if (slot === 'F') return p.includes('SF') || p.includes('PF');
  if (slot === 'UTIL') return true;
  return false;
};

const RiskIndicator: React.FC<{ lineup: Lineup }> = ({ lineup }) => {
  const ceiling = lineup.totalCeiling || 1;
  const proj = lineup.totalProjection || 1;
  const ratio = (ceiling / proj);
  
  const riskScore = Math.min(100, Math.max(0, (1 - (ratio - 1.1) / 0.5) * 100));
  const isHigh = riskScore > 60;
  const isLow = riskScore < 30;

  return (
    <div className="flex items-center justify-between py-2 px-4 bg-black/20 rounded-xl border border-gray-800/50" title="Simulated equity drop if players miss minutes projections.">
      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Minutes Risk</span>
      <div className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase border ${
        isHigh ? 'bg-red-500/10 text-red-500 border-red-500/20' : 
        isLow ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 
        'bg-amber-500/10 text-amber-400 border-amber-500/20'
      }`}>
        {isHigh ? 'Volatile' : isLow ? 'Safe' : 'Moderate'}
      </div>
    </div>
  );
};

export const LineupsView: React.FC<Props> = ({ 
  lineups, 
  playerPool,
  contestState, 
  onLineupUpload, 
  onContestChange,
  hasAutoLoadedReferencePack,
  referencePackPath,
  referenceMeta,
  slateStats,
  games
}) => {
  const { user, hasEntitlement } = useAuth();
  const canRunSim = hasEntitlement('run_sim');
  const canExport = hasEntitlement('export_data');

  const [modifiedLineups, setModifiedLineups] = useState<Lineup[]>(lineups);
  const [activeSet, setActiveSet] = useState<string>('All');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(!contestState || contestState.input.fieldSize === 0);
  
  const [swapModal, setSwapModal] = useState<{ lineupId: string; slot: string; currentPlayerId: string } | null>(null);
  const [playerSearch, setPlayerSearch] = useState('');

  // Dragging States
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const dragStartX = useRef(0);
  const dragThreshold = 60; 

  useEffect(() => {
    setModifiedLineups(lineups);
    setActiveIndex(0);
  }, [lineups]);

  const uniqueSets = ['All', ...Array.from(new Set(modifiedLineups.map(l => l.set))).filter(Boolean)];
  const filteredLineups = useMemo(() => {
    return activeSet === 'All' 
      ? modifiedLineups 
      : modifiedLineups.filter(l => l.set === activeSet);
  }, [modifiedLineups, activeSet]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canRunSim) return;
    const file = e.target.files?.[0];
    if (!file) return;
    onLineupUpload([file]);
  };

  const handleNext = () => {
    if (activeIndex < filteredLineups.length - 1) setActiveIndex(prev => prev + 1);
  };

  const handlePrev = () => {
    if (activeIndex > 0) setActiveIndex(prev => prev - 1);
  };

  const startDrag = (clientX: number) => {
    setIsDragging(true);
    dragStartX.current = clientX;
    setDragOffset(0);
  };

  const moveDrag = (clientX: number) => {
    if (!isDragging) return;
    const offset = clientX - dragStartX.current;
    
    // Add resistance at ends
    if (activeIndex === 0 && offset > 0) {
      setDragOffset(offset * 0.3);
    } else if (activeIndex === filteredLineups.length - 1 && offset < 0) {
      setDragOffset(offset * 0.3);
    } else {
      setDragOffset(offset);
    }
  };

  const endDrag = () => {
    if (!isDragging) return;
    
    if (dragOffset > dragThreshold && activeIndex > 0) {
      handlePrev();
    } else if (dragOffset < -dragThreshold && activeIndex < filteredLineups.length - 1) {
      handleNext();
    }

    setIsDragging(false);
    setDragOffset(0);
  };

  const exportCSV = () => {
    if (!canExport) return;
    const rows = modifiedLineups.map(l => {
      if (l.slotMap && Object.keys(l.slotMap).length === 8) {
        return DK_NBA_HEADER.map(s => l.slotMap?.[s] || '').join(',');
      }
      const { slotMap } = assignDraftKingsSlots(l.players || []);
      return DK_NBA_HEADER.map(s => slotMap[s]?.id || '').join(',');
    });
    const header = DK_NBA_HEADER.join(',');
    const csvContent = [header, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `slatesim_lineups_${new Date().toISOString().slice(0,10)}.csv`);
    link.click();
  };

  const confirmSwap = (newPlayer: Player) => {
    if (!swapModal) return;
    const lineup = modifiedLineups.find(l => l.id === swapModal.lineupId);
    if (!lineup) return;

    const currentIdMap: Record<string, string> = lineup.slotMap || (() => {
      const auto = assignDraftKingsSlots(lineup.players || []);
      const mapping: Record<string, string> = {};
      Object.entries(auto.slotMap).forEach(([s, p]) => mapping[s] = p.id);
      return mapping;
    })();

    const oldPlayerId = currentIdMap[swapModal.slot];
    let newPlayers = (lineup.players || []).filter(p => p.id !== oldPlayerId);
    newPlayers.push(newPlayer);

    const newSlotMap = { ...currentIdMap, [swapModal.slot]: newPlayer.id };
    const newLineup: Lineup = {
      ...lineup,
      playerIds: newPlayers.map(p => p.id),
      players: newPlayers,
      totalSalary: newPlayers.reduce((s, p) => s + p.salary, 0),
      totalProjection: newPlayers.reduce((s, p) => s + p.projection, 0),
      totalCeiling: newPlayers.reduce((s, p) => s + (p.ceiling || 0), 0),
      totalOwnership: newPlayers.reduce((s, p) => s + (p.ownership || 0), 0),
      slotMap: newSlotMap
    };

    setModifiedLineups(prev => prev.map(l => l.id === newLineup.id ? newLineup : l));
    setSwapModal(null);
    setPlayerSearch('');
  };

  const swapOptions = useMemo(() => {
    if (!swapModal) return [];
    const lineup = modifiedLineups.find(l => l.id === swapModal.lineupId);
    if (!lineup) return [];

    const existingIds = new Set(lineup.players?.map(p => p.id) || []);
    const currentIdMap: Record<string, string> = lineup.slotMap || (() => {
      const auto = assignDraftKingsSlots(lineup.players || []);
      const mapping: Record<string, string> = {};
      Object.entries(auto.slotMap).forEach(([s, p]) => mapping[s] = p.id);
      return mapping;
    })();

    const currentPlayerId = currentIdMap[swapModal.slot];
    const currentPlayer = lineup.players?.find(p => p.id === currentPlayerId);
    const currentBaseSalary = lineup.totalSalary - (currentPlayer?.salary || 0);

    return playerPool
      .filter(p => isPosValid(swapModal.slot, p.position))
      .filter(p => !existingIds.has(p.id))
      .filter(p => {
        if (!playerSearch) return true;
        const s = playerSearch.toLowerCase();
        return p.name.toLowerCase().includes(s) || p.team.toLowerCase().includes(s);
      })
      .sort((a, b) => b.projection - a.projection)
      .map(p => ({
        player: p,
        canAfford: (currentBaseSalary + p.salary) <= SALARY_CAP
      }));
  }, [swapModal, modifiedLineups, playerPool, playerSearch]);

  const SignalChip = ({ label, color, tooltip }: { label: string, color: string, tooltip: string }) => {
    const bgColors: Record<string, string> = {
      emerald: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
      amber: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
      red: 'bg-red-500/10 text-red-400 border border-red-500/20',
      blue: 'bg-brand/10 text-brand border border-brand/20',
    };
    return (
      <div className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase flex items-center gap-1 ${bgColors[color]}`} title={tooltip}>
        {label}
      </div>
    );
  };

  const LineupCard: React.FC<{ lineup: Lineup, index: number, isCurrent: boolean, position: number, currentDragOffset: number }> = ({ lineup, index, isCurrent, position, currentDragOffset }) => {
    const viability = getContestViability(lineup);
    const alignment = getFieldAlignment(lineup);
    const isComplete = (lineup.players?.length || 0) === 8;

    const { slotMap } = useMemo(() => {
      if (lineup.slotMap) {
        const mapped: Record<string, Player> = {};
        Object.entries(lineup.slotMap).forEach(([slot, id]) => {
          const p = lineup.players?.find(pl => pl.id === id);
          if (p) mapped[slot] = p;
        });
        if (Object.keys(mapped).length === 8) return { slotMap: mapped };
      }
      return isComplete ? assignDraftKingsSlots(lineup.players || []) : { slotMap: {} };
    }, [lineup.players, lineup.slotMap, isComplete]);

    const ceiling = lineup.totalCeiling || lineup.tailEV || 0;

    const baseOffset = position * 65; 
    const zIndex = isCurrent ? 50 : 50 - Math.abs(position);
    
    // Dynamic transition calculation
    const progress = Math.min(Math.abs(currentDragOffset) / 300, 1);
    const isEnteringFromRight = currentDragOffset < 0 && position === 1;
    const isEnteringFromLeft = currentDragOffset > 0 && position === -1;
    
    let scale = isCurrent ? 1 : 0.88;
    let opacity = isCurrent ? 1 : 0.25;

    if (isEnteringFromRight || isEnteringFromLeft) {
      scale = 0.88 + (0.12 * progress);
      opacity = 0.25 + (0.75 * progress);
    } else if (isCurrent) {
      scale = 1 - (0.12 * progress);
      opacity = 1 - (0.75 * progress);
    }

    return (
      <div 
        onClick={() => { 
          if (!isCurrent && Math.abs(currentDragOffset) < 5) setActiveIndex(index); 
        }}
        className={`absolute inset-0 select-none ${isDragging ? 'transition-none' : 'transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]'}`}
        style={{
          transform: `translateX(calc(${baseOffset}% + ${currentDragOffset}px)) scale(${scale})`,
          opacity: opacity,
          zIndex: zIndex,
          cursor: isDragging ? 'grabbing' : 'grab'
        }}
      >
        <div className="bg-charcoal-card h-full rounded-[2.5rem] border border-gray-800 shadow-[0_35px_60px_-15px_rgba(0,0,0,0.6)] overflow-hidden flex flex-col p-6 md:p-10 relative group">
          <div className={`flex flex-col h-full ${!isCurrent || isDragging ? 'pointer-events-none' : ''}`}>
            
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="font-extrabold text-3xl uppercase text-gray-100 tracking-tight">
                  ROSTER #{String(index + 1).padStart(3, '0')}
                </h3>
                <div className="text-[10px] font-bold font-mono text-gray-500 uppercase tracking-widest mt-1 opacity-70">Roster_Node: {lineup.id}</div>
              </div>
              <div className="flex flex-col items-end gap-2">
                 <div className="flex gap-4 font-mono text-sm font-bold bg-black/40 px-4 py-1.5 rounded-xl border border-gray-800">
                    <span className="text-brand">{(lineup.simEV ?? lineup.totalProjection).toFixed(1)} <span className="text-[10px] opacity-60">MP</span></span>
                    <span className="text-gray-400">${(lineup.totalSalary/1000).toFixed(1)}k</span>
                 </div>
                 <div className="flex gap-1.5">
                    <SignalChip label={viability.label} color={viability.color} tooltip="Relative Value" />
                    <SignalChip label={alignment.label} color={alignment.color} tooltip="Field Alignment" />
                 </div>
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto no-scrollbar pb-4">
               <div className="bg-charcoal border border-gray-800 rounded-3xl overflow-hidden shadow-2xl">
                    {DK_NBA_HEADER.map((slot) => {
                      const p = slotMap[slot];
                      return (
                        <div 
                          key={slot} 
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            if (Math.abs(currentDragOffset) < 5) {
                              setSwapModal({ lineupId: lineup.id, slot, currentPlayerId: p?.id || '' }); 
                            }
                          }}
                          className="flex items-center justify-between p-2.5 px-6 border-b border-gray-800/40 last:border-0 text-[12px] hover:bg-brand/5 cursor-pointer group/row transition-colors font-mono pointer-events-auto"
                        >
                           <div className="flex items-center gap-6 overflow-hidden">
                              <span className="w-8 font-bold text-gray-600 uppercase text-[9px]">{slot}</span>
                              <span className={`truncate font-bold ${p ? 'text-gray-300' : 'text-gray-600 italic'} group-hover/row:text-brand`}>{p ? p.name.toUpperCase() : 'EMPTY'}</span>
                           </div>
                           <div className="flex gap-4 shrink-0">
                              <span className="text-gray-600 text-[10px] w-10 text-right uppercase">{p?.team || '—'}</span>
                              <span className="font-bold w-12 text-right text-brand/80 group-hover/row:text-brand">{p?.projection.toFixed(1) || '—'}</span>
                           </div>
                        </div>
                      );
                    })}
                </div>

                <div className="bg-charcoal/60 p-5 rounded-[1.5rem] border border-gray-800 shadow-xl space-y-4">
                    <div className="grid grid-cols-5 gap-2 text-center">
                       <div className="space-y-1">
                          <div className="text-[8px] font-bold text-gray-500 uppercase tracking-tight">Mean Proj</div>
                          <div className="text-xs font-extrabold text-white font-mono leading-none">{(lineup.simEV ?? lineup.totalProjection).toFixed(1)}</div>
                       </div>
                       <div className="space-y-1">
                          <div className="text-[8px] font-bold text-gray-500 uppercase tracking-tight">Ceiling</div>
                          <div className="text-xs font-extrabold text-brand font-mono leading-none">{ceiling.toFixed(1)}</div>
                       </div>
                       <div className="space-y-1">
                          <div className="text-[8px] font-bold text-gray-500 uppercase tracking-tight">Win %</div>
                          <div className="text-xs font-extrabold text-emerald-400 font-mono leading-none">{(lineup.winProbPct ?? 0).toFixed(2)}%</div>
                       </div>
                       <div className="space-y-1">
                          <div className="text-[8px] font-bold text-gray-500 uppercase tracking-tight">Total Own%</div>
                          <div className="text-xs font-extrabold text-gray-200 font-mono leading-none">{(lineup.totalOwnership ?? 0).toFixed(1)}%</div>
                       </div>
                       <div className="space-y-1">
                          <div className="text-[8px] font-bold text-gray-500 uppercase tracking-tight">GPP Equity</div>
                          <div className="text-xs font-extrabold text-gray-200 font-mono leading-none">{(lineup.top10Pct ?? 0).toFixed(1)}%</div>
                       </div>
                    </div>
                    <div className="h-[1px] bg-gray-800/50 w-full" />
                    <RiskIndicator lineup={lineup} />
                </div>
            </div>

            <div className="mt-auto pt-6 border-t border-gray-800/50 flex justify-end">
                <button 
                  className="flex items-center gap-3 px-8 py-3 bg-gray-900 hover:bg-gray-800 rounded-2xl text-[11px] font-bold text-gray-400 border border-gray-800 uppercase font-mono transition-all active:scale-95 shadow-lg pointer-events-auto" 
                  onClick={(e) => {
                    e.stopPropagation();
                    if (Math.abs(currentDragOffset) > 5) return;
                    const ids = lineup.playerIds.join(',');
                    navigator.clipboard.writeText(ids);
                    setCopiedId(lineup.id);
                    setTimeout(() => setCopiedId(null), 2000);
                  }}
                >
                   {copiedId === lineup.id ? <CheckCircle className="w-4 h-4 text-brand" /> : <Copy className="w-4 h-4" />}
                   {copiedId === lineup.id ? 'COPIED' : 'COPY_IDS'}
                </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col lg:flex-row gap-8 relative pb-32">
      <div className="flex-1 space-y-8">
        {contestState && (
          <ContestSummary 
            input={contestState.input} 
            derived={contestState.derived} 
            slateStats={slateStats}
            hasAutoLoadedReferencePack={hasAutoLoadedReferencePack}
            referencePackPath={referencePackPath}
            referenceMeta={referenceMeta}
            games={games}
          />
        )}
        
        <div className="flex justify-between items-center px-2">
           <div className="flex items-center gap-5">
              <h2 className="text-lg font-bold uppercase tracking-[0.2em] text-gray-500">Physics Tunnel</h2>
              <button 
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="flex items-center gap-2 px-5 py-2.5 bg-charcoal-card border border-gray-700 rounded-xl text-xs font-bold uppercase text-gray-400 hover:bg-gray-700 hover:text-white transition-all shadow-md"
              >
                <Settings className="w-4 h-4" />
                Control_Panel
              </button>
           </div>
           {modifiedLineups.length > 0 && (
              <div className="flex items-center gap-5 bg-charcoal p-1.5 rounded-2xl border border-gray-800">
                <div className="flex gap-1">
                  <button onClick={handlePrev} disabled={activeIndex === 0} className="p-2.5 bg-charcoal-card border border-gray-700 rounded-xl disabled:opacity-20 hover:bg-gray-700 transition-all text-gray-300 active:scale-95"><ChevronLeft className="w-5 h-5" /></button>
                  <div className="flex flex-col items-center justify-center px-4 min-w-[100px]">
                    <span className="font-mono text-xs font-bold text-gray-100">{activeIndex + 1} / {filteredLineups.length}</span>
                    <span className="text-[8px] font-bold text-gray-600 uppercase tracking-widest">Node Index</span>
                  </div>
                  <button onClick={handleNext} disabled={activeIndex === filteredLineups.length - 1} className="p-2.5 bg-charcoal-card border border-gray-700 rounded-xl disabled:opacity-20 hover:bg-gray-700 transition-all text-gray-300 active:scale-95"><ChevronRight className="w-5 h-5" /></button>
                </div>
                <div className="w-[1px] h-8 bg-gray-800" />
                <button 
                  onClick={exportCSV}
                  disabled={!canExport}
                  className={`flex items-center gap-3 px-8 py-3 rounded-xl text-xs font-extrabold uppercase shadow-xl transition-all active:scale-95 ${canExport ? 'bg-brand text-charcoal shadow-brand/20 hover:bg-brand-hover' : 'bg-gray-800 text-gray-600 cursor-not-allowed shadow-none'}`}
                >
                  <Download className="w-4 h-4" />
                  Export
                </button>
              </div>
           )}
        </div>

        {filteredLineups.length === 0 ? (
           <div className="bg-charcoal-card rounded-[3rem] p-32 text-center border-2 border-dashed border-gray-800">
              <div className="bg-brand/10 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-10 border border-brand/20">
                <Play className="w-12 h-12 text-brand" />
              </div>
              <h3 className="text-3xl font-extrabold mb-4 uppercase tracking-tight text-white">Field Test Your Lineup</h3>
              <p className="text-gray-500 mb-12 max-w-sm mx-auto text-lg leading-relaxed">Don't guess. Run your roster through the SlateSim Engine to see its true win probability against 20,000 simulated opponents.</p>
              {canRunSim ? (
                <label className="cursor-pointer bg-brand hover:bg-brand-hover text-charcoal px-14 py-6 rounded-[2rem] font-extrabold uppercase tracking-[0.2em] text-sm transition-all shadow-2xl inline-block active:scale-95">
                    RUN SIMULATION
                    <input type="file" className="hidden" accept=".csv" onChange={handleUpload} />
                </label>
              ) : (
                <p className="text-brand font-bold uppercase text-xs tracking-[0.3em] border border-brand/20 p-8 rounded-3xl bg-brand/5">
                   Access Restricted: Insufficient Entitlements.
                </p>
              )}
           </div>
        ) : (
          <div className="flex flex-col gap-10">
            <div className="bg-charcoal p-1.5 px-3 rounded-[2rem] flex gap-2 w-max mx-auto border border-gray-800 shadow-2xl">
              {uniqueSets.map(set => (
                <button key={set} onClick={() => setActiveSet(set)} className={`px-8 py-3 rounded-[1.5rem] text-[11px] font-bold uppercase transition-all tracking-widest ${activeSet === set ? 'bg-brand text-charcoal shadow-xl' : 'text-gray-500 hover:text-gray-300'}`}>{set}</button>
              ))}
            </div>

            <div 
              className="relative w-full h-[680px] md:h-[720px] overflow-hidden"
              onMouseDown={(e) => startDrag(e.clientX)}
              onMouseMove={(e) => moveDrag(e.clientX)}
              onMouseUp={endDrag}
              onMouseLeave={endDrag}
              onTouchStart={(e) => startDrag(e.touches[0].clientX)}
              onTouchMove={(e) => moveDrag(e.touches[0].clientX)}
              onTouchEnd={endDrag}
            >
              <div className="relative w-full max-w-3xl mx-auto h-full perspective-2000">
                {filteredLineups.map((l, i) => {
                  const pos = i - activeIndex;
                  if (Math.abs(pos) > 2) return null;
                  return (
                    <LineupCard 
                      key={l.id} 
                      lineup={l} 
                      index={i} 
                      isCurrent={i === activeIndex} 
                      position={pos}
                      currentDragOffset={dragOffset}
                    />
                  );
                })}
              </div>
            </div>
            
            {canRunSim && (
              <div className="flex justify-center -mt-4">
                <label className="text-[10px] font-bold uppercase text-gray-600 hover:text-brand cursor-pointer flex items-center gap-2 transition-colors tracking-[0.2em]">
                  <RefreshCw className="w-3.5 h-3.5" /> RE-INITIALIZE SIM_CORE
                  <input type="file" className="hidden" accept=".csv" onChange={handleUpload} />
                </label>
              </div>
            )}
          </div>
        )}
      </div>

      {isSidebarOpen && (
        <div className="w-full lg:w-[26rem] shrink-0">
          <div className="sticky top-24">
            <ContestForm 
              input={contestState?.input || DEFAULT_CONTEST} 
              onChange={onContestChange} 
              onClose={() => setIsSidebarOpen(false)}
            />
          </div>
        </div>
      )}

      {swapModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-xl animate-in fade-in duration-300">
          <div className="bg-charcoal-card w-full max-w-2xl rounded-[3rem] shadow-[0_50px_100px_-20px_rgba(0,0,0,1)] border border-gray-800 flex flex-col max-h-[85vh] overflow-hidden">
            <div className="p-10 border-b border-gray-800">
              <div className="flex justify-between items-start mb-8">
                 <div>
                   <h3 className="text-3xl font-extrabold uppercase tracking-tight text-white">Override Protocol</h3>
                   <p className="text-sm text-brand font-bold uppercase tracking-[0.2em] flex items-center gap-2 mt-2">
                     <Edit3 className="w-4 h-4" /> REPLACING {swapModal.slot}
                   </p>
                 </div>
                 <button onClick={() => setSwapModal(null)} className="p-3 hover:bg-white/5 rounded-full transition-colors text-gray-500 hover:text-white"><X className="w-7 h-7" /></button>
              </div>
              <div className="relative">
                <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-6 h-6 text-gray-600" />
                <input 
                  autoFocus
                  type="text" 
                  placeholder="Scan baseline identities..." 
                  value={playerSearch}
                  onChange={(e) => setPlayerSearch(e.target.value)}
                  className="w-full bg-charcoal border border-gray-800 rounded-[1.5rem] py-5 pl-16 pr-8 text-lg font-bold text-white placeholder:text-gray-700 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand transition-all font-mono"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 no-scrollbar divide-y divide-gray-800/50">
               {swapOptions.length === 0 ? (
                 <div className="p-24 text-center text-gray-700 font-mono uppercase tracking-[0.3em] text-xl italic">NO_DATA_MATCHED</div>
               ) : (
                 swapOptions.map(({ player, canAfford }) => (
                   <button 
                     key={player.id}
                     disabled={!canAfford}
                     onClick={() => confirmSwap(player)}
                     className={`w-full flex items-center justify-between p-6 transition-all rounded-[2rem] mb-3 ${canAfford ? 'hover:bg-brand/5 cursor-pointer' : 'opacity-20 grayscale cursor-not-allowed bg-black/20'}`}
                   >
                     <div className="flex items-center gap-6 text-left">
                        <div className="w-14 h-14 rounded-2xl bg-charcoal border border-gray-800 flex items-center justify-center font-bold text-gray-500 text-sm uppercase font-mono tracking-tighter">{player.team.slice(0,3)}</div>
                        <div>
                          <div className="font-extrabold text-xl uppercase tracking-tight text-gray-100">{player.name}</div>
                          <div className="text-[11px] text-gray-500 font-bold uppercase tracking-[0.2em] mt-1">{player.position} • {player.team}</div>
                        </div>
                     </div>
                     <div className="text-right font-mono">
                        <div className={`text-xl font-extrabold ${canAfford ? 'text-white' : 'text-red-500'}`}>
                          {/* Fix: Use Number() and any cast to resolve potential arithmetic issues with index signature types */}
                          ${(Number(player.salary as any)/1000).toFixed(1)}k
                        </div>
                        {/* Fix: Avoid arithmetic modulo on string by checking numeric projection directly instead of toFixed output */}
                        <div className="text-xs font-bold text-brand uppercase tracking-widest mt-1">{Number(player.projection as any) % 1 === 0 ? player.projection.toLocaleString() : player.projection.toFixed(1)} MP</div>
                     </div>
                   </button>
                 ))
               )}
            </div>

            <div className="p-10 bg-black/40 border-t border-gray-800 flex justify-between items-center">
               <div className="text-xs font-bold text-gray-600 uppercase tracking-[0.3em]">{swapOptions.length} NODE_CANDIDATES</div>
               <button onClick={() => setSwapModal(null)} className="px-10 py-4 bg-charcoal border border-gray-700 text-gray-400 rounded-2xl text-xs font-extrabold uppercase transition-all hover:bg-gray-800 hover:text-white tracking-widest">Abort Override</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};