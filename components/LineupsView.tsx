import React, { useState, useMemo } from 'react';
import { Player, Lineup, ContestState, SlateStats, GameInfo, ContestInput } from '../types';
import { 
  Trophy, 
  Users, 
  Zap, 
  Upload, 
  Search, 
  AlertCircle,
  ShieldCheck,
  TrendingUp,
  Filter,
  ArrowRight,
  Target
} from 'lucide-react';
import { formatMoney, formatPct, getContestViability } from '../utils/contest';

interface Props {
  lineups: Lineup[];
  playerPool: Player[];
  contestState: ContestState;
  onLineupUpload: (files: File[]) => void;
  onContestChange: (input: ContestInput) => void;
  hasAutoLoadedReferencePack?: boolean;
  referencePackPath?: string;
  referenceMeta?: any;
  slateStats?: SlateStats;
  games?: GameInfo[];
}

export const LineupsView: React.FC<Props> = ({ 
  lineups, 
  contestState, 
  onLineupUpload,
  slateStats,
  games
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filteredLineups = useMemo(() => {
    return lineups.filter(l => {
      if (!searchTerm) return true;
      const playersStr = l.players?.map(p => p.name).join(' ') || '';
      return playersStr.toLowerCase().includes(searchTerm.toLowerCase());
    });
  }, [lineups, searchTerm]);

  const stats = useMemo(() => {
    if (lineups.length === 0) return null;
    const avgEV = lineups.reduce((acc, l) => acc + (l.simEV || 0), 0) / lineups.length;
    const avgROI = lineups.reduce((acc, l) => acc + (l.simROI || 0), 0) / lineups.length;
    return { avgEV, avgROI };
  }, [lineups]);

  return (
    <div className="flex flex-col h-full space-y-6 pb-24 selection:bg-brand selection:text-charcoal">
      {/* Top Header Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-charcoal-card p-4 rounded-xl border border-gray-800 flex items-center gap-4">
          <div className="bg-brand/10 p-2.5 rounded-lg text-brand"><Trophy className="w-5 h-5" /></div>
          <div>
            <div className="text-[10px] font-black text-gray-500 uppercase tracking-widest leading-none mb-1">Portfolio Proj</div>
            <div className="text-xl font-black text-white italic font-mono">
              {stats ? stats.avgEV.toFixed(1) : '--'}
            </div>
          </div>
        </div>
        <div className="bg-charcoal-card p-4 rounded-xl border border-gray-800 flex items-center gap-4">
          <div className="bg-emerald-500/10 p-2.5 rounded-lg text-emerald-400"><TrendingUp className="w-5 h-5" /></div>
          <div>
            <div className="text-[10px] font-black text-gray-500 uppercase tracking-widest leading-none mb-1">Expected ROI</div>
            <div className="text-xl font-black text-emerald-400 italic font-mono">
              {stats ? formatPct(stats.avgROI / 100) : '--'}
            </div>
          </div>
        </div>
        <div className="bg-charcoal-card p-4 rounded-xl border border-gray-800 flex items-center gap-4">
          <div className="bg-red-500/10 p-2.5 rounded-lg text-red-400"><Users className="w-5 h-5" /></div>
          <div>
            <div className="text-[10px] font-black text-gray-500 uppercase tracking-widest leading-none mb-1">Field Size</div>
            <div className="text-xl font-black text-white italic font-mono">{contestState.input.fieldSize.toLocaleString()}</div>
          </div>
        </div>
        <div className="bg-charcoal-card p-4 rounded-xl border border-gray-800 flex items-center gap-4">
          <div className="bg-blue-500/10 p-2.5 rounded-lg text-blue-400"><Zap className="w-5 h-5" /></div>
          <div>
            <div className="text-[10px] font-black text-gray-500 uppercase tracking-widest leading-none mb-1">Portfolio Size</div>
            <div className="text-xl font-black text-white italic font-mono">{lineups.length}</div>
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Main List */}
        <div className="flex-1 space-y-4">
          <div className="bg-charcoal-card p-4 rounded-xl border border-gray-800 flex flex-col sm:flex-row gap-4 justify-between items-center sticky top-0 z-10 backdrop-blur-md bg-opacity-90">
             <div className="relative flex-1 w-full">
               <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
               <input 
                 type="text" 
                 placeholder="SEARCH ROSTERS BY PLAYER..."
                 value={searchTerm}
                 onChange={(e) => setSearchTerm(e.target.value)}
                 className="w-full bg-black/40 border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-xs font-bold uppercase tracking-tight text-white focus:border-brand outline-none transition-all placeholder:text-gray-700"
               />
             </div>
             <div className="flex gap-2 w-full sm:w-auto">
               <label className="flex-1 sm:flex-initial cursor-pointer flex items-center justify-center gap-2 px-4 py-2 bg-brand text-charcoal rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-brand-hover transition-all">
                 <Upload className="w-3.5 h-3.5" /> Import Optimizer CSV
                 <input type="file" className="hidden" accept=".csv" onChange={(e) => e.target.files && onLineupUpload(Array.from(e.target.files))} />
               </label>
             </div>
          </div>

          <div className="space-y-3">
            {filteredLineups.length === 0 ? (
              <div className="bg-charcoal-card p-12 rounded-xl border border-dashed border-gray-800 text-center space-y-4">
                <Users className="w-12 h-12 text-gray-700 mx-auto" />
                <p className="text-gray-500 font-bold uppercase tracking-widest text-sm">Roster Pool Empty</p>
                <p className="text-xs text-gray-600 max-w-xs mx-auto leading-relaxed">Upload an optimizer CSV or BELIEFS JSON to begin simulation analysis.</p>
              </div>
            ) : (
              filteredLineups.map((l, idx) => {
                const viability = getContestViability(l);
                const isSelected = selectedId === l.id;
                
                return (
                  <div 
                    key={l.id} 
                    onClick={() => setSelectedId(isSelected ? null : l.id)}
                    className={`bg-charcoal-card rounded-xl border transition-all cursor-pointer overflow-hidden ${isSelected ? 'border-brand ring-1 ring-brand ring-opacity-50' : 'border-gray-800 hover:border-gray-700'}`}
                  >
                    <div className="p-4 flex flex-wrap items-center gap-6">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-black/40 flex items-center justify-center text-[10px] font-black text-gray-500 border border-gray-800">#{idx + 1}</div>
                        <div>
                          <div className="text-[10px] font-black text-gray-500 uppercase tracking-widest leading-none mb-1">{l.id}</div>
                          <div className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border inline-block ${
                            viability.color === 'emerald' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                            viability.color === 'amber' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                            'bg-red-500/10 text-red-400 border-red-500/20'
                          }`}>
                            {viability.label}
                          </div>
                        </div>
                      </div>

                      <div className="flex-1 min-w-[200px]">
                        <div className="flex flex-wrap gap-1.5">
                          {l.players?.map(p => (
                            <span key={p.id} className="text-[10px] font-bold text-gray-300 bg-black/20 px-2 py-0.5 rounded-md border border-gray-800">
                              {p.name.split(' ').pop()}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="flex gap-8 items-center font-mono">
                         <div>
                           <div className="text-[9px] font-black text-gray-600 uppercase">EV</div>
                           <div className="text-sm font-black text-white italic">{l.simEV?.toFixed(1) || '--'}</div>
                         </div>
                         <div>
                           <div className="text-[9px] font-black text-gray-600 uppercase">ROI</div>
                           <div className="text-sm font-black text-emerald-400 italic">{formatPct((l.simROI || 0) / 100)}</div>
                         </div>
                         <div>
                           <div className="text-[9px] font-black text-gray-600 uppercase">OWN</div>
                           <div className="text-sm font-black text-gray-400">{l.totalOwnership?.toFixed(0)}%</div>
                         </div>
                      </div>
                    </div>

                    {isSelected && l.players && (
                      <div className="border-t border-gray-800 bg-black/20 p-4 animate-in slide-in-from-top-2 duration-200">
                        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                          {l.players.map(p => (
                            <div key={p.id} className="bg-charcoal p-2.5 rounded-lg border border-gray-800 space-y-1">
                              <div className="text-[9px] font-black text-brand uppercase leading-none">{p.position}</div>
                              <div className="text-[11px] font-black text-white truncate uppercase">{p.name.split(' ').pop()}</div>
                              <div className="text-[10px] font-bold text-gray-500 leading-none">${(p.salary/1000).toFixed(1)}K</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="w-full lg:w-80 space-y-6">
          <section className="bg-charcoal-card p-5 rounded-2xl border border-gray-800 space-y-4">
             <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-500 flex items-center gap-2">
               <Target className="w-4 h-4 text-brand" /> Context Engine
             </h3>
             <div className="space-y-4">
                <div className="p-3 bg-black/40 rounded-xl border border-gray-800">
                  <div className="text-[10px] font-black text-gray-600 uppercase mb-1">Prize Pool</div>
                  <div className="text-lg font-black text-white italic">{formatMoney(contestState.derived.prizePool)}</div>
                </div>
                <div className="p-3 bg-black/40 rounded-xl border border-gray-800">
                  <div className="text-[10px] font-black text-gray-600 uppercase mb-1">Entries / Field</div>
                  <div className="text-lg font-black text-white italic">{lineups.length} / {contestState.input.fieldSize.toLocaleString()}</div>
                </div>
                <div className="pt-2">
                   <p className="text-[10px] text-gray-500 font-medium leading-relaxed italic uppercase">
                     * ROI and EV are computed by Monte Carlo simulation (N=50k) against the detected field of {contestState.input.fieldSize.toLocaleString()} entries.
                   </p>
                </div>
             </div>
          </section>

          <section className="bg-charcoal-card p-5 rounded-2xl border border-gray-800 space-y-4">
             <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-500 flex items-center gap-2">
               <ShieldCheck className="w-4 h-4 text-emerald-400" /> Integrity Log
             </h3>
             <div className="space-y-3 font-mono text-[10px]">
                {slateStats?.warnings.map((w, i) => (
                  <div key={i} className="flex gap-2 text-amber-500/80 leading-tight">
                    <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                    <span className="uppercase font-bold tracking-tighter">{w}</span>
                  </div>
                ))}
                <div className="text-gray-600 pt-2 border-t border-gray-800">
                  SESSION_ID: {Math.random().toString(36).substring(7).toUpperCase()}
                </div>
                <div className="text-gray-600">
                  LAST_TICK: {new Date().toLocaleTimeString()}
                </div>
             </div>
          </section>
        </div>
      </div>
    </div>
  );
};