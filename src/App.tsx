import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import {
  Home,
  List,
  PieChart,
  Users,
  Plus,
  Settings as SettingsIcon,
  AlertTriangle,
  BarChart3,
  Repeat,
  Target,
  MoreHorizontal,
  X,
  Sun,
  Moon,
  Laptop,
  SlidersHorizontal,
  Eye,
  EyeOff,
  FileText,
} from 'lucide-react';
import { usePrivacyStore } from './store/privacyStore';
import { purgeMockData, deduplicateCategories } from './utils/initDb';
import { processDueRecurringTransactions } from './utils/recurringEngine';
import { useUIStore } from './store/uiStore';
import { useThemeStore } from './store/themeStore';
import { useAuthStore } from './store/authStore';
import { useNavStore, ALL_NAV_ITEMS } from './store/navStore';
import type { NavItemId } from './store/navStore';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import { useSync } from './hooks/useSync';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Activity from './pages/Activity';
import Debts from './pages/Debts';
import Settings from './pages/Settings';
import Connections from './pages/Connections';
import BudgetDetail from './pages/BudgetDetail';
import Analytics from './pages/Analytics';
import Recurring from './pages/Recurring';
import Goals from './pages/Goals';
import FloatTools from './pages/FloatTools';
import StatementReader from './pages/StatementReader';
import Auth from './pages/Auth';
import ResetPassword from './pages/ResetPassword';
import TransactionModal from './components/TransactionModal';
import GlobalUndoToast from './components/GlobalUndoToast';
import BudgetModal from './components/BudgetModal';
import MigrateLocalDataBanner from './components/MigrateLocalDataBanner';
import CustomizeNavModal from './components/CustomizeNavModal';
import Logo from './components/Logo';
import Maintenance from './pages/Maintenance';
import Skip from './pages/Skip';
import { MAINTENANCE_CONFIG, isMaintenanceBypassed, setMaintenanceBypass } from './config/maintenance';

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

