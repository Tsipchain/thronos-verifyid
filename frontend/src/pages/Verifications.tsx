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
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

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
}

type StatusFilter = 'all' | 'pending' | 'in_review' | 'approved' | 'rejected' | 'completed';

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.FC<{ className?: string }> }> = {
  pending:    { label: 'Pending',     color: 'bg-yellow-100 text-yellow-800',  icon: Clock },
  in_review:  { label: 'In Review',   color: 'bg-blue-100 text-blue-800',      icon: FileCheck },
  approved:   { label: 'Agent Approved', color: 'bg-green-100 text-green-800', icon: CheckCircle },
  rejected:   { label: 'Rejected',    color: 'bg-red-100 text-red-800',        icon: XCircle },
  completed:  { label: 'Sealed ✓',    color: 'bg-purple-100 text-purple-800',  icon: Lock },
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

export default function Verifications() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [sealing, setSealing] = useState<number | null>(null);

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

  useEffect(() => {
    checkPermissions();
  }, [checkPermissions]);

  useEffect(() => {
    fetchVerifications();
  }, [fetchVerifications]);

  const handleSeal = async (id: number, decision: 'completed' | 'rejected') => {
    setSealing(id);
    try {
      await apiClient.post(`/api/v1/verifications/${id}/manager-finalize`, { decision });
      toast({
        title: decision === 'completed' ? 'Verification sealed ✓' : 'Verification rejected',
        description:
          decision === 'completed'
            ? 'The identity has been definitively approved and sealed by manager.'
            : 'The verification has been rejected by manager.',
      });
      fetchVerifications();
    } catch (err: any) {
      toast({
        title: 'Action failed',
        description: err?.response?.data?.detail || err.message,
        variant: 'destructive',
      });
    } finally {
      setSealing(null);
    }
  };

  const fmtDate = (s: string) => new Date(s).toLocaleString();
  const fmtSeconds = (s: number) => (s < 60 ? `${s}s` : `${Math.round(s / 60)}m`);

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
                {verifications.length} records · Manager review &amp; final seal
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
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filter === f.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
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

        {verifications.map((v) => {
          const cfg = STATUS_CONFIG[v.verification_status] ?? STATUS_CONFIG.pending;
          const Icon = cfg.icon;
          const canSeal = v.verification_status === 'approved' || v.verification_status === 'in_review';

          return (
            <Card key={v.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base font-mono">#{v.id}</CardTitle>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
                        <Icon className="h-3 w-3" />
                        {cfg.label}
                      </span>
                      {v.risk_level && v.risk_level !== 'low' && (
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          v.risk_level === 'high' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {v.risk_level} risk
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500">
                      User: <span className="font-mono">{v.user_id}</span>
                    </p>
                  </div>

                  {/* Manager action buttons */}
                  {canSeal && (
                    <div className="flex gap-2 flex-shrink-0">
                      <Button
                        size="sm"
                        className="bg-purple-600 hover:bg-purple-700 text-white"
                        disabled={sealing === v.id}
                        onClick={() => handleSeal(v.id, 'completed')}
                      >
                        <Lock className="h-3 w-3 mr-1" />
                        {sealing === v.id ? 'Sealing…' : 'Seal (κλείδωμα)'}
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
                    </div>
                  )}
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
                    <p className={`font-medium ${v.fraud_score > 50 ? 'text-red-600' : 'text-green-600'}`}>
                      {v.fraud_score}/100
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500">Submitted</span>
                    <p className="font-medium">{fmtDate(v.created_at)}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Verified at</span>
                    <p className="font-medium">{v.verified_at ? fmtDate(v.verified_at) : '—'}</p>
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
              </CardContent>
            </Card>
          );
        })}
      </main>
    </div>
  );
}
