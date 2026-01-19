
import React, { useState, useMemo } from 'react';
import { Player, ContestState } from '../types';
import { useAuth } from '../context/AuthContext';
import { 
  Search, 
  ArrowUp, 
  ArrowDown, 
  Upload, 
  X, 
  Scale, 
  Filter, 
  Columns, 
  Plus, 
  Trash2, 
  Check,
  ChevronDown,
  ShieldAlert,
  Activity,
  Box,
  Settings,
  PlusCircle
} from 'lucide-react';

interface FilterRule {
  id: string;
  column: string;
  operator: Operator;
  value: string;
  logic: 'AND' | 'OR';
}

type Operator = 'equals' | 'contains' | 'gt' | 'lt' | 'in';

const DEFAULT_COLS = ['Name', 'Salary', 'TeamAbbrev', 'Position', 'DK_FPTS_PROJ', 'OWN_MEAN', 'CEILING'];

const REGULAR_WHITELIST = [
  'Name',
  'Salary',
  'TeamAbbrev',
  'Position',
  'DK_FPTS_PROJ',
  'FLOOR',
  'CEILING',
  'OWN_MEAN'
];

// Added missing Props interface to fix compilation error
interface Props {
  players: Player[];
  referencePlayers?: Player[];
  beliefName?: string;
  onBeliefUpload: (files: File[]) => void;
  contestState?: ContestState;
}

