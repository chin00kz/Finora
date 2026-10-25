import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { syncNotifications, markNotificationRead, markAllNotificationsRead } from '../sync/notificationSync';
import { useAuthStore } from '../store/authStore';
import { ArrowLeft, Bell, CheckCircle2, XCircle, UserPlus, FileText, Banknote } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { getNotificationSemantics, getColorClass } from '../utils/notificationSemantics';
import type { FinancialDirection } from '../utils/notificationSemantics';

const getIconForType = (eventKey: string, direction: FinancialDirection, isRead: boolean) => {
  const colorClass = `${getColorClass(direction, isRead)} opacity-90`;
  switch(eventKey) {
    case 'shared_iou_request':
      return <FileText size={16} className={colorClass} />;
    case 'shared_iou_payment_proposed':
      return <Banknote size={16} className={colorClass} />;
    case 'shared_iou_payment_confirmed':
    case 'shared_iou_accepted':
    case 'shared_iou_auto_accepted':
    case 'connection_accepted':
      return <CheckCircle2 size={16} className={colorClass} />;
    case 'shared_iou_rejected':
    case 'shared_iou_declined':
    case 'shared_iou_cancelled':
    case 'shared_iou_payment_rejected':
      return <XCircle size={16} className={colorClass} />;
    case 'connection_request':
      return <UserPlus size={16} className={colorClass} />;
    default:
      return <Bell size={16} className={colorClass} />;
  }
};

const highlightKeywords = (text: string, direction: FinancialDirection, isRead: boolean) => {
  if (direction !== 'destructive') {
    return <span className={isRead ? 'text-foreground/70' : 'text-foreground/90'}>{text}</span>;
  }

  const keywords = ['rejected', 'declined', 'cancelled'];
  
  let matchedKeyword = '';
  for (const kw of keywords) {
    if (text.includes(kw)) {
      matchedKeyword = kw;
      break;
    }
  }

  if (matchedKeyword) {
    const parts = text.split(matchedKeyword);
    const colorClass = getColorClass(direction, isRead);
    return (
      <span className={isRead ? 'text-foreground/70' : 'text-foreground/90'}>
        {parts[0]}
        <span className={`font-semibold ${colorClass}`}>{matchedKeyword}</span>
        {parts.slice(1).join(matchedKeyword)}
      </span>
    );
  }
  return <span className={isRead ? 'text-foreground/70' : 'text-foreground/90'}>{text}</span>;
};

const formatTitle = (title: string, direction: FinancialDirection, isRead: boolean) => {
  const verbs = [' added', ' sent', ' rejected', ' declined', ' confirmed', ' says', ' accepted', ' cancelled', ' marked'];
  let name = title;
  let rest = '';
  for (const verb of verbs) {
    const idx = title.indexOf(verb);
    if (idx > 0) {
      name = title.substring(0, idx);
      rest = title.substring(idx);
      break;
    }
  }
  if (!rest) {
    const parts = title.split(' ');
    name = parts[0];
    rest = ' ' + parts.slice(1).join(' ');
  }
  
  const nameColor = isRead ? 'text-cyan-600/70 dark:text-cyan-400/70' : 'text-cyan-600 dark:text-cyan-400';
  
  return (
    <>
      <span className={`font-medium ${nameColor}`}>{name}</span>
      {highlightKeywords(rest, direction, isRead)}
    </>
  );
};

const formatBody = (body: string, direction: FinancialDirection, isRead: boolean) => {
  const parts = body.split(/((?:[A-Z]{3}|[$£€¥])\s*\d+(?:,\d+)*(?:\.\d+)?)/);
  const colorClass = getColorClass(direction, isRead);
  
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          return <span key={i} className={`font-semibold ${colorClass}`}>{part}</span>;
        }
        return part;
      })}
    </>
  );
};

export default function Notifications() {
  const navigate = useNavigate();
  const user = useAuthStore(state => state.user);
  
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
            {notifications.map(n => {
              const isRead = !!n.read_at;
              const direction = getNotificationSemantics(n.type);
              return (
                <div 
                  key={n.id}
                  onClick={() => handleNotificationClick(n)}
                  className={`py-5 px-4 flex gap-4 cursor-pointer transition-colors hover:bg-muted/30 relative ${!isRead ? 'bg-muted/5' : ''}`}
                >
                  {!isRead && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-10 bg-accent rounded-r-md" />
                  )}
                  
                  <div className="mt-0.5 shrink-0 flex items-center justify-center w-9 h-9 rounded-full bg-muted/20 border border-border/40">
                    {getIconForType(n.type, direction, isRead)}
                  </div>
                  
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="flex justify-between items-start gap-2 mb-1.5">
                      <p className="text-sm truncate leading-tight">
                        {formatTitle(n.title, direction, isRead)}
                      </p>
                      <span className="text-[11px] text-muted-foreground shrink-0 mt-0.5 font-medium">
                        {formatTime(n.created_at)}
                      </span>
                    </div>
                    <p className={`text-xs leading-relaxed line-clamp-2 ${!isRead ? 'text-muted-foreground/90' : 'text-muted-foreground/60'}`}>
                      {formatBody(n.body, direction, isRead)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
