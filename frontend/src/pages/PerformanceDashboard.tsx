import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart, Area,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  ArrowLeft, RefreshCw, Phone, CheckCircle, XCircle, Clock,
  TrendingUp, Bot, UserCheck, AlertTriangle, Zap, Activity,
  Shield, FileText, Database,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/lib/api';

// ── Palette ───────────────────────────────────────────────────────────────────

const PIE_COLORS = {
  completed:  '#8b5cf6',
  approved:   '#22c55e',
  rejected:   '#ef4444',
  in_review:  '#3b82f6',
  pending:    '#f59e0b',
  cancelled:  '#94a3b8',
};

const AGENT_COLORS = { approved: '#22c55e', rejected: '#ef4444' };
const SCORE_COLORS = ['#22c55e', '#4ade80', '#86efac', '#fde047', '#fb923c', '#f87171', '#dc2626'];

// ── Types ─────────────────────────────────────────────────────────────────────

interface CallCenterStats {
  period: string;
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

interface TimeseriesPoint { label: string; calls: number; }

interface Verification {
  id: number;
  document_type: string;
  verification_status: string;
  fraud_score: number;
  risk_level: string | null;
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

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtSeconds = (s: number) => s < 60 ? `${s}s` : `${Math.round(s / 60)}m`;

const DOC_LABELS: Record<string, string> = {
  national_id: 'National ID', passport: 'Passport',
  drivers_license: "Driver's Lic.", residence_permit: 'Residence',
};

function KpiCard({
  title, value, sub, icon: Icon, color = 'text-gray-800',
}: {
  title: string; value: string | number; sub?: string;
  icon: React.FC<{ className?: string }>; color?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-1">
        <CardTitle className="text-sm font-medium text-gray-500">{title}</CardTitle>
        <Icon className="h-4 w-4 text-gray-400" />
      </CardHeader>
      <CardContent>
        <div className={`text-3xl font-bold ${color}`}>{value}</div>
        {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// Custom label for PieChart slices
const renderPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
  if (percent < 0.05) return null;
  const RADIAN = Math.PI / 180;
  const r = innerRadius + (outerRadius - innerRadius) * 0.55;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight="bold">
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

export default function PerformanceDashboard() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [period, setPeriod] = useState<'daily' | 'monthly'>('daily');
  const [ccStats, setCcStats] = useState<CallCenterStats | null>(null);
  const [agentStats, setAgentStats] = useState<AgentStats[]>([]);
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>([]);
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [alerts, setAlerts] = useState<PerformanceAlert[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async (p: 'daily' | 'monthly') => {
    setLoading(true);
    try {
      const [ccRes, agRes, tsRes, verRes, alertRes] = await Promise.all([
        apiClient.get<CallCenterStats>(`/api/v1/analytics/call-center?period=${p}`),
        apiClient.get<AgentStats[]>(`/api/v1/analytics/agents?period=${p}`),
        apiClient.get<TimeseriesPoint[]>(`/api/v1/analytics/call-center/timeseries?period=${p}`),
        apiClient.get<Verification[]>(`/api/v1/verifications/list?limit=500`),
        apiClient.get<PerformanceAlert[]>(`/api/v1/performance/alerts?limit=20`).catch(() => ({ data: [] })),
      ]);
      setCcStats(ccRes.data);
      setAgentStats(agRes.data);
      setTimeseries(tsRes.data);
      setVerifications(verRes.data);
      setAlerts((alertRes as any).data ?? []);
    } catch (err: any) {
      toast({ title: 'Failed to load reports', description: err?.response?.data?.detail || err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchAll(period); }, [period, fetchAll]);

  const resolveAlert = async (id: number) => {
    try {
      await apiClient.post(`/api/v1/performance/alerts/${id}/resolve`, {});
      setAlerts(prev => prev.filter(a => a.id !== id));
      toast({ title: 'Alert resolved' });
    } catch { /**/ }
  };

  // ── Derived data ────────────────────────────────────────────────────────────

  // Outcome pie data
  const outcomePie = ccStats ? [
    { name: 'Completed',  value: ccStats.completed_calls,  key: 'completed' },
    { name: 'Approved',   value: ccStats.approved,         key: 'approved' },
    { name: 'Rejected',   value: ccStats.rejected,         key: 'rejected' },
    { name: 'Pending',    value: ccStats.pending_calls,    key: 'pending' },
    { name: 'Cancelled',  value: ccStats.cancelled_calls,  key: 'cancelled' },
  ].filter(d => d.value > 0) : [];

  // Document type pie
  const docTypeCounts: Record<string, number> = {};
  verifications.forEach(v => {
    docTypeCounts[v.document_type] = (docTypeCounts[v.document_type] ?? 0) + 1;
  });
  const docTypePie = Object.entries(docTypeCounts).map(([k, v]) => ({
    name: DOC_LABELS[k] ?? k,
    value: v,
  }));

  // Risk level pie
  const riskCounts: Record<string, number> = { low: 0, medium: 0, high: 0 };
  verifications.forEach(v => {
    const r = v.risk_level ?? 'low';
    riskCounts[r] = (riskCounts[r] ?? 0) + 1;
  });
  const riskPie = [
    { name: 'Low Risk',    value: riskCounts.low,    color: '#22c55e' },
    { name: 'Medium Risk', value: riskCounts.medium, color: '#f59e0b' },
    { name: 'High Risk',   value: riskCounts.high,   color: '#ef4444' },
  ].filter(d => d.value > 0);

  // Fraud score histogram (buckets of 10)
  const scoreBuckets: { label: string; count: number; fill: string }[] = Array.from({ length: 10 }, (_, i) => ({
    label: `${i * 10}–${i * 10 + 9}`,
    count: 0,
    fill: SCORE_COLORS[Math.min(i, SCORE_COLORS.length - 1)],
  }));
  verifications.forEach(v => {
    const bucket = Math.min(Math.floor(v.fraud_score / 10), 9);
    scoreBuckets[bucket].count += 1;
  });

  // Agent bar chart data
  const agentBarData = agentStats.map(a => ({
    name: a.is_ai ? '🤖 AI' : a.agent_id.slice(0, 10),
    approved: a.approved,
    rejected: a.rejected,
    rate: a.approval_rate_pct,
  }));

  // Timeseries — trim trailing zeros for cleaner chart
  const trimmedTs = (() => {
    let last = timeseries.length - 1;
    while (last > 0 && timeseries[last].calls === 0) last--;
    return timeseries.slice(0, last + 2);
  })();

  // Summary numbers
  const avgFraudScore = verifications.length
    ? Math.round(verifications.reduce((s, v) => s + v.fraud_score, 0) / verifications.length)
    : 0;
  const aiCount = verifications.filter(v => {
    try { return JSON.parse((v as any).extracted_data || '{}').review_history?.some((e: any) => e.source === 'ai_agent_fallback'); }
    catch { return false; }
  }).length;

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Activity className="w-10 h-10 animate-spin mx-auto mb-3 text-blue-600" />
          <p className="text-gray-500 text-sm">Loading reports…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/admin')}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back
            </Button>
            <div>
              <h1 className="text-xl font-bold">Reports &amp; Analytics</h1>
              <p className="text-xs text-gray-400">
                {verifications.length} verifications · period: {period}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPeriod('daily')}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${period === 'daily' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >Today</button>
            <button
              onClick={() => setPeriod('monthly')}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${period === 'monthly' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >This Month</button>
            <Button variant="outline" size="sm" onClick={() => fetchAll(period)} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">

        {/* ── Alerts banner ─────────────────────────────────────────────────── */}
        {alerts.length > 0 && (
          <div className="space-y-2">
            {alerts.slice(0, 3).map(a => (
              <Alert key={a.id} className={`border-l-4 ${
                a.severity === 'critical' ? 'border-l-red-500' :
                a.severity === 'high' ? 'border-l-orange-500' :
                a.severity === 'medium' ? 'border-l-yellow-500' : 'border-l-blue-500'
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <AlertTitle className="flex items-center gap-2 text-sm">
                      <AlertTriangle className="h-3 w-3" />
                      <Badge className={
                        a.severity === 'critical' ? 'bg-red-500' :
                        a.severity === 'high' ? 'bg-orange-500' :
                        a.severity === 'medium' ? 'bg-yellow-500' : 'bg-blue-500'
                      }>{a.severity}</Badge>
                      {a.alert_type.replace('_', ' ').toUpperCase()}
                    </AlertTitle>
                    <AlertDescription className="text-xs mt-0.5">{a.description}</AlertDescription>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => resolveAlert(a.id)}>Resolve</Button>
                </div>
              </Alert>
            ))}
          </div>
        )}

        {/* ── KPI cards ─────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            title="Total Calls"
            value={ccStats?.total_calls ?? 0}
            sub={`${ccStats?.completed_calls ?? 0} completed · ${ccStats?.pending_calls ?? 0} pending`}
            icon={Phone}
          />
          <KpiCard
            title="Approval Rate"
            value={`${ccStats?.approval_rate_pct ?? 0}%`}
            sub={`${ccStats?.approved ?? 0} approved · ${ccStats?.rejected ?? 0} rejected`}
            icon={CheckCircle}
            color={(ccStats?.approval_rate_pct ?? 0) >= 70 ? 'text-green-600' : 'text-orange-600'}
          />
          <KpiCard
            title="Avg Fraud Score"
            value={`${avgFraudScore}/100`}
            sub={`${verifications.length} total verifications`}
            icon={Shield}
            color={avgFraudScore >= 70 ? 'text-green-600' : avgFraudScore >= 30 ? 'text-yellow-600' : 'text-red-600'}
          />
          <KpiCard
            title="Avg Handle Time"
            value={fmtSeconds(ccStats?.avg_handle_seconds ?? 0)}
            sub={`Avg wait: ${fmtSeconds(ccStats?.avg_wait_seconds ?? 0)}`}
            icon={Clock}
          />
        </div>

        {/* ── Tabs ──────────────────────────────────────────────────────────── */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="identifications">Identifications</TabsTrigger>
            <TabsTrigger value="agents">Agents</TabsTrigger>
            <TabsTrigger value="system">System</TabsTrigger>
          </TabsList>

          {/* ─── OVERVIEW ──────────────────────────────────────────────────── */}
          <TabsContent value="overview" className="space-y-4">

            {/* Row 1: Outcome pie + Volume area chart */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

              {/* Outcome Pie */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Call Outcomes</CardTitle>
                  <CardDescription className="text-xs">{period === 'daily' ? 'Today' : 'This month'}</CardDescription>
                </CardHeader>
                <CardContent>
                  {outcomePie.length > 0 ? (
                    <>
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie
                            data={outcomePie}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={85}
                            dataKey="value"
                            labelLine={false}
                            label={renderPieLabel}
                          >
                            {outcomePie.map((entry) => (
                              <Cell key={entry.key} fill={PIE_COLORS[entry.key as keyof typeof PIE_COLORS] ?? '#94a3b8'} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v: any, name: string) => [v, name]} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center mt-1">
                        {outcomePie.map(e => (
                          <span key={e.key} className="flex items-center gap-1 text-xs">
                            <span className="w-2 h-2 rounded-full inline-block" style={{ background: PIE_COLORS[e.key as keyof typeof PIE_COLORS] }} />
                            {e.name}: <strong>{e.value}</strong>
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="h-[200px] flex items-center justify-center text-gray-400 text-sm">No data</div>
                  )}
                </CardContent>
              </Card>

              {/* Call Volume Area chart */}
              <Card className="md:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Call Volume
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {period === 'daily' ? 'Hourly — today' : 'Daily — this month'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={trimmedTs} margin={{ top: 4, right: 10, bottom: 20, left: 0 }}>
                      <defs>
                        <linearGradient id="callGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 10 }}
                        interval={period === 'daily' ? 3 : 4}
                        angle={-35}
                        textAnchor="end"
                        height={40}
                      />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                      <Tooltip />
                      <Area
                        type="monotone"
                        dataKey="calls"
                        name="Calls"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        fill="url(#callGrad)"
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* Row 2: Approval rate progress + wait/handle bars */}
            {ccStats && ccStats.total_calls > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Decision Breakdown</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span className="flex items-center gap-1"><CheckCircle className="h-3 w-3 text-green-500" /> Approved</span>
                      <span className="font-semibold text-green-600">{ccStats.approved} ({ccStats.approval_rate_pct}%)</span>
                    </div>
                    <Progress value={ccStats.approval_rate_pct} className="h-2" />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span className="flex items-center gap-1"><XCircle className="h-3 w-3 text-red-500" /> Rejected</span>
                      <span className="font-semibold text-red-600">
                        {ccStats.rejected} ({ccStats.total_calls > 0 ? Math.round(ccStats.rejected / ccStats.total_calls * 100) : 0}%)
                      </span>
                    </div>
                    <Progress
                      value={ccStats.total_calls > 0 ? ccStats.rejected / ccStats.total_calls * 100 : 0}
                      className="h-2 [&>div]:bg-red-500"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3 text-yellow-500" /> Pending / In Review</span>
                      <span className="font-semibold text-yellow-600">
                        {ccStats.pending_calls} ({ccStats.total_calls > 0 ? Math.round(ccStats.pending_calls / ccStats.total_calls * 100) : 0}%)
                      </span>
                    </div>
                    <Progress
                      value={ccStats.total_calls > 0 ? ccStats.pending_calls / ccStats.total_calls * 100 : 0}
                      className="h-2 [&>div]:bg-yellow-400"
                    />
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ─── IDENTIFICATIONS ───────────────────────────────────────────── */}
          <TabsContent value="identifications" className="space-y-4">

            {/* Row: Doc type pie + Risk level pie */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FileText className="h-4 w-4" /> Document Types
                  </CardTitle>
                  <CardDescription className="text-xs">All verifications on record</CardDescription>
                </CardHeader>
                <CardContent>
                  {docTypePie.length > 0 ? (
                    <>
                      <ResponsiveContainer width="100%" height={210}>
                        <PieChart>
                          <Pie
                            data={docTypePie}
                            cx="50%"
                            cy="50%"
                            outerRadius={85}
                            dataKey="value"
                            labelLine={false}
                            label={renderPieLabel}
                          >
                            {docTypePie.map((_, i) => (
                              <Cell key={i} fill={['#3b82f6','#8b5cf6','#06b6d4','#f59e0b'][i % 4]} />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center mt-1">
                        {docTypePie.map((e, i) => (
                          <span key={i} className="flex items-center gap-1 text-xs">
                            <span className="w-2 h-2 rounded-full inline-block" style={{ background: ['#3b82f6','#8b5cf6','#06b6d4','#f59e0b'][i % 4] }} />
                            {e.name}: <strong>{e.value}</strong>
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="h-[210px] flex items-center justify-center text-gray-400 text-sm">No data</div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Shield className="h-4 w-4" /> Risk Level Distribution
                  </CardTitle>
                  <CardDescription className="text-xs">Based on AI fraud analysis</CardDescription>
                </CardHeader>
                <CardContent>
                  {riskPie.length > 0 ? (
                    <>
                      <ResponsiveContainer width="100%" height={210}>
                        <PieChart>
                          <Pie
                            data={riskPie}
                            cx="50%"
                            cy="50%"
                            innerRadius={55}
                            outerRadius={85}
                            dataKey="value"
                            labelLine={false}
                            label={renderPieLabel}
                          >
                            {riskPie.map((e, i) => (
                              <Cell key={i} fill={e.color} />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center mt-1">
                        {riskPie.map((e, i) => (
                          <span key={i} className="flex items-center gap-1 text-xs">
                            <span className="w-2 h-2 rounded-full inline-block" style={{ background: e.color }} />
                            {e.name}: <strong>{e.value}</strong>
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="h-[210px] flex items-center justify-center text-gray-400 text-sm">No data</div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Fraud Score Histogram */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" /> Fraud Score Distribution
                </CardTitle>
                <CardDescription className="text-xs">
                  How verifications spread across score buckets (0 = high risk, 100 = clean)
                </CardDescription>
              </CardHeader>
              <CardContent>
                {verifications.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={scoreBuckets} margin={{ top: 4, right: 10, bottom: 20, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={40} />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                      <Tooltip
                        formatter={(v: any) => [v, 'Verifications']}
                        labelFormatter={(l: string) => `Score ${l}`}
                      />
                      <Bar dataKey="count" name="Verifications" radius={[3, 3, 0, 0]}>
                        {scoreBuckets.map((b, i) => (
                          <Cell key={i} fill={b.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[220px] flex items-center justify-center text-gray-400 text-sm">No verification data</div>
                )}
                <div className="flex justify-between text-xs text-gray-400 mt-1 px-1">
                  <span className="text-red-500">← High fraud risk</span>
                  <span className="text-green-500">Low fraud risk →</span>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── AGENTS ────────────────────────────────────────────────────── */}
          <TabsContent value="agents" className="space-y-4">

            {/* Agent grouped bar */}
            {agentBarData.length > 0 ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <UserCheck className="h-4 w-4" /> Agent Performance — Approved vs Rejected
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={agentBarData} margin={{ top: 4, right: 10, bottom: 20, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="approved" name="Approved" fill={AGENT_COLORS.approved} radius={[3, 3, 0, 0]} />
                      <Bar dataKey="rejected" name="Rejected" fill={AGENT_COLORS.rejected} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-16 text-center text-gray-400">
                  <Bot className="h-12 w-12 mx-auto mb-2 opacity-30" />
                  <p>No agent activity in the selected period.</p>
                </CardContent>
              </Card>
            )}

            {/* Agent cards */}
            {agentStats.map(a => (
              <Card key={a.agent_id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {a.is_ai
                        ? <Bot className="h-5 w-5 text-purple-600" />
                        : <UserCheck className="h-5 w-5 text-blue-600" />
                      }
                      <div>
                        <CardTitle className="text-sm font-mono">
                          {a.is_ai ? '🤖 AI Agent' : `Agent: ${a.agent_id}`}
                        </CardTitle>
                        <CardDescription className="text-xs">
                          {a.calls_handled} handled · {a.calls_completed} completed
                        </CardDescription>
                      </div>
                    </div>
                    <Badge className={a.approval_rate_pct >= 80 ? 'bg-green-600' : a.approval_rate_pct >= 50 ? 'bg-yellow-600' : 'bg-red-600'}>
                      {a.approval_rate_pct}% approval
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 gap-3 text-sm mb-3">
                    <div>
                      <span className="text-gray-400 text-xs">Approved</span>
                      <p className="font-semibold text-green-600">{a.approved}</p>
                    </div>
                    <div>
                      <span className="text-gray-400 text-xs">Rejected</span>
                      <p className="font-semibold text-red-600">{a.rejected}</p>
                    </div>
                    <div>
                      <span className="text-gray-400 text-xs">Avg Handle</span>
                      <p className="font-semibold">{fmtSeconds(a.avg_handle_seconds)}</p>
                    </div>
                    <div>
                      <span className="text-gray-400 text-xs">Avg Wait</span>
                      <p className="font-semibold">{fmtSeconds(a.avg_wait_seconds)}</p>
                    </div>
                  </div>
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>Approval rate</span>
                    <span>{a.approval_rate_pct}%</span>
                  </div>
                  <Progress value={a.approval_rate_pct} className="h-1.5" />
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          {/* ─── SYSTEM ────────────────────────────────────────────────────── */}
          <TabsContent value="system" className="space-y-4">
            <SystemTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

// ── SystemTab (lazy-loaded on demand) ─────────────────────────────────────────

function SystemTab() {
  const { toast } = useToast();
  const [data, setData] = useState<{
    endpoints: any[];
    slowQueries: any[];
    summary: any;
  }>({ endpoints: [], slowQueries: [], summary: null });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [ep, sq, sum] = await Promise.all([
          apiClient.get('/api/v1/performance/endpoints?hours=24').catch(() => ({ data: [] })),
          apiClient.get('/api/v1/performance/slow-queries?hours=24&limit=10').catch(() => ({ data: [] })),
          apiClient.get('/api/v1/performance/dashboard/summary').catch(() => ({ data: null })),
        ]);
        setData({ endpoints: (ep as any).data, slowQueries: (sq as any).data, summary: (sum as any).data });
      } catch { /**/ }
      setLoaded(true);
    })();
  }, []);

  if (!loaded) return (
    <div className="flex items-center justify-center py-16 text-gray-400">
      <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Loading system data…
    </div>
  );

  return (
    <div className="space-y-4">
      {data.summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-xs text-gray-500">Requests (24h)</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold">{data.summary.total_requests_24h?.toLocaleString()}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-xs text-gray-500">Avg Response</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold">{data.summary.avg_response_time_ms?.toFixed(0)}ms</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-xs text-gray-500">Error Rate</CardTitle></CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${data.summary.error_rate_percent > 5 ? 'text-red-600' : 'text-green-600'}`}>
                {data.summary.error_rate_percent?.toFixed(2)}%
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-xs text-gray-500">Slow Queries</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold">{data.summary.slow_queries_count}</div></CardContent>
          </Card>
        </div>
      )}

      {data.endpoints.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Zap className="h-4 w-4" /> API Endpoints</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.endpoints.slice(0, 10).map((e: any, i: number) => (
              <div key={i} className="flex items-center justify-between text-sm border-b last:border-0 pb-2 last:pb-0">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge className={e.method === 'GET' ? 'bg-green-500' : e.method === 'POST' ? 'bg-blue-500' : 'bg-orange-500'}>
                    {e.method}
                  </Badge>
                  <span className="font-mono text-xs truncate">{e.endpoint}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500 flex-shrink-0">
                  <span>{e.request_count}x</span>
                  <span>{e.avg_response_time_ms?.toFixed(0)}ms</span>
                  <span className={e.error_rate > 5 ? 'text-red-600' : 'text-green-600'}>{e.error_rate?.toFixed(1)}% err</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {data.slowQueries.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Database className="h-4 w-4" /> Slow Queries</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.slowQueries.map((q: any, i: number) => (
              <div key={i} className="border rounded p-3 text-xs">
                <div className="font-mono bg-gray-50 p-1.5 rounded mb-2 text-gray-600 overflow-x-auto">{q.query_text}</div>
                <div className="flex gap-4 text-gray-500">
                  <span>Avg: <strong className="text-orange-600">{q.avg_time_ms?.toFixed(0)}ms</strong></span>
                  <span>Max: <strong className="text-red-600">{q.max_time_ms?.toFixed(0)}ms</strong></span>
                  <span>Count: <strong>{q.count}</strong></span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {data.endpoints.length === 0 && data.slowQueries.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Database className="h-12 w-12 mx-auto mb-2 opacity-30" />
          <p>No system performance data available.</p>
        </div>
      )}
    </div>
  );
}