// ── Desktop Sidebar ──────────────────────────────────────────────────────────
function DesktopSidebar({ syncStatus }: { syncStatus: 'idle' | 'syncing' | 'error' }) {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;
  const { setAddTransactionModalOpen } = useUIStore();
  const { user } = useAuthStore();
  const { theme, setTheme } = useThemeStore();
  const { isMasked, toggleMask } = usePrivacyStore();

  const navItems = [
    { to: '/', label: 'Home', icon: Home },
    { to: '/accounts', label: 'Accounts', icon: PieChart },
    { to: '/activity', label: 'Activity', icon: List },
    { to: '/analytics', label: 'Analytics', icon: BarChart3 },
    { to: '/goals', label: 'Savings Goals', icon: Target },
    { to: '/recurring', label: 'Recurring', icon: Repeat },
    { to: '/debts', label: 'IOUs & Debts', icon: Users },
    { to: '/statements', label: 'Statement Reader', icon: FileText },
    { to: '/connections', label: 'Friends & Connections', icon: Users },
      { to: '/settings', label: 'Settings', icon: SettingsIcon },
  ];

  return (
    <aside className="hidden md:flex flex-col justify-between w-64 h-screen sticky top-0 bg-card/60 backdrop-blur-md border-r border-border p-4 z-30 shrink-0">
      <div className="space-y-6">
        {/* Brand & Sync indicator */}
        <div className="flex items-center justify-between px-2 pt-2">
          <Link to="/" className="flex items-center gap-2.5 group">
            <Logo size={26} className="transition-transform group-hover:scale-105" />
            <span className="text-xl font-bold tracking-tight text-foreground">Finora</span>
          </Link>
          <div className="flex items-center gap-1.5 text-xs">
            <button
              onClick={toggleMask}
              className={`p-1.5 rounded-lg transition-colors ${
                isMasked
                  ? 'bg-accent/20 text-accent'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              title={isMasked ? 'Privacy Mask: Active (Click to Reveal)' : 'Privacy Mask: Inactive (Click to Mask)'}
            >
              {isMasked ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
            {syncStatus === 'syncing' && (
              <span className="flex items-center gap-1 text-accent text-[11px]">
                <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
              </span>
            )}
            {syncStatus === 'error' && (
              <span className="text-amber-500" title="Sync issue">
                <AlertTriangle size={14} />
              </span>
            )}
            {syncStatus === 'idle' && (
              <span className="w-2 h-2 rounded-full bg-emerald-500/60" title="Cloud synchronized" />
            )}
          </div>
        </div>

        {/* Desktop Quick Add Button */}
        <button
          onClick={() => setAddTransactionModalOpen(true)}
          className="w-full py-2.5 px-4 bg-accent text-accent-foreground rounded-xl text-xs font-semibold flex items-center justify-between shadow-sm active:scale-[0.98] transition-transform"
        >
          <div className="flex items-center gap-2">
            <Plus size={16} />
            <span>New Transaction</span>
          </div>
          <kbd className="text-[10px] bg-accent-foreground/20 text-accent-foreground px-1.5 py-0.5 rounded font-mono">
            N
          </kbd>
        </button>

        {/* Nav Links */}
        <nav className="space-y-1">
          {navItems.map(item => {
            const Icon = item.icon;
            const active = isActive(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-colors ${
                  active
                    ? 'bg-foreground text-background font-semibold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                }`}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Footer Profile & Theme Toggle */}
      <div className="pt-4 border-t border-border space-y-3">
        <div className="flex items-center justify-between px-2 text-xs text-muted-foreground">
          <span className="truncate max-w-[130px] font-medium text-foreground">
            {user?.email || 'Guest Session'}
          </span>
          <div className="flex items-center gap-1 bg-muted p-1 rounded-lg">
            <button
              onClick={() => setTheme('light')}
              className={`p-1 rounded ${theme === 'light' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground'}`}
              title="Light Mode"
            >
              <Sun size={12} />
            </button>
            <button
              onClick={() => setTheme('dark')}
              className={`p-1 rounded ${theme === 'dark' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground'}`}
              title="Dark Mode"
            >
              <Moon size={12} />
            </button>
            <button
              onClick={() => setTheme('system')}
              className={`p-1 rounded ${theme === 'system' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground'}`}
              title="System Default"
            >
              <Laptop size={12} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function getNavIcon(id: NavItemId) {
  switch (id) {
    case 'home':
      return Home;
    case 'accounts':
      return PieChart;
    case 'activity':
      return List;
    case 'debts':
      return Users;
    case 'analytics':
      return BarChart3;
    case 'goals':
      return Target;
    case 'recurring':
      return Repeat;
    case 'float-tools':
      return BarChart3;
    case 'budgets':
      return PieChart;
    case 'statement-reader':
      return FileText;
    case 'connections':
      return Users;
    case 'settings':
      return SettingsIcon;
    default:
      return Home;
  }
}

// ── Mobile Bottom Nav ────────────────────────────────────────────────────────
function MobileBottomNav({ syncStatus }: { syncStatus: 'idle' | 'syncing' | 'error' }) {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;
  const { setAddTransactionModalOpen } = useUIStore();
  const { frontItemIds, getHiddenItemIds, setCustomizeModalOpen } = useNavStore();
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const { isMasked, toggleMask } = usePrivacyStore();

  const hiddenItemIds = getHiddenItemIds();
  const hasMore = hiddenItemIds.length > 0;

  return (
    <>
      {/* Floating Quick Add FAB on Mobile - Mathematically centered to viewport */}
      <button
        onClick={() => setAddTransactionModalOpen(true)}
        className="md:hidden fixed bottom-20 left-1/2 -translate-x-1/2 z-40 pointer-events-auto w-14 h-14 rounded-full bg-foreground text-background shadow-xl hover:opacity-90 active:scale-95 transition-transform flex items-center justify-center"
        title="Add transaction"
      >
        <Plus size={24} strokeWidth={2.25} />
      </button>

      {/* Mobile "More" Drawer for hidden items */}
      {isMoreOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-background/70 backdrop-blur-sm flex flex-col justify-end p-4 animate-in fade-in duration-150"
          onClick={() => setIsMoreOpen(false)}
        >
          <div
            className="bg-card border border-border rounded-2xl p-4 shadow-xl space-y-2 mb-20 max-w-md mx-auto w-full animate-in slide-in-from-bottom-4 duration-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
                  Explore More
                </span>
                <button
                  onClick={() => {
                    setIsMoreOpen(false);
                    setCustomizeModalOpen(true);
                  }}
                  className="flex items-center gap-1 text-[11px] font-medium text-accent hover:underline ml-1"
                >
                  <SlidersHorizontal size={12} />
                  <span>Customize</span>
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleMask}
                  className={`p-1.5 rounded-lg border transition-colors ${
                    isMasked
                      ? 'bg-accent/20 border-accent/40 text-accent font-semibold'
                      : 'bg-muted/40 border-border text-muted-foreground hover:text-foreground'
                  }`}
                  title={isMasked ? 'Reveal figures' : 'Mask figures (Privacy mode)'}
                >
                  {isMasked ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
                <button onClick={() => setIsMoreOpen(false)} className="p-1 text-muted-foreground">
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className={`grid ${hiddenItemIds.length <= 2 ? 'grid-cols-2' : 'grid-cols-3'} gap-2 pt-1`}>
              {hiddenItemIds.map(id => {
                const item = ALL_NAV_ITEMS.find(i => i.id === id);
                if (!item) return null;
                const Icon = getNavIcon(id);
                const active = isActive(item.to);
                const isSettings = id === 'settings';
                return (
                  <Link
                    key={id}
                    to={item.to}
                    onClick={() => setIsMoreOpen(false)}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl transition-colors ${
                      active
                        ? 'bg-accent text-accent-foreground font-semibold'
                        : 'bg-muted/50 hover:bg-muted text-foreground'
                    } text-xs font-medium`}
                  >
                    <div className="relative mb-1">
                      <Icon size={20} />
                      {isSettings && syncStatus === 'syncing' && (
                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent animate-pulse" />
                      )}
                      {isSettings && syncStatus === 'error' && (
                        <span className="absolute -top-1 -right-1 text-orange-400">
                          <AlertTriangle size={10} />
                        </span>
                      )}
                    </div>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>

            {/* Advanced Tools Shortcuts */}
            <div className="pt-2 border-t border-border grid grid-cols-2 gap-2">
              <Link
                to="/statements"
                onClick={() => setIsMoreOpen(false)}
                className={`flex items-center gap-2 p-2.5 rounded-xl border border-border transition-colors text-xs font-medium ${
                  isActive('/statements')
                    ? 'bg-accent text-accent-foreground font-semibold'
                    : 'bg-muted/30 hover:bg-muted text-foreground'
                }`}
              >
                <FileText size={16} className="text-accent shrink-0" />
                <span className="truncate">Statement Reader</span>
              </Link>
              <Link
                to="/float-tools"
                onClick={() => setIsMoreOpen(false)}
                className={`flex items-center gap-2 p-2.5 rounded-xl border border-border transition-colors text-xs font-medium ${
                  isActive('/float-tools')
                    ? 'bg-accent text-accent-foreground font-semibold'
                    : 'bg-muted/30 hover:bg-muted text-foreground'
                }`}
              >
                <SlidersHorizontal size={16} className="text-accent shrink-0" />
                <span className="truncate">Float Tools</span>
              </Link>
            </div>

          </div>
        </div>
      )}

      {/* Mobile Fixed Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 w-full max-w-md mx-auto bg-background/95 backdrop-blur-md border-t border-border pb-safe z-40">
        <div className="flex justify-around items-center h-16 px-1">
          {frontItemIds.map(id => {
            const item = ALL_NAV_ITEMS.find(i => i.id === id);
            if (!item) return null;
            const Icon = getNavIcon(id);
            const active = isActive(item.to);
            const isSettings = id === 'settings';
            return (
              <Link
                key={id}
                to={item.to}
                className={`flex flex-col items-center justify-center w-full h-full ${
                  active ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                <div className="relative">
                  <Icon size={22} />
                  {isSettings && syncStatus === 'syncing' && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent animate-pulse" />
                  )}
                  {isSettings && syncStatus === 'error' && (
                    <span className="absolute -top-1 -right-1 text-orange-400">
                      <AlertTriangle size={10} />
                    </span>
                  )}
                </div>
                <span className="text-[10px] mt-1 font-medium">{item.label}</span>
              </Link>
            );
          })}

          {/* More Menu on Mobile */}
          {hasMore && (
            <button
              onClick={() => setIsMoreOpen(!isMoreOpen)}
              className={`flex flex-col items-center justify-center w-full h-full ${
                isMoreOpen || hiddenItemIds.some(id => {
                  const it = ALL_NAV_ITEMS.find(i => i.id === id);
                  return it && isActive(it.to);
                })
                  ? 'text-foreground'
                  : 'text-muted-foreground'
              }`}
            >
              <div className="relative">
                <MoreHorizontal size={22} />
                {hiddenItemIds.includes('settings') && syncStatus === 'syncing' && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent animate-pulse" />
                )}
                {hiddenItemIds.includes('settings') && syncStatus === 'error' && (
                  <span className="absolute -top-1 -right-1 text-orange-400">
                    <AlertTriangle size={10} />
                  </span>
                )}
              </div>
              <span className="text-[10px] mt-1 font-medium">More</span>
            </button>
          )}
        </div>
      </nav>
    </>
  );
}

// ── Main App Shell (Full Application) ───────────────────────────────────────
function MainAppShell() {
  const { syncStatus } = useSync();
  const location = useLocation();
  const { setAddTransactionModalOpen } = useUIStore();
  const hideNav = location.pathname === '/auth' || location.pathname === '/reset-password';

  // Global Keyboard Shortcuts (N for new transaction)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl?.getAttribute('contenteditable') === 'true';

      if (isInput) return;

      if ((e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setAddTransactionModalOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setAddTransactionModalOpen]);

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col md:flex-row">
      {/* Desktop Sidebar (hidden on mobile) */}
      {!hideNav && <DesktopSidebar syncStatus={syncStatus} />}

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 min-h-[100dvh] overflow-y-auto">
        <div className="w-full min-h-[100dvh]">
          <Routes>
            <Route
              path="/"
              element={
                <>
                  <MigrateLocalDataBanner />
                  <Dashboard />
                </>
              }
            />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/goals" element={<Goals />} />
            <Route path="/recurring" element={<Recurring />} />
            <Route path="/debts" element={<Debts />} />
            <Route path="/connections" element={<Connections />} />
              <Route path="/settings" element={<Settings />} />
            <Route path="/budget" element={<BudgetDetail />} />
            <Route path="/float-tools" element={<FloatTools />} />
            <Route path="/statements" element={<StatementReader />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/skip" element={<Skip />} />
          </Routes>
        </div>
      </main>

      {/* Mobile Bottom Nav */}
      {!hideNav && <MobileBottomNav syncStatus={syncStatus} />}

      {/* Global Modals & Toasts */}
      {!hideNav && <TransactionModal />}
      {!hideNav && <BudgetModal />}
      {!hideNav && <CustomizeNavModal />}
      <GlobalUndoToast />
    </div>
  );
}

// ── App Shell Router Gate (Maintenance Mode & Skip Handling) ─────────────────
function AppShell() {
  const location = useLocation();
  const [bypassed, setBypassed] = useState(() => isMaintenanceBypassed());

  // Check URL query parameters (e.g. ?skip=true or ?bypass=true)
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    if (searchParams.get('skip') === 'true' || searchParams.get('bypass') === 'true') {
      setMaintenanceBypass(true);
      setBypassed(true);
    }
  }, [location.search]);

  // When maintenance is active and visitor hasn't unlocked bypass:
  if (MAINTENANCE_CONFIG.enabled && !bypassed) {
    if (location.pathname === '/skip') {
      return <Skip onBypass={() => setBypassed(true)} />;
    }
    return <Maintenance onBypass={() => setBypassed(true)} />;
  }

  return <MainAppShell />;
}

// ── Root App ─────────────────────────────────────────────────────────────────
function App() {
  const { setUser, setAuthLoading } = useAuthStore();

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setAuthLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null, session);
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null, session);
    });

    return () => subscription.unsubscribe();
  }, [setUser, setAuthLoading]);

  useEffect(() => {
    if (!MAINTENANCE_CONFIG.enabled || isMaintenanceBypassed()) {
      purgeMockData();
      deduplicateCategories();
      processDueRecurringTransactions();
    }
  }, []);

  return (
    <BrowserRouter>
      <ThemeInitializer />
      <AppShell />
    </BrowserRouter>
  );
}

export default App;

