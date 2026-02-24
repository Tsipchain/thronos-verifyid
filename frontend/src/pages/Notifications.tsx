/**
 * /notifications — full notification centre page.
 *
 * Shows all notifications for the current user with filtering and bulk actions.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, BellRing, Check, Ticket, CreditCard, Shield, Info, Trash2,
  Filter, RefreshCw
} from 'lucide-react';
import { apiClient } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

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

const CATEGORIES = ['all', 'billing', 'ticket', 'verification', 'system', 'general'];

function categoryBadge(cat: string) {
  const map: Record<string, string> = {
    billing:      'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    ticket:       'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    verification: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    system:       'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
    general:      'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  };
  return map[cat] ?? map.general;
}

function categoryIcon(cat: string) {
  switch (cat) {
    case 'ticket':      return <Ticket className="h-5 w-5 text-purple-500" />;
    case 'billing':     return <CreditCard className="h-5 w-5 text-green-500" />;
    case 'verification':return <Shield className="h-5 w-5 text-blue-500" />;
    default:            return <Info className="h-5 w-5 text-gray-400" />;
  }
}

function timeStr(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function Notifications() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [catFilter, setCatFilter] = useState('all');

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<Notification[]>('/api/v1/notifications?limit=200');
      setNotifications(res.data);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchNotifications(); }, []);

  const markRead = async (id: number) => {
    try {
      await apiClient.post(`/api/v1/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    } catch { /* silent */ }
  };

  const markAllRead = async () => {
    try {
      await apiClient.post('/api/v1/notifications/read-all');
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    } catch { /* silent */ }
  };

  const deleteNotif = async (id: number) => {
    try {
      await apiClient.delete(`/api/v1/notifications/${id}`);
      setNotifications(prev => prev.filter(n => n.id !== id));
    } catch { /* silent */ }
  };

  const handleClick = async (n: Notification) => {
    if (!n.is_read) await markRead(n.id);
    if (n.entity_type === 'ticket' && n.entity_id) navigate(`/tickets/${n.entity_id}`);
    else if (n.entity_type === 'org') navigate('/admin/organizations');
  };

  const visible = notifications.filter(n => {
    if (filter === 'unread' && n.is_read) return false;
    if (catFilter !== 'all' && n.category !== catFilter) return false;
    return true;
  });

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          {unreadCount > 0
            ? <BellRing className="h-7 w-7 text-amber-500" />
            : <Bell className="h-7 w-7 text-gray-400" />
          }
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Notifications</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchNotifications} className="gap-1">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
          {unreadCount > 0 && (
            <Button variant="outline" size="sm" onClick={markAllRead} className="gap-1">
              <Check className="h-3.5 w-3.5" />
              Mark all read
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        {/* Read filter */}
        <div className="flex rounded-lg border dark:border-gray-700 overflow-hidden">
          {(['all', 'unread'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-sm capitalize transition-colors ${
                filter === f
                  ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900'
                  : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        {/* Category filter */}
        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map(c => (
            <button
              key={c}
              onClick={() => setCatFilter(c)}
              className={`px-3 py-1.5 rounded-full text-xs capitalize transition-colors border ${
                catFilter === c
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center text-gray-400 py-16">Loading notifications…</div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-gray-400">
            <Bell className="h-12 w-12 mb-4 opacity-30" />
            <p className="text-lg font-medium">No notifications</p>
            <p className="text-sm mt-1">
              {filter === 'unread' ? 'All caught up!' : 'Nothing to show with the current filter.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {visible.map(n => (
            <div
              key={n.id}
              onClick={() => handleClick(n)}
              className={`
                flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer group
                ${n.is_read
                  ? 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                  : 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-950/50'
                }
              `}
            >
              <div className="mt-0.5 flex-shrink-0">{categoryIcon(n.category)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className={`text-sm leading-snug ${n.is_read ? 'text-gray-700 dark:text-gray-300' : 'font-semibold text-gray-900 dark:text-white'}`}>
                    {n.title}
                  </p>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${categoryBadge(n.category)}`}>
                    {n.category}
                  </span>
                  {!n.is_read && (
                    <span className="h-2 w-2 rounded-full bg-blue-500 flex-shrink-0" />
                  )}
                </div>
                {n.body && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                    {n.body}
                  </p>
                )}
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">{timeStr(n.created_at)}</p>
              </div>
              <div className="flex-shrink-0 flex items-center gap-1">
                {!n.is_read && (
                  <button
                    onClick={(e) => { e.stopPropagation(); markRead(n.id); }}
                    className="opacity-0 group-hover:opacity-60 hover:!opacity-100 p-1.5 rounded-lg transition-opacity"
                    title="Mark as read"
                  >
                    <Check className="h-4 w-4 text-green-500" />
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); deleteNotif(n.id); }}
                  className="opacity-0 group-hover:opacity-60 hover:!opacity-100 p-1.5 rounded-lg transition-opacity"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4 text-red-400" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
