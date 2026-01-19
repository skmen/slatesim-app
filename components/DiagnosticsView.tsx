
import React from 'react';
import { AppState } from '../types';
import { Activity, ShieldCheck, Target, TrendingUp, Info, AlertTriangle, BarChart2, Cpu } from 'lucide-react';
import { getContestViability, getFieldAlignment, getUpsideQuality, formatPct } from '../utils/contest';

interface Props {
  state: AppState;
}

const BellCurveChart: React.FC<{ userPercentile: number }> = ({ userPercentile }) => {
  const userX = 50 + (userPercentile - 50) * 4; 
  
  return (
    <div className="relative h-48 w-full bg-black/20 rounded-xl border border-gray-800 overflow-hidden p-4">
      <div className="absolute top-4 left-6">
        <h4 className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Field Outcome Distribution</h4>
      </div>
      <svg className="w-full h-full" viewBox="0 0 400 120" preserveAspectRatio="none">
        {/* The Bell Curve (Field) */}
        <path 
          d="M 0 110 Q 50 110 100 80 T 200 10 T 300 80 Q 350 110 400 110" 
          fill="none" 
          stroke="#475569" 
          strokeWidth="2" 
        />
        <path 
          d="M 0 110 Q 50 110 100 80 T 200 10 T 300 80 Q 350 110 400 110 L 400 120 L 0 120 Z" 
          fill="rgba(71, 85, 105, 0.1)" 
        />
        
        {/* Labels for X-Axis logic */}
        <text x="50" y="118" fill="#475569" fontSize="6" fontWeight="900" textAnchor="middle" className="uppercase">Floor</text>
        <text x="200" y="118" fill="#475569" fontSize="6" fontWeight="900" textAnchor="middle" className="uppercase">Field Avg</text>
        <text x="350" y="118" fill="#475569" fontSize="6" fontWeight="900" textAnchor="middle" className="uppercase">Ceiling</text>

        {/* User Lineup Indicator */}
        <line 
          x1={userX} 
          y1="0" 
          x2={userX} 
          y2="110" 
          stroke="#00E5FF" 
          strokeWidth="2" 
          className="animate-pulse"
        />
        <circle cx={userX} cy="55" r="4" fill="#00E5FF" />
      </svg>
      <div className="absolute bottom-4 right-6 text-right">
        <div className="text-[10px] font-black text-brand uppercase tracking-tighter italic">Your Lineup Rank</div>
        <div className="text-3xl font-black text-white italic font-mono">{userPercentile.toFixed(0)}th <span className="text-sm">Percentile</span></div>
      </div>
    </div>
  );
};

