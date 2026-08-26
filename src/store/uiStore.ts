import { create } from 'zustand';

interface UIState {
  isAddTransactionModalOpen: boolean;
  setAddTransactionModalOpen: (isOpen: boolean) => void;
  isBudgetModalOpen: boolean;
  setBudgetModalOpen: (isOpen: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  isAddTransactionModalOpen: false,
  setAddTransactionModalOpen: (isOpen) => set({ isAddTransactionModalOpen: isOpen }),
  isBudgetModalOpen: false,
  setBudgetModalOpen: (isOpen) => set({ isBudgetModalOpen: isOpen }),
}));

