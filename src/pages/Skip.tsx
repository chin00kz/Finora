import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import Logo from '../components/Logo';
import { setMaintenanceBypass } from '../config/maintenance';

interface SkipProps {
  onBypass?: () => void;
}

export default function Skip({ onBypass }: SkipProps) {
  const navigate = useNavigate();

  useEffect(() => {
    // Enable bypass token
    setMaintenanceBypass(true);
    if (onBypass) onBypass();

    // Brief timeout so the user sees confirmation, then redirect to dashboard
    const timer = setTimeout(() => {
      navigate('/', { replace: true });
    }, 600);

    return () => clearTimeout(timer);
  }, [navigate, onBypass]);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6 text-center">
      <div className="bg-card border border-border rounded-3xl p-8 max-w-sm w-full shadow-2xl space-y-4">
        <div className="flex justify-center">
          <Logo size={44} />
        </div>
        <div className="flex items-center justify-center gap-2 text-emerald-500 font-semibold text-lg">
          <CheckCircle2 size={24} />
          <span>Access Granted</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Maintenance bypass activated. Launching Finora...
        </p>
      </div>
    </div>
  );
}

