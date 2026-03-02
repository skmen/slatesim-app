import React, { useState, useMemo, useRef, useEffect } from 'react';
import Papa from 'papaparse';
import { Upload, Lock, Unlock, Download, Zap, ShieldCheck, ShieldAlert, X } from 'lucide-react';
import { Player, GameInfo, Lineup } from '../types';
import { PlayerDeepDive } from './PlayerDeepDive';

type Slot = 'PG' | 'SG' | 'SF' | 'PF' | 'C' | 'G' | 'F' | 'UTIL';

const SLOT_ORDER: Slot[] = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'];
const REQUIRED_COLS = ['Entry ID', 'Contest Name', 'Contest ID', 'Entry Fee', ...SLOT_ORDER];
const SALARY_CAP = 50000;

export type Entry = {
  entryId: string;
  contestName: string;
  contestId: string;
  entryFee: string;
  slots: Record<Slot, string>;
  projectedPoints?: number;
  currentPoints?: number;
  remainingSalary?: number;
};

const parseGameTime = (timeStr: string): Date | null => {
  if (!timeStr) return null;
  const now = new Date();
  const timePart = timeStr.match(/(\d{1,2}:\d{2})\s*(AM|PM)/i);
  if (!timePart) return null;

  let [_, time, modifier] = timePart;
  let [hours, minutes] = time.split(':').map(Number);

  if (modifier.toUpperCase() === 'PM' && hours < 12) hours += 12;
  if (modifier.toUpperCase() === 'AM' && hours === 12) hours = 0;

  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
};

