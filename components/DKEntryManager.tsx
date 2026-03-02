import React, { useState, useMemo, useRef } from 'react';
import Papa from 'papaparse';
import { Upload, Lock, Unlock, Download, SlidersHorizontal } from 'lucide-react';
import { Player, GameInfo } from '../types';
import { PlayerDeepDive } from './PlayerDeepDive';

/**
 * DraftKings Entry Manager
 * - Parse DKEntries.csv (first 12 cols)
 * - Batch apply optimizer lineups
 * - Inline edit slots
 * - Late swap marking + placeholder optimizer trigger
 * - Export back to DK upload format
 */

type Slot = 'PG' | 'SG' | 'SF' | 'PF' | 'C' | 'G' | 'F' | 'UTIL';

const SLOT_ORDER: Slot[] = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'];
const REQUIRED_COLS = ['Entry ID', 'Contest Name', 'Contest ID', 'Entry Fee', ...SLOT_ORDER];

export type Entry = {
  entryId: string;
  contestName: string;
  contestId: string;
  entryFee: string;
  slots: Record<Slot, string>;
};

const iconLocked = <Lock className="w-4 h-4 text-red-500 inline ml-1" />;
const iconUnlocked = <Unlock className="w-4 h-4 text-emerald-600 inline ml-1" />;

type Props = {
  players: Player[];
  games: GameInfo[];
  showActuals?: boolean;
};

