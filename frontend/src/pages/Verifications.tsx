import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { rbac } from '@/lib/rbac';
import { apiClient } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  FileCheck,
  Clock,
  CheckCircle,
  XCircle,
  Lock,
  Shield,
  RefreshCw,
  Filter,
  Bot,
  User,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Zap,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// ── Types ──────────────────────────────────────────────────────────────────

interface ReviewEvent {
  source: 'ai_fraud_check' | 'human_agent' | 'ai_agent_fallback';
  fraud_score?: number;
  risk_level?: string;
  flags?: string[];
  explanation?: string;
  agent_id?: string;
  outcome?: string;
  notes?: string;
  reason?: string;
  checked_at?: string;
  completed_at?: string;
  triggered_at?: string;
}

interface Verification {
  id: number;
  user_id: string;
  document_type: string;
  verification_status: string;
  fraud_score: number;
  risk_level: string | null;
  created_at: string;
  verified_at: string | null;
  blockchain_tx_hash: string | null;
  review_history: ReviewEvent[];
}

type StatusFilter = 'all' | 'pending' | 'in_review' | 'approved' | 'rejected' | 'completed';

// ── Static config ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.FC<{ className?: string }> }> = {
  pending:    { label: 'Pending',        color: 'bg-yellow-100 text-yellow-800',  icon: Clock },
  in_review:  { label: 'In Review',      color: 'bg-blue-100 text-blue-800',      icon: FileCheck },
  approved:   { label: 'Agent Approved', color: 'bg-green-100 text-green-800',    icon: CheckCircle },
  rejected:   { label: 'Rejected',       color: 'bg-red-100 text-red-800',        icon: XCircle },
  completed:  { label: 'Sealed ✓',       color: 'bg-purple-100 text-purple-800',  icon: Lock },
};

const DOC_TYPE_LABEL: Record<string, string> = {
  national_id:      'National ID',
  passport:         'Passport',
  drivers_license:  "Driver's License",
  residence_permit: 'Residence Permit',
};

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all',       label: 'All' },
  { value: 'pending',   label: 'Pending' },
  { value: 'in_review', label: 'In Review' },
  { value: 'approved',  label: 'Agent Approved' },
  { value: 'rejected',  label: 'Rejected' },
  { value: 'completed', label: 'Sealed' },
];

// ── Helpers ────────────────────────────────────────────────────────────────

const fmtTs = (ts?: string | null) => (ts ? new Date(ts).toLocaleString() : '—');

function ScorePill({ score }: { score: number }) {
  const cls =
    score >= 70 ? 'text-green-600' : score >= 30 ? 'text-yellow-600' : 'text-red-600';
  return <span className={`font-semibold ${cls}`}>{score}/100</span>;
}

function SourceBadge({ src }: { src: ReviewEvent['source'] }) {
  if (src === 'ai_fraud_check')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
        <Bot className="h-3 w-3" /> AI Fraud Check
      </span>
    );
  if (src === 'human_agent')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
        <User className="h-3 w-3" /> Human Agent
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
      <Zap className="h-3 w-3" /> AI Fallback (15 min)
    </span>
  );
}

// ── ReviewTimeline ─────────────────────────────────────────────────────────