const formatPlayerName = (name: string) => {
    const parts = name.split(' ');
    if (parts.length < 2) return name;
    return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

export const DKEntryManager: React.FC<Props> = ({ players, games, showActuals = false }) => {
  const [entries, setEntries] = useState<Entry[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{ entryIdx: number; slot: Slot } | null>(null);
  const [showCandidates, setShowCandidates] = useState(false);
  const [deepDivePlayer, setDeepDivePlayer] = useState<Player | null>(null);
  const [manualLocks, setManualLocks] = useState<Set<string>>(new Set());
  const [playerScores, setPlayerScores] = useState<Record<string, number>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const playerRefs = useRef<Record<string, HTMLDivElement>>({});

  const gameStartedCache = useMemo(() => {
    const cache = new Map<string, boolean>();
    const now = new Date();
    games.forEach((game) => {
      const gameTime = parseGameTime(game.gameTime);
      const started = gameTime ? now >= gameTime : false;
      cache.set(game.teamA.abbreviation, started);
      cache.set(game.teamB.abbreviation, started);
    });
    return cache;
  }, [games]);

  const playerMap = useMemo(() => {
    const map = new Map<string, Player>();
    players.forEach(p => {
      map.set(p.id, p);
      map.set(`${p.name} (${p.id})`, p);
    });
    return map;
  }, [players]);

  const getPlayerFromString = (playerStr: string): Player | undefined => playerMap.get(playerStr);

  const isGameStarted = (teamAbbr: string): boolean => !!gameStartedCache.get(teamAbbr.toUpperCase());

  const isGameManuallyLocked = (game: GameInfo): boolean =>
    manualLocks.has(game.teamA.abbreviation) || manualLocks.has(game.teamB.abbreviation);

  const isPlayerLocked = (playerString: string): boolean => {
    const player = getPlayerFromString(playerString);
    if (!player) return false;
    if (isGameStarted(player.team)) return true;
    
    const game = games.find(g => g.teamA.abbreviation === player.team || g.teamB.abbreviation === player.team);
    return game ? isGameManuallyLocked(game) : false;
  };
  
  const handleCsv = (file: File) => {
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: (result) => {
        const rows = result.data as string[][];
        const newEntries: Entry[] = [];
        const newPlayerScores: Record<string, number> = {};

        rows.forEach((row) => {
          if (row[0] && row[2]) { // Entry row
            const slots: Record<Slot, string> = {
              PG: row[4] || '', SG: row[5] || '', SF: row[6] || '', PF: row[7] || '',
              C: row[8] || '', G: row[9] || '', F: row[10] || '', UTIL: row[11] || '',
            };
            const salary = SLOT_ORDER.reduce((sum, s) => sum + (getPlayerFromString(slots[s])?.salary || 0), 0);
            newEntries.push({
              entryId: row[0],
              contestName: row[1],
              contestId: row[2],
              entryFee: row[3],
              slots,
              remainingSalary: SALARY_CAP - salary,
            });
          } else if (!row[0] && !row[2] && row[14]) { // Player score row
            const playerId = row[15];
            const score = parseFloat(row[21]);
            if (playerId && !isNaN(score)) {
              newPlayerScores[playerId] = score;
            }
          }
        });
        
        setPlayerScores(newPlayerScores);

        const updatedEntries = newEntries.map(entry => {
          let currentPoints = 0;
          let projectedPoints = 0;
          SLOT_ORDER.forEach(slot => {
            const player = getPlayerFromString(entry.slots[slot]);
            if (player) {
              const score = newPlayerScores[player.id] || player.projection || 0;
              if (isPlayerLocked(entry.slots[slot])) {
                currentPoints += score;
              }
              projectedPoints += score;
            }
          });
          return { ...entry, currentPoints, projectedPoints };
        });

        setEntries(updatedEntries);
      },
      error: (err) => {
        console.error('CSV parse error', err);
        alert('Failed to parse DKEntries.csv');
      },
    });
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleCsv(file);
  };

  const downloadCsv = () => {
    if (!entries.length) return;
    const rows = entries.map((en) => {
      const row: Record<string, string> = { 'Entry ID': en.entryId, 'Contest Name': en.contestName, 'Contest ID': en.contestId, 'Entry Fee': en.entryFee };
      SLOT_ORDER.forEach((s) => { row[s] = en.slots[s] || ''; });
      return row;
    });
    const csv = Papa.unparse(rows, { columns: REQUIRED_COLS });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'DKEntries-updated.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const openSwapModal = (entryIdx: number, slot: Slot) => {
    const current = entries[entryIdx]?.slots[slot] || '';
    if (current && isPlayerLocked(current)) return;
    setSelectedSlot({ entryIdx, slot });
    setShowCandidates(true);
  };

  const applySwap = (playerName: string) => {
    if (!selectedSlot) return;
    setEntries((prev) =>
      prev.map((en, idx) => {
        if (idx !== selectedSlot.entryIdx) return en;
        const newSlots = { ...en.slots, [selectedSlot.slot]: playerName };
        let currentPoints = 0;
        let projectedPoints = 0;
        let salary = 0;
        SLOT_ORDER.forEach(slot => {
            const player = getPlayerFromString(newSlots[slot]);
            if(player) {
                salary += player.salary;
                const score = playerScores[player.id] || player.projection || 0;
                if (isPlayerLocked(newSlots[slot])) {
                    currentPoints += score;
                }
                projectedPoints += score;
            }
        });
        return { ...en, slots: newSlots, projectedPoints, currentPoints, remainingSalary: SALARY_CAP - salary };
      })
    );
    setShowCandidates(false);
  };
  
  const candidatePlayers = useMemo(() => {
    if (!selectedSlot) return [];
    const positions: string[] = (() => {
      switch (selectedSlot.slot) {
        case 'G': return ['PG', 'SG'];
        case 'F': return ['SF', 'PF'];
        case 'UTIL': return ['PG', 'SG', 'SF', 'PF', 'C'];
        default: return [selectedSlot.slot];
      }
    })();
    return players
      .filter(p => p.position && positions.some(pos => p.position.includes(pos)))
      .sort((a,b) => b.salary - a.salary);
  }, [selectedSlot, players]);

  useEffect(() => {
    if (showCandidates && selectedSlot && scrollContainerRef.current) {
      const remainingSalary = entries[selectedSlot.entryIdx].remainingSalary || 0;
      const playerOut = getPlayerFromString(entries[selectedSlot.entryIdx].slots[selectedSlot.slot]);
      const budget = remainingSalary + (playerOut?.salary || 0);
      const bestFit = candidatePlayers.find(p => p.salary <= budget) || candidatePlayers[0];
      const container = scrollContainerRef.current;
      const targetEl = bestFit ? playerRefs.current[bestFit.id] : null;
      if (targetEl && container) {
        const offset = targetEl.offsetTop - container.offsetTop;
        container.scrollTo({ top: offset, behavior: 'smooth' });
      }
    }
  }, [showCandidates, selectedSlot, candidatePlayers, entries]);

  const currentLineupSalary = useMemo(() => {
    if (!selectedSlot) return 0;
    const entry = entries[selectedSlot.entryIdx];
    return SLOT_ORDER.reduce((sum, s) => sum + (getPlayerFromString(entry.slots[s])?.salary || 0), 0);
  }, [selectedSlot, entries, playerMap]);

  const toggleManualLock = (game: GameInfo) => {
    setManualLocks(prev => {
        const next = new Set(prev);
        const isLocked = isGameManuallyLocked(game);
        [game.teamA.abbreviation, game.teamB.abbreviation].forEach(abbr => {
            if(isLocked) next.delete(abbr);
            else next.add(abbr);
        });
        return next;
    });
  }

  const runLateSwap = () => {
    // Placeholder: integrate with backend optimizer; avoid bundling worker in this component
    alert('Late Swap optimizer not available in this build. Wire this to your backend API.');
  };

  return (
    <div className="flex flex-col h-full space-y-6 pb-24 bg-vellum text-black">
      {/* Top Header */}
      <div className="flex-shrink-0 bg-white border-b border-ink/10 p-4 flex items-center justify-between shadow-sm rounded-b-lg">
        <div>
          <h1 className="text-xl font-black uppercase tracking-wider text-black">Late Swap Manager</h1>
          <p className="text-sm text-black/60">{entries.length} Entries Loaded</p>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={runLateSwap} className="px-5 py-2 rounded-lg bg-drafting-orange text-white font-bold text-sm uppercase tracking-widest shadow hover:brightness-110 transition-all">
            <Zap className="inline-block w-4 h-4 mr-2"/>
            Run Late Swap
          </button>
          <button onClick={downloadCsv} className="px-4 py-2 rounded-lg bg-white border border-ink/20 text-black font-bold text-sm uppercase tracking-widest hover:border-drafting-orange transition-all">
            <Download className="inline-block w-4 h-4 mr-2"/>
            Export CSV
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel: Slate Controls */}
        <div className="w-[18%] flex-shrink-0 bg-white border-r border-ink/10 p-4 overflow-y-auto rounded-lg shadow-sm">
          <h2 className="text-lg font-bold uppercase tracking-wider text-black mb-4">Slate Controls</h2>
          <div className="space-y-3">
              {games.map(game => {
                  const isLive = isGameStarted(game.teamA.abbreviation) || isGameStarted(game.teamB.abbreviation);
                  const isUpcoming = !isLive;
                  const manuallyLocked = isGameManuallyLocked(game);

                  return (
                      <div key={game.matchupKey} className="bg-vellum p-3 rounded-lg border border-ink/10">
                          <div className="flex items-center justify-between">
                            <div>
                                <span className={`px-2 py-1 rounded-full text-xs font-bold uppercase ${isLive ? 'bg-red-100 text-red-700' : 'bg-emerald-600 text-white'}`}>
                                    {isLive ? 'Live' : 'Upcoming'}
                                </span>
                                <p className="text-sm font-bold text-black mt-1">{game.teamA.abbreviation} vs {game.teamB.abbreviation}</p>
                                <p className="text-xs text-black/60">{game.gameTime}</p>
                            </div>
                            {isUpcoming && (
                                <button onClick={() => toggleManualLock(game)} className={`p-2 rounded-full transition-colors ${manuallyLocked ? 'bg-blue-100 text-blue-700' : 'bg-white border border-ink/10 text-black hover:border-drafting-orange'}`}>
                                    {manuallyLocked ? <Lock className="w-5 h-5"/> : <Unlock className="w-5 h-5"/>}
                                </button>
                            )}
                          </div>
                      </div>
                  )
              })}
          </div>
        </div>

        {/* Right Panel: Entry Inspector */}
        <div className="flex-1 p-4 overflow-y-auto">
            {entries.length === 0 ? (
                <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="h-full flex items-center justify-center border-4 border-dashed border-ink/20 rounded-xl text-black/50 hover:border-drafting-orange hover:text-black transition-all cursor-pointer bg-white"
                >
                    <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={onFileChange} />
                    <div className="text-center">
                        <Upload className="w-12 h-12 mx-auto mb-2 text-drafting-orange"/>
                        <h3 className="text-lg font-bold uppercase text-black">Load Entries CSV</h3>
                        <p className="text-black/60">Drop a file or click here to get started.</p>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    {entries.map((entry, idx) => (
                        <div key={entry.entryId} className="bg-white rounded-xl border border-ink/10 shadow-sm">
                            <div className="p-3 border-b border-ink/10 flex justify-between items-center">
                                <div>
                                    <p className="text-sm font-bold text-black truncate">{entry.contestName}</p>
                                    <p className="text-xs text-black/60 font-mono">
                                      Current: {entry.currentPoints?.toFixed(2)} | Proj: {entry.projectedPoints?.toFixed(2)} | Rem. Salary: ${entry.remainingSalary?.toLocaleString()}
                                    </p>
                                </div>
                                <div className="text-[11px] text-black/60 font-mono"></div>
                            </div>
                            <div className="p-3 space-y-2">
                                {SLOT_ORDER.map(slot => {
                                    const playerStr = entry.slots[slot];
                                    const player = getPlayerFromString(playerStr);
                                    const locked = isPlayerLocked(playerStr);
                                    const proj = player ? (playerScores[player.id] || player.projection || 0) : 0;
                                    const salaryK = player ? `$${(player.salary / 1000).toFixed(1)}k` : '$0.0k';
                                    return (
                                        <div
                                          key={slot}
                                          onClick={() => !locked && openSwapModal(idx, slot)}
                                          className={`flex items-center justify-between rounded border px-2 py-2 ${locked ? 'bg-ink/5 border-ink/10' : 'bg-vellum border-ink/10 hover:border-drafting-orange cursor-pointer'}`}
                                        >
                                          <div className="flex items-center gap-3 w-full">
                                            <span className="text-[10px] font-black uppercase text-black/60 min-w-[28px]">{slot}</span>
                                            {player ? (
                                              <div className="flex items-center w-full gap-3">
                                                <span className={`text-sm font-bold text-black truncate ${locked ? 'opacity-70' : ''}`}>{formatPlayerName(player.name)}</span>
                                                <span className="text-sm text-black/70 font-mono whitespace-nowrap">{salaryK}</span>
                                                <span className="text-sm text-black/70 font-mono ml-auto whitespace-nowrap">{locked ? 'Current' : 'Proj'}: {proj.toFixed(2)}</span>
                                              </div>
                                            ) : (
                                              <span className="text-black/40 text-sm font-mono flex-1">Empty</span>
                                            )}
                                          </div>
                                          {locked && iconLocked}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
      </div>

      {showCandidates && selectedSlot && (
        <div className="fixed inset-0 z-[120] bg-vellum/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div ref={scrollContainerRef} className="bg-vellum rounded-xl border border-ink/10 w-full max-w-3xl max-h-[80vh] overflow-hidden shadow-2xl flex flex-col">
            <div className="p-4 border-b border-ink/10 flex items-center justify-between flex-shrink-0">
                <div>
                    <h3 className="text-lg font-black uppercase tracking-wider text-drafting-orange">Swap {selectedSlot.slot}</h3>
                    <p className="text-sm text-black/70 font-mono">Remaining Salary: ${(SALARY_CAP - currentLineupSalary).toLocaleString()}</p>
                </div>
              <button onClick={() => setShowCandidates(false)} className="p-2 text-black/50 hover:text-black transition-colors rounded-full"><X className="w-5 h-5"/></button>
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-ink/10">
              {candidatePlayers.map((p) => {
                const locked = isPlayerLocked(`${p.name} (${p.id})`);
                const playerOut = getPlayerFromString(entries[selectedSlot.entryIdx].slots[selectedSlot.slot]);
                const salaryAfterSwap = currentLineupSalary - (playerOut?.salary || 0) + p.salary;
                const canAfford = salaryAfterSwap <= SALARY_CAP;
                
                return (
                  <div key={p.id} ref={el => playerRefs.current[p.id] = el!} className="flex items-center justify-between px-4 py-3 hover:bg-white">
                    <div>
                      <button className="text-lg font-black text-black text-left hover:underline" onClick={() => setDeepDivePlayer(p)}>
                        {p.name}
                      </button>
                      <span className="text-sm text-black/60 ml-3 font-mono">
                        {p.team} - {p.position} - ${p.salary?.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      {locked ? <ShieldAlert className="w-5 h-5 text-red-600"/> : <ShieldCheck className="w-5 h-5 text-emerald-600"/>}
                      <button
                        className="px-4 py-2 rounded bg-drafting-orange text-white text-xs font-bold uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition-colors"
                        disabled={locked || !canAfford}
                        onClick={() => applySwap(`${p.name} (${p.id})`)}
                      >
                        Swap In
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {deepDivePlayer && (
        <PlayerDeepDive player={deepDivePlayer} players={players} games={games} onClose={() => setDeepDivePlayer(null)} isHistorical={false} showActuals={showActuals} depthCharts={undefined} injuryLookup={undefined} startingLineupLookup={undefined}/>
      )}
    </div>
  );
};

export default DKEntryManager;
