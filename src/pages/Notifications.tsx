import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { syncNotifications, markNotificationRead, markAllNotificationsRead } from '../sync/notificationSync';
import { useAuthStore } from '../store/authStore';
import { ArrowLeft, Bell, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function Notifications() {
  const navigate = useNavigate();
  const user = useAuthStore(state => state.user);
  
  // Refresh on mount
  useEffect(() => {
    if (user) {
      syncNotifications().catch(console.error);
    }
  }, [user]);

  const notifications = useLiveQuery(() => 
    db.cacheNotifications.orderBy('created_at').reverse().toArray()
  ) || [];

  const unreadCount = notifications.filter(n => !n.read_at).length;

  const handleNotificationClick = async (n: any) => {
    if (!n.read_at) {
      await markNotificationRead(n.id);
    }

    if (n.entity_type === 'shared_iou') {
      navigate('/debts', { state: { sharedIouId: n.entity_id } });
    } else if (n.entity_type === 'connection') {
      navigate('/connections');
    }
    // Other types can be added here later
  };

  const handleMarkAllRead = async () => {
    if (unreadCount > 0) {
      await markAllNotificationsRead();
    }
  };

  const formatTime = (ts: number) => {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);

    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m`;
    if (hours < 24) return `${hours}h`;
    if (days === 1) return 'Yesterday';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground pb-24 md:pb-6 relative max-w-3xl mx-auto flex flex-col">
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-medium tracking-tight">Notifications</h1>
        </div>
        {unreadCount > 0 && (
          <button 
            onClick={handleMarkAllRead}
            className="text-xs font-medium text-accent hover:text-accent-foreground px-2 py-1"
          >
            Mark all read
          </button>
        )}
      </header>

      <main className="flex-1 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-muted-foreground mt-12">
            <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center mb-4">
              <Bell size={28} className="opacity-50" />
            </div>
            <p className="text-sm font-medium text-foreground">No notifications yet</p>
            <p className="text-xs mt-1 text-center max-w-[200px]">You're all caught up!</p>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {notifications.map(n => (
              <div 
                key={n.id}
                onClick={() => handleNotificationClick(n)}
                className={`p-4 flex gap-4 cursor-pointer transition-colors hover:bg-muted/30 ${!n.read_at ? 'bg-muted/10' : ''}`}
              >
                <div className="mt-0.5 shrink-0">
                  {!n.read_at ? (
                    <div className="w-2.5 h-2.5 rounded-full bg-accent shadow-sm ring-4 ring-accent/10" />
                  ) : (
                    <CheckCircle2 size={16} className="text-muted-foreground/40" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start gap-2 mb-0.5">
                    <p className={`text-sm font-medium truncate ${!n.read_at ? 'text-foreground' : 'text-foreground/80'}`}>
                      {n.title}
                    </p>
                    <span className="text-[11px] text-muted-foreground shrink-0 mt-0.5">
                      {formatTime(n.created_at)}
                    </span>
                  </div>
                  <p className={`text-xs leading-relaxed ${!n.read_at ? 'text-muted-foreground/90' : 'text-muted-foreground/60'}`}>
                    {n.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
