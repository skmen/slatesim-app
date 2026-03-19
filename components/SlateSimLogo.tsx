import React from 'react';

interface Props {
  className?: string;
}

const PIN_OFFSETS = ['17%', '50%', '83%'];

export const SlateSimLogo: React.FC<Props> = ({ className = '' }) => {
  return (
    <div
      role="img"
      aria-label="Slate Sim"
      className={`inline-flex items-center gap-2 sm:gap-3 select-none ${className}`}
    >
      <div className="relative w-10 h-10 sm:w-12 sm:h-12 shrink-0">
        <div className="absolute inset-0 rounded-[10px] border-2 border-black bg-gradient-to-br from-amber-200 via-orange-400 to-orange-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]" />
        <div className="absolute inset-[22%] rounded-[6px] border-2 border-black/90 bg-gradient-to-br from-orange-200 to-orange-500" />

        {PIN_OFFSETS.map((offset) => (
          <React.Fragment key={`top-${offset}`}>
            <span className="absolute -top-[5px] w-[3px] h-[7px] rounded-full bg-black" style={{ left: offset, transform: 'translateX(-50%)' }} />
            <span className="absolute -bottom-[5px] w-[3px] h-[7px] rounded-full bg-black" style={{ left: offset, transform: 'translateX(-50%)' }} />
            <span className="absolute -left-[5px] w-[7px] h-[3px] rounded-full bg-black" style={{ top: offset, transform: 'translateY(-50%)' }} />
            <span className="absolute -right-[5px] w-[7px] h-[3px] rounded-full bg-black" style={{ top: offset, transform: 'translateY(-50%)' }} />
          </React.Fragment>
        ))}
      </div>

      <div className="leading-none font-black italic tracking-tight text-[32px] sm:text-[40px]">
        <span className="text-slate-700">SLATE</span>
        <span
          className="ml-0.5 bg-gradient-to-b from-amber-300 via-orange-400 to-orange-600 bg-clip-text text-transparent"
          style={{ textShadow: '0 1px 0 rgba(30, 41, 59, 0.35)' }}
        >
          SIM
        </span>
      </div>
    </div>
  );
};
