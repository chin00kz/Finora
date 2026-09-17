import React from 'react';
import { X } from 'lucide-react';

/**
 * Modal — shared overlay wrapper replacing 14 duplicated `fixed inset-0 z-50 backdrop-blur` blocks.
 *
 * variant="sheet"  → slides up from the bottom (default for transaction/debt modals)
 * variant="dialog" → centered card (default for goals, recurring, export modals)
 */

interface ModalProps {
  open: boolean;
  onClose?: () => void;
  /** 'sheet' = bottom drawer, 'dialog' = centered. Default: 'sheet' */
  variant?: 'sheet' | 'dialog';
  /** Pass false to suppress the default white card wrapper (for fully custom layouts) */
  withCard?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Modal({
  open,
  onClose,
  variant = 'sheet',
  withCard = true,
  children,
  className = '',
}: ModalProps) {
  if (!open) return null;

  const isSheet = variant === 'sheet';

  return (
    <div
      className={`fixed inset-0 z-50 flex ${
        isSheet
          ? 'flex-col justify-end sm:justify-center sm:items-center'
          : 'items-center justify-center p-4'
      } bg-black/40 backdrop-blur-sm`}
      onClick={onClose}
    >
      <div
        className={
          withCard
            ? `bg-card border border-border ${
                isSheet
                  ? 'rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md'
                  : 'rounded-2xl w-full max-w-md'
              } shadow-xl ${className}`
            : className
        }
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Modal.Header — consistent header row with optional close button.
 */
Modal.Header = function ModalHeader({
  title,
  onClose,
  children,
}: {
  title?: string;
  onClose?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between p-4 border-b border-border">
      {title ? (
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
      ) : (
        children
      )}
      {onClose && (
        <button
          onClick={onClose}
          className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      )}
    </div>
  );
};

/**
 * Modal.Body — padded content area.
 */
Modal.Body = function ModalBody({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`p-4 ${className}`}>{children}</div>;
};

/**
 * Modal.Footer — padded action button row.
 */
Modal.Footer = function ModalFooter({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex gap-2 p-4 pt-0 ${className}`}>{children}</div>
  );
};
