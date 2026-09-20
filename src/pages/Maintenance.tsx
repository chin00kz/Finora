import { useState } from 'react';
import { ShieldCheck, ArrowRight, Sparkles, RefreshCw, KeyRound } from 'lucide-react';
import Logo from '../components/Logo';
import { MAINTENANCE_CONFIG, setMaintenanceBypass } from '../config/maintenance';

interface MaintenanceProps {
  onBypass?: () => void;
}

export default function Maintenance({ onBypass }: MaintenanceProps) {
  const [showSkipPrompt, setShowSkipPrompt] = useState(false);

  const handleSkip = () => {
    setMaintenanceBypass(true);
    if (onBypass) {
      onBypass();
    } else {
      window.location.href = '/';
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col justify-between p-4 sm:p-6 md:p-12 relative overflow-hidden">
      {/* Background decorative ambient glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-accent/10 rounded-full blur-3xl pointer-events-none" />

      {/* Top Header */}
      <header className="w-full max-w-2xl mx-auto flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <Logo size={32} />
          <span className="font-bold text-xl tracking-tight text-foreground">Finora</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span>Maintenance</span>
        </div>
      </header>

      {/* Main Content Card */}
      <main className="w-full max-w-lg mx-auto my-auto z-10 py-10">
        <div className="bg-card border border-border/80 shadow-2xl rounded-3xl p-6 sm:p-8 space-y-6 text-center">
          {/* Animated Icon Avatar */}
          <div className="mx-auto w-16 h-16 rounded-2xl bg-accent/15 border border-accent/25 flex items-center justify-center text-accent shadow-inner">
            <Sparkles size={30} className="animate-pulse text-accent" />
          </div>

          {/* Titles */}
          <div className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              {MAINTENANCE_CONFIG.title}
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
              {MAINTENANCE_CONFIG.description}
            </p>
          </div>

          {/* Status Highlights */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left pt-2">
            <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-muted/40 border border-border/60">
              <ShieldCheck size={20} className="text-emerald-500 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-semibold text-foreground">Data Protected</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Your encrypted local records are completely safe.
                </div>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-muted/40 border border-border/60">
              <RefreshCw size={20} className="text-blue-500 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-semibold text-foreground">Cloud Sync Update</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Enhancing live multi-device syncing speed.
                </div>
              </div>
            </div>
          </div>

          {/* Estimated info note */}
          <p className="text-xs text-muted-foreground font-medium">
            {MAINTENANCE_CONFIG.statusNote}
          </p>

          {/* Quick Skip Section for Authorized/Active Users */}
          <div className="pt-4 border-t border-border/60 space-y-3">
            {!showSkipPrompt ? (
              <button
                type="button"
                onClick={() => setShowSkipPrompt(true)}
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 transition-colors underline-offset-4 hover:underline"
              >
                <KeyRound size={13} />
                <span>Need to use the app right now? (Skip)</span>
              </button>
            ) : (
              <div className="p-4 rounded-2xl bg-accent/10 border border-accent/20 space-y-3 animate-in fade-in slide-in-from-top-2 duration-150">
                <p className="text-xs text-foreground font-medium">
                  Active user bypass enabled. Click below to continue using Finora normally:
                </p>
                <button
                  type="button"
                  onClick={handleSkip}
                  className="w-full py-2.5 px-4 rounded-xl bg-accent text-accent-foreground font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-95 active:scale-[0.99] transition shadow-md"
                >
                  <span>Continue to App</span>
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full max-w-2xl mx-auto text-center text-xs text-muted-foreground/80 py-2 z-10">
        Finora Budget Tracker &bull; System Maintenance
      </footer>
    </div>
  );
}

