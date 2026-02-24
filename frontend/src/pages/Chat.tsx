import { useEffect, useState, useRef, useMemo } from 'react';
import { apiClient } from '@/lib/api';
import { getAPIBaseURL } from '@/lib/config';
import { getAuthToken } from '@/lib/auth';
import { rbac } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import {
  MessageSquare, Send, Users, Plus, ArrowLeft,
  Circle, UserCircle2, Trash2, Lock, X,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';

// ── Types ──────────────────────────────────────────────────────────────────

interface Conversation {
  id: number;
  conversation_type: string;
  name: string;
  description?: string;
  participant_count: number;
  unread_count: number;
  last_message_at: string;
  can_delete?: boolean;
}

interface Message {
  id: number;
  user_id: string;
  username: string;
  content: string;
  message_type?: string;
  created_at: string;
  is_edited: boolean;
}

interface ChatUser {
  id: string;
  email: string;
  name?: string | null;
  role: string;
}

interface ChatProps {
  embedded?: boolean;
  onClose?: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getUserFromToken() {
  try {
    const token = getAuthToken();
    if (!token) return { id: 'unknown', email: 'guest' };
    const payload = JSON.parse(atob(token.split('.')[1]));
    return { id: payload.sub || payload.user_id, email: payload.email || 'user' };
  } catch {
    return { id: 'unknown', email: 'guest' };
  }
}

function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) || '?';
}

function fmtTime(ts: string) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function markConversationAsRead(id: number) {
  apiClient.post(`/api/v1/chat/conversations/${id}/read`).catch(() => {});
}

// ── Component ──────────────────────────────────────────────────────────────

