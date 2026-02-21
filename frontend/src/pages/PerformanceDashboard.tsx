import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { createClient } from '@metagptx/web-sdk';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import {
  Activity, AlertTriangle, Clock, Database, TrendingUp, Zap,
  Phone, Users, CheckCircle, XCircle, Bot, UserCheck,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { authApi } from '@/lib/auth';
import { apiClient } from '@/lib/api';

const client = createClient();

// ── Call-center analytics types ───────────────────────────────────────────────

interface CallCenterStats {
  period: string;
  range_start: string;
  range_end: string;
  total_calls: number;
  completed_calls: number;
  pending_calls: number;
  cancelled_calls: number;
  approved: number;
  rejected: number;
  approval_rate_pct: number;
  avg_wait_seconds: number;
  avg_handle_seconds: number;
}

interface AgentStats {
  agent_id: string;
  is_ai: boolean;
  calls_handled: number;
  calls_completed: number;
  approved: number;
  rejected: number;
  approval_rate_pct: number;
  avg_handle_seconds: number;
  avg_wait_seconds: number;
}

interface TimeseriesPoint {
  label: string;
  calls: number;
}

// ── Existing types ────────────────────────────────────────────────────────────

interface DashboardSummary {
  total_requests_24h: number;
  avg_response_time_ms: number;
  error_rate_percent: number;
  slow_queries_count: number;
  active_alerts_count: number;
  top_slow_endpoint: string | null;
  top_slow_endpoint_time_ms: number | null;
}

interface SlowQuery {
  query_hash: string;
  query_text: string;
  count: number;
  avg_time_ms: number;
  max_time_ms: number;
  min_time_ms: number;
}

interface EndpointPerformance {
  endpoint: string;
  method: string;
  request_count: number;
  avg_response_time_ms: number;
  max_response_time_ms: number;
  error_count: number;
  error_rate: number;
}

interface PerformanceAlert {
  id: number;
  alert_type: string;
  severity: string;
  endpoint: string | null;
  metric_value: number;
  threshold_value: number;
  description: string;
  created_at: string;
}

export default function PerformanceDashboard() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [slowQueries, setSlowQueries] = useState<SlowQuery[]>([]);
  const [endpoints, setEndpoints] = useState<EndpointPerformance[]>([]);
  const [alerts, setAlerts] = useState<PerformanceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState(24);
  const { toast } = useToast();

  // Call-center analytics state
  const [analyticsPeriod, setAnalyticsPeriod] = useState<'daily' | 'monthly'>('daily');
  const [ccStats, setCcStats] = useState<CallCenterStats | null>(null);
  const [agentStats, setAgentStats] = useState<AgentStats[]>([]);
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const fetchAnalytics = useCallback(async (period: 'daily' | 'monthly') => {
    setAnalyticsLoading(true);
    try {
      const [ccRes, agentRes, tsRes] = await Promise.all([
        apiClient.get<CallCenterStats>(`/api/v1/analytics/call-center?period=${period}`),
        apiClient.get<AgentStats[]>(`/api/v1/analytics/agents?period=${period}`),
        apiClient.get<TimeseriesPoint[]>(`/api/v1/analytics/call-center/timeseries?period=${period}`),
      ]);
      setCcStats(ccRes.data);
      setAgentStats(agentRes.data);
      setTimeseries(tsRes.data);
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || 'Failed to load analytics';
      toast({ title: 'Analytics error', description: detail, variant: 'destructive' });
    } finally {
      setAnalyticsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchAnalytics(analyticsPeriod);
  }, [analyticsPeriod, fetchAnalytics]);

  const handleLogout = async () => {
    try {
      await authApi.logout();
      navigate('/login');
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to logout',
        variant: 'destructive',
      });
    }
  };

  const fetchData = async () => {
    try {
      setLoading(true);

      // Fetch dashboard summary
      const summaryResponse = await client.apiCall.invoke({
        url: '/api/v1/performance/dashboard/summary',
        method: 'GET',
      });
      setSummary(summaryResponse.data);

      // Fetch slow queries
      const queriesResponse = await client.apiCall.invoke({
        url: `/api/v1/performance/slow-queries?hours=${timeRange}&limit=20`,
        method: 'GET',
      });
      setSlowQueries(queriesResponse.data);

      // Fetch endpoint performance
      const endpointsResponse = await client.apiCall.invoke({
        url: `/api/v1/performance/endpoints?hours=${timeRange}`,
        method: 'GET',
      });
      setEndpoints(endpointsResponse.data);

      // Fetch active alerts
      const alertsResponse = await client.apiCall.invoke({
        url: '/api/v1/performance/alerts?limit=50',
        method: 'GET',
      });
      setAlerts(alertsResponse.data);
    } catch (error: any) {
      const detail = error?.data?.detail || error?.response?.data?.detail || error.message;
      toast({
        title: 'Error loading performance data',
        description: detail,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const resolveAlert = async (alertId: number) => {
    try {
      await client.apiCall.invoke({
        url: `/api/v1/performance/alerts/${alertId}/resolve`,
        method: 'POST',
      });
      
      toast({
        title: 'Alert resolved',
        description: 'The alert has been marked as resolved.',
      });
      
      // Refresh alerts
      fetchData();
    } catch (error: any) {
      const detail = error?.data?.detail || error?.response?.data?.detail || error.message;
      toast({
        title: 'Error resolving alert',
        description: detail,
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    fetchData();
  }, [timeRange]);

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-500';
      case 'high':
        return 'bg-orange-500';
      case 'medium':
        return 'bg-yellow-500';
      case 'low':
        return 'bg-blue-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getMethodColor = (method: string) => {
    switch (method) {
      case 'GET':
        return 'bg-green-500';
      case 'POST':
        return 'bg-blue-500';
      case 'PUT':
        return 'bg-yellow-500';
      case 'DELETE':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  if (loading && !summary) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 flex items-center justify-center">
        <div className="text-center">
          <Activity className="w-12 h-12 animate-spin mx-auto mb-4 text-blue-600" />
          <p className="text-gray-600">Loading performance data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-4xl font-bold text-gray-900">Performance Dashboard</h1>
            <p className="text-gray-600 mt-2">Monitor system performance and identify bottlenecks</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant={timeRange === 1 ? 'default' : 'outline'}
              onClick={() => setTimeRange(1)}
            >
              1h
            </Button>
            <Button
              variant={timeRange === 24 ? 'default' : 'outline'}
              onClick={() => setTimeRange(24)}
            >
              24h
            </Button>
            <Button
              variant={timeRange === 168 ? 'default' : 'outline'}
              onClick={() => setTimeRange(168)}
            >
              7d
            </Button>
            <Button onClick={fetchData} variant="outline">
              <Activity className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Button variant="outline" onClick={handleLogout}>
              Logout
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Total Requests</CardTitle>
                <Activity className="w-4 h-4 text-gray-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summary.total_requests_24h.toLocaleString()}</div>
                <p className="text-xs text-gray-600 mt-1">Last {timeRange}h</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Avg Response Time</CardTitle>
                <Clock className="w-4 h-4 text-gray-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summary.avg_response_time_ms.toFixed(0)}ms</div>
                <p className="text-xs text-gray-600 mt-1">Average across all endpoints</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Error Rate</CardTitle>
                <AlertTriangle className="w-4 h-4 text-gray-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summary.error_rate_percent.toFixed(2)}%</div>
                <p className="text-xs text-gray-600 mt-1">
                  {summary.error_rate_percent > 5 ? 'Above threshold' : 'Within normal range'}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Active Alerts</CardTitle>
                <Zap className="w-4 h-4 text-gray-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summary.active_alerts_count}</div>
                <p className="text-xs text-gray-600 mt-1">
                  {summary.slow_queries_count} slow queries detected
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Active Alerts */}
        {alerts.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                Active Performance Alerts
              </CardTitle>
              <CardDescription>Unresolved performance issues requiring attention</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {alerts.map((alert) => (
                  <Alert key={alert.id} className="border-l-4" style={{ borderLeftColor: getSeverityColor(alert.severity).replace('bg-', '#') }}>
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <AlertTitle className="flex items-center gap-2">
                          <Badge className={getSeverityColor(alert.severity)}>{alert.severity}</Badge>
                          {alert.alert_type.replace('_', ' ').toUpperCase()}
                        </AlertTitle>
                        <AlertDescription className="mt-2">
                          {alert.description}
                          {alert.endpoint && (
                            <div className="mt-1 text-xs">
                              <span className="font-semibold">Endpoint:</span> {alert.endpoint}
                            </div>
                          )}
                          <div className="mt-1 text-xs text-gray-500">
                            {new Date(alert.created_at).toLocaleString()}
                          </div>
                        </AlertDescription>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => resolveAlert(alert.id)}
                      >
                        Resolve
                      </Button>
                    </div>
                  </Alert>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabs for detailed views */}
        <Tabs defaultValue="call-center" className="space-y-6">
          <TabsList>
            <TabsTrigger value="call-center">Call Center</TabsTrigger>
            <TabsTrigger value="agents">Agents &amp; AI</TabsTrigger>
            <TabsTrigger value="endpoints">API Endpoints</TabsTrigger>
            <TabsTrigger value="queries">Slow Queries</TabsTrigger>
          </TabsList>

          {/* ── Call Center Analytics ── */}
          <TabsContent value="call-center" className="space-y-6">
            {/* Period toggle */}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={analyticsPeriod === 'daily' ? 'default' : 'outline'}
                onClick={() => setAnalyticsPeriod('daily')}
              >Daily</Button>
              <Button
                size="sm"
                variant={analyticsPeriod === 'monthly' ? 'default' : 'outline'}
                onClick={() => setAnalyticsPeriod('monthly')}
              >Monthly</Button>
              {analyticsLoading && <span className="text-xs text-gray-400 animate-pulse">Loading…</span>}
            </div>

            {ccStats && (
              <>
                {/* KPI cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardHeader className="pb-1 flex flex-row items-center justify-between">
                      <CardTitle className="text-sm font-medium">Total Calls</CardTitle>
                      <Phone className="h-4 w-4 text-gray-400" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold">{ccStats.total_calls}</div>
                      <p className="text-xs text-gray-500 mt-1">
                        {ccStats.completed_calls} completed · {ccStats.pending_calls} pending
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-1 flex flex-row items-center justify-between">
                      <CardTitle className="text-sm font-medium">Approval Rate</CardTitle>
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold text-green-600">{ccStats.approval_rate_pct}%</div>
                      <Progress value={ccStats.approval_rate_pct} className="h-1 mt-2" />
                      <p className="text-xs text-gray-500 mt-1">
                        {ccStats.approved} approved · {ccStats.rejected} rejected
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-1 flex flex-row items-center justify-between">
                      <CardTitle className="text-sm font-medium">Avg Wait Time</CardTitle>
                      <Clock className="h-4 w-4 text-gray-400" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold">
                        {ccStats.avg_wait_seconds < 60
                          ? `${ccStats.avg_wait_seconds}s`
                          : `${Math.round(ccStats.avg_wait_seconds / 60)}m`}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Queue entry → call start</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-1 flex flex-row items-center justify-between">
                      <CardTitle className="text-sm font-medium">Avg Handle Time</CardTitle>
                      <TrendingUp className="h-4 w-4 text-gray-400" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold">
                        {ccStats.avg_handle_seconds < 60
                          ? `${ccStats.avg_handle_seconds}s`
                          : `${Math.round(ccStats.avg_handle_seconds / 60)}m`}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Call start → completion</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Simple bar chart */}
                {timeseries.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Activity className="h-4 w-4" />
                        Call Volume — {analyticsPeriod === 'daily' ? 'Hourly (today)' : 'Daily (this month)'}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {(() => {
                        const max = Math.max(...timeseries.map(p => p.calls), 1);
                        return (
                          <div className="flex items-end gap-1 h-32 overflow-x-auto pb-1">
                            {timeseries.map((p) => (
                              <div key={p.label} className="flex flex-col items-center flex-1 min-w-[20px]">
                                <div
                                  className="w-full bg-blue-500 rounded-t"
                                  style={{ height: `${Math.max(2, (p.calls / max) * 100)}%` }}
                                  title={`${p.label}: ${p.calls} calls`}
                                />
                                <span className="text-[9px] text-gray-400 mt-0.5 rotate-45 origin-left whitespace-nowrap">
                                  {p.label.slice(-5)}
                                </span>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>

          {/* ── Agent & AI Performance ── */}
          <TabsContent value="agents" className="space-y-6">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={analyticsPeriod === 'daily' ? 'default' : 'outline'}
                onClick={() => setAnalyticsPeriod('daily')}
              >Daily</Button>
              <Button
                size="sm"
                variant={analyticsPeriod === 'monthly' ? 'default' : 'outline'}
                onClick={() => setAnalyticsPeriod('monthly')}
              >Monthly</Button>
            </div>

            {agentStats.length === 0 && !analyticsLoading && (
              <div className="text-center py-12 text-gray-400">
                <Users className="h-12 w-12 mx-auto mb-2 opacity-40" />
                <p>No agent activity in the selected period.</p>
              </div>
            )}

            {agentStats.map((a) => (
              <Card key={a.agent_id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    {a.is_ai ? (
                      <Bot className="h-5 w-5 text-purple-600" />
                    ) : (
                      <UserCheck className="h-5 w-5 text-blue-600" />
                    )}
                    <div>
                      <CardTitle className="text-base font-mono">
                        {a.is_ai ? '🤖 AI Agent' : `Agent: ${a.agent_id}`}
                      </CardTitle>
                      <CardDescription>
                        {a.calls_handled} calls handled · {a.calls_completed} completed
                      </CardDescription>
                    </div>
                    <div className="ml-auto">
                      <Badge className={a.approval_rate_pct >= 80 ? 'bg-green-600' : 'bg-yellow-600'}>
                        {a.approval_rate_pct}% approval
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Approved</span>
                      <p className="font-semibold text-green-600 flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" />{a.approved}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Rejected</span>
                      <p className="font-semibold text-red-600 flex items-center gap-1">
                        <XCircle className="h-3 w-3" />{a.rejected}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Avg Handle</span>
                      <p className="font-semibold">
                        {a.avg_handle_seconds < 60
                          ? `${a.avg_handle_seconds}s`
                          : `${Math.round(a.avg_handle_seconds / 60)}m`}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Avg Wait</span>
                      <p className="font-semibold">
                        {a.avg_wait_seconds < 60
                          ? `${a.avg_wait_seconds}s`
                          : `${Math.round(a.avg_wait_seconds / 60)}m`}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Approval rate</span>
                      <span>{a.approval_rate_pct}%</span>
                    </div>
                    <Progress value={a.approval_rate_pct} className="h-1.5" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="endpoints" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5" />
                  API Endpoint Performance
                </CardTitle>
                <CardDescription>Performance metrics for all API endpoints</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {endpoints.map((endpoint, index) => (
                    <div key={index} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          <Badge className={getMethodColor(endpoint.method)}>{endpoint.method}</Badge>
                          <span className="font-mono text-sm">{endpoint.endpoint}</span>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold">{endpoint.request_count.toLocaleString()} requests</div>
                          <div className="text-xs text-gray-600">
                            {endpoint.error_count} errors ({endpoint.error_rate.toFixed(2)}%)
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-4 mt-3 text-sm">
                        <div>
                          <div className="text-gray-600">Avg Response</div>
                          <div className="font-semibold">{endpoint.avg_response_time_ms.toFixed(0)}ms</div>
                        </div>
                        <div>
                          <div className="text-gray-600">Max Response</div>
                          <div className="font-semibold">{endpoint.max_response_time_ms.toFixed(0)}ms</div>
                        </div>
                        <div>
                          <div className="text-gray-600">Error Rate</div>
                          <div className={`font-semibold ${endpoint.error_rate > 5 ? 'text-red-600' : 'text-green-600'}`}>
                            {endpoint.error_rate.toFixed(2)}%
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="queries" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="w-5 h-5" />
                  Slow Database Queries
                </CardTitle>
                <CardDescription>Queries exceeding performance thresholds</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {slowQueries.map((query, index) => (
                    <div key={index} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex-1">
                          <div className="font-mono text-xs bg-gray-100 p-2 rounded overflow-x-auto">
                            {query.query_text}
                          </div>
                        </div>
                        <Badge variant="outline" className="ml-4">
                          {query.count}x executed
                        </Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-4 mt-3 text-sm">
                        <div>
                          <div className="text-gray-600">Avg Time</div>
                          <div className="font-semibold text-orange-600">{query.avg_time_ms.toFixed(0)}ms</div>
                        </div>
                        <div>
                          <div className="text-gray-600">Min Time</div>
                          <div className="font-semibold">{query.min_time_ms.toFixed(0)}ms</div>
                        </div>
                        <div>
                          <div className="text-gray-600">Max Time</div>
                          <div className="font-semibold text-red-600">{query.max_time_ms.toFixed(0)}ms</div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {slowQueries.length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                      <Database className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>No slow queries detected in the selected time range</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
