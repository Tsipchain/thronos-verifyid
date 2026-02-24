/**
 * NotificationBell — bell icon with unread badge + dropdown of recent notifications.
 *
 * Polls /api/v1/notifications/unread-count every 30s.
 * Opens a popover with the latest 20 notifications; click navigates to entity
 * or marks as read.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellRing, Check, Ticket, CreditCard, Shield, Info, Trash2 } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Notification {
  id: number;
  title: string;
  body: string | null;
  category: string;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  created_at: string;
}

function categoryIcon(cat: string) {
  switch (cat) {
    case 'ticket':      return <Ticket className="h-4 w-4 text-purple-500" />;
    case 'billing':     return <CreditCard className="h-4 w-4 text-green-500" />;
    case 'verification':return <Shield className="h-4 w-4 text-blue-500" />;
    default:            return <Info className="h-4 w-4 text-gray-400" />;
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Poll unread count
  useEffect(() => {
    const fetchCount = async () => {
      try {
        const res = await apiClient.get<{ count: number }>('/api/v1/notifications/unread-count');
        setUnread(res.data.count);
      } catch { /* silent */ }
    };
    fetchCount();
    const id = setInterval(fetchCount, 30_000);
    return () => clearInterval(id);
  }, []);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<Notification[]>('/api/v1/notifications?limit=20');
      setNotifications(res.data);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  };

  const handleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next) fetchNotifications();
  };

  const markRead = async (id: number) => {
    try {
      await apiClient.post(`/api/v1/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
      setUnread(prev => Math.max(0, prev - 1));
    } catch { /* silent */ }
  };

  const markAllRead = async () => {
    try {
      await apiClient.post('/api/v1/notifications/read-all');
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnread(0);
    } catch { /* silent */ }
  };

  const deleteNotif = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiClient.delete(`/api/v1/notifications/${id}`);
      const removed = notifications.find(n => n.id === id);
      setNotifications(prev => prev.filter(n => n.id !== id));
      if (removed && !removed.is_read) setUnread(prev => Math.max(0, prev - 1));
    } catch { /* silent */ }
  };

  const handleClick = async (n: Notification) => {
    if (!n.is_read) await markRead(n.id);
    if (n.entity_type === 'ticket' && n.entity_id) {
      navigate(`/tickets/${n.entity_id}`);
      setOpen(false);
    } else if (n.entity_type === 'org' && n.entity_id) {
      navigate('/admin/organizations');
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="outline"
        size="sm"
        onClick={handleOpen}
        className="relative gap-2"
        aria-label="Notifications"
      >
        {unread > 0
          ? <BellRing className="h-4 w-4 text-amber-500 animate-pulse" />
          : <Bell className="h-4 w-4" />
        }
        {unread > 0 && (
          <Badge
            variant="destructive"
            className="absolute -top-2 -right-2 h-5 min-w-[20px] px-1 text-xs flex items-center justify-center"
          >
            {unread > 99 ? '99+' : unread}
          </Badge>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b dark:border-gray-700">
            <span className="font-semibold text-sm text-gray-900 dark:text-white">
              Notifications {unread > 0 && <span className="text-amber-500">({unread} unread)</span>}
            </span>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={markAllRead}
                  className="h-7 text-xs gap-1"
                >
                  <Check className="h-3 w-3" />
                  Mark all read
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { navigate('/notifications'); setOpen(false); }}
                className="h-7 text-xs"
              >
                View all
              </Button>
            </div>
          </div>

          {/* List */}
          <ScrollArea className="max-h-[420px]">
            {loading ? (
              <div className="p-6 text-center text-sm text-gray-400">Loading…</div>
            ) : notifications.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400">
                <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
                No notifications yet
              </div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={`
                    flex items-start gap-3 px-4 py-3 border-b last:border-0
                    dark:border-gray-700 cursor-pointer group transition-colors
                    ${n.is_read
                      ? 'bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800'
                      : 'bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-950/50'
                    }
                  `}
                >
                  <div className="mt-0.5 flex-shrink-0">{categoryIcon(n.category)}</div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-snug truncate ${n.is_read ? 'text-gray-700 dark:text-gray-300' : 'font-medium text-gray-900 dark:text-white'}`}>
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                        {n.body}
                      </p>
                    )}
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{timeAgo(n.created_at)}</p>
                  </div>
                  <button
                    onClick={(e) => deleteNotif(n.id, e)}
                    className="flex-shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity p-1 rounded"
                    aria-label="Delete notification"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-gray-400" />
                  </button>
                </div>
              ))
            )}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
