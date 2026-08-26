import { create } from 'zustand';

interface UIState {
  isAddTransactionModalOpen: boolean;
  setAddTransactionModalOpen: (isOpen: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  isAddTransactionModalOpen: false,
  setAddTransactionModalOpen: (isOpen) => set({ isAddTransactionModalOpen: isOpen }),
}));

