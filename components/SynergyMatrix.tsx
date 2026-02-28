import React, { useState, useMemo, useEffect } from 'react';
import { Player } from '../types';
import { Link2, Users, TrendingUp, TrendingDown } from 'lucide-react';
import { PlayerSearchInput } from './PlayerSearchInput';

interface Props {
  players: Player[];
}

export const SynergyMatrix: React.FC<Props> = ({ players }) => {
  const [p1Id, setP1Id] = useState<string>('');
  const [p2Id, setP2Id] = useState<string>('');

  const p1 = useMemo(() => players.find(p => p.id === p1Id), [players, p1Id]);
  const p2 = useMemo(() => players.find(p => p.id === p2Id), [players, p2Id]);
  const p2Options = useMemo(() => {
    if (!p1) return players.slice(0, 50);
    return players.filter(p => p.team === p1.team && p.id !== p1.id);
  }, [players, p1]);

  const p1Options = useMemo(() => {
    if (!p2) return players.slice(0, 50);
    return players.filter(p => p.team === p2.team && p.id !== p2.id);
  }, [players, p2]);

  useEffect(() => {
    if (p1 && p2 && p1.team !== p2.team) {
      setP2Id('');
    }
  }, [p1, p2]);

  const synergy = useMemo(() => {
    if (!p1 || !p2) return null;
    
    // Mock correlation and combined stats
    const correlation = (Math.random() * 0.8 - 0.2).toFixed(2);
    const combinedProj = (p1.projection + p2.projection).toFixed(1);
    const combinedSalary = p1.salary + p2.salary;
    const combinedValue = ((parseFloat(combinedProj) / combinedSalary) * 1000).toFixed(2);
    
    return {
      correlation: parseFloat(correlation),
      combinedProj,
      combinedSalary,
      combinedValue,
      isPositive: parseFloat(correlation) > 0
    };
  }, [p1, p2]);

  const canReset = Boolean(p1Id || p2Id);
  const reset = () => {
    setP1Id('');
    setP2Id('');
  };

  return (
    <div className="bg-white/40 rounded-sm border border-ink/10 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-drafting-orange" />
          <h3 className="text-xs font-black uppercase tracking-widest text-ink/60">Synergy Matrix</h3>
        </div>
        <button
          type="button"
          onClick={reset}
          disabled={!canReset}
          className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-sm border transition-colors ${
            canReset
              ? 'border-ink/20 text-ink/60 hover:border-drafting-orange hover:text-drafting-orange'
              : 'border-ink/10 text-ink/30 cursor-not-allowed'
          }`}
        >
          Reset
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="space-y-1">
          <label className="text-[9px] font-black text-ink/40 uppercase tracking-widest">Player One</label>
          <PlayerSearchInput 
            players={p1Options}
            selectedPlayerId={p1Id}
            onSelect={(p) => setP1Id(p.id)}
            onClear={() => setP1Id('')}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[9px] font-black text-ink/40 uppercase tracking-widest">Player Two</label>
          <PlayerSearchInput 
            players={p2Options}
            selectedPlayerId={p2Id}
            onSelect={(p) => setP2Id(p.id)}
            onClear={() => setP2Id('')}
          />
        </div>
      </div>

      {synergy ? (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-center justify-between p-3 bg-white/40 rounded-sm border border-ink/10">
            <div className="flex flex-col">
              <span className="text-[10px] font-black text-ink/60 uppercase tracking-widest">Correlation</span>
              <div className="flex items-center gap-2">
                <span className={`text-lg font-black font-mono ${synergy.isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
                  {synergy.correlation > 0 ? '+' : ''}{synergy.correlation}
                </span>
                {synergy.isPositive ? <TrendingUp className="w-4 h-4 text-emerald-600" /> : <TrendingDown className="w-4 h-4 text-red-600" />}
              </div>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-black text-ink/60 uppercase tracking-widest">Combined Proj</span>
              <div className="text-lg font-black font-mono text-drafting-orange">{synergy.combinedProj}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-2 bg-ink/5 rounded-sm border border-ink/10">
              <span className="text-[9px] font-black text-ink/40 uppercase block mb-1">Total Salary</span>
              <span className="text-xs font-bold font-mono text-ink/60">${synergy.combinedSalary.toLocaleString()}</span>
            </div>
            <div className="p-2 bg-ink/5 rounded-sm border border-ink/10">
              <span className="text-[9px] font-black text-ink/40 uppercase block mb-1">Combined Value</span>
              <span className="text-xs font-bold font-mono text-drafting-orange">{synergy.combinedValue}x</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="h-32 flex flex-col items-center justify-center border border-dashed border-ink/20 rounded-sm bg-ink/5">
          <Users className="w-6 h-6 text-ink/40 mb-2" />
          <p className="text-[10px] font-bold text-ink/40 uppercase tracking-widest">Select two players to analyze</p>
        </div>
      )}
    </div>
  );
};
