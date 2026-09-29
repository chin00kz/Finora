import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';

export default function NotificationBell() {
  const navigate = useNavigate();
  const unreadCount = useLiveQuery(() => db.cacheNotifications.filter(n => !n.read_at).count()) || 0;

  return (
    <button
      type="button"
      onClick={() => navigate('/notifications')}
      aria-label="Notifications"
      className="p-1.5 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors relative active:scale-95"
    >
      <Bell size={20} />
      {unreadCount > 0 && (
        <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-accent border-[1.5px] border-background" />
      )}
    </button>
  );
}
