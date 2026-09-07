import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type NavItemId =
  | 'home'
  | 'accounts'
  | 'activity'
  | 'analytics'
  | 'goals'
  | 'recurring'
  | 'debts';

export interface NavItemConfig {
  id: NavItemId;
  label: string;
  to: string;
}

export const ALL_NAV_ITEMS: NavItemConfig[] = [
  { id: 'home', label: 'Home', to: '/' },
  { id: 'accounts', label: 'Accounts', to: '/accounts' },
  { id: 'activity', label: 'Activity', to: '/activity' },
  { id: 'debts', label: 'IOUs', to: '/debts' },
  { id: 'analytics', label: 'Analytics', to: '/analytics' },
  { id: 'goals', label: 'Goals', to: '/goals' },
  { id: 'recurring', label: 'Recurring', to: '/recurring' },
];

export const DEFAULT_FRONT_ITEMS: NavItemId[] = ['home', 'accounts', 'activity', 'debts'];

interface NavState {
  frontItemIds: NavItemId[];
  isCustomizeModalOpen: boolean;
  setCustomizeModalOpen: (open: boolean) => void;
  moveToFront: (id: NavItemId) => boolean;
  moveToMore: (id: NavItemId) => boolean;
  moveItem: (id: NavItemId, direction: 'up' | 'down') => void;
  resetToDefault: () => void;
  // Computed helpers
  getHiddenItemIds: () => NavItemId[];
  getTotalBarCount: (frontIds?: NavItemId[]) => number;
}

export const useNavStore = create<NavState>()(
  persist(
    (set, get) => ({
      frontItemIds: DEFAULT_FRONT_ITEMS,
      isCustomizeModalOpen: false,

      setCustomizeModalOpen: (open) => set({ isCustomizeModalOpen: open }),

      getHiddenItemIds: () => {
        const { frontItemIds } = get();
        const frontSet = new Set(frontItemIds);
        return ALL_NAV_ITEMS.map(i => i.id).filter(id => !frontSet.has(id));
      },

      getTotalBarCount: (candidateFrontIds?: NavItemId[]) => {
        const front = candidateFrontIds ?? get().frontItemIds;
        const hiddenCount = ALL_NAV_ITEMS.length - front.length;
        const hasMore = hiddenCount > 0;
        // Total options on bottom bar: front items + (1 if More is needed) + 1 (Settings)
        return front.length + (hasMore ? 1 : 0) + 1;
      },

      moveToFront: (id: NavItemId) => {
        const { frontItemIds, getTotalBarCount } = get();
        if (frontItemIds.includes(id)) return false;
        const newFront = [...frontItemIds, id];
        const newTotal = getTotalBarCount(newFront);
        if (newTotal > 6) {
          return false; // exceeds maximum 6 options
        }
        set({ frontItemIds: newFront });
        return true;
      },

      moveToMore: (id: NavItemId) => {
        const { frontItemIds, getTotalBarCount } = get();
        if (!frontItemIds.includes(id)) return false;
        const newFront = frontItemIds.filter(itemId => itemId !== id);
        const newTotal = getTotalBarCount(newFront);
        if (newTotal < 4) {
          return false; // below minimum 4 options
        }
        set({ frontItemIds: newFront });
        return true;
      },

      moveItem: (id: NavItemId, direction: 'up' | 'down') => {
        const { frontItemIds } = get();
        const index = frontItemIds.indexOf(id);
        if (index === -1) return;
        const newIndex = direction === 'up' ? index - 1 : index + 1;
        if (newIndex < 0 || newIndex >= frontItemIds.length) return;

        const newFront = [...frontItemIds];
        const [moved] = newFront.splice(index, 1);
        newFront.splice(newIndex, 0, moved);
        set({ frontItemIds: newFront });
      },

      resetToDefault: () => {
        set({ frontItemIds: DEFAULT_FRONT_ITEMS });
      },
    }),
    {
      name: 'finora-nav-preferences',
      partialize: (state) => ({ frontItemIds: state.frontItemIds }),
    }
  )
);