export const DKEntryManager: React.FC<Props> = ({ players, games, showActuals = false }) => {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [lockedTeams, setLockedTeams] = useState<string[]>([]);
  const [lateSwapMode, setLateSwapMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{ entryIdx: number; slot: Slot } | null>(null);
  const [showCandidates, setShowCandidates] = useState(false);
  const [deepDivePlayer, setDeepDivePlayer] = useState<Player | null>(null);

  // -------- CSV PARSING --------
  const handleCsv = (file: File) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const rows = result.data as Record<string, string>[];
        const mapped: Entry[] = [];
        rows.forEach((row) => {
          const hasCols = REQUIRED_COLS.every((c) => c in row);
          if (!hasCols) return;
          const slots: Record<Slot, string> = {
            PG: row['PG'] || '',
            SG: row['SG'] || '',
            SF: row['SF'] || '',
            PF: row['PF'] || '',
            C: row['C'] || '',
            G: row['G'] || '',
            F: row['F'] || '',
            UTIL: row['UTIL'] || '',
          };
          mapped.push({
            entryId: row['Entry ID'] || '',
            contestName: row['Contest Name'] || '',
            contestId: row['Contest ID'] || '',
            entryFee: row['Entry Fee'] || '',
            slots,
          });
        });
        setEntries(mapped);
      },
      error: (err) => {
        console.error('CSV parse error', err);
        alert('Failed to parse DKEntries.csv');
      },
    });
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleCsv(file);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleCsv(file);
  };

  // -------- INLINE EDITING --------
  const updateSlot = (idx: number, slot: Slot, value: string) => {
    setEntries((prev) =>
      prev.map((en, i) => (i === idx ? { ...en, slots: { ...en.slots, [slot]: value } } : en))
    );
  };

  // -------- BATCH APPLY LINEUPS --------
  // optimizedLineups: array of objects with slot names mapping to player strings
  const handleBatchApply = (optimizedLineups: Record<Slot, string>[]) => {
    if (!optimizedLineups.length) return;
    setEntries((prev) =>
      prev.map((en, i) => {
        const lineup = optimizedLineups[i % optimizedLineups.length];
        return { ...en, slots: { ...en.slots, ...lineup } };
      })
    );
  };

  // -------- LATE SWAP --------
  const toggleLockedTeam = (team: string) => {
    setLockedTeams((prev) =>
      prev.includes(team) ? prev.filter((t) => t !== team) : [...prev, team]
    );
  };

  const isPlayerLocked = (player: string) => {
    const tokens = player.split(/[^A-Z0-9]+/i).map((t) => t.toUpperCase());
    return lockedTeams.some((team) => tokens.includes(team.toUpperCase()));
  };

  // -------- EXPORT CSV --------
  const downloadCsv = () => {
    if (!entries.length) return;
    const rows = entries.map((en) => {
      const row: Record<string, string> = {
        'Entry ID': en.entryId,
        'Contest Name': en.contestName,
        'Contest ID': en.contestId,
        'Entry Fee': en.entryFee,
      };
      SLOT_ORDER.forEach((s) => {
        row[s] = en.slots[s] || '';
      });
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

  // -------- DERIVED --------
  const grouped = useMemo(() => {
    const map = new Map<string, Entry[]>();
    entries.forEach((en) => {
      const list = map.get(en.contestName) || [];
      list.push(en);
      map.set(en.contestName, list);
    });
    return map;
  }, [entries]);

  const openSwapModal = (entryIdx: number, slot: Slot) => {
    const current = entries[entryIdx]?.slots[slot] || '';
    if (current && isPlayerLocked(current)) return; // locked cannot be swapped
    setSelectedSlot({ entryIdx, slot });
    setShowCandidates(true);
  };

  const applySwap = (playerName: string) => {
    if (!selectedSlot) return;
    setEntries((prev) =>
      prev.map((en, idx) =>
        idx === selectedSlot.entryIdx
          ? { ...en, slots: { ...en.slots, [selectedSlot.slot]: playerName } }
          : en
      )
    );
    setShowCandidates(false);
  };

  const candidatePlayers = useMemo(() => {
    if (!selectedSlot) return [];
    return players.filter((p) => p.position && p.position.split(/[\\/ ,]+/).includes(selectedSlot.slot));
  }, [selectedSlot, players]);

  const lockedPlayers = useMemo(
    () =>
      new Set(
        entries.flatMap((en) =>
          SLOT_ORDER.map((s) => en.slots[s]).filter((p) => p && isPlayerLocked(p))
        )
      ),
    [entries, lockedTeams]
  );

  return (
    <div className="min-h-screen bg-vellum text-ink font-sans p-4 space-y-6">
      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        className="border-2 border-dashed border-ink/20 rounded-2xl p-6 text-center bg-white/70 hover:bg-white transition-colors cursor-pointer shadow-sm"
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={onFileChange}
        />
        <div className="flex items-center justify-center gap-3 text-drafting-orange">
          <Upload className="w-6 h-6" />
          <div className="text-sm font-mono uppercase tracking-widest text-ink">
            Drop DKEntries.csv or click to upload
          </div>
        </div>
        <p className="text-xs text-ink/60 mt-2">
          Only the first 12 DraftKings columns are read; extra columns are ignored.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <button
          onClick={() => handleBatchApply([])}
          className="px-3 py-2 rounded-lg bg-vellum border border-ink/20 text-sm font-black uppercase tracking-widest hover:border-drafting-orange flex items-center gap-2"
        >
          <SlidersHorizontal className="w-4 h-4" />
          Batch Apply Lineups
        </button>
        <button
          onClick={() => setLateSwapMode((p) => !p)}
          className={`px-3 py-2 rounded-lg text-sm font-black uppercase tracking-widest border flex items-center gap-2 ${
            lateSwapMode
              ? 'bg-red-50 border-red-300 text-red-700'
              : 'bg-vellum border-ink/20 hover:border-drafting-orange'
          }`}
        >
          <Lock className="w-4 h-4" />
          Late Swap Mode
        </button>
        <button
          onClick={downloadCsv}
          className="px-3 py-2 rounded-lg bg-vellum border border-ink/20 text-sm font-black uppercase tracking-widest hover:border-drafting-orange flex items-center gap-2"
        >
          <Download className="w-4 h-4" />
          Download Updated Entries
        </button>
      </div>

      {lateSwapMode && (
        <div className="p-4 rounded-xl border border-red-300 bg-white shadow-sm">
          <div className="text-xs font-black uppercase tracking-widest text-red-600 mb-2">
            Mark Locked Teams (games started)
          </div>
          <div className="flex flex-wrap gap-2">
            {['BOS', 'NYK', 'LAL', 'GSW', 'MIA', 'DEN', 'PHI', 'DAL'].map((team) => {
              const locked = lockedTeams.includes(team);
              return (
                <button
                  key={team}
                  onClick={() => toggleLockedTeam(team)}
                  className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest border ${
                    locked
                      ? 'bg-red-50 border-red-300 text-red-700'
                      : 'bg-vellum border-ink/20 text-ink hover:border-drafting-orange'
                  }`}
                >
                  {team} {locked ? iconLocked : iconUnlocked}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-6">
        {[...grouped.entries()].map(([contest, list]) => (
          <div key={contest} className="border border-ink/10 rounded-xl bg-white shadow-sm">
            <div className="px-4 py-3 border-b border-ink/10 flex items-center justify-between">
              <div className="text-sm font-black uppercase tracking-widest text-drafting-orange">
                {contest} — {list.length} entries
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-vellum text-ink/60 text-[11px] uppercase tracking-widest">
                  <tr>
                    <th className="px-3 py-2">Entry ID</th>
                    <th className="px-3 py-2">Contest ID</th>
                    <th className="px-3 py-2">Entry Fee</th>
                    {SLOT_ORDER.map((s) => (
                      <th key={s} className="px-3 py-2">
                        {s}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.map((en, rowIdx) => {
                    const globalIdx = entries.indexOf(en);
                    return (
                      <tr
                        key={en.entryId + rowIdx}
                        className="border-t border-ink/10 hover:bg-vellum transition-colors"
                      >
                        <td className="px-3 py-2 font-mono text-xs text-ink/80">{en.entryId}</td>
                        <td className="px-3 py-2 font-mono text-xs text-ink/80">{en.contestId}</td>
                        <td className="px-3 py-2 font-mono text-xs text-ink/80">${en.entryFee}</td>
                        {SLOT_ORDER.map((slot) => {
                          const val = en.slots[slot] || '';
                          const locked = val && isPlayerLocked(val);
                          return (
                            <td key={slot} className="px-3 py-2">
                              <div className="flex items-center gap-2 text-sm">
                                <input
                                  value={val}
                                  onClick={() => openSwapModal(globalIdx, slot)}
                                  onChange={(e) => updateSlot(globalIdx, slot, e.target.value)}
                                  disabled={locked}
                                  className={`w-full bg-white border ${locked ? 'border-ink/10 text-ink/40' : 'border-ink/20 text-ink'} rounded px-2 py-1 text-xs focus:border-drafting-orange outline-none cursor-pointer`}
                                  placeholder="Player Name (ID)"
                                />
                                <span>{locked ? iconLocked : null}</span>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
      {showCandidates && selectedSlot && (
        <div className="fixed inset-0 z-[120] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-ink/10 w-full max-w-2xl max-h-[80vh] overflow-hidden shadow-2xl">
            <div className="px-4 py-3 border-b border-ink/10 flex items-center justify-between">
              <div className="text-sm font-black uppercase tracking-widest text-drafting-orange">
                Swap {selectedSlot.slot}
              </div>
              <button
                onClick={() => setShowCandidates(false)}
                className="text-ink/40 hover:text-ink px-2 py-1 rounded"
              >
                Close
              </button>
            </div>
            <div className="overflow-y-auto max-h-[70vh] divide-y divide-ink/10">
              {candidatePlayers.map((p) => {
                const locked = isPlayerLocked(`${p.name} ${p.team}`);
                return (
                  <div key={p.id} className="flex items-center justify-between px-4 py-2 hover:bg-vellum">
                    <div className="flex flex-col">
                      <button
                        className="text-sm font-bold text-ink text-left hover:underline"
                        onClick={() => setDeepDivePlayer(p)}
                      >
                        {p.name}
                      </button>
                      <div className="text-[11px] text-ink/60 font-mono uppercase">
                        {p.team} • {p.position} • ${p.salary?.toLocaleString?.() ?? '--'}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {locked && iconLocked}
                      <button
                        className="px-3 py-1 rounded bg-drafting-orange text-white text-[11px] font-black uppercase tracking-widest disabled:opacity-40"
                        disabled={locked}
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
        <PlayerDeepDive
          player={deepDivePlayer}
          players={players}
          games={games}
          onClose={() => setDeepDivePlayer(null)}
          isHistorical={false}
          showActuals={showActuals}
          depthCharts={undefined}
          injuryLookup={undefined}
          startingLineupLookup={undefined}
        />
      )}
    </div>
  );
};

export default DKEntryManager;
