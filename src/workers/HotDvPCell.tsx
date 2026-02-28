import React from 'react';

interface HotDvPCellProps {
  position: string;
  rank: number;
  pointsAllowed: number;
}

export const HotDvPCell: React.FC<HotDvPCellProps> = ({ position, rank, pointsAllowed }) => {
  // Rank 1-5 is considered "Hot" (High Leverage/Alert)
  const isHot = rank <= 5;

  return (
    <div className={`
      relative p-4 border-r border-b border-ink/10 font-mono text-xs
      transition-colors duration-300
      ${isHot ? 'bg-drafting-orange/10' : 'bg-transparent hover:bg-white/20'}
    `}>
      {/* Hot Spot Indicator Line */}
      {isHot && (
        <div className="absolute top-0 left-0 w-[3px] h-full bg-drafting-orange" />
      )}

      <div className="flex justify-between items-center mb-2">
        <span className="font-bold text-ink uppercase tracking-tight">{position}</span>
        <span className={`
          font-black tracking-tighter text-sm
          ${isHot ? 'text-drafting-orange' : 'text-ink/60'}
        `}>
          {pointsAllowed.toFixed(1)}
        </span>
      </div>

      <div className="flex justify-between items-center">
        <span className="text-[9px] text-blueprint uppercase tracking-widest opacity-80">
          Rank
        </span>
        <span className="text-[9px] font-bold text-ink">
          {rank}th
        </span>
      </div>

      {/* Technical Crosshair for Hot Cells */}
      {isHot && (
        <div className="absolute bottom-1 right-1 w-2 h-2 border-b border-r border-drafting-orange/50" />
      )}
    </div>
  );
};