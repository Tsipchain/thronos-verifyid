import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/lib/api';
import { authApi } from '@/lib/auth';
import { getAPIBaseURL } from '@/lib/config';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Video, Clock, AlertTriangle, Phone, User, CheckCircle, XCircle, Bot, History } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Toaster } from '@/components/ui/toaster';
import AIAssistantModal from '@/components/AIAssistantModal';
import LanguageSelector from '@/components/LanguageSelector';
import ChatWidget from '@/components/ChatWidget';

interface VideoCallRequest {
  id: number;
  verification_id: number;
  customer_id: string;
  agent_id: string | null;
  priority: string;
  status: string;
  created_at: string;
  assigned_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  wait_time_seconds: number;
  client_online?: boolean;
  is_stuck?: boolean;
  outcome?: string | null;
}

interface AgentStatus {
  agent_id: string;
  status: string;
  last_heartbeat: string;
  current_call_id: number | null;
  total_calls_today: number;
}

export default function CallAgentDashboard() {
  const navigate = useNavigate();
  const [pendingCalls, setPendingCalls] = useState<VideoCallRequest[]>([]);
  const [callHistory, setCallHistory] = useState<VideoCallRequest[]>([]);
  const [activeCalls, setActiveCalls] = useState<number>(0);
  const [agentStatus, setAgentStatus] = useState<string>('offline');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const { toast } = useToast();

  useEffect(() => {
    checkAuth();
  }, []);


  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;

    const fetchUnread = async () => {
      try {
        const response = await apiClient.get<Array<{ unread_count?: number }>>('/api/v1/chat/conversations');
        const total = response.data.reduce((sum, conv) => sum + (conv.unread_count || 0), 0);
        setChatUnreadCount(total);
      } catch {
        // ignore polling error
      }
    };

    fetchUnread();
    intervalId = setInterval(fetchUnread, 15000);
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [chatOpen]);

  const checkAuth = async () => {
    try {
      const user = await authApi.getCurrentUser();
      if (!user) {
        throw new Error('Authentication required');
      }
      setCurrentUser(user);
      
      // Connect WebSocket
      connectWebSocket(user.id);
      
      // Set agent status to online
      await updateAgentStatus('online');
      
      // Fetch pending calls and history
      await fetchPendingCalls();
      await fetchCallHistory();
      
      // Start heartbeat
      startHeartbeat(user.id);
    } catch (error) {
      console.error('Authentication failed:', error);
      toast({
        title: 'Authentication Error',
        description: 'Please log in to access this page',
        variant: 'destructive'
      });
    }
  };

  const handleLogout = async () => {
    try {
      await authApi.logout();
      navigate('/login');
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to logout',
        variant: 'destructive'
      });
    }
  };

  const connectWebSocket = (userId: string) => {
    const apiBaseUrl = getAPIBaseURL();
    const wsBaseUrl = apiBaseUrl.startsWith('https')
      ? apiBaseUrl.replace('https', 'wss')
      : apiBaseUrl.replace('http', 'ws');
    const wsUrl = new URL(`/api/v1/video-calls/ws/${userId}`, wsBaseUrl);
    
    const websocket = new WebSocket(wsUrl.toString());
    
    websocket.onopen = () => {
      console.log('WebSocket connected');
    };
    
    websocket.onmessage = (event) => {
      const message = JSON.parse(event.data);

      if (message.type === 'new_call') {
        toast({
          title: '🔔 New Call in Queue',
          description: `Priority: ${message.priority.toUpperCase()}`,
        });
        fetchPendingCalls();
      } else if (message.type === 'call_assigned') {
        toast({
          title: '✅ Call Assigned',
          description: `Call ID: ${message.call_id}`,
        });
        fetchPendingCalls();
      } else if (message.type === 'call_completed') {
        fetchPendingCalls();
        fetchCallHistory();
      } else if (message.type === 'client_disconnected') {
        // Mark the matching pending call as offline immediately (no re-fetch needed)
        setPendingCalls(prev =>
          prev.map(c =>
            c.customer_id === message.user_id ? { ...c, client_online: false } : c
          )
        );
      } else if (message.type === 'heartbeat_ack') {
        // Heartbeat acknowledged
      }
    };
    
    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    websocket.onclose = () => {
      console.log('WebSocket disconnected');
      // Attempt to reconnect after 5 seconds
      setTimeout(() => connectWebSocket(userId), 5000);
    };
    
    setWs(websocket);
  };

  const startHeartbeat = (userId: string) => {
    setInterval(async () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'heartbeat' }));
      }
      // Always send 'online' — agent is active while this dashboard is open
      await updateAgentStatus('online');
    }, 30000); // Every 30 seconds
  };

  const fetchPendingCalls = async () => {
    try {
      const response = await apiClient.get('/api/v1/video-calls/pending');
      setPendingCalls(response.data);
    } catch (error: any) {
      console.error('Failed to fetch pending calls:', error);
      const detail = error?.response?.data?.detail || error.message;
      toast({ title: 'Error', description: detail, variant: 'destructive' });
    }
  };

  const fetchCallHistory = async () => {
    try {
      const response = await apiClient.get<VideoCallRequest[]>('/api/v1/video-calls/history');
      setCallHistory(response.data);
    } catch (error: any) {
      console.error('Failed to fetch call history:', error);
    }
  };

  const updateAgentStatus = async (status: string) => {
    try {
      await apiClient.post('/api/v1/video-calls/agents/status', { status });
      setAgentStatus(status);
    } catch (error) {
      console.error('Failed to update agent status:', error);
    }
  };

  const acceptCall = async (callId: number, clientOnline?: boolean) => {
    // Warn the agent if the client appears to have disconnected
    if (clientOnline === false) {
      const proceed = window.confirm(
        'The client appears to be offline or may have closed the waiting page.\n' +
        'You can still accept the call — the client may reconnect shortly.\n\n' +
        'Continue?'
      );
      if (!proceed) return;
    }

    try {
      // Assign call to current agent
      await apiClient.post(`/api/v1/video-calls/${callId}/assign`, { agent_id: currentUser.id });

      // Start the call
      await apiClient.post(`/api/v1/video-calls/${callId}/start`);

      // Refresh pending calls
      await fetchPendingCalls();

      // Open the video call interface
      navigate(`/agent/video-call/${callId}`);
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error.message;
      toast({
        title: 'Error',
        description: detail,
        variant: 'destructive'
      });
    }
  };

  const getPriorityBadge = (priority: string) => {
    const badges: Record<string, { label: string; className: string; icon: string }> = {
      urgent: { label: 'URGENT', className: 'bg-red-500 hover:bg-red-600', icon: '🔴' },
      high: { label: 'HIGH', className: 'bg-orange-500 hover:bg-orange-600', icon: '🟠' },
      normal: { label: 'NORMAL', className: 'bg-green-500 hover:bg-green-600', icon: '🟢' },
      low: { label: 'LOW', className: 'bg-gray-500 hover:bg-gray-600', icon: '⚪' }
    };
    
    const badge = badges[priority.toLowerCase()] || badges.normal;
    
    return (
      <Badge className={badge.className}>
        {badge.icon} {badge.label}
      </Badge>
    );
  };

  const formatWaitTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  };

  return (
    <div className="container mx-auto p-6 pb-24">
      <Toaster />
      
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2">Call Agent Dashboard</h1>
          <div className="flex flex-wrap gap-4 items-center">
            <Badge className={agentStatus === 'online' ? 'bg-green-500' : 'bg-gray-500'}>
              {agentStatus === 'online' ? '● Online' : '○ Offline'}
            </Badge>
            <span className="text-sm text-gray-500">
              Active Calls: {activeCalls}/3
            </span>
            <span className="text-sm text-gray-500">
              Queue: {pendingCalls.length}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <LanguageSelector />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAiModalOpen(true)}
            className="gap-2"
          >
            <Bot className="h-4 w-4" />
            AI Assistant
          </Button>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            Logout
          </Button>
        </div>
      </div>

      <Tabs defaultValue="pending" className="w-full">
        <TabsList>
          <TabsTrigger value="pending">
            Pending Calls ({pendingCalls.length})
          </TabsTrigger>
          <TabsTrigger value="active">
            Active Calls ({activeCalls})
          </TabsTrigger>
          <TabsTrigger value="history">
            Call History ({callHistory.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-4 mt-4">
          {pendingCalls.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center text-gray-500">
                <Phone className="mx-auto h-12 w-12 mb-2 opacity-50" />
                <p>No pending calls at the moment</p>
              </CardContent>
            </Card>
          ) : (
            pendingCalls.map((call) => {
              const isOnline = call.client_online !== false;
              const isStuck = call.is_stuck === true;
              return (
                <Card
                  key={call.id}
                  className={`hover:shadow-lg transition-shadow ${
                    isStuck
                      ? 'border-orange-400 bg-orange-50'
                      : !isOnline
                        ? 'opacity-70 border-dashed'
                        : ''
                  }`}
                >
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          {isStuck ? (
                            <Badge className="bg-orange-500 text-white text-xs">⚠ Stuck Call</Badge>
                          ) : (
                            getPriorityBadge(call.priority)
                          )}
                          {!isStuck && call.client_online === true && (
                            <Badge className="bg-green-500 text-white text-xs">● Online</Badge>
                          )}
                          {!isStuck && call.client_online === false && (
                            <Badge className="bg-red-500 text-white text-xs" title="Client has disconnected from the waiting page">
                              ○ Offline
                            </Badge>
                          )}
                          <span className="font-semibold text-lg">
                            Customer ID: {call.customer_id}
                          </span>
                        </div>
                        <div className="text-sm text-gray-500">
                          Verification ID: #{call.verification_id}
                        </div>
                        {isStuck && (
                          <div className="text-xs text-orange-600 mt-1 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Call started but was never completed — resume to close it
                          </div>
                        )}
                        {!isStuck && call.client_online === false && (
                          <div className="text-xs text-red-500 mt-1 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Client may have left the waiting screen
                          </div>
                        )}
                      </div>
                      {isStuck ? (
                        <Button
                          onClick={() => navigate(`/agent/video-call/${call.id}`)}
                          className="bg-orange-500 hover:bg-orange-600"
                        >
                          <Video className="mr-2 h-4 w-4" />
                          Resume
                        </Button>
                      ) : (
                        <Button
                          onClick={() => acceptCall(call.id, call.client_online)}
                          className={isOnline ? 'bg-blue-500 hover:bg-blue-600' : 'bg-gray-500 hover:bg-gray-600'}
                        >
                          <Video className="mr-2 h-4 w-4" />
                          Accept Call
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <div className="text-sm text-gray-500">Wait Time</div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {formatWaitTime(call.wait_time_seconds || 0)}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-500">Status</div>
                        <div className="flex items-center gap-1">
                          <Badge variant="outline">{call.status}</Badge>
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-500">Created</div>
                        <div>{new Date(call.created_at).toLocaleTimeString()}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="active" className="mt-4">
          <Card>
            <CardContent className="pt-6 text-center text-gray-500">
              <Video className="mx-auto h-12 w-12 mb-2 opacity-50" />
              <p>No active calls</p>
              <p className="text-sm">Accepted calls will appear here</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4 space-y-3">
          {callHistory.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center text-gray-500">
                <History className="mx-auto h-12 w-12 mb-2 opacity-50" />
                <p>No completed calls yet</p>
                <p className="text-sm">Calls you handle will appear here with their outcomes</p>
              </CardContent>
            </Card>
          ) : (
            callHistory.map((call) => {
              const approved = call.outcome === 'approved';
              const rejected = call.outcome === 'rejected';
              return (
                <Card key={call.id} className={`border-l-4 ${approved ? 'border-l-green-500' : rejected ? 'border-l-red-500' : 'border-l-gray-400'}`}>
                  <CardContent className="py-4 px-5">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        {approved ? (
                          <CheckCircle className="h-8 w-8 text-green-500 flex-shrink-0" />
                        ) : rejected ? (
                          <XCircle className="h-8 w-8 text-red-500 flex-shrink-0" />
                        ) : (
                          <Clock className="h-8 w-8 text-gray-400 flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">Call #{call.id}</span>
                            <Badge
                              className={
                                approved ? 'bg-green-100 text-green-800 border-green-200' :
                                rejected ? 'bg-red-100 text-red-800 border-red-200' :
                                'bg-gray-100 text-gray-700 border-gray-200'
                              }
                              variant="outline"
                            >
                              {call.outcome ? call.outcome.toUpperCase() : 'UNKNOWN'}
                            </Badge>
                            {getPriorityBadge(call.priority)}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">
                            Verification #{call.verification_id} · Customer: {call.customer_id}
                          </p>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 text-xs text-gray-400 space-y-0.5">
                        {call.completed_at && (
                          <p>{new Date(call.completed_at).toLocaleString()}</p>
                        )}
                        {call.started_at && call.completed_at && (
                          <p>
                            Duration: {Math.round(
                              (new Date(call.completed_at).getTime() - new Date(call.started_at).getTime()) / 60000
                            )}m
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>
      </Tabs>
      <AIAssistantModal open={aiModalOpen} onOpenChange={setAiModalOpen} />
      <ChatWidget open={chatOpen} onOpenChange={setChatOpen} />
      <footer className="fixed bottom-0 left-0 right-0 border-t bg-white/90 backdrop-blur dark:bg-gray-900/90">
        <div className="container mx-auto flex items-center justify-between px-6 py-3">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Team communication
          </span>
          <Button
            size="sm"
            onClick={() => setChatOpen(true)}
            className="gap-2"
          >
            <User className="h-4 w-4" />
            Open Team Chat
          </Button>
        </div>
      </footer>
    </div>
  );
}
