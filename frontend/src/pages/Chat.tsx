import { useEffect, useState, useRef } from 'react';
import { apiClient } from '@/lib/api';
import { getAPIBaseURL } from '@/lib/config';
import { getAuthToken } from '@/lib/auth';
import { rbac } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { 
  MessageSquare, 
  Send, 
  Users, 
  Plus,
  ArrowLeft,
  Circle
} from 'lucide-react';
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
}

interface Message {
  id: number;
  user_id: string;
  username: string;
  content: string;
  created_at: string;
  is_edited: boolean;
}

export default function Chat() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    checkPermissions();
    loadConversations();
  }, []);

  useEffect(() => {
    if (selectedConversation) {
      loadMessages(selectedConversation.id);
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

  const checkPermissions = async () => {
    await rbac.initialize();
    if (!rbac.canAccessChat()) {
      toast({
        title: 'Access Denied',
        description: 'You do not have permission to access chat',
        variant: 'destructive'
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
      toast({
        title: 'Error',
        description: detail,
        variant: 'destructive'
      });
      setLoading(false);
    }
  };

  const loadMessages = async (conversationId: number) => {
    try {
      const response = await apiClient.get<Message[]>(
        `/api/v1/chat/conversations/${conversationId}/messages`
      );
      setMessages(response.data);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load messages',
        variant: 'destructive'
      });
    }
  };

  const connectWebSocket = (conversationId: number) => {
    const token = getAuthToken() || 'demo-token';
    const apiBaseUrl = getAPIBaseURL();
    const wsBaseUrl = apiBaseUrl.startsWith('https')
      ? apiBaseUrl.replace('https', 'wss')
      : apiBaseUrl.replace('http', 'ws');
    const wsUrl = new URL(`/api/v1/chat/ws/${conversationId}`, wsBaseUrl);
    wsUrl.searchParams.set('token', token);
    const ws = new WebSocket(wsUrl.toString());

    ws.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'message') {
        setMessages(prev => [...prev, data.message]);
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
        content: newMessage
      });
      setNewMessage('');
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to send message',
        variant: 'destructive'
      });
    } finally {
      setSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading chat...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/admin')}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <MessageSquare className="h-6 w-6 text-blue-600" />
            <h1 className="text-xl font-bold">Team Chat</h1>
          </div>
          {rbac.canManageChat() && (
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              New Conversation
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Conversations List */}
        <div className="w-80 bg-white border-r flex flex-col">
          <div className="p-4 border-b">
            <h2 className="font-semibold text-gray-900">Conversations</h2>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`p-3 rounded-lg cursor-pointer mb-1 transition-colors ${
                    selectedConversation?.id === conv.id
                      ? 'bg-blue-50 border border-blue-200'
                      : 'hover:bg-gray-50'
                  }`}
                  onClick={() => setSelectedConversation(conv)}
                >
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="bg-blue-100 text-blue-600 text-xs">
                          {conv.conversation_type === 'group' ? <Users className="h-4 w-4" /> : conv.name?.[0] || 'D'}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {conv.name || 'Direct Message'}
                        </p>
                        <p className="text-xs text-gray-500">
                          {conv.participant_count} members
                        </p>
                      </div>
                    </div>
                    {conv.unread_count > 0 && (
                      <Badge variant="default" className="ml-2">
                        {conv.unread_count}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Messages Area */}
        <div className="flex-1 flex flex-col">
          {selectedConversation ? (
            <>
              {/* Conversation Header */}
              <div className="bg-white border-b px-6 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold text-lg">
                      {selectedConversation.name || 'Direct Message'}
                    </h2>
                    <p className="text-sm text-gray-500">
                      {selectedConversation.participant_count} members
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Circle className="h-2 w-2 fill-green-500 text-green-500" />
                    <span>Online</span>
                  </div>
                </div>
              </div>

              {/* Messages */}
              <ScrollArea className="flex-1 p-6">
                <div className="space-y-4">
                  {messages.map((msg) => (
                    <div key={msg.id} className="flex gap-3">
                      <Avatar className="h-8 w-8 mt-1">
                        <AvatarFallback className="bg-gray-200 text-gray-600 text-xs">
                          {msg.username[0]?.toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <div className="flex items-baseline gap-2 mb-1">
                          <span className="font-medium text-sm">{msg.username}</span>
                          <span className="text-xs text-gray-500">
                            {new Date(msg.created_at).toLocaleTimeString()}
                          </span>
                          {msg.is_edited && (
                            <span className="text-xs text-gray-400">(edited)</span>
                          )}
                        </div>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">
                          {msg.content}
                        </p>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {/* Message Input */}
              {rbac.canSendMessages() && (
                <div className="bg-white border-t p-4">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Type a message..."
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyPress={handleKeyPress}
                      disabled={sending}
                      className="flex-1"
                    />
                    <Button onClick={sendMessage} disabled={sending || !newMessage.trim()}>
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              <div className="text-center">
                <MessageSquare className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                <p>Select a conversation to start chatting</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
