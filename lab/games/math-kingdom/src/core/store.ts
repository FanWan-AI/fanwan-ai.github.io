import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface GameState {
  coins: number;
  stars: number;
  energy: number;
  maxEnergy: number;
  xp: number;
  level: number;
  
  // Actions
  addCoins: (amount: number) => void;
  addStars: (amount: number) => void;
  addXp: (amount: number) => void;
  consumeEnergy: (amount: number) => boolean;
  restoreEnergy: (amount: number) => void;
}

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      coins: 0,
      stars: 0,
      energy: 100,
      maxEnergy: 100,
      xp: 0,
      level: 1,

      addCoins: (amount) => set((state) => ({ coins: state.coins + amount })),
      
      addStars: (amount) => set((state) => ({ stars: state.stars + amount })),
      
      addXp: (amount) => set((state) => {
        const newXp = state.xp + amount;
        // Simple level up logic: Level * 100 XP needed
        const nextLevelXp = state.level * 100;
        if (newXp >= nextLevelXp) {
          return { xp: newXp - nextLevelXp, level: state.level + 1 };
        }
        return { xp: newXp };
      }),

      consumeEnergy: (amount) => {
        const { energy } = get();
        if (energy >= amount) {
          set({ energy: energy - amount });
          return true;
        }
        return false;
      },

      restoreEnergy: (amount) => set((state) => ({ 
        energy: Math.min(state.energy + amount, state.maxEnergy) 
      })),
    }),
    {
      name: 'math-kingdom-storage',
    }
  )
);
