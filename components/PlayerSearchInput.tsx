import React, { useState, useMemo } from 'react';
import { Player } from '../types';
import { X, Search } from 'lucide-react';

interface Props {
  players: Player[];
  onSelect: (player: Player) => void;
  selectedPlayerId: string;
  onClear?: () => void;
}

export const PlayerSearchInput: React.FC<Props> = ({ players, onSelect, selectedPlayerId, onClear }) => {
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const selectedPlayer = useMemo(() => players.find(p => p.id === selectedPlayerId), [players, selectedPlayerId]);

  const filteredPlayers = useMemo(() => {
    const playersToShow = players.filter(p => 
      p.name.toLowerCase().includes(search.toLowerCase())
    );
    return playersToShow.slice(0, 5);
  }, [players, search]);

  const handleSelect = (player: Player) => {
    onSelect(player);
    setSearch('');
    setIsOpen(false);
  };

  const handleClear = () => {
    setSearch('');
    setIsOpen(false);
    onClear?.();
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/40" />
        <input 
          type="text"
          placeholder="Search player..."
          value={isOpen ? search : (selectedPlayer ? selectedPlayer.name : search)}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => {
            setIsOpen(true);
            setSearch('');
          }}
          onBlur={() => setTimeout(() => setIsOpen(false), 100)}
          className="w-full bg-white/60 border border-ink/20 rounded-sm pl-10 pr-10 py-2 text-xs font-bold text-ink focus:border-drafting-orange outline-none transition-all placeholder:text-ink/30 uppercase tracking-widest"
        />
        {(selectedPlayer || search) && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-sm text-ink/40 hover:text-ink hover:bg-ink/10 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {isOpen && filteredPlayers.length > 0 && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-ink/10 rounded-sm shadow-lg">
          {filteredPlayers.map(player => (
            <div 
              key={player.id}
              onMouseDown={() => handleSelect(player)}
              className="px-4 py-2 hover:bg-ink/5 cursor-pointer text-xs font-bold text-ink uppercase"
            >
              {player.name} ({player.team})
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
