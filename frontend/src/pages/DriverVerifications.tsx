/**
 * DriverVerifications — admin / manager / call-agent oversight page.
 *
 * Shows all VerifyID program verifications with:
 *  - Sub-verification step details & miner signatures
 *  - Sign-step action (manager/admin can sign each step)
 *  - Manager finalize (seal / reject) with full blockchain proof
 *  - Call-agent view for drone program oversight
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/lib/api';
import { rbac } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft,
  Car,
  Plane,
  Shield,
  Lock,
  CheckCircle,
  XCircle,
  Clock,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Cpu,
  Link,
  Filter,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────

interface SubVerification {
  step_key: string;
  label: string;
  status: 'pending' | 'signed' | 'failed';
  miner_id: string | null;
  miner_address: string | null;
  miner_signature: string | null;
  chain_tx: string | null;
  signed_at: string | null;
  notes: string | null;
}

interface DriverVerification {
  id: number;
  user_id: string;
  program_type: string;
  status: string;
  driver_name: string | null;
  license_number: string | null;
  vehicle_type: string | null;
  school_or_operator: string | null;
  document_verification_id: number | null;
  sub_verifications: SubVerification[];
  final_chain_hash: string | null;
  chain_proof: Record<string, unknown> | null;
  created_at: string;
  finalized_at: string | null;
  finalized_by: string | null;
  manager_notes: string | null;
}

// ── Config ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.FC<{ className?: string }> }> = {
  pending:          { label: 'Pending',           color: 'bg-yellow-100 text-yellow-800', icon: Clock },
  in_progress:      { label: 'In Progress',       color: 'bg-blue-100 text-blue-800',    icon: Clock },
  awaiting_manager: { label: 'Awaiting Approval', color: 'bg-purple-100 text-purple-800',icon: Clock },
  completed:        { label: 'Completed ✓',       color: 'bg-green-100 text-green-800',  icon: CheckCircle },
  rejected:         { label: 'Rejected',          color: 'bg-red-100 text-red-800',      icon: XCircle },
};

const PROGRAM_FILTERS = [
  { value: '', label: 'All Programs' },
  { value: 'taxi_school', label: 'Taxi School' },
  { value: 'drone_program', label: 'Drone Program' },
];

const STATUS_FILTERS = [
  { value: '', label: 'All Statuses' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'awaiting_manager', label: 'Awaiting Approval' },
  { value: 'completed', label: 'Completed' },
  { value: 'rejected', label: 'Rejected' },
];

// ── Helpers ───────────────────────────────────────────────────────────────

const fmtTs = (ts?: string | null) => (ts ? new Date(ts).toLocaleString() : '—');
const truncSig = (sig: string) =>
  sig.length > 22 ? `${sig.slice(0, 10)}…${sig.slice(-10)}` : sig;

// ── Step progress inline ──────────────────────────────────────────────────

function StepRow({
  step,
  dvId,
  canSign,
  onSigned,
}: {
  step: SubVerification;
  dvId: number;
  canSign: boolean;
  onSigned: () => void;
}) {
  const { toast } = useToast();
  const [signing, setSigning] = useState(false);
  const isSigned = step.status === 'signed';

  const handleSign = async () => {
    setSigning(true);
    try {
      await apiClient.post(`/api/v1/driver/${dvId}/sign-step`, { step_key: step.step_key });
      toast({ title: `Step "${step.label}" signed`, description: 'Miner signature recorded on-chain.' });
      onSigned();
    } catch (err: any) {
      toast({
        title: 'Sign failed',
        description: err?.response?.data?.detail || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSigning(false);
    }
  };

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border text-sm ${
        isSigned
          ? 'border-green-200 bg-green-50'
          : 'border-gray-200 bg-white'
      }`}
    >
      <div
        className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs ${
          isSigned ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-600'
        }`}
      >
        {isSigned ? <CheckCircle2 className="h-3.5 w-3.5" /> : '·'}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{step.label}</span>
          <Badge className={`text-xs ${isSigned ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            {step.status}
          </Badge>
        </div>
        {isSigned && step.miner_signature && (
          <div className="mt-1 space-y-0.5">
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <Cpu className="h-3 w-3" />
              <span className="font-mono">{step.miner_id}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-green-700 font-mono">
              <Lock className="h-3 w-3" />
              {truncSig(step.miner_signature)}
            </div>
            {step.chain_tx && (
              <div className="flex items-center gap-1 text-xs text-blue-600 font-mono">
                <Link className="h-3 w-3" />
                {step.chain_tx}
              </div>
            )}
            <p className="text-xs text-gray-400">Signed: {fmtTs(step.signed_at)}</p>
          </div>
        )}
      </div>

      {!isSigned && canSign && (
        <Button
          size="sm"
          className="flex-shrink-0"
          disabled={signing}
          onClick={handleSign}
        >
          {signing ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3 mr-1" />}
          {signing ? '' : 'Sign'}
        </Button>
      )}
    </div>
  );
}

// ── Chain proof display ───────────────────────────────────────────────────

function ChainProofPanel({ ver }: { ver: DriverVerification }) {
  if (!ver.final_chain_hash) return null;
  const proof = ver.chain_proof as any;
  return (
    <div className="mt-4 border border-blue-200 rounded-xl bg-blue-50 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Shield className="h-4 w-4 text-blue-600" />
        <span className="font-semibold text-sm text-blue-900">On-Chain Proof Bundle</span>
        <Badge className="bg-blue-600 text-white text-xs ml-auto">Thronos</Badge>
      </div>
      <div className="space-y-1 text-xs font-mono">
        <div>
          <span className="text-gray-500">Final TX:</span>{' '}
          <span className="text-blue-800 break-all">{ver.final_chain_hash}</span>
        </div>
        {proof?.merkle_root && (
          <div>
            <span className="text-gray-500">Merkle Root:</span>{' '}
            <span className="text-blue-800 break-all">{proof.merkle_root}</span>
          </div>
        )}
        {proof?.finalized_at && (
          <div>
            <span className="text-gray-500">Finalized:</span>{' '}
            <span className="text-blue-800">{fmtTs(proof.finalized_at)}</span>
          </div>
        )}
      </div>
      {proof?.step_hashes && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-gray-600 mb-1">Sub-verification hashes (all on-chain):</p>
          <div className="space-y-1">
            {(proof.step_hashes as string[]).map((h: string, i: number) => (
              <div key={i} className="flex items-center gap-2 text-xs font-mono">
                <CheckCircle2 className="h-3 w-3 text-green-600 flex-shrink-0" />
                <span className="text-gray-600 break-all">{h}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="mt-3 text-xs text-blue-700 bg-blue-100 rounded p-2">
        {proof?.proof || 'All sub-verifications signed by Thronos miners and approved by manager.'}
      </div>
    </div>
  );
}

// ── Driver verification card ──────────────────────────────────────────────

function DriverVerCard({
  ver,
  canSign,
  onRefresh,
}: {
  ver: DriverVerification;
  canSign: boolean;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [sealing, setSealing] = useState(false);

  const cfg = STATUS_CONFIG[ver.status] ?? STATUS_CONFIG.pending;
  const StatusIcon = cfg.icon;
  const ProgramIcon = ver.program_type === 'drone_program' ? Plane : Car;
  const signedCount = ver.sub_verifications.filter(s => s.status === 'signed').length;
  const totalCount = ver.sub_verifications.length;
  const canFinalize = ['in_progress', 'awaiting_manager'].includes(ver.status) && canSign;

  const handleFinalize = async (decision: 'completed' | 'rejected') => {
    setSealing(true);
    try {
      await apiClient.post(`/api/v1/driver/${ver.id}/finalize`, { decision });
      toast({
        title: decision === 'completed' ? 'Verification sealed ✓' : 'Verification rejected',
        description:
          decision === 'completed'
            ? 'Full chain proof committed to Thronos blockchain.'
            : 'Driver verification has been rejected.',
      });
      onRefresh();
    } catch (err: any) {
      toast({
        title: 'Action failed',
        description: err?.response?.data?.detail || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSealing(false);
    }
  };

  const allSigned = signedCount === totalCount && totalCount > 0;

  return (
    <Card className={`hover:shadow-md transition-shadow ${ver.status === 'awaiting_manager' ? 'border-purple-300' : ''}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className={`p-2 rounded-lg flex-shrink-0 ${ver.program_type === 'drone_program' ? 'bg-indigo-100' : 'bg-blue-100'}`}>
              <ProgramIcon className={`h-5 w-5 ${ver.program_type === 'drone_program' ? 'text-indigo-600' : 'text-blue-600'}`} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-base font-mono">#{ver.id}</CardTitle>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
                  <StatusIcon className="h-3 w-3" />
                  {cfg.label}
                </span>
                {ver.status === 'awaiting_manager' && (
                  <Badge className="bg-purple-100 text-purple-700 text-xs">
                    Action Required
                  </Badge>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-0.5">
                {ver.driver_name || 'Unknown driver'} ·{' '}
                {ver.program_type === 'drone_program' ? 'Drone Program' : 'Taxi School'}
                {ver.school_or_operator ? ` · ${ver.school_or_operator}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {canFinalize && (
              <>
                <Button
                  size="sm"
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                  disabled={sealing}
                  onClick={() => handleFinalize('completed')}
                >
                  <Lock className="h-3 w-3 mr-1" />
                  {sealing ? 'Sealing…' : 'Seal & Commit'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-red-300 text-red-600 hover:bg-red-50"
                  disabled={sealing}
                  onClick={() => handleFinalize('rejected')}
                >
                  <XCircle className="h-3 w-3 mr-1" />
                  Reject
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={() => setExpanded(e => !e)}>
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {/* Quick stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
          <div>
            <span className="text-gray-500 text-xs">Chain Steps</span>
            <p className="font-medium">
              <span className={allSigned ? 'text-green-600' : 'text-blue-600'}>
                {signedCount}/{totalCount}
              </span>
              {allSigned && <CheckCircle2 className="inline h-4 w-4 text-green-600 ml-1" />}
            </p>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Licence</span>
            <p className="font-medium font-mono">{ver.license_number || '—'}</p>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Submitted</span>
            <p className="font-medium">{fmtTs(ver.created_at)}</p>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Finalized</span>
            <p className="font-medium">{ver.finalized_at ? fmtTs(ver.finalized_at) : '—'}</p>
          </div>
        </div>

        {/* Step progress bar */}
        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mb-3">
          <div
            className={`h-full transition-all duration-500 ${allSigned ? 'bg-green-500' : 'bg-blue-500'}`}
            style={{ width: `${totalCount > 0 ? (signedCount / totalCount) * 100 : 0}%` }}
          />
        </div>

        {/* Hint to expand */}
        {!expanded && (
          <button
            className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1"
            onClick={() => setExpanded(true)}
          >
            <ChevronDown className="h-3 w-3" />
            {totalCount} sub-verification steps — click to sign or view
          </button>
        )}

        {/* Expanded: steps + proof */}
        {expanded && (
          <div className="mt-2 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Sub-Verification Chain
            </p>
            {ver.sub_verifications.map(step => (
              <StepRow
                key={step.step_key}
                step={step}
                dvId={ver.id}
                canSign={canSign && ['in_progress', 'awaiting_manager'].includes(ver.status)}
                onSigned={onRefresh}
              />
            ))}

            {/* Chain proof (when completed) */}
            <ChainProofPanel ver={ver} />

            {/* All-signed info when awaiting manager */}
            {ver.status === 'awaiting_manager' && (
              <div className="flex items-start gap-2 p-3 bg-purple-50 border border-purple-200 rounded-lg text-sm">
                <AlertTriangle className="h-4 w-4 text-purple-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-purple-900">
                    All {totalCount} steps signed by Thronos miners — awaiting final approval
                  </p>
                  <p className="text-xs text-purple-600 mt-0.5">
                    Click "Seal &amp; Commit" to generate the full proof bundle and commit it to the blockchain.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Blockchain tx (completed) */}
        {ver.final_chain_hash && !expanded && (
          <div className="mt-2 flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded p-2">
            <Shield className="h-3 w-3 text-blue-500 flex-shrink-0" />
            <span className="font-mono break-all">{ver.final_chain_hash}</span>
            <Badge variant="secondary" className="text-xs flex-shrink-0">Thronos</Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function DriverVerifications() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [verifications, setVerifications] = useState<DriverVerification[]>([]);
  const [loading, setLoading] = useState(true);
  const [canSign, setCanSign] = useState(false);
  const [programFilter, setProgramFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const checkAccess = useCallback(async () => {
    await rbac.initialize();
    if (!rbac.canAccessVerifications()) {
      toast({
        title: 'Access Denied',
        description: 'Manager or admin role required.',
        variant: 'destructive',
      });
      navigate('/admin');
      return;
    }
    // Managers and admins can sign steps
    setCanSign(rbac.canManageChat() || rbac.isAdmin());
  }, [navigate, toast]);

  const fetchVerifications = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (programFilter) params.append('program_type', programFilter);
      if (statusFilter) params.append('status', statusFilter);
      const qs = params.toString() ? `?${params}` : '';
      const res = await apiClient.get<DriverVerification[]>(`/api/v1/driver/list${qs}`);
      setVerifications(res.data);
    } catch (err: any) {
      toast({
        title: 'Failed to load',
        description: err?.response?.data?.detail || err.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [programFilter, statusFilter, toast]);

  useEffect(() => { checkAccess(); }, [checkAccess]);
  useEffect(() => { fetchVerifications(); }, [fetchVerifications]);

  // Derived stats
  const awaitingApproval = verifications.filter(v => v.status === 'awaiting_manager').length;
  const droneCount = verifications.filter(v => v.program_type === 'drone_program').length;
  const taxiCount = verifications.filter(v => v.program_type === 'taxi_school').length;
  const completedCount = verifications.filter(v => v.status === 'completed').length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/admin')}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back
            </Button>
            <Shield className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-xl font-bold">VerifyID Driver Verifications</h1>
              <p className="text-sm text-gray-500">
                {verifications.length} total
                {taxiCount > 0 && (
                  <span className="ml-2 text-blue-600 font-medium">
                    · {taxiCount} taxi school
                  </span>
                )}
                {droneCount > 0 && (
                  <span className="ml-2 text-indigo-600 font-medium">
                    · {droneCount} drone program
                  </span>
                )}
                {awaitingApproval > 0 && (
                  <span className="ml-2 text-purple-600 font-medium">
                    · {awaitingApproval} awaiting approval
                  </span>
                )}
                {completedCount > 0 && (
                  <span className="ml-2 text-green-600 font-medium">
                    · {completedCount} completed
                  </span>
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
        <div className="max-w-7xl mx-auto flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-400" />
            <span className="text-xs text-gray-500 font-medium">Program:</span>
            {PROGRAM_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setProgramFilter(f.value)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  programFilter === f.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 font-medium">Status:</span>
            {STATUS_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  statusFilter === f.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-3">
        {loading && (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <RefreshCw className="h-6 w-6 animate-spin mr-2" />
            Loading…
          </div>
        )}

        {!loading && verifications.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <Shield className="h-12 w-12 mx-auto mb-3 opacity-40" />
            <p>No driver verifications found for the selected filters.</p>
          </div>
        )}

        {verifications.map(ver => (
          <DriverVerCard
            key={ver.id}
            ver={ver}
            canSign={canSign}
            onRefresh={fetchVerifications}
          />
        ))}
      </main>
    </div>
  );
}
