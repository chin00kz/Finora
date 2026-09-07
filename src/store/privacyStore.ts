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
    }),
    {
      name: 'finora_user_preferences',
    }
  )
);
