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
      <div className="relative w-9 h-9 sm:w-10 sm:h-10 shrink-0">
        <div className="absolute inset-0 rounded-[10px] border-2 border-black bg-gradient-to-br from-drafting-orange/20 via-drafting-orange/70 to-drafting-orange shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]" />
        <div className="absolute inset-[22%] rounded-[6px] border-2 border-black/90 bg-gradient-to-br from-drafting-orange/30 to-drafting-orange" />

        {PIN_OFFSETS.map((offset) => (
          <React.Fragment key={`top-${offset}`}>
            <span className="absolute -top-[5px] w-[3px] h-[7px] rounded-full bg-black" style={{ left: offset, transform: 'translateX(-50%)' }} />
            <span className="absolute -bottom-[5px] w-[3px] h-[7px] rounded-full bg-black" style={{ left: offset, transform: 'translateX(-50%)' }} />
            <span className="absolute -left-[5px] w-[7px] h-[3px] rounded-full bg-black" style={{ top: offset, transform: 'translateY(-50%)' }} />
            <span className="absolute -right-[5px] w-[7px] h-[3px] rounded-full bg-black" style={{ top: offset, transform: 'translateY(-50%)' }} />
          </React.Fragment>
        ))}
      </div>

      <div className="leading-none font-black italic tracking-tight text-[24px] sm:text-[30px]">
        <span className="text-ink/85">SLATE</span>
        <span className="ml-0.5 text-drafting-orange">
          SIM
        </span>
      </div>
    </div>
  );
};
