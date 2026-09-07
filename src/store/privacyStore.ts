import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface PrivacyState {
  isMasked: boolean;
  toggleMask: () => void;
  setMasked: (masked: boolean) => void;

  // Home customization preferences
  showSafeToSpendHome: boolean;
  setShowSafeToSpendHome: (show: boolean) => void;
  safeToSpendForecastDays: number;
  setSafeToSpendForecastDays: (days: number) => void;

  // Fast-Entry preferences
  oneTapLogMode: boolean; // default false (review form first), true = 1-tap instant log
  setOneTapLogMode: (mode: boolean) => void;
  showQuickAddHome: boolean; // default false (off by default on Home)
  setShowQuickAddHome: (show: boolean) => void;
  pinnedQuickNotes: string[];
  setPinnedQuickNotes: (notes: string[]) => void;
  togglePinQuickNote: (note: string) => void;
  hiddenQuickNotes: string[];
  setHiddenQuickNotes: (notes: string[]) => void;
  hideQuickNote: (note: string) => void;
}

export const usePrivacyStore = create<PrivacyState>()(
  persist(
    (set) => ({
      isMasked: false,
      toggleMask: () => set((state) => ({ isMasked: !state.isMasked })),
      setMasked: (isMasked) => set({ isMasked }),

      showSafeToSpendHome: false, // OFF by default as specified
      setShowSafeToSpendHome: (showSafeToSpendHome) => set({ showSafeToSpendHome }),
      safeToSpendForecastDays: 14, // 14 days default
      setSafeToSpendForecastDays: (safeToSpendForecastDays) => set({ safeToSpendForecastDays }),

      oneTapLogMode: false,
      setOneTapLogMode: (oneTapLogMode) => set({ oneTapLogMode }),
      showQuickAddHome: false,
      setShowQuickAddHome: (showQuickAddHome) => set({ showQuickAddHome }),
      pinnedQuickNotes: [],
      setPinnedQuickNotes: (pinnedQuickNotes) => set({ pinnedQuickNotes }),
      togglePinQuickNote: (note) =>
        set((state) => {
          const lower = note.trim().toLowerCase();
          const exists = state.pinnedQuickNotes.some((n) => n.trim().toLowerCase() === lower);
          return {
            pinnedQuickNotes: exists
              ? state.pinnedQuickNotes.filter((n) => n.trim().toLowerCase() !== lower)
              : [...state.pinnedQuickNotes, note.trim()],
          };
        }),
      hiddenQuickNotes: [],
      setHiddenQuickNotes: (hiddenQuickNotes) => set({ hiddenQuickNotes }),
      hideQuickNote: (note) =>
        set((state) => {
          const lower = note.trim().toLowerCase();
          if (state.hiddenQuickNotes.some((n) => n.trim().toLowerCase() === lower)) {
            return state;
          }
          return { hiddenQuickNotes: [...state.hiddenQuickNotes, note.trim()] };
        }),
    }),
    {
      name: 'finora_user_preferences',
    }
  )
);

