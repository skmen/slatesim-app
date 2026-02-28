
import React, { useState, useMemo } from 'react';
import { ContestInput } from '../types';
import { Settings, X, AlertCircle } from 'lucide-react';
import { CONTEST_PRESETS } from '../utils/contest';

interface Props {
  input: ContestInput;
  onChange: (input: ContestInput) => void;
  onClose?: () => void;
}

// Generate discrete fee steps: [0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.50, 1, 2, ..., 10000]
const FEE_STEPS = [
  0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.50, 1,
  ...Array.from({ length: 9999 }, (_, i) => i + 2)
];

export const ContestForm: React.FC<Props> = ({ input, onChange, onClose }) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleChange = (field: keyof ContestInput, value: any) => {
    // Basic validation for numeric fields
    if (typeof value === 'number' && value < 0) {
      return;
    }
    onChange({
      ...input,
      [field]: value
    });
  };

  const loadPreset = (presetName: string) => {
    const preset = CONTEST_PRESETS.find(p => p.name === presetName);
    if (preset) {
      onChange({
        ...input,
        contestName: preset.name,
        site: (preset as any).site || input.site,
        entryFee: preset.entryFee,
        fieldSize: (preset as any).fieldSize,
        maxEntries: (preset as any).maxEntries,
        rakePct: (preset as any).rakePct
      });
    }
  };

  const isFanDuel = input.site === 'FanDuel';

  // Map entryFee to closest index in FEE_STEPS for the slider
  const feeIndex = useMemo(() => {
    const currentFee = input.entryFee;
    let closestIdx = 0;
    let minDiff = Infinity;
    
    // Efficiently find index in sorted steps
    for (let i = 0; i < FEE_STEPS.length; i++) {
      const diff = Math.abs(FEE_STEPS[i] - currentFee);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
      if (FEE_STEPS[i] > currentFee) break;
    }
    return closestIdx;
  }, [input.entryFee]);

  return (
    <div className="bg-white dark:bg-charcoal-card rounded-xl shadow-sm border border-cloud-darker dark:border-charcoal-card overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-cloud-darker dark:border-charcoal-card">
        <h3 className="font-bold text-sm flex items-center gap-2">
          <Settings className="w-4 h-4 text-brand" /> Contest Setup
        </h3>
        {onClose && (
          <button 
            onClick={onClose}
            className="p-1 hover:bg-cloud dark:hover:bg-charcoal rounded-full transition-colors text-gray-400"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="p-4 space-y-5">
        {/* Site Selector */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Select Site</label>
          <div className="flex gap-2">
            <button
              onClick={() => handleChange('site', 'DraftKings')}
              className={`flex-1 py-2 px-3 rounded-lg border text-xs font-bold transition-all ${
                input.site === 'DraftKings'
                  ? 'bg-brand text-white border-brand'
                  : 'bg-cloud dark:bg-charcoal text-gray-500 border-cloud-darker dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-charcoal/80'
              }`}
            >
              DraftKings
            </button>
            <button
              onClick={() => handleChange('site', 'FanDuel')}
              className={`flex-1 py-2 px-3 rounded-lg border text-xs font-bold transition-all ${
                input.site === 'FanDuel'
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'bg-cloud dark:bg-charcoal text-gray-500 border-cloud-darker dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-charcoal/80'
              }`}
            >
              FanDuel
            </button>
          </div>
          {isFanDuel && (
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-lg text-xs flex items-start gap-2 border border-blue-100 dark:border-blue-900/40">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>FanDuel support is coming soon. For now, please use DraftKings for analysis.</span>
            </div>
          )}
        </div>

        {/* Presets Dropdown */}
        <div className={`space-y-2 transition-opacity ${isFanDuel ? 'opacity-50 pointer-events-none' : ''}`}>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Load a Preset</label>
          <select 
            onChange={(e) => loadPreset(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-cloud-darker dark:border-gray-600 bg-cloud dark:bg-charcoal text-xs font-medium focus:ring-2 focus:ring-brand outline-none appearance-none cursor-pointer"
            value={CONTEST_PRESETS.some(p => p.name === input.contestName) ? input.contestName : ""}
          >
            <option value="" disabled>Select a preset...</option>
            {CONTEST_PRESETS.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Entry Fee Slider */}
        <div className={`space-y-2 transition-opacity ${isFanDuel ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex justify-between items-end">
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Entry Fee</label>
            <span className="text-sm font-bold text-brand">${input.entryFee.toFixed(2)}</span>
          </div>
          <input 
            type="range"
            min="0"
            max={FEE_STEPS.length - 1}
            step="1"
            value={feeIndex}
            onChange={(e) => handleChange('entryFee', FEE_STEPS[parseInt(e.target.value)])}
            className="w-full h-1.5 bg-cloud dark:bg-charcoal rounded-lg appearance-none cursor-pointer accent-brand"
          />
        </div>

        {/* Field Size */}
        <div className={`space-y-2 transition-opacity ${isFanDuel ? 'opacity-50 pointer-events-none' : ''}`}>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Field Size</label>
          <input 
            type="number" 
            min="0"
            value={input.fieldSize} 
            onChange={(e) => handleChange('fieldSize', Math.max(0, parseInt(e.target.value) || 0))}
            className="w-full px-3 py-2 rounded-lg border border-cloud-darker dark:border-gray-600 bg-cloud dark:bg-charcoal focus:ring-2 focus:ring-brand outline-none text-xs font-medium"
          />
        </div>

        {/* Max Entries */}
        <div className={`space-y-2 transition-opacity ${isFanDuel ? 'opacity-50 pointer-events-none' : ''}`}>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Max Entries</label>
          <input 
            type="number" 
            min="0"
            value={input.maxEntries} 
            onChange={(e) => handleChange('maxEntries', Math.max(0, parseInt(e.target.value) || 0))}
            className="w-full px-3 py-2 rounded-lg border border-cloud-darker dark:border-gray-600 bg-cloud dark:bg-charcoal focus:ring-2 focus:ring-brand outline-none text-xs font-medium"
          />
        </div>

        {/* Advanced Economics Toggle */}
        <div className={`pt-2 border-t border-cloud-darker dark:border-charcoal space-y-4 transition-opacity ${isFanDuel ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-700 dark:text-gray-300">
              Advanced Economics
            </span>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${showAdvanced ? 'bg-brand' : 'bg-gray-200 dark:bg-gray-700'}`}
              role="switch"
              aria-checked={showAdvanced}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${showAdvanced ? 'translate-x-4' : 'translate-x-0'}`}
              />
            </button>
          </div>

          {showAdvanced && (
            <div className="space-y-4 animate-in fade-in slide-in-from-top-1">
              <div className="space-y-2">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Rake %</label>
                <input 
                  type="number" 
                  step="0.001"
                  min="0"
                  value={input.rakePct} 
                  onChange={(e) => handleChange('rakePct', Math.max(0, parseFloat(e.target.value) || 0))}
                  className="w-full px-4 py-2 rounded-lg border border-cloud-darker dark:border-gray-600 bg-white dark:bg-charcoal focus:ring-2 focus:ring-brand outline-none text-xs font-medium"
                />
              </div>

            </div>
          )}
        </div>

        {/* Instructional Text */}
        <div className="pt-2 border-t border-cloud-darker dark:border-charcoal">
          <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-snug">
            Evaluations update live. Use industry presets or enter manual prize pool economics for a more accurate check.
          </p>
        </div>
      </div>
    </div>
  );
};
