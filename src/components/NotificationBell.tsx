import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { getNotificationSemantics, getBadgeBgClass, getDirectionPriority } from '../utils/notificationSemantics';
import type { FinancialDirection } from '../utils/notificationSemantics';

export default function NotificationBell() {
  const navigate = useNavigate();
  const unreadNotifications = useLiveQuery(() => db.cacheNotifications.filter(n => !n.read_at).toArray()) || [];
  const unreadCount = unreadNotifications.length;

  let highestPriority = -1;
  let highestDirection: FinancialDirection = 'neutral';

  unreadNotifications.forEach(n => {
    const direction = getNotificationSemantics(n.type);
    const priority = getDirectionPriority(direction);
    if (priority > highestPriority) {
      highestPriority = priority;
      highestDirection = direction;
    }
  });

  const badgeColorClass = getBadgeBgClass(highestDirection);
  const displayCount = unreadCount > 9 ? '9+' : unreadCount;

  return (
    <button
      type="button"
      onClick={() => navigate('/notifications')}
      aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
      className="w-11 h-11 flex items-center justify-center rounded-lg text-foreground/80 hover:text-foreground hover:bg-muted/50 transition-colors relative active:scale-95"
    >
      <Bell size={22} strokeWidth={2.25} />
      {unreadCount > 0 && (
        <span 
          className={`absolute top-1.5 right-1.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold border-2 border-background ${badgeColorClass}`}
        >
          {displayCount}
        </span>
      )}
    </button>
  );
}
