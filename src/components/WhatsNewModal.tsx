import { useUIStore } from '../store/uiStore';

export default function WhatsNewModal({ onSetup }: { onSetup: () => void }) {
  const { setDismissedProfileIntroV1 } = useUIStore();

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-card border border-border rounded-2xl p-6 shadow-xl max-w-sm w-full space-y-5 animate-in zoom-in-95 duration-200">
        <div>
          <h2 className="text-xl font-bold text-foreground">Finora is growing</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Connect with people you know and, soon, manage shared IOUs together.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Choose a unique username so friends can find you. <strong className="text-foreground">Your email isn't shown to other users.</strong>
          </p>
        </div>
        <div className="space-y-2">
          <button 
            onClick={onSetup}
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium"
          >
            Set up profile
          </button>
          <button 
            onClick={setDismissedProfileIntroV1}
            className="w-full py-2.5 bg-secondary text-secondary-foreground rounded-xl text-sm font-medium"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}