export default function Chat({ embedded = false, onClose }: ChatProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [chatUsers, setChatUsers] = useState<ChatUser[]>([]);
  const [directContacts, setDirectContacts] = useState<ChatUser[]>([]);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [activeTab, setActiveTab] = useState<'conversations' | 'people'>('conversations');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [currentUser] = useState(getUserFromToken());

  useEffect(() => {
    rbac.initialize().then(() => {
      if (!rbac.canAccessChat()) {
        toast({ title: 'Access Denied', description: 'No chat permission', variant: 'destructive' });
        navigate('/admin');
      }
    });
    loadConversations();
    loadDirectContacts();
  }, []);

  useEffect(() => {
    if (!selectedConv) return;
    loadMessages(selectedConv.id);
    markConversationAsRead(selectedConv.id);
    connectWebSocket(selectedConv.id);
    return () => wsRef.current?.close();
  }, [selectedConv?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Derived title ────────────────────────────────────────────────────────

  const convTitle = useMemo(() => {
    if (!selectedConv) return '';
    if (selectedConv.conversation_type === 'group') return selectedConv.name || 'Group';
    const other = messages.find((m) => m.user_id !== currentUser.id);
    if (other?.username) return other.username;
    const match = directContacts.find((c) => c.email === selectedConv.name);
    return match?.name || match?.email || selectedConv.name || 'Private Chat';
  }, [selectedConv, messages, currentUser.id, directContacts]);

  // ── API calls ────────────────────────────────────────────────────────────

  const loadConversations = async () => {
    try {
      const res = await apiClient.get<Conversation[]>('/api/v1/chat/conversations');
      setConversations(res.data);
      if (res.data.length > 0) setSelectedConv((prev) => prev ?? res.data[0]);
    } catch {
      toast({ title: 'Error', description: 'Failed to load conversations', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const loadChatUsers = async () => {
    try {
      const res = await apiClient.get<ChatUser[]>('/api/v1/chat/users');
      setChatUsers(res.data);
    } catch { /**/ }
  };

  const loadDirectContacts = async () => {
    try {
      const res = await apiClient.get<ChatUser[]>('/api/v1/chat/contacts');
      setDirectContacts(res.data);
    } catch { /**/ }
  };

  const loadMessages = async (id: number) => {
    try {
      const res = await apiClient.get<Message[]>(`/api/v1/chat/conversations/${id}/messages`);
      setMessages(res.data);
    } catch {
      toast({ title: 'Error', description: 'Failed to load messages', variant: 'destructive' });
    }
  };

  const connectWebSocket = (convId: number) => {
    const token = getAuthToken() || 'demo-token';
    const base = getAPIBaseURL();
    const wsBase = base.startsWith('https') ? base.replace('https', 'wss') : base.replace('http', 'ws');
    const url = new URL(`/api/v1/chat/ws/${convId}`, wsBase);
    url.searchParams.set('token', token);
    const ws = new WebSocket(url.toString());

    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.type === 'message') {
        const incoming = data.message?.conversation_id;
        if (incoming === selectedConv?.id) {
          setMessages((prev) => [...prev, data.message]);
          markConversationAsRead(selectedConv.id);
        } else if (incoming) {
          setConversations((prev) =>
            prev.map((c) => c.id === incoming ? { ...c, unread_count: (c.unread_count || 0) + 1 } : c)
          );
        }
      }
    };
    ws.onerror = (e) => console.error('WS error', e);
    wsRef.current = ws;
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedConv || !rbac.canSendMessages()) return;
    setSending(true);
    try {
      await apiClient.post('/api/v1/chat/messages', {
        conversation_id: selectedConv.id,
        content: newMessage,
      });
      setNewMessage('');
      inputRef.current?.focus();
    } catch {
      toast({ title: 'Error', description: 'Failed to send message', variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const openDirectChat = async (userId: string) => {
    try {
      const res = await apiClient.post<Conversation>('/api/v1/chat/direct', {
        recipient_user_id: userId,
        content: '',
      });
      setConversations((prev) =>
        prev.find((c) => c.id === res.data.id) ? prev : [res.data, ...prev]
      );
      setSelectedConv(res.data);
      setActiveTab('conversations');
      loadConversations();
    } catch {
      toast({ title: 'Error', description: 'Failed to open conversation', variant: 'destructive' });
    }
  };

  const deleteConversation = async (conv: Conversation) => {
    try {
      await apiClient.delete(`/api/v1/chat/conversations/${conv.id}`);
      const updated = conversations.filter((c) => c.id !== conv.id);
      setConversations(updated);
      if (selectedConv?.id === conv.id) {
        setSelectedConv(updated[0] || null);
        setMessages([]);
      }
      toast({ title: 'Deleted' });
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.detail || 'Cannot delete', variant: 'destructive' });
    }
  };

  const createGroup = async () => {
    if (!groupName.trim()) {
      toast({ title: 'Missing name', description: 'Please provide a group name.', variant: 'destructive' });
      return;
    }
    if (selectedUserIds.size === 0) {
      toast({ title: 'No participants', description: 'Select at least one participant.', variant: 'destructive' });
      return;
    }
    setCreatingGroup(true);
    try {
      const res = await apiClient.post<Conversation>('/api/v1/chat/conversations', {
        conversation_type: 'group',
        name: groupName.trim(),
        description: '',
        participant_ids: Array.from(selectedUserIds),
      });
      setConversations((prev) => [res.data, ...prev]);
      setSelectedConv(res.data);
      setGroupName('');
      setSelectedUserIds(new Set());
      setGroupModalOpen(false);
    } catch {
      toast({ title: 'Error', description: 'Failed to create group', variant: 'destructive' });
    } finally {
      setCreatingGroup(false);
    }
  };

  const toggleUser = (id: string) =>
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // ── Loading state ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className={`flex items-center justify-center bg-gray-50 ${embedded ? 'h-full' : 'h-screen'}`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Loading chat…</p>
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className={`flex flex-col bg-gray-50 text-gray-900 ${embedded ? 'h-full' : 'h-screen'}`}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b flex-shrink-0">
        {!embedded && (
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
        )}
        <MessageSquare className="h-5 w-5 text-blue-600 flex-shrink-0" />
        <span className="font-semibold text-base flex-1">Team Chat</span>

        {rbac.canManageChat() && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1 h-8"
            onClick={() => { setGroupModalOpen(true); loadChatUsers(); }}
          >
            <Plus className="h-3.5 w-3.5" /> New Group
          </Button>
        )}

        {embedded && onClose && (
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 ml-1" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* ── Sidebar ───────────────────────────────────────────────────── */}
        <aside className="w-72 bg-white border-r flex flex-col flex-shrink-0">

          {/* Tab switcher */}
          <div className="flex border-b">
            {(['conversations', 'people'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                  activeTab === tab
                    ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/40'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                {tab === 'conversations' ? 'Conversations' : 'People'}
              </button>
            ))}
          </div>

          <ScrollArea className="flex-1">
            {activeTab === 'conversations' ? (
              <div className="p-2 space-y-0.5">
                {conversations.length === 0 && (
                  <div className="py-10 text-center text-xs text-gray-400">
                    <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    No conversations yet
                  </div>
                )}
                {conversations.map((conv) => {
                  const isGroup = conv.conversation_type === 'group';
                  const initial = isGroup
                    ? conv.name?.[0]?.toUpperCase() || 'G'
                    : conv.name?.[0]?.toUpperCase() || 'D';
                  const displayName = conv.name || (isGroup ? 'Group' : 'Direct Message');
                  const isSelected = selectedConv?.id === conv.id;

                  return (
                    <div
                      key={conv.id}
                      onClick={() => setSelectedConv(conv)}
                      className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer group transition-colors ${
                        isSelected
                          ? 'bg-blue-50 border border-blue-100'
                          : 'hover:bg-gray-50 border border-transparent'
                      }`}
                    >
                      {/* Avatar */}
                      <Avatar className="h-9 w-9 flex-shrink-0">
                        <AvatarFallback
                          className={`text-xs font-semibold ${
                            isGroup
                              ? 'bg-indigo-100 text-indigo-700'
                              : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {isGroup ? <Users className="h-4 w-4" /> : initial}
                        </AvatarFallback>
                      </Avatar>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-sm font-medium truncate leading-tight text-gray-900">{displayName}</p>
                          {conv.last_message_at && (
                            <span className="text-[10px] text-gray-400 flex-shrink-0">
                              {fmtTime(conv.last_message_at)}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {isGroup
                            ? `${conv.participant_count} members`
                            : 'Private message'}
                        </p>
                      </div>

                      {/* Badges + delete */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {conv.unread_count > 0 && (
                          <Badge className="h-5 min-w-[20px] px-1.5 text-[10px] bg-blue-600">
                            {conv.unread_count}
                          </Badge>
                        )}
                        {conv.can_delete && (
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteConversation(conv); }}
                            className="h-6 w-6 flex items-center justify-center rounded text-gray-300 hover:bg-red-50 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-2 space-y-0.5">
                {directContacts.length === 0 && (
                  <div className="py-10 text-center text-xs text-gray-400">
                    <UserCircle2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    No contacts found
                  </div>
                )}
                {directContacts.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => openDirectChat(user.id)}
                    className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 text-left transition-colors"
                  >
                    <Avatar className="h-9 w-9 flex-shrink-0">
                      <AvatarFallback className="bg-slate-100 text-slate-600 text-xs font-semibold">
                        {getInitials(user.name || user.email)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate leading-tight text-gray-900">
                        {user.name || user.email}
                      </p>
                      <p className="text-xs text-gray-500">{user.role}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </aside>

        {/* ── Message panel ─────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedConv ? (
            <>
              {/* Conversation header */}
              <div className="bg-white border-b px-5 py-3 flex items-center gap-3 flex-shrink-0">
                <Avatar className="h-9 w-9">
                  <AvatarFallback className={`text-sm font-semibold ${
                    selectedConv.conversation_type === 'group'
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-emerald-100 text-emerald-700'
                  }`}>
                    {selectedConv.conversation_type === 'group'
                      ? <Users className="h-4 w-4" />
                      : getInitials(convTitle)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm leading-tight truncate text-gray-900">{convTitle}</p>
                  <p className="text-xs text-gray-500">
                    {selectedConv.conversation_type === 'group'
                      ? `${selectedConv.participant_count} members`
                      : 'Private conversation'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-green-600">
                  <Circle className="h-2 w-2 fill-green-500 text-green-500" />
                  <span>Connected</span>
                </div>
              </div>

              {/* Messages */}
              <ScrollArea className="flex-1 min-h-0">
                <div className="p-5 space-y-3">
                  {messages.length === 0 && (
                    <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
                      No messages yet — say hello!
                    </div>
                  )}
                  {messages.map((msg) => {
                    const mine = msg.user_id === currentUser.id;
                    const isSystem = msg.message_type === 'system';

                    if (isSystem) {
                      return (
                        <div key={msg.id} className="flex justify-center">
                          <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-3 py-1">
                            {msg.content}
                          </span>
                        </div>
                      );
                    }

                    return (
                      <div key={msg.id} className={`flex gap-2.5 ${mine ? 'justify-end' : 'justify-start'}`}>
                        {!mine && (
                          <Avatar className="h-7 w-7 mt-1 flex-shrink-0">
                            <AvatarFallback className="bg-slate-200 text-slate-600 text-[10px] font-semibold">
                              {getInitials(msg.username)}
                            </AvatarFallback>
                          </Avatar>
                        )}
                        <div className={`max-w-[72%] flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                          <div className="flex items-baseline gap-1.5 mb-0.5">
                            <span className="text-[11px] font-semibold text-gray-700">
                              {mine ? 'You' : msg.username}
                            </span>
                            <span className="text-[10px] text-gray-500">
                              {fmtTime(msg.created_at)}
                            </span>
                            {msg.is_edited && (
                              <span className="text-[10px] text-gray-400">(edited)</span>
                            )}
                          </div>
                          <div className={`rounded-2xl px-3.5 py-2 text-sm leading-snug shadow-sm ${
                            mine
                              ? 'bg-blue-600 text-white rounded-tr-sm'
                              : 'bg-white text-gray-900 border border-gray-200 rounded-tl-sm'
                          }`}>
                            {msg.content}
                          </div>
                        </div>
                        {mine && (
                          <Avatar className="h-7 w-7 mt-1 flex-shrink-0">
                            <AvatarFallback className="bg-blue-100 text-blue-700 text-[10px] font-semibold">
                              {getInitials(currentUser.email)}
                            </AvatarFallback>
                          </Avatar>
                        )}
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {/* Input bar */}
              {rbac.canSendMessages() ? (
                <div className="bg-white border-t px-4 py-3 flex-shrink-0">
                  <div className="flex gap-2 items-center">
                    <Input
                      ref={inputRef}
                      placeholder={`Message ${convTitle}…`}
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyDown={handleKeyDown}
                      disabled={sending}
                      className="flex-1 h-9 text-sm"
                    />
                    <Button
                      size="sm"
                      onClick={sendMessage}
                      disabled={sending || !newMessage.trim()}
                      className="h-9 w-9 p-0 flex-shrink-0"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="bg-white border-t px-4 py-3 flex items-center gap-2 text-xs text-gray-400 flex-shrink-0">
                  <Lock className="h-3.5 w-3.5" />
                  You do not have permission to send messages.
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-3">
              <div className="h-16 w-16 rounded-full bg-gray-100 flex items-center justify-center">
                <MessageSquare className="h-8 w-8 text-gray-300" />
              </div>
              <div className="text-center">
                <p className="font-medium text-gray-500 text-sm">No conversation selected</p>
                <p className="text-xs text-gray-400 mt-1">
                  Pick one from the left or open a new chat
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Create group modal ─────────────────────────────────────────────── */}
      <Dialog open={groupModalOpen} onOpenChange={setGroupModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Group Conversation</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Group name</label>
              <Input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="e.g. KYC Team"
              />
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Participants</p>
              <ScrollArea className="h-48 border rounded-lg p-2">
                <div className="space-y-1">
                  {chatUsers.map((user) => (
                    <label key={user.id} className="flex items-center gap-2.5 p-1.5 rounded hover:bg-gray-50 cursor-pointer text-sm">
                      <Checkbox
                        checked={selectedUserIds.has(user.id)}
                        onCheckedChange={() => toggleUser(user.id)}
                      />
                      <Avatar className="h-6 w-6">
                        <AvatarFallback className="text-[10px] bg-blue-100 text-blue-700">
                          {getInitials(user.name || user.email)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="flex-1 truncate">{user.email}</span>
                      <span className="text-xs text-gray-400">{user.role}</span>
                    </label>
                  ))}
                  {chatUsers.length === 0 && (
                    <p className="text-xs text-gray-400 p-2">No users available.</p>
                  )}
                </div>
              </ScrollArea>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setGroupModalOpen(false)}>Cancel</Button>
              <Button onClick={createGroup} disabled={creatingGroup}>
                {creatingGroup ? 'Creating…' : 'Create Group'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
