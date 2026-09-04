import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Home, List, PieChart, Users, Plus, Settings as SettingsIcon, AlertTriangle } from 'lucide-react';
import { initDbWithMockData, deduplicateCategories } from './utils/initDb';
import { useUIStore } from './store/uiStore';
import { useThemeStore } from './store/themeStore';
import { useAuthStore } from './store/authStore';
import { supabase } from './lib/supabase';
import { useSync } from './hooks/useSync';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Activity from './pages/Activity';
import Debts from './pages/Debts';
import Settings from './pages/Settings';
import BudgetDetail from './pages/BudgetDetail';
import Auth from './pages/Auth';
import ResetPassword from './pages/ResetPassword';
import TransactionModal from './components/TransactionModal';
import BudgetModal from './components/BudgetModal';
import MigrateLocalDataBanner from './components/MigrateLocalDataBanner';

// ── Theme initializer ────────────────────────────────────────────────────────
function ThemeInitializer() {
  const { theme } = useThemeStore();

  useEffect(() => {
    const root = document.documentElement;

    const applyTheme = () => {
      if (theme === 'dark') {
        root.classList.add('dark');
      } else if (theme === 'light') {
        root.classList.remove('dark');
      } else {
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
      }
    };

    applyTheme();

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = () => applyTheme();
      mediaQuery.addEventListener('change', listener);
      return () => mediaQuery.removeEventListener('change', listener);
    }
  }, [theme]);

  return null;
}

// ── Bottom nav ───────────────────────────────────────────────────────────────
function BottomNav({ syncStatus }: { syncStatus: 'idle' | 'syncing' | 'error' }) {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;
  const { setAddTransactionModalOpen } = useUIStore();

  return (
    <>
      {/* Floating Quick Add FAB */}
      <div className="fixed bottom-20 left-0 right-0 max-w-md mx-auto pointer-events-none flex justify-center z-40">
        <button
          onClick={() => setAddTransactionModalOpen(true)}
          className="bg-accent text-accent-foreground p-4 rounded-full shadow-lg active:scale-95 transition-transform pointer-events-auto"
        >
          <Plus size={28} />
        </button>
      </div>

      <nav className="fixed bottom-0 w-full max-w-md mx-auto bg-background border-t border-border pb-safe z-40">
        <div className="flex justify-around items-center h-16 px-1">
          <Link to="/" className={`flex flex-col items-center justify-center w-full h-full ${isActive('/') ? 'text-foreground' : 'text-muted-foreground'}`}>
            <Home size={22} />
            <span className="text-[10px] mt-1 font-medium">Home</span>
          </Link>
          <Link to="/accounts" className={`flex flex-col items-center justify-center w-full h-full ${isActive('/accounts') ? 'text-foreground' : 'text-muted-foreground'}`}>
            <PieChart size={22} />
            <span className="text-[10px] mt-1 font-medium">Accounts</span>
          </Link>
          <Link to="/activity" className={`flex flex-col items-center justify-center w-full h-full ${isActive('/activity') ? 'text-foreground' : 'text-muted-foreground'}`}>
            <List size={22} />
            <span className="text-[10px] mt-1 font-medium">Activity</span>
          </Link>
          <Link to="/debts" className={`flex flex-col items-center justify-center w-full h-full ${isActive('/debts') ? 'text-foreground' : 'text-muted-foreground'}`}>
            <Users size={22} />
            <span className="text-[10px] mt-1 font-medium">IOUs</span>
          </Link>

          {/* Settings — shows sync indicator when relevant */}
          <Link to="/settings" className={`relative flex flex-col items-center justify-center w-full h-full ${isActive('/settings') ? 'text-foreground' : 'text-muted-foreground'}`}>
            <div className="relative">
              <SettingsIcon size={22} />
              {/* Syncing spinner */}
              {syncStatus === 'syncing' && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent animate-pulse" />
              )}
              {/* Sync error badge */}
              {syncStatus === 'error' && (
                <span className="absolute -top-1 -right-1 text-orange-400">
                  <AlertTriangle size={10} />
                </span>
              )}
            </div>
            <span className="text-[10px] mt-1 font-medium">Settings</span>
          </Link>
        </div>
      </nav>
    </>
  );
}

// ── Sync wrapper — must be inside BrowserRouter ──────────────────────────────
function AppShell() {
  const { syncStatus } = useSync();

  // Prevent FAB from showing on auth/reset-password routes
  const location = useLocation();
  const hideNav = location.pathname === '/auth' || location.pathname === '/reset-password';

  return (
    <div className="min-h-screen bg-muted flex justify-center">
      <div className="w-full max-w-md bg-background min-h-screen relative shadow-sm pb-20">
        <Routes>
          <Route path="/" element={<><MigrateLocalDataBanner /><Dashboard /></>} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/debts" element={<Debts />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/budget" element={<BudgetDetail />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/reset-password" element={<ResetPassword />} />
        </Routes>
        {!hideNav && <BottomNav syncStatus={syncStatus} />}
        {!hideNav && <TransactionModal />}
        {!hideNav && <BudgetModal />}
      </div>
    </div>
  );
}

// ── Root App ─────────────────────────────────────────────────────────────────
function App() {
  const { setUser, setAuthLoading } = useAuthStore();

  useEffect(() => {
    // Restore session on startup (silent — no redirect)
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null, session);
      setAuthLoading(false);
    });

    // Listen for auth state changes (sign in, sign out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null, session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    initDbWithMockData();
    deduplicateCategories();
  }, []);

  return (
    <BrowserRouter>
      <ThemeInitializer />
      <AppShell />
    </BrowserRouter>
  );
}

export default App;