export const ProjectionsView: React.FC<Props> = ({ players, referencePlayers, beliefName, onBeliefUpload }) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const allKeys = useMemo<string[]>(() => {
    const keys = new Set<string>();
    players.forEach(p => Object.keys(p).forEach(k => keys.add(k)));
    ['id', 'value', 'players'].forEach(k => keys.delete(k));
    if (!isAdmin) return REGULAR_WHITELIST.filter(key => keys.has(key));
    return Array.from(keys).sort((a, b) => a.localeCompare(b));
  }, [players, isAdmin]);

  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
    isAdmin ? new Set(DEFAULT_COLS) : new Set(REGULAR_WHITELIST)
  );
  const [showColumnManager, setShowColumnManager] = useState(false);
  const [showFilterBuilder, setShowFilterBuilder] = useState(false);
  const [filters, setFilters] = useState<FilterRule[]>([]);
  const [sortKey, setSortKey] = useState<string>('DK_FPTS_PROJ');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  const addFilter = () => {
    const newFilter: FilterRule = {
      id: Math.random().toString(36).substr(2, 9),
      column: allKeys[0] || 'Name',
      operator: 'contains',
      value: '',
      logic: 'AND'
    };
    setFilters([...filters, newFilter]);
  };

  const removeFilter = (id: string) => setFilters(filters.filter(f => f.id !== id));
  const updateFilter = (id: string, updates: Partial<FilterRule>) => {
    setFilters(filters.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  const processedPlayers = useMemo(() => {
    let result = [...players];
    if (filters.length > 0) {
      result = result.filter(player => {
        let match = true;
        filters.forEach((f: FilterRule, idx: number) => {
          if (!isAdmin && !REGULAR_WHITELIST.includes(f.column)) return;
          const rawVal = player[f.column];
          // Fixed potential unknown issues by ensuring string conversion before methods
          const playerVal = String(rawVal ?? '').toLowerCase();
          const filterVal = String(f.value).toLowerCase();
          let currentMatch = false;
          const nPlayerVal = parseFloat(playerVal);
          const nFilterVal = parseFloat(filterVal);
          switch (f.operator) {
            case 'equals': currentMatch = playerVal === filterVal; break;
            case 'contains': currentMatch = playerVal.indexOf(filterVal) !== -1; break;
            case 'gt': currentMatch = !isNaN(nPlayerVal) && !isNaN(nFilterVal) && nPlayerVal > nFilterVal; break;
            case 'lt': currentMatch = !isNaN(nPlayerVal) && !isNaN(nFilterVal) && nPlayerVal < nFilterVal; break;
            case 'in': currentMatch = filterVal.split(',').map(s => s.trim().toLowerCase()).includes(playerVal); break;
          }
          if (idx === 0) match = currentMatch;
          else {
            if (f.logic === 'AND') match = match && currentMatch;
            else match = match || currentMatch;
          }
        });
        return match;
      });
    }
    result.sort((a, b) => {
      const valA = a[sortKey];
      const valB = b[sortKey];
      const nA = typeof valA === 'number' ? valA : parseFloat(String(valA ?? '0'));
      const nB = typeof valB === 'number' ? valB : parseFloat(String(valB ?? '0'));
      if (!isNaN(nA) && !isNaN(nB)) return sortDir === 'asc' ? nA - nB : nB - nA;
      
      // Fix: Ensure comparison values are strings to resolve "Argument of type 'unknown' is not assignable to parameter of type 'string'"
      const sA = String(valA ?? '');
      const sB = String(valB ?? '');
      return sortDir === 'asc' ? sA.localeCompare(sB) : sB.localeCompare(sA);
    });
    return result;
  }, [players, filters, sortKey, sortDir, isAdmin]);

  const formatValue = (val: any) => {
    if (val === undefined || val === null) return '--';
    if (typeof val === 'number') return val % 1 === 0 ? val.toLocaleString() : val.toFixed(2);
    const num = parseFloat(val);
    if (!isNaN(num) && String(num) === String(val).trim().replace(/,/g, '')) return num % 1 === 0 ? num.toLocaleString() : num.toFixed(2);
    return String(val);
  };

  const handleHeaderClick = (key: string) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const columnsToRender = useMemo(() => Array.from(visibleColumns).filter(col => isAdmin || REGULAR_WHITELIST.includes(col)), [visibleColumns, isAdmin]);

  const getColLabel = (key: string) => {
    const map: Record<string, string> = {
      'DK_FPTS_PROJ': 'Mean Proj',
      'OWN_MEAN': 'Own%',
      'CEILING': 'Ceiling',
      'FLOOR': 'Floor',
      'TeamAbbrev': 'Team',
      'Position': 'Pos',
      'Name': 'Player'
    };
    return map[key] || key.replace(/_/g, ' ');
  };

  const toggleColumn = (col: string) => {
    const next = new Set(visibleColumns);
    if (next.has(col)) {
      if (next.size > 1) next.delete(col);
    } else {
      next.add(col);
    }
    setVisibleColumns(next);
  };

  return (
    <div className="flex flex-col h-full space-y-4 pb-24 relative selection:bg-brand selection:text-charcoal">
      {/* Filter Builder Modal */}
      {showFilterBuilder && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-charcoal-card w-full max-w-2xl rounded-2xl border border-gray-800 shadow-2xl flex flex-col max-h-[80vh]">
            <div className="p-6 border-b border-gray-800 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Filter className="w-5 h-5 text-brand" />
                <h3 className="text-xl font-bold uppercase tracking-tight">Active Filters</h3>
              </div>
              <button onClick={() => setShowFilterBuilder(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors"><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4 no-scrollbar">
              {filters.length === 0 ? (
                <div className="text-center py-10 text-gray-600 font-medium uppercase tracking-widest text-sm">No filters active</div>
              ) : (
                filters.map((f, i) => (
                  <div key={f.id} className="flex flex-wrap items-center gap-3 p-4 bg-black/20 rounded-xl border border-gray-800">
                    {i > 0 && (
                      <select 
                        value={f.logic} 
                        onChange={(e) => updateFilter(f.id, { logic: e.target.value as 'AND' | 'OR' })}
                        className="bg-charcoal border border-gray-700 rounded px-2 py-1 text-[10px] font-bold text-brand uppercase"
                      >
                        <option value="AND">AND</option>
                        <option value="OR">OR</option>
                      </select>
                    )}
                    <select 
                      value={f.column} 
                      onChange={(e) => updateFilter(f.id, { column: e.target.value })}
                      className="flex-1 min-w-[120px] bg-charcoal border border-gray-700 rounded px-3 py-2 text-xs font-bold text-gray-300 outline-none focus:border-brand"
                    >
                      {allKeys.map(k => <option key={k} value={k}>{getColLabel(k)}</option>)}
                    </select>
                    <select 
                      value={f.operator} 
                      onChange={(e) => updateFilter(f.id, { operator: e.target.value as Operator })}
                      className="bg-charcoal border border-gray-700 rounded px-3 py-2 text-xs font-bold text-gray-300 outline-none focus:border-brand"
                    >
                      <option value="contains">Contains</option>
                      <option value="equals">Equals</option>
                      <option value="gt">Greater Than</option>
                      <option value="lt">Less Than</option>
                      <option value="in">In (comma separated)</option>
                    </select>
                    <input 
                      type="text" 
                      value={f.value} 
                      onChange={(e) => updateFilter(f.id, { value: e.target.value })}
                      placeholder="Value..."
                      className="flex-1 min-w-[120px] bg-charcoal border border-gray-700 rounded px-3 py-2 text-xs font-bold text-white outline-none focus:border-brand placeholder:text-gray-700"
                    />
                    <button onClick={() => removeFilter(f.id)} className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))
              )}
              <button 
                onClick={addFilter}
                className="w-full py-4 border-2 border-dashed border-gray-800 rounded-xl flex items-center justify-center gap-2 text-gray-500 hover:text-brand hover:border-brand/50 transition-all font-bold uppercase text-xs"
              >
                <PlusCircle className="w-4 h-4" /> Add Rule
              </button>
            </div>
            <div className="p-6 border-t border-gray-800 flex justify-end">
              <button onClick={() => setShowFilterBuilder(false)} className="px-8 py-3 bg-brand text-charcoal font-bold rounded-xl uppercase tracking-widest text-xs hover:bg-brand-hover transition-all">Apply Filters</button>
            </div>
          </div>
        </div>
      )}

      {/* Column Manager Modal */}
      {showColumnManager && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-charcoal-card w-full max-w-xl rounded-2xl border border-gray-800 shadow-2xl flex flex-col max-h-[80vh]">
            <div className="p-6 border-b border-gray-800 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Columns className="w-5 h-5 text-brand" />
                <h3 className="text-xl font-bold uppercase tracking-tight">Display Columns</h3>
              </div>
              <button onClick={() => setShowColumnManager(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors"><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 no-scrollbar">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {allKeys.map(k => (
                  <button 
                    key={k} 
                    onClick={() => toggleColumn(k)}
                    className={`flex items-center justify-between p-3 rounded-xl border transition-all text-left ${visibleColumns.has(k) ? 'bg-brand/10 border-brand text-brand font-bold' : 'bg-black/20 border-gray-800 text-gray-500 hover:border-gray-700'}`}
                  >
                    <span className="text-xs uppercase truncate">{getColLabel(k)}</span>
                    {visibleColumns.has(k) && <Check className="w-3.5 h-3.5" />}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-6 border-t border-gray-800 flex justify-end">
              <button onClick={() => setShowColumnManager(false)} className="px-8 py-3 bg-brand text-charcoal font-bold rounded-xl uppercase tracking-widest text-xs hover:bg-brand-hover transition-all">Close</button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-charcoal-card p-4 rounded-xl border border-gray-800 sticky top-0 z-30 shadow-2xl space-y-4">
        <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-brand/10 p-2 rounded-lg"><Scale className="w-5 h-5 text-brand" /></div>
            <div>
              <h2 className="text-lg font-bold uppercase tracking-tight leading-none">Projection Terminal</h2>
              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-1 font-mono">DataSet: {beliefName || 'Market Consensus'}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <button onClick={() => setShowFilterBuilder(true)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] font-bold uppercase transition-all border ${filters.length > 0 ? 'bg-brand text-charcoal border-brand shadow-lg shadow-brand/20' : 'bg-charcoal border-gray-700 text-gray-400 hover:bg-gray-800'}`}><Filter className="w-3.5 h-3.5" /> Filter {filters.length > 0 && `(${filters.length})`}</button>
            {isAdmin && <button onClick={() => setShowColumnManager(true)} className="flex items-center gap-2 px-3 py-2 bg-charcoal border border-gray-700 text-gray-400 rounded-lg text-[10px] font-bold uppercase hover:bg-gray-800"><Columns className="w-3.5 h-3.5" /> Columns</button>}
            <label className="cursor-pointer flex items-center gap-2 px-3 py-2 bg-brand/10 border border-brand/20 text-brand rounded-lg text-[10px] font-bold uppercase hover:bg-brand/20 transition-all font-mono"><Upload className="w-3.5 h-3.5" /> Import Proj<input type="file" className="hidden" accept=".csv" onChange={(e) => e.target.files && onBeliefUpload(Array.from(e.target.files))} /></label>
          </div>
        </div>
      </div>

      <div className="bg-charcoal-card rounded-xl shadow-sm border border-gray-800 overflow-hidden flex-1 flex flex-col">
        <div className="overflow-auto flex-1 no-scrollbar font-mono">
          <table className="w-full text-left text-[11px] border-collapse min-w-max uppercase">
            <thead className="bg-black/40 text-gray-500 font-bold tracking-widest sticky top-0 z-20">
              <tr>
                {columnsToRender.map((key: string) => (
                  <th key={key} onClick={() => handleHeaderClick(key)} className="p-4 cursor-pointer hover:text-brand transition-colors whitespace-nowrap group border-b border-gray-800">
                    <div className="flex items-center gap-2">
                      {getColLabel(key)}
                      <div className={`opacity-0 group-hover:opacity-100 transition-opacity ${sortKey === key ? 'opacity-100 text-brand' : ''}`}>
                        {sortKey === key ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ChevronDown className="w-3 h-3" />}
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {processedPlayers.map(p => (
                <tr key={p.id} onClick={() => setSelectedPlayerId(p.id === selectedPlayerId ? null : p.id)} className={`cursor-pointer transition-colors group ${selectedPlayerId === p.id ? 'bg-brand/5' : 'hover:bg-white/5'}`}>
                  {columnsToRender.map((key: string) => (
                    <td key={key} className={`p-4 border-r border-gray-800/30 last:border-0 ${key.toLowerCase() === 'name' ? 'font-bold text-gray-200' : 'text-gray-400'} ${key.toLowerCase().includes('proj') || key.toLowerCase().includes('ceiling') ? 'text-brand font-bold' : ''}`}>
                      {key.toLowerCase() === 'salary' ? `$${formatValue(p[key])}` : formatValue(p[key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-3 bg-black/40 border-t border-gray-800 flex justify-between items-center text-[10px] font-bold text-gray-600 uppercase tracking-widest font-mono">
           <span>Total Players: {processedPlayers.length}</span>
           <span className="flex items-center gap-2">Sorting: {getColLabel(sortKey)} [{sortDir}]</span>
        </div>
      </div>
    </div>
  );
};
