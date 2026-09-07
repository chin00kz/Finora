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

