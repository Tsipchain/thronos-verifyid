/**
 * /tickets — support ticket management.
 *
 * - Non-staff: see own tickets + create new ones
 * - Staff (manager/admin): see all tickets + update status/priority/assignment
 *
 * Route /tickets/:id opens ticket detail with comments thread.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Ticket, Plus, ChevronRight, MessageSquare, AlertTriangle,
  Clock, CheckCircle2, XCircle, RefreshCw, Send, Lock, Filter,
  ArrowLeft
} from 'lucide-react';
import { apiClient } from '@/lib/api';
import { rbac } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Comment {
  id: number;
  ticket_id: number;
  user_id: string;
  username: string | null;
  content: string;
  is_internal: boolean;
  created_at: string;
}

interface TicketItem {
  id: number;
  reference: string;
  created_by: string;
  created_by_email: string | null;
  assigned_to: string | null;
  org_id: string | null;
  category: string;
  priority: string;
  status: string;
  subject: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  comments: Comment[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  open:        'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  in_progress: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  waiting:     'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  resolved:    'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  closed:      'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

const PRIORITY_COLORS: Record<string, string> = {
  low:    'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  high:   'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  urgent: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
};

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'open':        return <Clock className="h-4 w-4 text-blue-500" />;
    case 'in_progress': return <RefreshCw className="h-4 w-4 text-amber-500" />;
    case 'waiting':     return <AlertTriangle className="h-4 w-4 text-purple-500" />;
    case 'resolved':    return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case 'closed':      return <XCircle className="h-4 w-4 text-gray-400" />;
    default:            return null;
  }
}

function timeStr(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// ── Create Ticket Form ────────────────────────────────────────────────────────

function CreateTicketModal({ onCreated, onClose }: { onCreated: (t: TicketItem) => void; onClose: () => void }) {
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [priority, setPriority] = useState('medium');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!subject.trim()) { setError('Subject is required'); return; }
    setSubmitting(true);
    try {
      const res = await apiClient.post<TicketItem>('/api/v1/tickets', {
        subject, description, category, priority
      });
      onCreated(res.data);
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to create ticket');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-6 border-b dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Open a Support Ticket</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">&times;</button>
        </div>
        <div className="p-6 space-y-4">
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Subject *</label>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Briefly describe your issue"
              className="w-full px-3 py-2 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category</label>
              <select value={category} onChange={e => setCategory(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                <option value="general">General</option>
                <option value="billing">Billing</option>
                <option value="technical">Technical</option>
                <option value="verification">Verification</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={5}
              placeholder="Provide as much detail as possible…"
              className="w-full px-3 py-2 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 px-6 pb-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting} className="gap-2">
            {submitting ? 'Submitting…' : <><Ticket className="h-4 w-4" /> Submit Ticket</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Ticket Detail ─────────────────────────────────────────────────────────────

function TicketDetail({ ticketId, isStaff }: { ticketId: string; isStaff: boolean }) {
  const navigate = useNavigate();
  const [ticket, setTicket] = useState<TicketItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [updating, setUpdating] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetch = async () => {
    try {
      const res = await apiClient.get<TicketItem>(`/api/v1/tickets/${ticketId}`);
      setTicket(res.data);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetch(); }, [ticketId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [ticket?.comments]);

  const sendComment = async () => {
    if (!comment.trim()) return;
    setSending(true);
    try {
      await apiClient.post(`/api/v1/tickets/${ticketId}/comments`, { content: comment, is_internal: isInternal });
      setComment('');
      await fetch();
    } catch { /* silent */ } finally {
      setSending(false);
    }
  };

  const updateStatus = async (status: string) => {
    setUpdating(true);
    try {
      await apiClient.put(`/api/v1/tickets/${ticketId}`, { status });
      await fetch();
    } catch { /* silent */ } finally {
      setUpdating(false);
    }
  };

  if (loading) return <div className="text-center py-16 text-gray-400">Loading ticket…</div>;
  if (!ticket) return <div className="text-center py-16 text-gray-400">Ticket not found</div>;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <button
        onClick={() => navigate('/tickets')}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to tickets
      </button>

      {/* Ticket header */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-mono text-gray-400 mb-1">{ticket.reference}</p>
              <CardTitle className="text-xl">{ticket.subject}</CardTitle>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Opened by {ticket.created_by_email || ticket.created_by} · {timeStr(ticket.created_at)}
              </p>
            </div>
            <div className="flex flex-col gap-2 items-end flex-shrink-0">
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[ticket.status]}`}>
                {ticket.status.replace('_', ' ')}
              </span>
              <span className={`text-xs px-2 py-1 rounded-full ${PRIORITY_COLORS[ticket.priority]}`}>
                {ticket.priority}
              </span>
              <span className="text-xs px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 capitalize">
                {ticket.category}
              </span>
            </div>
          </div>
        </CardHeader>
        {ticket.description && (
          <CardContent className="border-t dark:border-gray-700 pt-4">
            <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{ticket.description}</p>
          </CardContent>
        )}
      </Card>

      {/* Staff controls */}
      {isStaff && (
        <Card className="mb-6">
          <CardContent className="flex flex-wrap gap-2 pt-4">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300 self-center mr-2">Update status:</span>
            {['open', 'in_progress', 'waiting', 'resolved', 'closed'].map(s => (
              <button
                key={s}
                disabled={ticket.status === s || updating}
                onClick={() => updateStatus(s)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors capitalize
                  ${ticket.status === s
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 cursor-default'
                    : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400'
                  }`}
              >
                {s.replace('_', ' ')}
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Comments thread */}
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
        <MessageSquare className="h-4 w-4" />
        Conversation ({ticket.comments.length})
      </h3>
      <div className="space-y-3 mb-6">
        {ticket.comments.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-6">No messages yet. Be the first to reply.</p>
        )}
        {ticket.comments.map(c => (
          <div
            key={c.id}
            className={`p-4 rounded-xl border ${
              c.is_internal
                ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30'
                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium text-gray-900 dark:text-white">
                {c.username || c.user_id}
              </span>
              {c.is_internal && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 flex items-center gap-1">
                  <Lock className="h-2.5 w-2.5" /> Internal
                </span>
              )}
              <span className="text-xs text-gray-400 ml-auto">{timeStr(c.created_at)}</span>
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{c.content}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Reply box */}
      {ticket.status !== 'closed' && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={3}
              placeholder="Write a reply…"
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendComment(); }}
              className="w-full px-3 py-2 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <div className="flex items-center justify-between">
              {isStaff ? (
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
                  <input type="checkbox" checked={isInternal} onChange={e => setIsInternal(e.target.checked)}
                    className="rounded" />
                  <Lock className="h-3.5 w-3.5 text-amber-500" />
                  Internal note (staff only)
                </label>
              ) : <span />}
              <Button onClick={sendComment} disabled={sending || !comment.trim()} size="sm" className="gap-2">
                <Send className="h-3.5 w-3.5" />
                {sending ? 'Sending…' : 'Send'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Ticket List ───────────────────────────────────────────────────────────────

function TicketList({ isStaff }: { isStaff: boolean }) {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<TicketItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const fetch = async () => {
    setLoading(true);
    try {
      let url = '/api/v1/tickets?limit=200';
      if (statusFilter !== 'all') url += `&status=${statusFilter}`;
      if (categoryFilter !== 'all') url += `&category=${categoryFilter}`;
      const res = await apiClient.get<TicketItem[]>(url);
      setTickets(res.data);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetch(); }, [statusFilter, categoryFilter]);

  const openCount = tickets.filter(t => ['open', 'in_progress', 'waiting'].includes(t.status)).length;

  return (
    <>
      {showCreate && (
        <CreateTicketModal
          onCreated={t => { setTickets(prev => [t, ...prev]); }}
          onClose={() => setShowCreate(false)}
        />
      )}

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Ticket className="h-7 w-7 text-purple-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Support Tickets</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {openCount > 0 ? `${openCount} open ticket${openCount > 1 ? 's' : ''}` : 'All resolved'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetch} className="gap-1">
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              New Ticket
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6">
          <div className="flex items-center gap-1">
            <Filter className="h-4 w-4 text-gray-400" />
            <span className="text-sm text-gray-500">Status:</span>
            {['all', 'open', 'in_progress', 'waiting', 'resolved', 'closed'].map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`text-xs px-2.5 py-1 rounded-full capitalize transition-colors ${
                  statusFilter === s
                    ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {s.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div className="text-center text-gray-400 py-16">Loading tickets…</div>
        ) : tickets.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center py-16 text-gray-400">
              <Ticket className="h-12 w-12 mb-4 opacity-30" />
              <p className="text-lg font-medium">No tickets</p>
              <p className="text-sm mt-1">Open a new support ticket to get started.</p>
              <Button className="mt-4 gap-2" onClick={() => setShowCreate(true)}>
                <Plus className="h-4 w-4" /> New Ticket
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {tickets.map(t => (
              <div
                key={t.id}
                onClick={() => navigate(`/tickets/${t.id}`)}
                className="flex items-center gap-4 p-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-blue-300 dark:hover:border-blue-700 cursor-pointer transition-all group"
              >
                <StatusIcon status={t.status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-mono text-gray-400">{t.reference}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${PRIORITY_COLORS[t.priority]}`}>{t.priority}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${STATUS_COLORS[t.status]}`}>{t.status.replace('_', ' ')}</span>
                  </div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{t.subject}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t.created_by_email} · {timeStr(t.created_at)}
                    {t.comments.length > 0 && (
                      <span className="ml-2 inline-flex items-center gap-0.5">
                        <MessageSquare className="h-3 w-3" /> {t.comments.length}
                      </span>
                    )}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-gray-500 flex-shrink-0" />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ── Page Entry Point ──────────────────────────────────────────────────────────

export default function Tickets() {
  const { id } = useParams<{ id?: string }>();
  const isStaff = rbac.canAccessVerifications(); // managers and admins

  if (id) return <TicketDetail ticketId={id} isStaff={isStaff} />;
  return <TicketList isStaff={isStaff} />;
}
