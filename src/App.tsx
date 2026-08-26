import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Home, List, PieChart, Users, Plus, Settings as SettingsIcon } from 'lucide-react';
import { initDbWithMockData } from './utils/initDb';
import { useUIStore } from './store/uiStore';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Activity from './pages/Activity';
import Debts from './pages/Debts';
import Settings from './pages/Settings';
import BudgetDetail from './pages/BudgetDetail';
import TransactionModal from './components/TransactionModal';
import BudgetModal from './components/BudgetModal';

function BottomNav() {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;
  const { setAddTransactionModalOpen } = useUIStore();

  return (
    <>
      {/* Floating Quick Add FAB */}
      <div className="fixed bottom-20 left-0 right-0 max-w-md mx-auto pointer-events-none flex justify-center z-40">
        <button 
          onClick={() => setAddTransactionModalOpen(true)}
          className="bg-gray-900 text-white p-4 rounded-full shadow-lg active:scale-95 transition-transform pointer-events-auto"
        >
          <Plus size={28} />
        </button>
      </div>

      <nav className="fixed bottom-0 w-full max-w-md mx-auto bg-white border-t border-gray-200 pb-safe z-40">
        <div className="flex justify-around items-center h-16 px-1">
          <Link to="/" className={`flex flex-col items-center justify-center w-full h-full ${isActive('/') ? 'text-gray-900' : 'text-gray-400'}`}>
            <Home size={22} />
            <span className="text-[10px] mt-1 font-medium">Home</span>
          </Link>
          <Link to="/accounts" className={`flex flex-col items-center justify-center w-full h-full ${isActive('/accounts') ? 'text-gray-900' : 'text-gray-400'}`}>
            <PieChart size={22} />
            <span className="text-[10px] mt-1 font-medium">Accounts</span>
          </Link>
          <Link to="/activity" className={`flex flex-col items-center justify-center w-full h-full ${isActive('/activity') ? 'text-gray-900' : 'text-gray-400'}`}>
            <List size={22} />
            <span className="text-[10px] mt-1 font-medium">Activity</span>
          </Link>
          <Link to="/debts" className={`flex flex-col items-center justify-center w-full h-full ${isActive('/debts') ? 'text-gray-900' : 'text-gray-400'}`}>
            <Users size={22} />
            <span className="text-[10px] mt-1 font-medium">IOUs</span>
          </Link>
          <Link to="/settings" className={`flex flex-col items-center justify-center w-full h-full ${isActive('/settings') ? 'text-gray-900' : 'text-gray-400'}`}>
            <SettingsIcon size={22} />
            <span className="text-[10px] mt-1 font-medium">Settings</span>
          </Link>
        </div>
      </nav>
    </>
  );
}

function App() {
  useEffect(() => {
    initDbWithMockData();
  }, []);

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50 flex justify-center">
        {/* Mobile container */}
        <div className="w-full max-w-md bg-white min-h-screen relative shadow-sm pb-20">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="/debts" element={<Debts />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/budget" element={<BudgetDetail />} />
          </Routes>
          <BottomNav />
          <TransactionModal />
          <BudgetModal />
        </div>
      </div>
    </BrowserRouter>
  );
}

export default App;
