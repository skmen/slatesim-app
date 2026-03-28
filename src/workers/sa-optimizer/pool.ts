import { Player, PlayerPool } from './types';

export function buildPlayerPool(players: Player[]): PlayerPool {
  const byId = new Map<string, Player>();
  const byPosition = new Map<string, Player[]>();

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    byId.set(player.id, player);

    for (let j = 0; j < player.positions.length; j++) {
      const pos = player.positions[j];
      let bucket = byPosition.get(pos);
      if (!bucket) {
        bucket = [];
        byPosition.set(pos, bucket);
      }
      bucket.push(player);
    }
  }

  byPosition.forEach((bucket) => {
    bucket.sort((a, b) => b.projection - a.projection);
  });

  return {
    all: players,
    byPosition,
    byId,
  };
}

