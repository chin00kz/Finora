import { useState } from 'react';
import { Upload, X } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { syncAll } from '../sync/syncEngine';

const DISMISSED_KEY = 'finora-migrate-dismissed';

export default function MigrateLocalDataBanner() {
  const { user } = useAuthStore();
  const [isUploading, setIsUploading] = useState(false);
  const [done, setDone] = useState(false);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISSED_KEY) === 'true'
  );

  if (!user || dismissed || done) return null;

  const handleUpload = async () => {
    setIsUploading(true);
    await syncAll(user.id);
    setIsUploading(false);
    setDone(true);
    localStorage.setItem(DISMISSED_KEY, 'true');
  };

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem(DISMISSED_KEY, 'true');
  };

  return (
    <div className="mx-6 mb-4 p-4 bg-accent/10 border border-accent/20 rounded-2xl flex items-start gap-3">
      <Upload size={18} className="text-accent mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">Upload local data to your account?</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Back up your existing transactions, accounts, and budgets so they sync to all your devices.
        </p>
        <div className="flex gap-2 mt-3">
          <button
            onClick={handleUpload}
            disabled={isUploading}
            className="px-3 py-1.5 bg-accent text-accent-foreground text-xs font-medium rounded-lg active:scale-95 transition-transform disabled:opacity-60"
          >
            {isUploading ? 'Uploading…' : 'Upload'}
          </button>
          <button
            onClick={handleDismiss}
            className="px-3 py-1.5 bg-muted text-muted-foreground text-xs font-medium rounded-lg active:scale-95 transition-transform"
          >
            Skip
          </button>
        </div>
      </div>
      <button onClick={handleDismiss} className="text-muted-foreground flex-shrink-0">
        <X size={16} />
      </button>
    </div>
  );
}

