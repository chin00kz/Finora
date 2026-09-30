export type FinancialDirection = 'positive' | 'warning' | 'destructive' | 'social' | 'neutral';

export const getNotificationSemantics = (type: string): FinancialDirection => {
  switch(type) {
    case 'shared_iou_rejected':
    case 'shared_iou_declined':
    case 'shared_iou_cancelled':
    case 'shared_iou_payment_rejected':
      return 'destructive'; // red
    case 'shared_iou_request':
      return 'warning'; // amber
    case 'connection_request':
      return 'social'; // cyan
    case 'shared_iou_payment_confirmed':
    case 'shared_iou_payment_proposed':
    case 'shared_iou_accepted':
    case 'shared_iou_auto_accepted':
      return 'positive'; // emerald
    case 'connection_accepted':
    default:
      return 'neutral'; // accent
  }
};

export const getColorClass = (direction: FinancialDirection, isRead: boolean) => {
  switch (direction) {
    case 'positive': return isRead ? 'text-emerald-500/60' : 'text-emerald-500';
    case 'warning': return isRead ? 'text-amber-500/60' : 'text-amber-500';
    case 'destructive': return isRead ? 'text-red-500/60' : 'text-red-500';
    case 'social': return isRead ? 'text-cyan-500/60' : 'text-cyan-500';
    case 'neutral': return isRead ? 'text-accent/60' : 'text-accent';
  }
};

export const getBadgeBgClass = (direction: FinancialDirection) => {
  switch (direction) {
    case 'destructive': return 'bg-red-500 text-white';
    case 'warning': return 'bg-amber-500 text-white';
    case 'social': return 'bg-cyan-500 text-white';
    case 'positive': return 'bg-emerald-500 text-white';
    case 'neutral': return 'bg-accent text-accent-foreground';
  }
};

export const getDirectionPriority = (direction: FinancialDirection): number => {
  switch (direction) {
    case 'destructive': return 4;
    case 'warning': return 3;
    case 'social': return 2;
    case 'positive': return 1;
    case 'neutral': return 0;
  }
};
