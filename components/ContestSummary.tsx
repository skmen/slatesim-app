
import React from 'react';
import { ContestDerived, ContestInput, GameInfo } from '../types';
import { formatMoney, formatPct } from '../utils/contest';
import { Wallet, Users, Percent, CheckCircle, AlertTriangle, XCircle, FileText, Calendar, Database, PlayCircle } from 'lucide-react';

interface Props {
  input: ContestInput;
  derived: ContestDerived;
  games?: GameInfo[];
}

export const ContestSummary: React.FC<Props> = ({ 
  input, 
  derived, 
  games,
}) => {
  const getVerdict = () => {
    if (!input || !derived) return { status: 'UNAVAILABLE', label: 'Unknown', color: 'gray' };
    if (input.fieldSize <= 0 || input.entryFee < 0) return { status: 'FAIL', label: 'Invalid Inputs', color: 'red' };

    const extremeRake = (input.rakePct || 0) > 0.18; 
    const tinyField = input.fieldSize < 50; 
    if (extremeRake || tinyField) return { status: 'WARN', label: 'Caution', color: 'amber' };
    return { status: 'PASS', label: 'Engine Ready', color: 'emerald' };
  };

  const verdict = getVerdict();
  const verdictColors = {
      gray: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
      red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
      amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
      emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  };

  return (

    <div className="space-y-4">
        <div className="bg-white dark:bg-charcoal-card rounded-xl shadow-sm border border-cloud-darker dark:border-charcoal-card overflow-hidden">
            <div className="bg-brand-light dark:bg-brand/10 p-4 border-b border-brand/20 flex justify-between items-center">
                <h4 className="font-bold text-brand-hover dark:text-brand-light flex items-center gap-2">{input.contestName}<span className="text-xs px-2 py-0.5 bg-white dark:bg-charcoal/50 rounded-full border border-brand/20 text-gray-600 dark:text-gray-300 font-normal">{input.site}</span></h4>
                <div className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 ${verdictColors[verdict.color as keyof typeof verdictColors]}`}>
                    {verdict.status === 'PASS' && <CheckCircle className="w-3.5 h-3.5" />}
                    {verdict.status === 'WARN' && <AlertTriangle className="w-3.5 h-3.5" />}
                    {verdict.status === 'FAIL' && <XCircle className="w-3.5 h-3.5" />}
                    {verdict.label}
                </div>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex items-start gap-3">
                    <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-600 dark:text-red-400"><Percent className="w-5 h-5" /></div>
                    <div><div className="text-xs text-gray-500 uppercase font-medium">Field Size (Opponents)</div><div className="font-bold text-cloud-text dark:text-white">{(input.fieldSize || 0).toLocaleString()} Simulated</div></div>
                </div>
                <div className="flex items-start gap-3">
                    <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-blue-600 dark:text-blue-400"><Users className="w-5 h-5" /></div>
                    <div><div className="text-xs text-gray-500 uppercase font-medium">Max Entries</div><div className="font-bold text-cloud-text dark:text-white">{input.maxEntries}</div></div>
                </div>
                <div className="flex items-start gap-3">
                    <div className="p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg text-emerald-600 dark:text-emerald-400"><Wallet className="w-5 h-5" /></div>
                    <div><div className="text-xs text-gray-500 uppercase font-medium">Est. Payouts</div><div className="font-bold text-cloud-text dark:text-white">~{(derived.estimatedPaidPlaces || 0).toLocaleString()} Places</div></div>
                </div>
            </div>
        </div>

        <div className="bg-white dark:bg-charcoal-card p-4 rounded-xl shadow-sm border border-cloud-darker dark:border-charcoal-card">
            <h4 className="font-bold text-sm flex items-center gap-2 mb-3"><PlayCircle className="w-4 h-4 text-brand" />Active Slate Matchups</h4>
            {games && games.length > 0 ? (
                <div className="flex flex-wrap gap-2">{games.map(g => (<div key={g.matchupKey} className="px-3 py-1.5 bg-cloud dark:bg-charcoal border border-cloud-darker dark:border-gray-700 rounded-lg text-xs font-bold flex items-center gap-2"><span className="text-gray-500 dark:text-gray-400">{g.teamA.abbreviation}</span><span className="text-[10px] text-gray-300 dark:text-gray-600 font-normal uppercase">vs</span><span className="text-gray-500 dark:text-gray-400">{g.teamB.abbreviation}</span></div>))}</div>
            ) : (<p className="text-xs text-gray-400 italic">No environment data detected.</p>)}
        </div>
    </div>
  );
};