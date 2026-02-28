import React, { useState, useMemo } from 'react';
import { Player } from '../types';
import { X, Search } from 'lucide-react';

interface Props {
  players: Player[];
  position: string;
  remainingSalary: number;
  onSelect: (player: Player) => void;
  onClose: () => void;
}

export const PlayerSelectionModal: React.FC<Props> = ({ players, position, remainingSalary, onSelect, onClose }) => {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<'name' | 'salary' | 'projection'>('projection');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const filteredPlayers = useMemo(() => {
    const result = players.filter(p =>
      p.position.includes(position) &&
      p.salary <= remainingSalary &&
      p.name.toLowerCase().includes(search.toLowerCase())
    );
    const compareValues = (a: any, b: any) => {
      const nA = Number(a);
      const nB = Number(b);
      if (Number.isFinite(nA) && Number.isFinite(nB)) return nA - nB;
      return String(a ?? '').localeCompare(String(b ?? ''));
    };
    return [...result].sort((a, b) => {
      const valA = sortKey === 'name' ? a.name : sortKey === 'salary' ? a.salary : a.projection;
      const valB = sortKey === 'name' ? b.name : sortKey === 'salary' ? b.salary : b.projection;
      const cmp = compareValues(valA, valB);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [players, position, remainingSalary, search, sortKey, sortDir]);

  const handleSort = (key: 'name' | 'salary' | 'projection') => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sortIndicator = (key: 'name' | 'salary' | 'projection') =>
    sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-vellum/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-vellum border border-ink/10 rounded-sm w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col shadow-2xl">
        <div className="p-4 border-b border-ink/10 flex justify-between items-center bg-white/40">
          <div>
            <h3 className="text-sm font-black uppercase tracking-widest text-ink/60">Select Player for {position}</h3>
            <p className="text-[10px] text-ink/40 font-bold uppercase tracking-widest mt-1 font-mono">Remaining Salary: ${remainingSalary.toLocaleString()}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-ink/5 rounded-full transition-colors text-ink/40 hover:text-ink">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/40" />
            <input 
              type="text"
              placeholder="Search players..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-white/60 border border-ink/20 rounded-sm pl-10 pr-4 py-2 text-xs font-bold text-ink focus:border-drafting-orange outline-none transition-all placeholder:text-ink/30 uppercase tracking-widest"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto no-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-white/80 z-10 border-b border-ink/10">
              <tr className="text-[9px] font-black text-ink/40 uppercase tracking-widest">
                <th className="px-4 py-3 cursor-pointer select-none" onClick={() => handleSort('name')}>
                  Player{sortIndicator('name')}
                </th>
                <th className="px-4 py-3 text-right cursor-pointer select-none" onClick={() => handleSort('salary')}>
                  Salary{sortIndicator('salary')}
                </th>
                <th className="px-4 py-3 text-right cursor-pointer select-none" onClick={() => handleSort('projection')}>
                  Projection{sortIndicator('projection')}
                </th>
              </tr>
            </thead>
            <tbody className="text-[10px] font-mono">
              {filteredPlayers.map(player => (
                <tr key={player.id} onClick={() => onSelect(player)} className="border-b border-ink/5 hover:bg-white/40 transition-colors cursor-pointer">
                  <td className="px-4 py-3">
                    <div className="font-bold text-ink uppercase">{player.name}</div>
                    <div className="text-ink/60">{player.team} - {player.position}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-ink/60">${player.salary.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-black text-drafting-orange">{player.projection.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