function ReviewTimeline({
  history,
  managerDecision,
}: {
  history: ReviewEvent[];
  managerDecision?: { status: string; verifiedAt: string | null };
}) {
  if (history.length === 0 && !managerDecision) return null;
  const total = history.length + (managerDecision ? 1 : 0);

  return (
    <div className="mt-4 border-t pt-4 space-y-3">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Review Timeline</p>

      {history.map((ev, i) => {
        const ts = ev.checked_at ?? ev.completed_at ?? ev.triggered_at;
        const isLast = i === history.length - 1 && !managerDecision;
        return (
          <div key={i} className="flex gap-3 items-start">
            <div className="flex flex-col items-center">
              <div className="w-2 h-2 rounded-full bg-gray-400 mt-1 flex-shrink-0" />
              {!isLast && (
                <div className="w-px flex-1 bg-gray-200 my-1" style={{ minHeight: '16px' }} />
              )}
            </div>
            <div className="flex-1 pb-1">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <SourceBadge src={ev.source} />
                {ev.outcome && (
                  <span className={`text-xs font-medium ${ev.outcome === 'approved' ? 'text-green-600' : 'text-red-600'}`}>
                    → {ev.outcome.toUpperCase()}
                  </span>
                )}
                {ev.fraud_score != null && (
                  <span className="text-xs text-gray-500">
                    Score: <ScorePill score={ev.fraud_score} />
                  </span>
                )}
                {ev.risk_level && (
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    ev.risk_level === 'high'
                      ? 'bg-red-100 text-red-700'
                      : ev.risk_level === 'medium'
                      ? 'bg-yellow-100 text-yellow-700'
                      : 'bg-green-100 text-green-700'
                  }`}>
                    {ev.risk_level} risk
                  </span>
                )}
                <span className="text-xs text-gray-400 ml-auto">{fmtTs(ts)}</span>
              </div>

              {ev.flags && ev.flags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {ev.flags.map((f, fi) => (
                    <span key={fi} className="text-xs bg-red-50 text-red-600 border border-red-200 rounded px-1.5 py-0.5">
                      ⚑ {f}
                    </span>
                  ))}
                </div>
              )}
              {ev.explanation && (
                <p className="text-xs text-gray-500 mt-1 italic">{ev.explanation}</p>
              )}
              {ev.notes && <p className="text-xs text-gray-500 mt-1">Note: {ev.notes}</p>}
              {ev.reason && (
                <p className="text-xs text-orange-600 mt-1 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> {ev.reason}
                </p>
              )}
              {ev.agent_id && (
                <p className="text-xs text-gray-400 mt-0.5 font-mono">
                  Agent: {ev.agent_id.slice(0, 16)}…
                </p>
              )}
            </div>
          </div>
        );
      })}

      {managerDecision && (
        <div className="flex gap-3 items-start">
          <div className="flex flex-col items-center">
            <div
              className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${
                managerDecision.status === 'completed'
                  ? 'bg-purple-500'
                  : managerDecision.status === 'rejected'
                  ? 'bg-red-500'
                  : 'bg-gray-400'
              }`}
            />
          </div>
          <div className="flex-1 pb-1">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                <Lock className="h-3 w-3" /> Manager Decision
              </span>
              <span
                className={`text-xs font-medium ${
                  managerDecision.status === 'completed' ? 'text-purple-600' : 'text-red-600'
                }`}
              >
                → {managerDecision.status === 'completed' ? 'SEALED ✓' : managerDecision.status.toUpperCase()}
              </span>
              <span className="text-xs text-gray-400 ml-auto">{fmtTs(managerDecision.verifiedAt)}</span>
            </div>
          </div>
        </div>
      )}

      {total === 0 && <p className="text-xs text-gray-400 italic">No review events recorded yet.</p>}
    </div>
  );
}

// ── ComparisonPanel ────────────────────────────────────────────────────────

function ComparisonPanel({ history }: { history: ReviewEvent[] }) {
  const fraudCheck = history.find(e => e.source === 'ai_fraud_check');
  const humanAgent = history.find(e => e.source === 'human_agent');
  const aiFallback = history.find(e => e.source === 'ai_agent_fallback');
  const second = humanAgent ?? aiFallback;

  if (!fraudCheck || !second) return null;

  const aiScore = fraudCheck.fraud_score ?? 0;
  const aiSaidPass = aiScore >= 30;
  const humanOutcome = humanAgent?.outcome;
  const humanSaidPass = humanOutcome === 'approved';
  const agreement =
    humanOutcome != null
      ? aiSaidPass === humanSaidPass
        ? 'agree'
        : 'disagree'
      : 'pending';

  return (
    <div className="mt-3 bg-gray-50 rounded-lg p-3 border">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        AI vs {humanAgent ? 'Human Agent' : 'AI Fallback'} — Comparison
      </p>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Initial AI Fraud Check</p>
          <p className={`font-semibold ${aiSaidPass ? 'text-green-600' : 'text-red-600'}`}>
            <ScorePill score={aiScore} /> · {aiSaidPass ? 'Pass' : 'Fail'}
          </p>
          <p className="text-xs text-gray-400">{fraudCheck.risk_level} risk</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-0.5">
            {humanAgent ? 'Human Agent Decision' : 'AI Fallback Review'}
          </p>
          {humanOutcome ? (
            <p className={`font-semibold ${humanSaidPass ? 'text-green-600' : 'text-red-600'}`}>
              {humanSaidPass ? '✓ Approved' : '✗ Rejected'}
            </p>
          ) : second.fraud_score != null ? (
            <p className="font-semibold text-gray-600">
              <ScorePill score={second.fraud_score} />
            </p>
          ) : (
            <p className="text-xs text-gray-400">Pending manager decision</p>
          )}
          {second.risk_level && (
            <p className="text-xs text-gray-400">{second.risk_level} risk</p>
          )}
        </div>
      </div>
      {agreement !== 'pending' && (
        <div
          className={`mt-2 text-xs px-2 py-1 rounded flex items-center gap-1 ${
            agreement === 'agree' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
          }`}
        >
          {agreement === 'agree' ? (
            <CheckCircle className="h-3 w-3" />
          ) : (
            <AlertTriangle className="h-3 w-3" />
          )}
          {agreement === 'agree'
            ? 'AI and agent were in agreement'
            : 'AI and agent reached different conclusions — manager review recommended'}
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function Verifications() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [sealing, setSealing] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const checkPermissions = useCallback(async () => {
    await rbac.initialize();
    if (!rbac.canAccessVerifications()) {
      toast({ title: 'Access Denied', description: 'Manager or admin role required.', variant: 'destructive' });
      navigate('/admin');
    }
  }, [navigate, toast]);

  const fetchVerifications = useCallback(async () => {
    setLoading(true);
    try {
      const params = filter !== 'all' ? `?status=${filter}` : '';
      const response = await apiClient.get<Verification[]>(`/api/v1/verifications/list${params}`);
      setVerifications(response.data);
    } catch (err: any) {
      toast({
        title: 'Failed to load verifications',
        description: err?.response?.data?.detail || err.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [filter, toast]);

  useEffect(() => { checkPermissions(); }, [checkPermissions]);
  useEffect(() => { fetchVerifications(); }, [fetchVerifications]);

  const handleSeal = async (id: number, decision: 'completed' | 'rejected') => {
    setSealing(id);
    try {
      await apiClient.post(`/api/v1/verifications/${id}/manager-finalize`, { decision });
      toast({
        title: decision === 'completed' ? 'Verification sealed ✓' : 'Verification rejected',
        description:
          decision === 'completed'
            ? 'The identity has been definitively approved and sealed.'
            : 'The verification has been rejected.',
      });
      fetchVerifications();
    } catch (err: any) {
      toast({ title: 'Action failed', description: err?.response?.data?.detail || err.message, variant: 'destructive' });
    } finally {
      setSealing(null);
    }
  };

  const toggleExpand = (id: number) =>
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Aggregate stats for header
  const aiReviewed = verifications.filter(v => v.review_history.some(e => e.source === 'ai_agent_fallback')).length;
  const humanReviewed = verifications.filter(v => v.review_history.some(e => e.source === 'human_agent')).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/admin')}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <FileCheck className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-xl font-bold">Identity Verifications</h1>
              <p className="text-sm text-gray-500">
                {verifications.length} records
                {humanReviewed > 0 && (
                  <span className="ml-2 text-green-600 font-medium">· {humanReviewed} human-reviewed</span>
                )}
                {aiReviewed > 0 && (
                  <span className="ml-2 text-orange-600 font-medium">· {aiReviewed} AI fallback</span>
                )}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={fetchVerifications} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </header>

      {/* Filter bar */}
      <div className="bg-white border-b px-6 py-2">
        <div className="max-w-7xl mx-auto flex items-center gap-2 flex-wrap">
          <Filter className="h-4 w-4 text-gray-400 mr-1" />
          {FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filter === f.value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-3">
        {loading && (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <RefreshCw className="h-6 w-6 animate-spin mr-2" />
            Loading…
          </div>
        )}

        {!loading && verifications.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <FileCheck className="h-12 w-12 mx-auto mb-3 opacity-40" />
            <p>No verifications found for the selected filter.</p>
          </div>
        )}

        {verifications.map(v => {
          const cfg = STATUS_CONFIG[v.verification_status] ?? STATUS_CONFIG.pending;
          const Icon = cfg.icon;
          const canSeal = v.verification_status === 'approved' || v.verification_status === 'in_review';
          const isOpen = expanded.has(v.id);

          const hasAiFallback = v.review_history.some(e => e.source === 'ai_agent_fallback');
          const hasHuman = v.review_history.some(e => e.source === 'human_agent');

          const managerDecision =
            ['completed', 'rejected'].includes(v.verification_status)
              ? { status: v.verification_status, verifiedAt: v.verified_at }
              : undefined;

          return (
            <Card
              key={v.id}
              className={`hover:shadow-md transition-shadow ${hasAiFallback ? 'border-orange-300' : ''}`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-base font-mono">#{v.id}</CardTitle>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
                        <Icon className="h-3 w-3" />
                        {cfg.label}
                      </span>

                      {/* Who reviewed */}
                      {hasAiFallback && (
                        <Badge className="bg-orange-100 text-orange-700 border-orange-300 text-xs gap-1">
                          <Zap className="h-3 w-3" /> AI Fallback
                        </Badge>
                      )}
                      {hasHuman && (
                        <Badge className="bg-green-100 text-green-700 border-green-300 text-xs gap-1">
                          <User className="h-3 w-3" /> Human Agent
                        </Badge>
                      )}
                      {!hasHuman && !hasAiFallback && v.review_history.length > 0 && (
                        <Badge className="bg-blue-100 text-blue-700 border-blue-300 text-xs gap-1">
                          <Bot className="h-3 w-3" /> AI Check Only
                        </Badge>
                      )}

                      {v.risk_level && v.risk_level !== 'low' && (
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                            v.risk_level === 'high' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                          }`}
                        >
                          {v.risk_level} risk
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500">
                      User: <span className="font-mono">{v.user_id}</span>
                    </p>
                  </div>

                  <div className="flex gap-2 flex-shrink-0 items-start">
                    {canSeal && (
                      <>
                        <Button
                          size="sm"
                          className="bg-purple-600 hover:bg-purple-700 text-white"
                          disabled={sealing === v.id}
                          onClick={() => handleSeal(v.id, 'completed')}
                        >
                          <Lock className="h-3 w-3 mr-1" />
                          {sealing === v.id ? 'Sealing…' : 'Seal'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-red-300 text-red-600 hover:bg-red-50"
                          disabled={sealing === v.id}
                          onClick={() => handleSeal(v.id, 'rejected')}
                        >
                          <XCircle className="h-3 w-3 mr-1" />
                          Reject
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => toggleExpand(v.id)}
                      title={isOpen ? 'Hide details' : 'Show review history'}
                    >
                      {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="pt-0">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <span className="text-gray-500">Document</span>
                    <p className="font-medium">{DOC_TYPE_LABEL[v.document_type] ?? v.document_type}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Fraud score</span>
                    <p className="font-medium">
                      <ScorePill score={v.fraud_score} />
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500">Submitted</span>
                    <p className="font-medium">{fmtTs(v.created_at)}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Verified at</span>
                    <p className="font-medium">{v.verified_at ? fmtTs(v.verified_at) : '—'}</p>
                  </div>
                </div>

                {/* Blockchain proof */}
                {v.blockchain_tx_hash && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded p-2">
                    <Shield className="h-3 w-3 text-blue-500 flex-shrink-0" />
                    <span className="font-mono break-all">{v.blockchain_tx_hash}</span>
                    <Badge variant="secondary" className="text-xs flex-shrink-0">Thronos</Badge>
                  </div>
                )}

                {/* Expanded: comparison + timeline */}
                {isOpen && (
                  <>
                    <ComparisonPanel history={v.review_history} />
                    <ReviewTimeline history={v.review_history} managerDecision={managerDecision} />
                  </>
                )}

                {/* Hint to expand when collapsed */}
                {!isOpen && v.review_history.length > 0 && (
                  <button
                    className="mt-2 text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1"
                    onClick={() => toggleExpand(v.id)}
                  >
                    <ChevronDown className="h-3 w-3" />
                    {v.review_history.length} review event{v.review_history.length !== 1 ? 's' : ''} — click to view
                  </button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </main>
    </div>
  );
}