export const DiagnosticsView: React.FC<Props> = ({ state }) => {
  const { lineups, contestState } = state;
  const completeLineups = lineups.filter(l => !l.missingCount || l.missingCount === 0);
  
  const avgMeanProj = completeLineups.length > 0 
    ? completeLineups.reduce((acc, l) => acc + (l.simEV || l.totalProjection), 0) / completeLineups.length 
    : 0;

  const STRONG_PROTOCOL_PERCENTILE = 94; 

  const getNarrative = () => {
    if (completeLineups.length === 0) return "Standby: No simulation data found. Upload rosters to begin leverage analysis.";
    
    const strongCount = completeLineups.filter(l => getContestViability(l).label === 'High Value').length;
    const overAlignedCount = completeLineups.filter(l => getFieldAlignment(l).label === 'Chalky').length;
    
    const viabilityPct = (strongCount / completeLineups.length) * 100;
    
    return viabilityPct > 50 
      ? `Portfolio Health: Strong. ${completeLineups.length} lineups verified above average GPP equity.`
      : `Portfolio Alert: High chalk detected across core rosters. Recommend diversifying player pool.`;
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-24 animate-in fade-in slide-in-from-bottom-2 selection:bg-brand selection:text-charcoal">
      <header className="flex items-center gap-3">
         <Cpu className="w-8 h-8 text-brand" />
         <div>
            <h2 className="text-2xl font-black uppercase italic">Field Leverage Analysis</h2>
            <p className="text-sm text-gray-500 font-mono tracking-tighter uppercase font-bold">{completeLineups.length} Active Rosters</p>
         </div>
      </header>

      <BellCurveChart userPercentile={STRONG_PROTOCOL_PERCENTILE} />

      <section className="bg-brand/5 p-6 rounded-xl border border-brand/20 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 opacity-5 rotate-12">
            <Cpu className="w-24 h-24" />
        </div>
        <h3 className="text-xs font-black text-brand uppercase tracking-widest mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4" /> Slate Analytics Feed
        </h3>
        <p className="text-lg font-bold leading-relaxed text-white">
          {getNarrative()}
        </p>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="p-5 rounded-xl bg-charcoal-card border border-gray-800">
          <div className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">Portfolio Proj</div>
          <div className="text-2xl font-black font-mono text-white italic">{avgMeanProj.toFixed(1)} <span className="text-xs">PTS</span></div>
          <div className="text-[10px] text-gray-500 mt-2 font-bold uppercase">Average Projected Score</div>
        </div>
        <div className="p-5 rounded-xl bg-charcoal-card border border-gray-800">
          <div className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">Chalk Concentration</div>
          <div className="text-2xl font-black font-mono text-red-400 italic">
            {formatPct(completeLineups.length > 0 ? completeLineups.filter(l => getFieldAlignment(l).label === 'Chalky').length / completeLineups.length : 0, 0)}
          </div>
          <div className="text-[10px] text-gray-500 mt-2 font-bold uppercase">High Ownership Risk</div>
        </div>
        <div className="p-5 rounded-xl bg-charcoal-card border border-gray-800">
          <div className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">Top Tier Upside</div>
          <div className="text-2xl font-black font-mono text-brand italic">
            {formatPct(completeLineups.length > 0 ? completeLineups.filter(l => getUpsideQuality(l).label === 'High Ceiling').length / completeLineups.length : 0, 0)}
          </div>
          <div className="text-[10px] text-gray-500 mt-2 font-bold uppercase">Clean Ceiling Projections</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <section className="bg-charcoal-card p-6 rounded-xl border border-gray-800 space-y-4">
           <h3 className="font-black text-sm uppercase tracking-widest text-gray-500 flex items-center gap-2">
             <Target className="w-4 h-4" /> Contest Scope
           </h3>
           {contestState ? (
              <div className="space-y-4 text-sm text-gray-400 font-mono">
                <p>
                  Simulation Scope: <span className="text-white font-black">{contestState.input.fieldSize.toLocaleString()} Simulated Opponents</span>.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-black/20 p-3 rounded-lg border border-gray-800">
                    <div className="text-[9px] font-black text-gray-600 uppercase">Field Rake</div>
                    <div className="text-sm font-black text-red-500/80">{formatPct(contestState.derived.rakePct)}</div>
                  </div>
                  <div className="bg-black/20 p-3 rounded-lg border border-gray-800">
                    <div className="text-[9px] font-black text-gray-600 uppercase">Paid Places</div>
                    <div className="text-sm font-black text-emerald-500/80">{contestState.derived.estimatedPaidPlaces.toLocaleString()}</div>
                  </div>
                </div>
                <p className="italic text-[10px] leading-tight text-gray-600 font-sans uppercase font-bold">
                  Field Avg assumes standard distribution. Leverage calculation based on ownership delta.
                </p>
              </div>
           ) : (
              <div className="p-8 text-center text-gray-600 italic font-mono uppercase tracking-tighter">NO_CONTEXT</div>
           )}
        </section>

        <section className="bg-amber-500/5 p-6 rounded-xl border border-amber-500/20 space-y-4">
           <h3 className="font-black text-sm uppercase tracking-widest text-amber-500 flex items-center gap-2 italic">
             <AlertTriangle className="w-4 h-4" /> Strategic Alerts
           </h3>
           <div className="text-sm leading-relaxed text-amber-200/80 font-bold uppercase tracking-tight italic">
             {contestState && contestState.input.fieldSize > 5000 ? (
               <p>
                 GPP Warning: Large field size detected. Prioritize Ceiling over Mean Proj. Minimize player overlap in FLEX positions to avoid shared outcomes.
               </p>
             ) : (
               <p>
                 Small Slate Warning: Variance is high. Focus on safe floors for cash games or high leverage pivots for tournaments.
               </p>
             )}
           </div>
           <div className="pt-4 border-t border-amber-500/10 flex items-center gap-2">
              <Info className="w-4 h-4 text-amber-500" />
              <span className="text-[10px] text-amber-500/60 font-black uppercase tracking-widest font-mono">Last Computed: {new Date().toLocaleTimeString()}</span>
           </div>
        </section>
      </div>
    </div>
  );
};
