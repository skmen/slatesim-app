import React from 'react';
import { Search } from 'lucide-react';
import { TierType, PosType } from '@/utils/classifyPlayers';

export type PosFilter = 'ALL' | PosType;
export type TierFilter = 'ALL' | TierType;

interface FilterBarProps {
  posFilter: PosFilter;
  tierFilter: TierFilter;
  salaryRange: [number, number];
  salaryBounds: [number, number];
  searchQuery: string;
  onPosChange: (pos: PosFilter) => void;
  onTierChange: (tier: TierFilter) => void;
  onSalaryChange: (range: [number, number]) => void;
  onSearchChange: (q: string) => void;
}

const POS_OPTIONS: Array<{ label: string; value: PosFilter }> = [
  { label: 'All', value: 'ALL' },
  { label: 'PG', value: 'PG' },
  { label: 'SG', value: 'SG' },
  { label: 'SF', value: 'SF' },
  { label: 'PF', value: 'PF' },
  { label: 'C', value: 'C' },
];

const TIER_OPTIONS: Array<{ label: string; value: TierFilter }> = [
  { label: 'All', value: 'ALL' },
  { label: 'Elite', value: 'ELITE' },
  { label: 'Sweet Spot', value: 'SWEET_SPOT' },
  { label: 'Broad', value: 'BROAD' },
  { label: 'Caution', value: 'CAUTION' },
];

const PillGroup = <T extends string>({
  options,
  active,
  onChange,
  colorActive,
}: {
  options: Array<{ label: string; value: T }>;
  active: T;
  onChange: (v: T) => void;
  colorActive: string;
}) => (
  <div className="flex flex-wrap gap-1">
    {options.map((opt) => (
      <button
        key={opt.value}
        onClick={() => onChange(opt.value)}
        className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-sm border transition-colors ${
          active === opt.value
            ? `${colorActive} text-white border-transparent`
            : 'bg-white/60 border-ink/15 text-ink/60 hover:border-ink/30 hover:text-ink'
        }`}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

export const FilterBar: React.FC<FilterBarProps> = ({
  posFilter,
  tierFilter,
  salaryRange,
  salaryBounds,
  searchQuery,
  onPosChange,
  onTierChange,
  onSalaryChange,
  onSearchChange,
}) => {
  return (
    <div className="bg-white/50 border border-ink/10 rounded-sm p-3 space-y-3">
      <div className="flex flex-wrap gap-4 items-start">
        {/* Position filter */}
        <div className="space-y-1">
          <p className="text-[9px] font-black uppercase tracking-widest text-ink/50">Position</p>
          <PillGroup
            options={POS_OPTIONS}
            active={posFilter}
            onChange={onPosChange}
            colorActive="bg-ink"
          />
        </div>

        {/* Tier filter */}
        <div className="space-y-1">
          <p className="text-[9px] font-black uppercase tracking-widest text-ink/50">Tier</p>
          <PillGroup
            options={TIER_OPTIONS}
            active={tierFilter}
            onChange={onTierChange}
            colorActive="bg-blueprint"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-4 items-end">
        {/* Salary range */}
        <div className="space-y-1 w-full sm:w-auto sm:min-w-[200px]">
          <p className="text-[9px] font-black uppercase tracking-widest text-ink/50">
            Salary — ${salaryRange[0].toLocaleString()} – ${salaryRange[1].toLocaleString()}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-ink/40">${(salaryBounds[0] / 1000).toFixed(0)}k</span>
            <input
              type="range"
              min={salaryBounds[0]}
              max={salaryBounds[1]}
              step={100}
              value={salaryRange[0]}
              onChange={(e) => onSalaryChange([Number(e.target.value), salaryRange[1]])}
              className="flex-1 accent-blueprint h-1"
            />
            <input
              type="range"
              min={salaryBounds[0]}
              max={salaryBounds[1]}
              step={100}
              value={salaryRange[1]}
              onChange={(e) => onSalaryChange([salaryRange[0], Number(e.target.value)])}
              className="flex-1 accent-blueprint h-1"
            />
            <span className="text-[9px] text-ink/40">${(salaryBounds[1] / 1000).toFixed(0)}k</span>
          </div>
        </div>

        {/* Search */}
        <div className="space-y-1 flex-1 min-w-[160px]">
          <p className="text-[9px] font-black uppercase tracking-widest text-ink/50">Search</p>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink/30" />
            <input
              type="text"
              placeholder="Search player..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full pl-7 pr-3 py-1.5 text-[11px] bg-white border border-ink/15 rounded-sm placeholder:text-ink/30 focus:outline-none focus:border-blueprint"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
