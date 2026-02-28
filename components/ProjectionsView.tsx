
import React, { useState, useMemo } from 'react';
import { Player, ContestState } from '../types';
import { useAuth } from '../context/AuthContext';
import { useLineup } from '../context/LineupContext';
import { 
  Search, 
  ArrowUp, 
  ArrowDown, 
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

const normalizeKeyToken = (key: string): string => String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const findKeyMatch = (obj: Record<string, any>, key: string): string | undefined => {
  const target = String(key || '');
  const exact = Object.keys(obj).find((k) => k.toLowerCase() === target.toLowerCase());
  if (exact) return exact;
  const targetNorm = normalizeKeyToken(target);
  return Object.keys(obj).find((k) => normalizeKeyToken(k) === targetNorm);
};

// Added missing Props interface to fix compilation error
interface Props {
  players: Player[];
  referencePlayers?: Player[];
  beliefName?: string;
  onBeliefUpload: (files: File[]) => void;
  contestState?: ContestState;
  isHistorical: boolean;
  showActuals: boolean;
}

export const ProjectionsView: React.FC<Props> = ({ players, referencePlayers, beliefName, onBeliefUpload, isHistorical, showActuals }) => {
  const { user } = useAuth();
  const { addPlayer, isPlayerInLineup } = useLineup();
  const isAdmin = user?.role === 'admin';

  const getValueForKey = (player: Player, key: string): any => {
    const base = player as any;
    const aliases: Record<string, any> = {
      Name: player.name,
      Salary: player.salary,
      TeamAbbrev: player.team,
      Position: player.position,
      DK_FPTS_PROJ: player.projection,
      OWN_MEAN: player.ownership,
      CEILING: player.ceiling,
      FLOOR: player.floor,
    };
    if (key in aliases) return aliases[key];
    const match = findKeyMatch(base, key);
    return match ? base[match] : undefined;
  };

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
      const valA = getValueForKey(a, sortKey);
      const valB = getValueForKey(b, sortKey);
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
    // FIX: The error "Argument of type 'unknown' is not assignable to parameter of type 'string'" is likely from this line. Coercing `val` to a string before passing to `parseFloat`.
    const num = parseFloat(String(val));
    if (!isNaN(num) && String(num) === String(val).trim().replace(/,/g, '')) return num % 1 === 0 ? num.toLocaleString() : num.toFixed(2);
    return String(val);
  };

  const handleHeaderClick = (key: string) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const columnsToRender = useMemo(
    () =>
      Array.from(visibleColumns).filter((col) => {
        if (!showActuals && col.toLowerCase().includes('actual')) return false;
        return isAdmin || REGULAR_WHITELIST.includes(col as string);
      }),
    [visibleColumns, isAdmin, showActuals]
  );

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
    <div className="flex flex-col h-full space-y-4 pb-24 relative selection:bg-highlight selection:text-main">
      {/* Filter Builder Modal */}
      {showFilterBuilder && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-vellum/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-2xl rounded-sm border border-ink/10 shadow-2xl flex flex-col max-h-[80vh]">
            <div className="p-6 border-b border-ink/10 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Filter className="w-5 h-5 text-drafting-orange" />
                <h3 className="text-xl font-bold uppercase tracking-tight text-ink">Active Filters</h3>
              </div>
              <button onClick={() => setShowFilterBuilder(false)} className="p-2 hover:bg-ink/5 rounded-full transition-colors"><X className="w-5 h-5 text-ink/40" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4 no-scrollbar bg-vellum/30">
              {filters.length === 0 ? (
                <div className="text-center py-10 text-ink/40 font-medium uppercase tracking-widest text-sm">No filters active</div>
              ) : (
                filters.map((f, i) => (
                  <div key={f.id} className="flex flex-wrap items-center gap-3 p-4 bg-white rounded-sm border border-ink/10">
                    {i > 0 && (
                      <select 
                        value={f.logic} 
                        onChange={(e) => updateFilter(f.id, { logic: e.target.value as 'AND' | 'OR' })}
                        className="bg-vellum border border-ink/20 rounded px-2 py-1 text-[10px] font-bold text-drafting-orange uppercase"
                      >
                        <option value="AND">AND</option>
                        <option value="OR">OR</option>
                      </select>
                    )}
                    <select 
                      value={f.column} 
                      onChange={(e) => updateFilter(f.id, { column: e.target.value })}
                      className="flex-1 min-w-[120px] bg-vellum border border-ink/20 rounded px-3 py-2 text-xs font-bold text-ink outline-none focus:border-drafting-orange"
                    >
                      {allKeys.map(k => <option key={k} value={k}>{getColLabel(k)}</option>)}
                    </select>
                    <select 
                      value={f.operator} 
                      onChange={(e) => updateFilter(f.id, { operator: e.target.value as Operator })}
                      className="bg-vellum border border-ink/20 rounded px-3 py-2 text-xs font-bold text-ink outline-none focus:border-drafting-orange"
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
                      className="flex-1 min-w-[120px] bg-vellum border border-ink/20 rounded px-3 py-2 text-xs font-bold text-ink outline-none focus:border-drafting-orange placeholder:text-ink/30"
                    />
                    <button onClick={() => removeFilter(f.id)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))
              )}
              <button 
                onClick={addFilter}
                className="w-full py-4 border-2 border-dashed border-ink/20 rounded-sm flex items-center justify-center gap-2 text-ink/40 hover:text-drafting-orange hover:border-drafting-orange/50 transition-all font-bold uppercase text-xs"
              >
                <PlusCircle className="w-4 h-4" /> Add Rule
              </button>
            </div>
            <div className="p-6 border-t border-ink/10 flex justify-end">
              <button onClick={() => setShowFilterBuilder(false)} className="px-8 py-3 bg-drafting-orange text-white font-bold rounded-sm uppercase tracking-widest text-xs hover:opacity-90 transition-all">Apply Filters</button>
            </div>
          </div>
        </div>
      )}

      {/* Column Manager Modal */}
      {showColumnManager && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-vellum/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-xl rounded-sm border border-ink/10 shadow-2xl flex flex-col max-h-[80vh]">
            <div className="p-6 border-b border-ink/10 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Columns className="w-5 h-5 text-drafting-orange" />
                <h3 className="text-xl font-bold uppercase tracking-tight text-ink">Display Columns</h3>
              </div>
              <button onClick={() => setShowColumnManager(false)} className="p-2 hover:bg-ink/5 rounded-full transition-colors"><X className="w-5 h-5 text-ink/40" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 no-scrollbar bg-vellum/30">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {allKeys.map(k => (
                  <button 
                    key={k} 
                    onClick={() => toggleColumn(k)}
                    className={`flex items-center justify-between p-3 rounded-sm border transition-all text-left ${visibleColumns.has(k) ? 'bg-drafting-orange/10 border-drafting-orange text-drafting-orange font-bold' : 'bg-white border-ink/10 text-ink/60 hover:border-ink/40'}`}
                  >
                    <span className="text-xs uppercase truncate">{getColLabel(k)}</span>
                    {visibleColumns.has(k) && <Check className="w-3.5 h-3.5" />}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-6 border-t border-ink/10 flex justify-end">
              <button onClick={() => setShowColumnManager(false)} className="px-8 py-3 bg-drafting-orange text-white font-bold rounded-sm uppercase tracking-widest text-xs hover:opacity-90 transition-all">Close</button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white/80 backdrop-blur-md p-4 rounded-sm border border-ink/10 sticky top-0 z-30 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-drafting-orange/10 p-2 rounded-sm"><Scale className="w-5 h-5 text-drafting-orange" /></div>
            <div>
              <h2 className="text-lg font-bold uppercase tracking-tight leading-none text-ink">Projection Center</h2>
              <p className="text-[10px] text-ink/60 font-bold uppercase tracking-widest mt-1 font-mono">DataSet: {beliefName || 'Market Consensus'}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <button onClick={() => setShowFilterBuilder(true)} className={`flex items-center gap-2 px-3 py-2 rounded-sm text-[10px] font-bold uppercase transition-all border ${filters.length > 0 ? 'bg-drafting-orange text-white border-drafting-orange shadow-lg' : 'bg-white border-ink/20 text-ink/60 hover:bg-ink/5'}`}><Filter className="w-3.5 h-3.5" /> Filter {filters.length > 0 && `(${filters.length})`}</button>
            {isAdmin && <button onClick={() => setShowColumnManager(true)} className="flex items-center gap-2 px-3 py-2 bg-white border border-ink/20 text-ink/60 rounded-sm text-[10px] font-bold uppercase hover:bg-ink/5"><Columns className="w-3.5 h-3.5" /> Columns</button>}
          </div>
        </div>
      </div>

      <div className="bg-white/40 rounded-sm shadow-sm border border-ink/10 overflow-hidden flex-1 flex flex-col">
        <div className="overflow-auto flex-1 no-scrollbar font-mono">
          <table className="w-full text-left text-[11px] border-collapse min-w-max uppercase">
            <thead className="bg-blueprint/10 text-blueprint font-bold tracking-widest sticky top-0 z-20 backdrop-blur-sm">
              <tr>
                <th className="p-4 w-10 border-b border-ink/10"></th>
                {columnsToRender.map((key: string) => (
                  <th key={key} onClick={() => handleHeaderClick(key)} className="p-4 cursor-pointer hover:text-drafting-orange transition-colors whitespace-nowrap group border-b border-ink/10">
                    <div className="flex items-center gap-2">
                      {getColLabel(key)}
                      <div className={`opacity-0 group-hover:opacity-100 transition-opacity ${sortKey === key ? 'opacity-100 text-drafting-orange' : ''}`}>
                        {sortKey === key ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ChevronDown className="w-3 h-3" />}
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {processedPlayers.map(p => {
                const value = (p.projection / p.salary) * 1000;
                const inLineup = isPlayerInLineup(p.id);
                
                return (
                  <tr key={p.id} onClick={() => setSelectedPlayerId(p.id === selectedPlayerId ? null : p.id)} className={`cursor-pointer transition-colors group ${selectedPlayerId === p.id ? 'bg-drafting-orange/5' : 'hover:bg-white/40'}`}>
                    <td className="p-4 border-r border-ink/5">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!inLineup) addPlayer(p);
                        }}
                        className={`p-1 rounded transition-all ${inLineup ? 'text-emerald-600 bg-emerald-600/10' : 'text-drafting-orange hover:bg-drafting-orange/10'}`}
                      >
                        {inLineup ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                      </button>
                    </td>
                    {columnsToRender.map((key: string) => {
                      const isName = key.toLowerCase() === 'name';
                      const isActualCol = key.toLowerCase().includes('actual');
                      const isProj = key.toLowerCase().includes('proj') || key.toLowerCase().includes('ceiling') || (isHistorical && showActuals && isActualCol);
                      const isSalary = key.toLowerCase() === 'salary';
                      
                      let cellColor = isName ? 'text-ink' : 'text-ink/60';
                      if (isProj) cellColor = 'text-ink/40';
                      
                      const val = getValueForKey(p, key);
                      if (typeof val === 'number' && !isSalary && !isProj) {
                        if (key.toLowerCase().includes('plus_minus') || key.toLowerCase().includes('value')) {
                           if (val > 5.5) cellColor = 'text-emerald-600';
                           else if (val < 4.0) cellColor = 'text-red-600';
                        }
                      }

                      return (
                        <td key={key} className={`p-4 border-r border-ink/5 last:border-0 ${isName ? 'font-bold' : ''} ${cellColor} ${isProj ? 'font-black' : ''}`}>
                          {isHistorical && showActuals && key.toLowerCase() === 'dk_fpts_proj' ? (
                            <div className="flex flex-col">
                              <span className="text-emerald-600 font-bold">{formatValue(p.actual)}</span>
                              <span className="text-ink/40 text-[9px]">({formatValue(p.DK_FPTS_PROJ)})</span>
                            </div>
                          ) : isSalary ? `$${formatValue(p[key])}` : formatValue(p[key])}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="p-3 bg-blueprint/5 border-t border-ink/10 flex justify-between items-center text-[10px] font-bold text-ink/40 uppercase tracking-widest font-mono">
           <span>Total Players: {processedPlayers.length}</span>
           <span className="flex items-center gap-2">Sorting: {getColLabel(sortKey)} [{sortDir}]</span>
        </div>
      </div>
    </div>
  );
};
