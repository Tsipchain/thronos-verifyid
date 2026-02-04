import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api';
import { authApi } from '@/lib/auth';
import { getAPIBaseURL } from '@/lib/config';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Video, Clock, AlertTriangle, Phone, User, CheckCircle, Bot } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Toaster } from '@/components/ui/toaster';
import AIAssistantModal from '@/components/AIAssistantModal';

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
}

interface AgentStatus {
  agent_id: string;
  status: string;
  last_heartbeat: string;
  current_call_id: number | null;
  total_calls_today: number;
}

export default function CallAgentDashboard() {
  const [pendingCalls, setPendingCalls] = useState<VideoCallRequest[]>([]);
  const [activeCalls, setActiveCalls] = useState<number>(0);
  const [agentStatus, setAgentStatus] = useState<string>('offline');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    checkAuth();
  }, []);

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
      
      // Fetch pending calls
      await fetchPendingCalls();
      
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
      
      // Update agent status
      await updateAgentStatus(agentStatus);
    }, 30000); // Every 30 seconds
  };

  const fetchPendingCalls = async () => {
    try {
      const response = await apiClient.get('/api/v1/video-calls/pending');
      setPendingCalls(response.data);
    } catch (error: any) {
      console.error('Failed to fetch pending calls:', error);
      const detail = error?.response?.data?.detail || error.message;
      toast({
        title: 'Error',
        description: detail,
        variant: 'destructive'
      });
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

  const acceptCall = async (callId: number) => {
    try {
      // Assign call to current agent
      await apiClient.post(`/api/v1/video-calls/${callId}/assign`, { agent_id: currentUser.id });
      
      // Start the call
      await apiClient.post(`/api/v1/video-calls/${callId}/start`);
      
      toast({
        title: 'Call Started',
        description: 'Video call interface will open',
      });
      
      // Refresh pending calls
      await fetchPendingCalls();
      
      // In a real implementation, open video call interface
      // window.open(`/video-call/${callId}`, '_blank');
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
    <div className="container mx-auto p-6">
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
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAiModalOpen(true)}
          className="gap-2"
        >
          <Bot className="h-4 w-4" />
          AI Assistant
        </Button>
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
            Call History
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
            pendingCalls.map((call) => (
              <Card key={call.id} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        {getPriorityBadge(call.priority)}
                        <span className="font-semibold text-lg">
                          Customer ID: {call.customer_id}
                        </span>
                      </div>
                      <div className="text-sm text-gray-500">
                        Verification ID: #{call.verification_id}
                      </div>
                    </div>
                    <Button 
                      onClick={() => acceptCall(call.id)}
                      className="bg-blue-500 hover:bg-blue-600"
                    >
                      <Video className="mr-2 h-4 w-4" />
                      Accept Call
                    </Button>
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
            ))
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

        <TabsContent value="history" className="mt-4">
          <Card>
            <CardContent className="pt-6 text-center text-gray-500">
              <CheckCircle className="mx-auto h-12 w-12 mb-2 opacity-50" />
              <p>Call history</p>
              <p className="text-sm">Completed calls will appear here</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      <AIAssistantModal open={aiModalOpen} onOpenChange={setAiModalOpen} />
    </div>
  );
}
