import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { ClassifiedPlayer } from '@/utils/classifyPlayers';

interface OveruseWarningProps {
  players: ClassifiedPlayer[];
}

const OVERUSE_TOOLTIP = 'These players have strong ownership projections but their usage rate exceeds the historical ceiling for their position. Centers above 28% usage historically produced a 0% hit rate for exceeding projections by 8+ pts — likely because that usage level is unsustainably high and comes at the cost of efficiency. Fade these regardless of ownership.';

export const OveruseWarning: React.FC<OveruseWarningProps> = ({ players }) => {
  if (players.length === 0) return null;

  return (
    <div className="border border-red-400 bg-red-50 rounded-sm p-4 space-y-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
        <div className="flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-[11px] font-black uppercase tracking-widest text-red-800">
              Overuse Warning — Fade Despite Ownership
            </p>
            <span className="relative inline-flex group">
              <span className="text-red-400 text-[10px] cursor-help">ℹ</span>
              <span className="pointer-events-none absolute left-0 bottom-full z-30 mb-2 w-72 rounded-md bg-ink px-2.5 py-2 text-[11px] leading-snug text-vellum opacity-0 shadow-lg transition-opacity group-hover:opacity-100 font-normal normal-case tracking-normal text-left">
                {OVERUSE_TOOLTIP}
              </span>
            </span>
          </div>
          <p className="text-[11px] text-red-700 mt-1 leading-relaxed">
            The following players meet ownership thresholds but exceed the proven usage ceiling for their position.
            Centers above 28% usage historically produced a <strong>0% hit rate</strong> for 8+ pt overperformance.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {players.map((p) => (
          <div
            key={p.Player}
            className="flex items-center gap-1.5 bg-red-100 border border-red-300 rounded-sm px-2 py-1"
          >
            <span className="text-[11px] font-bold text-red-900">{p.Player}</span>
            <span className="text-[9px] text-red-600 font-black uppercase">{p.Team}</span>
            <span className="text-[9px] text-red-500">${p.Salary.toLocaleString()}</span>
            <span className="text-[9px] text-red-600">Own {p.Own.toFixed(1)}%</span>
            <span className="text-[9px] text-red-700 font-bold">Usg {p.Usage.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};
