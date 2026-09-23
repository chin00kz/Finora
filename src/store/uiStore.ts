import { create } from 'zustand';

export interface UndoToastAction {
  id: string;
  message: string;
  transactionId: string;
  accountId: string;
  amount: number;
  type: 'expense' | 'income';
  createdAt: number;
  durationMs?: number;
}

export interface TransactionPrefill {
  notes?: string;
  amount?: number | string;
  categoryId?: string;
  accountId?: string;
  type?: 'expense' | 'income';
  tagIds?: string[];
}

interface UIState {
  hasDismissedProfileIntroV1: boolean;
  loadDismissedProfileIntroV1: (userId: string) => void;
  setDismissedProfileIntroV1: (userId: string) => void;
  resetProfileIntroState: () => void;
  isAddTransactionModalOpen: boolean;
  setAddTransactionModalOpen: (isOpen: boolean) => void;
  isBudgetModalOpen: boolean;
  setBudgetModalOpen: (isOpen: boolean) => void;

  undoToast: UndoToastAction | null;
  showUndoToast: (action: UndoToastAction) => void;
  dismissUndoToast: () => void;

  prefillData: TransactionPrefill | null;
  setPrefillData: (data: TransactionPrefill | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  hasDismissedProfileIntroV1: false,
  loadDismissedProfileIntroV1: (userId) => {
    set({ hasDismissedProfileIntroV1: localStorage.getItem(`profile_intro_dismissed_v1:${userId}`) === 'true' });
  },
  setDismissedProfileIntroV1: (userId) => {
    localStorage.setItem(`profile_intro_dismissed_v1:${userId}`, 'true');
    set({ hasDismissedProfileIntroV1: true });
  },
  resetProfileIntroState: () => set({ hasDismissedProfileIntroV1: false }),

  isAddTransactionModalOpen: false,
  setAddTransactionModalOpen: (isOpen) =>
    set((state) => ({
      isAddTransactionModalOpen: isOpen,
      // Clear prefillData when closing modal
      prefillData: isOpen ? state.prefillData : null,
    })),
  isBudgetModalOpen: false,
  setBudgetModalOpen: (isOpen) => set({ isBudgetModalOpen: isOpen }),

  undoToast: null,
  showUndoToast: (undoToast) => set({ undoToast }),
  dismissUndoToast: () => set({ undoToast: null }),

  prefillData: null,
  setPrefillData: (prefillData) => set({ prefillData }),
}));






