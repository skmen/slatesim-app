import React, { useState, useMemo, useCallback, useRef } from 'react';
import { Upload, X, FileText, Star } from 'lucide-react';
import {
  parseCSV,
  classifyAllPlayers,
  ClassifiedPlayer,
  TierType,
  PosType,
} from '@/utils/classifyPlayers';
import { SummaryCards } from './slate/SummaryCards';
import { FilterBar, PosFilter, TierFilter } from './slate/FilterBar';
import { PlayerTable } from './slate/PlayerTable';
import { OveruseWarning } from './slate/OveruseWarning';
import { MethodologyAccordion } from './slate/MethodologyAccordion';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SlateRecommendationsProps {
  // Optionally pass pre-loaded players from existing app state
  preloadedPlayers?: any[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fuzzyMatch(haystack: string, needle: string): boolean {
  if (!needle) return true;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function deriveSlateName(filename: string): string {
  // Try to extract a date from the filename e.g. "slate_2024-03-20.csv"
  const dateMatch = filename.match(/\d{4}[-_]\d{2}[-_]\d{2}/);
  if (dateMatch) return dateMatch[0].replace(/_/g, '-');
  return filename.replace(/\.[^.]+$/, '');
}

// ─── Drop zone ────────────────────────────────────────────────────────────────

const DropZone: React.FC<{ onFile: (text: string, name: string) => void }> = ({ onFile }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      onFile(e.target?.result as string, file.name);
    };
    reader.readAsText(file);
  }, [onFile]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-sm p-10 cursor-pointer transition-colors ${
        dragging ? 'border-blueprint bg-blue-50' : 'border-ink/20 hover:border-ink/40 hover:bg-ink/5'
      }`}
    >
      <Upload className="w-8 h-8 text-ink/30" />
      <div className="text-center">
        <p className="text-[12px] font-bold text-ink/60">Drop a projections CSV here</p>
        <p className="text-[11px] text-ink/40 mt-1">or click to browse — accepts DraftKings projection exports</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

export const SlateRecommendations: React.FC<SlateRecommendationsProps> = () => {
  // ── Data state ────────────────────────────────────────────────────────────
  const [classifiedData, setClassifiedData] = useState<ClassifiedPlayer[]>([]);
  const [slateName, setSlateName] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [hasData, setHasData] = useState(false);

  // ── Filter state ──────────────────────────────────────────────────────────
  const [posFilter, setPosFilter] = useState<PosFilter>('ALL');
  const [tierFilter, setTierFilter] = useState<TierFilter>('ALL');
  const [salaryRange, setSalaryRange] = useState<[number, number]>([3000, 15000]);
  const [searchQuery, setSearchQuery] = useState('');

  // ── Salary bounds derived from data ───────────────────────────────────────
  const salaryBounds = useMemo<[number, number]>(() => {
    if (classifiedData.length === 0) return [3000, 15000];
    const salaries = classifiedData.map((p) => p.Salary);
    return [
      Math.floor(Math.min(...salaries) / 100) * 100,
      Math.ceil(Math.max(...salaries) / 100) * 100,
    ];
  }, [classifiedData]);

  // ── Upload handler ────────────────────────────────────────────────────────
  const handleCSV = useCallback((text: string, filename: string) => {
    setParseError(null);
    try {
      const rows = parseCSV(text);
      if (rows.length === 0) {
        setParseError('No player rows found. Check that the CSV has the required columns (Player, Pos, Own, Usage, Proj, Ceiling).');
        return;
      }
      const classified = classifyAllPlayers(rows);
      setClassifiedData(classified);
      setSlateName(deriveSlateName(filename));
      setHasData(true);
      // Reset filters and update salary bounds
      setPosFilter('ALL');
      setTierFilter('ALL');
      setSearchQuery('');
      const salaries = classified.map((p) => p.Salary);
      if (salaries.length > 0) {
        setSalaryRange([
          Math.floor(Math.min(...salaries) / 100) * 100,
          Math.ceil(Math.max(...salaries) / 100) * 100,
        ]);
      }
    } catch (err) {
      setParseError('Failed to parse CSV. Ensure the file is a valid projections export.');
      console.error(err);
    }
  }, []);

  // ── Derived data ──────────────────────────────────────────────────────────

  // Separate overuse players (not shown in main table)
  const overusePlayers = useMemo(
    () => classifiedData.filter((p) => p.classification.tier === 'OVERUSE_WARNING'),
    [classifiedData],
  );

  // Main table players (exclude overuse)
  const mainPlayers = useMemo(
    () => classifiedData.filter((p) => p.classification.tier !== 'OVERUSE_WARNING'),
    [classifiedData],
  );

  // Apply filters
  const filteredPlayers = useMemo(() => {
    return mainPlayers.filter((p) => {
      if (posFilter !== 'ALL' && p.pos_primary !== posFilter) return false;
      if (tierFilter !== 'ALL' && p.classification.tier !== tierFilter) return false;
      if (p.Salary < salaryRange[0] || p.Salary > salaryRange[1]) return false;
      if (searchQuery && !fuzzyMatch(p.Player, searchQuery)) return false;
      return true;
    });
  }, [mainPlayers, posFilter, tierFilter, salaryRange, searchQuery]);

  // Summary counts (from all classified, excluding overuse)
  const counts = useMemo(() => {
    const all = classifiedData.filter((p) => p.classification.tier !== 'OVERUSE_WARNING');
    return {
      total: all.length,
      elite: all.filter((p) => p.classification.tier === 'ELITE').length,
      sweet_spot: all.filter((p) => p.classification.tier === 'SWEET_SPOT').length,
      broad: all.filter((p) => p.classification.tier === 'BROAD').length,
      caution: all.filter((p) => p.classification.tier === 'CAUTION').length,
    };
  }, [classifiedData]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 pb-8">
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Star className="w-4 h-4 text-drafting-orange" />
            <h1 className="text-[11px] font-black uppercase tracking-widest text-drafting-orange">
              Slate Recommendations
            </h1>
          </div>
          <p className="text-[13px] text-ink/60 mt-1">
            Players meeting historical overperformance criteria
            {slateName && <span className="ml-1 text-ink/80 font-bold">— {slateName}</span>}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {hasData && (
            <span className="text-[10px] font-black uppercase tracking-widest text-ink/50 border border-ink/15 rounded-sm px-2 py-1">
              {counts.total} qualifying
            </span>
          )}
          {hasData && (
            <button
              onClick={() => {
                setHasData(false);
                setClassifiedData([]);
                setSlateName('');
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest border border-ink/15 rounded-sm text-ink/60 hover:border-ink/30 hover:text-ink transition-colors"
            >
              <X className="w-3 h-3" />
              New slate
            </button>
          )}
        </div>
      </div>

      {/* ── Upload / no data state ───────────────────────────────────────── */}
      {!hasData && (
        <div className="space-y-3">
          <DropZone onFile={handleCSV} />
          {parseError && (
            <div className="border border-red-300 bg-red-50 rounded-sm px-4 py-3 text-[12px] text-red-700">
              {parseError}
            </div>
          )}
          <div className="border border-ink/10 bg-white/40 rounded-sm p-4 space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-ink/50">Expected columns</p>
            <div className="flex flex-wrap gap-1.5">
              {['Player','Team','OPP','Pos','Salary','Value','Own','Usage','Min','Proj','Ceiling','Floor','Lev_Score','Boom','Bust'].map((col) => (
                <span key={col} className="text-[10px] font-mono bg-ink/5 border border-ink/10 rounded px-1.5 py-0.5 text-ink/60">
                  {col}
                </span>
              ))}
            </div>
            <p className="text-[10px] text-ink/40">
              "Lev Score" (with space) is also accepted. Dual positions like SG/SF are normalized automatically.
            </p>
          </div>
          <MethodologyAccordion />
        </div>
      )}

      {/* ── Data loaded ──────────────────────────────────────────────────── */}
      {hasData && (
        <div className="space-y-4">
          {/* Summary cards */}
          <SummaryCards counts={counts} />

          {/* Filter bar */}
          <FilterBar
            posFilter={posFilter}
            tierFilter={tierFilter}
            salaryRange={salaryRange}
            salaryBounds={salaryBounds}
            searchQuery={searchQuery}
            onPosChange={setPosFilter}
            onTierChange={setTierFilter}
            onSalaryChange={setSalaryRange}
            onSearchChange={setSearchQuery}
          />

          {/* Re-upload button (compact, secondary) */}
          <div className="flex items-center gap-2 text-[10px] text-ink/40">
            <FileText className="w-3.5 h-3.5" />
            <label className="cursor-pointer hover:text-ink transition-colors underline underline-offset-2">
              Upload a different CSV
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => handleCSV(ev.target?.result as string, file.name);
                  reader.readAsText(file);
                }}
              />
            </label>
          </div>

          {/* Player table */}
          <PlayerTable players={filteredPlayers} />

          {/* Overuse warning banner */}
          <OveruseWarning players={overusePlayers} />

          {/* Methodology */}
          <MethodologyAccordion />
        </div>
      )}
    </div>
  );
};

export default SlateRecommendations;
