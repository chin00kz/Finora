import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Home, List, PieChart, Users, Plus } from 'lucide-react';
import { initDbWithMockData } from './utils/initDb';
import { useUIStore } from './store/uiStore';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Activity from './pages/Activity';
import Debts from './pages/Debts';
import TransactionModal from './components/TransactionModal';

function BottomNav() {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;
  const { setAddTransactionModalOpen } = useUIStore();

  return (
    <nav className="fixed bottom-0 w-full max-w-md mx-auto bg-white border-t border-gray-200 pb-safe">
      <div className="flex justify-around items-center h-16 px-2">
        <Link to="/" className={`flex flex-col items-center justify-center w-full h-full ${isActive('/') ? 'text-gray-900' : 'text-gray-400'}`}>
          <Home size={24} />
          <span className="text-[10px] mt-1 font-medium">Home</span>
        </Link>
        <Link to="/accounts" className={`flex flex-col items-center justify-center w-full h-full ${isActive('/accounts') ? 'text-gray-900' : 'text-gray-400'}`}>
          <PieChart size={24} />
          <span className="text-[10px] mt-1 font-medium">Accounts</span>
        </Link>
        
        {/* Quick Add FAB */}
        <div className="flex flex-col items-center justify-center w-full h-full -mt-6">
          <button 
            onClick={() => setAddTransactionModalOpen(true)}
            className="bg-gray-900 text-white p-3 rounded-full shadow-lg active:scale-95 transition-transform"
          >
            <Plus size={28} />
          </button>
        </div>

        <Link to="/activity" className={`flex flex-col items-center justify-center w-full h-full ${isActive('/activity') ? 'text-gray-900' : 'text-gray-400'}`}>
          <List size={24} />
          <span className="text-[10px] mt-1 font-medium">Activity</span>
        </Link>
        <Link to="/debts" className={`flex flex-col items-center justify-center w-full h-full ${isActive('/debts') ? 'text-gray-900' : 'text-gray-400'}`}>
          <Users size={24} />
          <span className="text-[10px] mt-1 font-medium">IOUs</span>
        </Link>
      </div>
    </nav>
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
          </Routes>
          <BottomNav />
          <TransactionModal />
        </div>
      </div>
    </BrowserRouter>
  );
}

export default App;
