import React from 'react';

interface VellumCardProps {
  children: React.ReactNode;
  label?: string;
  className?: string;
  onClick?: () => void;
}

export const VellumCard: React.FC<VellumCardProps> = ({ children, label = 'LVL_01', className = '', onClick }) => {
  return (
    <div 
      onClick={onClick}
      className={`
        relative bg-white/40 backdrop-blur-md border border-ink/10 
        shadow-drafting hover:shadow-drafting-hover hover:-translate-y-[2px] 
        transition-all duration-300 ease-out rounded-[2px] p-6
        group ${className}
      `}
    >
      {/* Corner Marks (Crosshairs) */}
      <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-blueprint/30 -translate-x-[1px] -translate-y-[1px]" />
      <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-blueprint/30 translate-x-[1px] -translate-y-[1px]" />
      <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-blueprint/30 -translate-x-[1px] translate-y-[1px]" />
      <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-blueprint/30 translate-x-[1px] translate-y-[1px]" />

      {/* Layer Label */}
      <div className="absolute top-2 right-2 text-[9px] font-mono text-blueprint uppercase tracking-widest opacity-60 group-hover:opacity-100 transition-opacity">
        {label}
      </div>

      {children}
    </div>
  );
};