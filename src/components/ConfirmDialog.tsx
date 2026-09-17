import { useState, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * useConfirm — replaces native confirm() / window.confirm() with a styled modal.
 *
 * Usage:
 *   const { confirmDialog, requestConfirm } = useConfirm();
 *
 *   // In JSX:
 *   {confirmDialog}
 *
 *   // In a handler:
 *   const ok = await requestConfirm({
 *     title: 'Delete account?',
 *     body: 'This cannot be undone.',
 *     danger: true,
 *   });
 *   if (ok) { ... }
 */

interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** If true, confirm button renders in destructive red */
  danger?: boolean;
}

export function useConfirm() {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [resolve, setResolve] = useState<((value: boolean) => void) | null>(null);

  const requestConfirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise(res => {
      setOpts(options);
      setResolve(() => res);
    });
  }, []);

  const handleResponse = useCallback(
    (result: boolean) => {
      resolve?.(result);
      setOpts(null);
      setResolve(null);
    },
    [resolve],
  );

  const confirmDialog = opts ? (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={() => handleResponse(false)}
    >
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-sm shadow-2xl p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          {opts.danger && (
            <div className="shrink-0 mt-0.5 p-1.5 rounded-lg bg-destructive/10">
              <AlertTriangle size={18} className="text-destructive" />
            </div>
          )}
          <div>
            <h3 className="text-sm font-semibold text-foreground">{opts.title}</h3>
            {opts.body && (
              <p className="text-sm text-muted-foreground mt-1">{opts.body}</p>
            )}
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => handleResponse(false)}
            className="px-3 py-1.5 text-sm rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            {opts.cancelLabel ?? 'Cancel'}
          </button>
          <button
            onClick={() => handleResponse(true)}
            className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
              opts.danger
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
          >
            {opts.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirmDialog, requestConfirm };
}
