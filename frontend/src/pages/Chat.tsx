import { useEffect, useMemo, useRef, useState } from 'react';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MessageSquare, Send, Users, Plus, ArrowLeft, Circle, UserCircle2, Lock, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';

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
}

const roleBadgeClasses: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-700',
  manager: 'bg-blue-100 text-blue-700',
  management: 'bg-blue-100 text-blue-700',
  agent: 'bg-emerald-100 text-emerald-700',
  it: 'bg-orange-100 text-orange-700',
};

const formatRole = (role: string) => {
  if (!role) return 'Member';
  return role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
};

const getInitials = (value?: string | null) => {
  const source = value?.trim() || 'U';
  const parts = source.split(' ').filter(Boolean);
  if (parts.length === 1) {
    return source.slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
};

const getUserFromToken = () => {
  const token = getAuthToken();
  if (!token) {
    return { id: '', email: '' };
  }

  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return {
      id: String(payload.sub || ''),
      email: String(payload.email || ''),
    };
  } catch {
    return { id: '', email: '' };
  }
};

export default function Chat({ embedded = false }: ChatProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [chatUsers, setChatUsers] = useState<ChatUser[]>([]);
  const [directContacts, setDirectContacts] = useState<ChatUser[]>([]);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [activeTab, setActiveTab] = useState<'conversations' | 'people'>('conversations');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [currentUser] = useState(getUserFromToken());

  useEffect(() => {
    checkPermissions();
    loadConversations();
    loadDirectContacts();
  }, []);

  useEffect(() => {
    if (selectedConversation) {
      loadMessages(selectedConversation.id);
      markConversationAsRead(selectedConversation.id);
      connectWebSocket(selectedConversation.id);
    }
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [selectedConversation]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const selectedConversationTitle = useMemo(() => {
    if (!selectedConversation) return '';

    if (selectedConversation.conversation_type === 'group') {
      return selectedConversation.name || 'Team Group';
    }

    const otherMessage = messages.find((msg) => msg.user_id !== currentUser.id);
    if (otherMessage?.username) {
      return otherMessage.username;
    }

    const contactMatch = directContacts.find((contact) => contact.email === selectedConversation.name);
    if (contactMatch) {
      return contactMatch.name || contactMatch.email;
    }

    return selectedConversation.name || 'Private Chat';
  }, [selectedConversation, messages, currentUser.id, directContacts]);

  const checkPermissions = async () => {
    await rbac.initialize();
    if (!rbac.canAccessChat()) {
      toast({
        title: 'Access Denied',
        description: 'You do not have permission to access chat',
        variant: 'destructive',
      });
      navigate('/admin');
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadConversations = async () => {
    try {
      const response = await apiClient.get<Conversation[]>('/api/v1/chat/conversations');
      setConversations(response.data);
      if (response.data.length > 0 && !selectedConversation) {
        setSelectedConversation(response.data[0]);
      }
      setLoading(false);
    } catch (error) {
      const detail = (error as { data?: { detail?: string } })?.data?.detail || 'Failed to load conversations';
      toast({ title: 'Error', description: detail, variant: 'destructive' });
      setLoading(false);
    }
  };

  const loadChatUsers = async () => {
    try {
      const response = await apiClient.get<ChatUser[]>('/api/v1/chat/users');
      setChatUsers(response.data);
    } catch (error) {
      console.error('Failed to load chat users', error);
    }
  };

  const loadDirectContacts = async () => {
    try {
      const response = await apiClient.get<ChatUser[]>('/api/v1/chat/contacts');
      setDirectContacts(response.data);
    } catch (error) {
      console.error('Failed to load direct contacts', error);
    }
  };

  const loadMessages = async (conversationId: number) => {
    try {
      const response = await apiClient.get<Message[]>(`/api/v1/chat/conversations/${conversationId}/messages`);
      setMessages(response.data);
    } catch {
      toast({ title: 'Error', description: 'Failed to load messages', variant: 'destructive' });
    }
  };

  const markConversationAsRead = async (conversationId: number) => {
    try {
      await apiClient.post(`/api/v1/chat/conversations/${conversationId}/read`);
      setConversations((prev) => prev.map((conv) => (
        conv.id === conversationId ? { ...conv, unread_count: 0 } : conv
      )));
    } catch {
      // non-blocking
    }
  };

  const connectWebSocket = (conversationId: number) => {
    const token = getAuthToken() || 'demo-token';
    const apiBaseUrl = getAPIBaseURL();
    const wsBaseUrl = apiBaseUrl.startsWith('https') ? apiBaseUrl.replace('https', 'wss') : apiBaseUrl.replace('http', 'ws');
    const wsUrl = new URL(`/api/v1/chat/ws/${conversationId}`, wsBaseUrl);
    wsUrl.searchParams.set('token', token);
    const ws = new WebSocket(wsUrl.toString());

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'message') {
        const incomingConversationId = data.message?.conversation_id;
        if (incomingConversationId === selectedConversation?.id) {
          setMessages((prev) => [...prev, data.message]);
          markConversationAsRead(selectedConversation.id);
        } else if (incomingConversationId) {
          setConversations((prev) => prev.map((conv) => (
            conv.id === incomingConversationId
              ? { ...conv, unread_count: (conv.unread_count || 0) + 1 }
              : conv
          )));
        }
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    wsRef.current = ws;
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedConversation || !rbac.canSendMessages()) return;

    setSending(true);
    try {
      await apiClient.post('/api/v1/chat/messages', {
        conversation_id: selectedConversation.id,
        content: newMessage,
      });
      setNewMessage('');
    } catch {
      toast({ title: 'Error', description: 'Failed to send message', variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const openDirectChat = async (recipientUserId: string) => {
    try {
      const response = await apiClient.post<Conversation>('/api/v1/chat/direct', {
        recipient_user_id: recipientUserId,
        content: '',
      });

      const existing = conversations.find((conv) => conv.id === response.data.id);
      if (!existing) {
        setConversations((prev) => [response.data, ...prev]);
      }
      setSelectedConversation(response.data);
      setActiveTab('conversations');
      await loadConversations();
    } catch {
      toast({ title: 'Error', description: 'Failed to open direct conversation', variant: 'destructive' });
    }
  };

  const handleDeleteConversation = async (conversation: Conversation) => {
    try {
      await apiClient.delete(`/api/v1/chat/conversations/${conversation.id}`);
      const updated = conversations.filter((conv) => conv.id !== conversation.id);
      setConversations(updated);
      if (selectedConversation?.id === conversation.id) {
        setSelectedConversation(updated[0] || null);
        setMessages([]);
      }
      toast({ title: 'Deleted', description: 'Conversation deleted successfully.' });
    } catch (error) {
      const detail = (error as { data?: { detail?: string } })?.data?.detail || 'Cannot delete this conversation';
      toast({ title: 'Error', description: detail, variant: 'destructive' });
    }
  };

  const toggleUserSelection = (userId: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim()) {
      toast({ title: 'Missing name', description: 'Please provide a group name.', variant: 'destructive' });
      return;
    }

    if (selectedUserIds.size === 0) {
      toast({ title: 'No participants', description: 'Select at least one participant.', variant: 'destructive' });
      return;
    }

    try {
      setCreatingGroup(true);
      const response = await apiClient.post<Conversation>('/api/v1/chat/conversations', {
        conversation_type: 'group',
        name: groupName.trim(),
        description: '',
        participant_ids: Array.from(selectedUserIds),
      });
      setConversations((prev) => [response.data, ...prev]);
      setSelectedConversation(response.data);
      setGroupName('');
      setSelectedUserIds(new Set());
      setIsGroupModalOpen(false);
    } catch {
      toast({ title: 'Error', description: 'Failed to create conversation', variant: 'destructive' });
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-slate-600">Loading chat...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col bg-slate-50 ${embedded ? 'h-full rounded-b-xl' : 'h-screen'}`}>
      {!embedded && (
        <header className="bg-white border-b px-6 py-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={() => navigate('/admin')}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <MessageSquare className="h-6 w-6 text-blue-600" />
              <h1 className="text-xl font-bold text-slate-900">Team Chat</h1>
            </div>
            {rbac.canManageChat() && (
              <Button
                size="sm"
                onClick={() => {
                  setIsGroupModalOpen(true);
                  loadChatUsers();
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                New Group
              </Button>
            )}
          </div>
        </header>
      )}

      <Dialog open={isGroupModalOpen} onOpenChange={setIsGroupModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Group Conversation</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Group name</label>
              <Input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="KYC Team" />
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Participants</p>
              <ScrollArea className="h-48 border rounded-md p-2">
                <div className="space-y-2">
                  {chatUsers.map((user) => (
                    <label key={user.id} className="flex items-center gap-2 text-sm rounded-md p-2 hover:bg-slate-50">
                      <Checkbox checked={selectedUserIds.has(user.id)} onCheckedChange={() => toggleUserSelection(user.id)} />
                      <span className="flex-1 truncate">{user.name || user.email}</span>
                      <span className={`text-xs px-2 py-1 rounded-full ${roleBadgeClasses[user.role.toLowerCase()] || 'bg-slate-100 text-slate-600'}`}>
                        {formatRole(user.role)}
                      </span>
                    </label>
                  ))}
                  {chatUsers.length === 0 && <p className="text-xs text-slate-500">No users available.</p>}
                </div>
              </ScrollArea>
            </div>
            <Button onClick={handleCreateGroup} disabled={creatingGroup}>
              {creatingGroup ? 'Creating...' : 'Create Group'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-80 bg-white border-r flex flex-col">
          <div className="p-3 border-b">
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'conversations' | 'people')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="conversations">Conversations</TabsTrigger>
                <TabsTrigger value="people">People</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {activeTab === 'conversations' ? (
            <ScrollArea className="flex-1 p-2">
              <div className="space-y-2">
                {conversations.map((conv) => (
                  <button
                    key={conv.id}
                    type="button"
                    className={`w-full text-left p-3 rounded-xl border transition-all ${
                      selectedConversation?.id === conv.id
                        ? 'bg-blue-50 border-blue-200 shadow-sm'
                        : 'bg-white border-transparent hover:bg-slate-50'
                    }`}
                    onClick={() => setSelectedConversation(conv)}
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9">
                        <AvatarFallback className="bg-blue-100 text-blue-700 text-xs">
                          {conv.conversation_type === 'group' ? <Users className="h-4 w-4" /> : getInitials(conv.name || 'DM')}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate text-slate-900">{conv.name || 'Direct Message'}</p>
                        <p className="text-xs text-slate-500 truncate">
                          {conv.conversation_type === 'group' ? `${conv.participant_count} members` : 'Private chat'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {conv.unread_count > 0 && <Badge>{conv.unread_count}</Badge>}
                        {conv.can_delete && (
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteConversation(conv);
                            }}
                            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
                            title="Delete conversation"
                          >
                            <Trash2 className="h-4 w-4" />
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <ScrollArea className="flex-1 p-2">
              <div className="space-y-2">
                {directContacts.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    className="w-full text-left p-3 rounded-xl border hover:bg-slate-50 transition-colors"
                    onClick={() => openDirectChat(user.id)}
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9">
                        <AvatarFallback className="bg-slate-200 text-slate-700 text-xs">{getInitials(user.name || user.email)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate text-slate-900">{user.name || user.email}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary" className={roleBadgeClasses[user.role.toLowerCase()] || ''}>
                            {formatRole(user.role)}
                          </Badge>
                          <span className="text-[11px] text-slate-500">Start private chat</span>
                        </div>
                      </div>
                      <UserCircle2 className="h-4 w-4 text-slate-400" />
                    </div>
                  </button>
                ))}
                {directContacts.length === 0 && <p className="text-xs text-slate-500 p-2">No contacts found.</p>}
              </div>
            </ScrollArea>
          )}
        </div>

        <div className="flex-1 flex flex-col bg-gradient-to-b from-slate-50 to-white">
          {selectedConversation ? (
            <>
              <div className="bg-white/95 backdrop-blur border-b px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="bg-indigo-100 text-indigo-700 text-sm">
                        {selectedConversation.conversation_type === 'group' ? <Users className="h-4 w-4" /> : getInitials(selectedConversationTitle)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h2 className="font-semibold text-lg text-slate-900">{selectedConversationTitle}</h2>
                      <p className="text-xs text-slate-500">
                        {selectedConversation.conversation_type === 'group' ? `${selectedConversation.participant_count} members in group` : 'Private conversation'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Circle className="h-2 w-2 fill-green-500 text-green-500" />
                    <span>Connected</span>
                  </div>
                </div>
              </div>

              <ScrollArea className="flex-1 p-6">
                <div className="space-y-4">
                  {messages.map((msg) => {
                    const mine = msg.user_id === currentUser.id;
                    return (
                      <div key={msg.id} className={`flex gap-3 ${mine ? 'justify-end' : ''}`}>
                        {!mine && (
                          <Avatar className="h-8 w-8 mt-1">
                            <AvatarFallback className="bg-slate-200 text-slate-700 text-xs">{getInitials(msg.username)}</AvatarFallback>
                          </Avatar>
                        )}
                        <div className={`max-w-[75%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                          <div className="flex items-baseline gap-2 mb-1">
                            <span className="font-medium text-xs text-slate-600">{mine ? 'You' : msg.username}</span>
                            <span className="text-[11px] text-slate-400">{new Date(msg.created_at).toLocaleTimeString()}</span>
                            {msg.is_edited && <span className="text-[11px] text-slate-400">(edited)</span>}
                          </div>
                          <div className={`rounded-2xl px-4 py-2 text-sm shadow-sm ${mine ? 'bg-blue-600 text-white' : 'bg-white text-slate-800 border'}`}>
                            {msg.content}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {rbac.canSendMessages() ? (
                <div className="bg-white border-t p-4">
                  <div className="flex gap-2">
                    <Input
                      placeholder={`Message ${selectedConversationTitle}...`}
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyDown={handleKeyDown}
                      disabled={sending}
                      className="flex-1"
                    />
                    <Button onClick={sendMessage} disabled={sending || !newMessage.trim()}>
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="bg-white border-t px-4 py-3 flex items-center gap-2 text-sm text-slate-500">
                  <Lock className="h-4 w-4" />
                  You do not have permission to send messages in chat.
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500">
              <div className="text-center">
                <MessageSquare className="h-12 w-12 mx-auto mb-4 text-slate-400" />
                <p>Select a conversation to start chatting</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
