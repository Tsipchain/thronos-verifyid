/**
 * DriverVerification — self-service page for VerifyID drivers
 * ("pirates") to submit and track their program verification.
 *
 * Supports:
 *   - taxi_school : 5 sub-verification steps for taxi driving schools
 *   - drone_program: 5 sub-verification steps for drone operators
 *
 * Each sub-verification step is signed by a Thronos miner.
 * The manager's final approval creates an on-chain proof bundle.
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Car,
  Plane,
  Shield,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
  ChevronRight,
  Lock,
  Link,
  ArrowLeft,
  User,
  FileText,
  Cpu,
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

// ── Step icon map ─────────────────────────────────────────────────────────

const STEP_ICONS: Record<string, React.FC<{ className?: string }>> = {
  identity_check:      Shield,
  license_check:       FileText,
  pilot_license_check: FileText,
  medical_check:       User,
  background_check:    Shield,
  school_enrollment:   CheckCircle2,
  drone_certification: Cpu,
  route_clearance:     Link,
  call_agent_review:   User,
};

// ── Program config ─────────────────────────────────────────────────────────

const PROGRAMS = [
  {
    key: 'taxi_school',
    label: 'Taxi Driving School',
    description: 'Verification for taxi school enrolment and licensing',
    icon: Car,
    color: 'blue',
    vehicleTypes: ['Sedan', 'SUV', 'Minivan', 'Electric'],
  },
  {
    key: 'drone_program',
    label: 'Drone Operator Programme',
    description: 'Certification for commercial drone operations (overseen by call agents)',
    icon: Plane,
    color: 'indigo',
    vehicleTypes: ['Multirotor', 'Fixed-wing', 'Hybrid VTOL', 'Helicopter'],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending:           { label: 'Pending',          color: 'bg-yellow-100 text-yellow-800' },
  in_progress:       { label: 'In Progress',      color: 'bg-blue-100 text-blue-800' },
  awaiting_manager:  { label: 'Awaiting Approval',color: 'bg-purple-100 text-purple-800' },
  completed:         { label: 'Completed ✓',      color: 'bg-green-100 text-green-800' },
  rejected:          { label: 'Rejected',         color: 'bg-red-100 text-red-800' },
};

function fmtTs(ts?: string | null) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}

function truncSig(sig: string) {
  return sig.length > 20 ? `${sig.slice(0, 10)}…${sig.slice(-8)}` : sig;
}

// ── Sub-step card ──────────────────────────────────────────────────────────

function StepCard({ step, index }: { step: SubVerification; index: number }) {
  const Icon = STEP_ICONS[step.step_key] ?? Shield;
  const isSigned = step.status === 'signed';
  const isFailed = step.status === 'failed';

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border ${
        isSigned
          ? 'border-green-200 bg-green-50'
          : isFailed
          ? 'border-red-200 bg-red-50'
          : 'border-gray-200 bg-white'
      }`}
    >
      {/* Step number / icon */}
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
          isSigned
            ? 'bg-green-600 text-white'
            : isFailed
            ? 'bg-red-600 text-white'
            : 'bg-gray-200 text-gray-600'
        }`}
      >
        {isSigned ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Icon className="h-4 w-4 text-gray-500 flex-shrink-0" />
          <span className="font-medium text-sm">{step.label}</span>
          <Badge
            className={`text-xs ${
              isSigned
                ? 'bg-green-100 text-green-700'
                : isFailed
                ? 'bg-red-100 text-red-700'
                : 'bg-gray-100 text-gray-500'
            }`}
          >
            {step.status}
          </Badge>
        </div>

        {isSigned && step.miner_signature && (
          <div className="mt-2 space-y-1">
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <Cpu className="h-3 w-3" />
              <span className="font-mono">{step.miner_id}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-green-700 bg-green-100 rounded px-2 py-1 font-mono break-all">
              <Lock className="h-3 w-3 flex-shrink-0" />
              {truncSig(step.miner_signature)}
            </div>
            {step.chain_tx && (
              <div className="flex items-center gap-1 text-xs text-blue-600 font-mono">
                <Link className="h-3 w-3 flex-shrink-0" />
                {step.chain_tx}
              </div>
            )}
            <p className="text-xs text-gray-400">Signed: {fmtTs(step.signed_at)}</p>
          </div>
        )}
        {step.status === 'pending' && (
          <p className="mt-1 text-xs text-gray-400">Awaiting miner signature…</p>
        )}
      </div>
    </div>
  );
}

// ── Chain proof panel ──────────────────────────────────────────────────────

function ChainProofPanel({ ver }: { ver: DriverVerification }) {
  if (!ver.final_chain_hash) return null;
  const proof = ver.chain_proof as any;

  return (
    <div className="mt-6 border border-blue-200 rounded-xl bg-blue-50 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Shield className="h-5 w-5 text-blue-600" />
        <h3 className="font-semibold text-blue-900">Blockchain Proof</h3>
        <Badge className="bg-blue-600 text-white text-xs">Thronos Chain</Badge>
      </div>

      <div className="space-y-2 text-xs font-mono">
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
          <p className="text-xs font-semibold text-gray-600 mb-1">Sub-verification hashes:</p>
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

// ── Tracking view ──────────────────────────────────────────────────────────

function TrackingView({ ver }: { ver: DriverVerification }) {
  const program = PROGRAMS.find(p => p.key === ver.program_type);
  const ProgramIcon = program?.icon ?? Shield;
  const cfg = STATUS_CONFIG[ver.status] ?? STATUS_CONFIG.pending;
  const signedCount = ver.sub_verifications.filter(s => s.status === 'signed').length;
  const totalCount = ver.sub_verifications.length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 bg-white rounded-xl border">
        <div className={`p-2 rounded-lg ${program?.color === 'indigo' ? 'bg-indigo-100' : 'bg-blue-100'}`}>
          <ProgramIcon className={`h-6 w-6 ${program?.color === 'indigo' ? 'text-indigo-600' : 'text-blue-600'}`} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold">{program?.label}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>
              {cfg.label}
            </span>
          </div>
          <p className="text-sm text-gray-500">
            {ver.driver_name} · {ver.license_number}
            {ver.school_or_operator ? ` · ${ver.school_or_operator}` : ''}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-gray-900">{signedCount}/{totalCount}</p>
          <p className="text-xs text-gray-500">steps signed</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-green-500 transition-all duration-500"
          style={{ width: `${totalCount > 0 ? (signedCount / totalCount) * 100 : 0}%` }}
        />
      </div>

      {/* Sub-verification steps */}
      <div className="space-y-2">
        <p className="text-sm font-semibold text-gray-700">Sub-Verification Chain</p>
        {ver.sub_verifications.map((step, i) => (
          <StepCard key={step.step_key} step={step} index={i} />
        ))}
      </div>

      {/* Awaiting manager notice */}
      {ver.status === 'awaiting_manager' && (
        <div className="flex items-center gap-3 p-4 bg-purple-50 border border-purple-200 rounded-xl">
          <Clock className="h-5 w-5 text-purple-600 flex-shrink-0" />
          <div>
            <p className="font-medium text-purple-900">All steps signed — awaiting manager approval</p>
            <p className="text-sm text-purple-600">
              A manager will review the complete chain and issue the final approval.
            </p>
          </div>
        </div>
      )}

      {/* Completed */}
      {ver.status === 'completed' && (
        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
          <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
          <div>
            <p className="font-bold text-green-900">Verification Complete</p>
            <p className="text-sm text-green-600">
              Finalized by manager · {fmtTs(ver.finalized_at)}
            </p>
          </div>
        </div>
      )}

      {/* Rejected */}
      {ver.status === 'rejected' && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <div>
            <p className="font-bold text-red-900">Verification Rejected</p>
            {ver.manager_notes && (
              <p className="text-sm text-red-600">{ver.manager_notes}</p>
            )}
          </div>
        </div>
      )}

      {/* Chain proof */}
      <ChainProofPanel ver={ver} />
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function DriverVerification() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const [view, setView] = useState<'select' | 'form' | 'tracking'>('select');
  const [selectedProgram, setSelectedProgram] = useState<string | null>(null);
  const [myVerifications, setMyVerifications] = useState<DriverVerification[]>([]);
  const [activeVer, setActiveVer] = useState<DriverVerification | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);

  const [formData, setFormData] = useState({
    driver_name: '',
    license_number: '',
    vehicle_type: '',
    school_or_operator: '',
    document_verification_id: '',
  });

  const loadMyVerifications = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const res = await apiClient.get<DriverVerification[]>('/api/v1/driver/status');
      setMyVerifications(res.data);

      // If there's an active non-completed one, show tracking
      const active = res.data.find(v =>
        ['in_progress', 'awaiting_manager'].includes(v.status)
      );
      if (active) {
        setActiveVer(active);
        setView('tracking');
      } else if (res.data.length > 0 && view === 'select') {
        setActiveVer(res.data[0]);
        setView('tracking');
      }
    } catch {
      // Not logged in or no verifications yet — stay on select
    } finally {
      setLoadingStatus(false);
    }
  }, [view]);

  useEffect(() => {
    const vid = searchParams.get('vid');
    if (vid) {
      apiClient
        .get<DriverVerification>(`/api/v1/driver/${vid}`)
        .then(r => {
          setActiveVer(r.data);
          setView('tracking');
        })
        .catch(() => {});
    } else {
      loadMyVerifications();
    }
  }, [searchParams]);

  // Poll every 15s when tracking
  useEffect(() => {
    if (view !== 'tracking' || !activeVer) return;
    const id = setInterval(() => {
      apiClient
        .get<DriverVerification>(`/api/v1/driver/${activeVer.id}`)
        .then(r => setActiveVer(r.data))
        .catch(() => {});
    }, 15_000);
    return () => clearInterval(id);
  }, [view, activeVer]);

  const handleSelectProgram = (key: string) => {
    setSelectedProgram(key);
    setView('form');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProgram) return;
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        program_type: selectedProgram,
        driver_name: formData.driver_name,
        license_number: formData.license_number,
        vehicle_type: formData.vehicle_type || undefined,
        school_or_operator: formData.school_or_operator || undefined,
        document_verification_id: formData.document_verification_id
          ? parseInt(formData.document_verification_id)
          : undefined,
      };
      const res = await apiClient.post<DriverVerification>('/api/v1/driver/submit', payload);
      setActiveVer(res.data);
      setView('tracking');
      navigate(`/driver/verify?vid=${res.data.id}`, { replace: true });
      toast({ title: 'Verification submitted!', description: 'Thronos miners will sign each step.' });
    } catch (err: any) {
      toast({
        title: 'Submission failed',
        description: err?.response?.data?.detail || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const program = PROGRAMS.find(p => p.key === selectedProgram);

  // ── Select program ────────────────────────────────────────────────────

  if (view === 'select') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 py-12 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4">
              <Shield className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900">VerifyID</h1>
            <p className="text-gray-500 mt-2">
              Blockchain-secured driver verification · Powered by Thronos
            </p>
          </div>

          {loadingStatus ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : (
            <>
              {/* Past verifications */}
              {myVerifications.length > 0 && (
                <div className="mb-8">
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                    Your Verifications
                  </h2>
                  <div className="space-y-2">
                    {myVerifications.map(ver => {
                      const pg = PROGRAMS.find(p => p.key === ver.program_type);
                      const PgIcon = pg?.icon ?? Shield;
                      const cfg = STATUS_CONFIG[ver.status] ?? STATUS_CONFIG.pending;
                      const signed = ver.sub_verifications.filter(s => s.status === 'signed').length;
                      return (
                        <button
                          key={ver.id}
                          className="w-full flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-xl hover:border-blue-400 transition-colors text-left"
                          onClick={() => { setActiveVer(ver); setView('tracking'); }}
                        >
                          <PgIcon className="h-5 w-5 text-blue-600 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm">{pg?.label}</p>
                            <p className="text-xs text-gray-400">
                              #{ver.id} · {signed}/{ver.sub_verifications.length} steps signed
                            </p>
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${cfg.color}`}>
                            {cfg.label}
                          </span>
                          <ChevronRight className="h-4 w-4 text-gray-300 flex-shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Program selector */}
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Start New Verification
              </h2>
              <div className="grid md:grid-cols-2 gap-4">
                {PROGRAMS.map(pg => {
                  const PgIcon = pg.icon;
                  return (
                    <button
                      key={pg.key}
                      onClick={() => handleSelectProgram(pg.key)}
                      className="p-6 bg-white border-2 border-gray-200 rounded-2xl hover:border-blue-500 hover:shadow-md transition-all text-left group"
                    >
                      <div className={`inline-flex p-3 rounded-xl mb-4 ${pg.color === 'indigo' ? 'bg-indigo-100 group-hover:bg-indigo-200' : 'bg-blue-100 group-hover:bg-blue-200'} transition-colors`}>
                        <PgIcon className={`h-6 w-6 ${pg.color === 'indigo' ? 'text-indigo-600' : 'text-blue-600'}`} />
                      </div>
                      <h3 className="text-lg font-bold text-gray-900 mb-1">{pg.label}</h3>
                      <p className="text-sm text-gray-500 mb-4">{pg.description}</p>
                      <div className="flex items-center gap-1 text-blue-600 text-sm font-medium">
                        Start verification <ChevronRight className="h-4 w-4" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <p className="text-center text-xs text-gray-400 mt-8">
            All verifications are recorded on the Thronos blockchain and signed by our miner network.
          </p>
        </div>
      </div>
    );
  }

  // ── Verification form ─────────────────────────────────────────────────

  if (view === 'form' && program) {
    const ProgramIcon = program.icon;
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 py-12 px-4">
        <div className="max-w-xl mx-auto">
          <button
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6"
            onClick={() => setView('select')}
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-xl ${program.color === 'indigo' ? 'bg-indigo-100' : 'bg-blue-100'}`}>
                  <ProgramIcon className={`h-6 w-6 ${program.color === 'indigo' ? 'text-indigo-600' : 'text-blue-600'}`} />
                </div>
                <div>
                  <CardTitle>{program.label}</CardTitle>
                  <p className="text-sm text-gray-500">{program.description}</p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="driver_name">Full Name</Label>
                  <Input
                    id="driver_name"
                    value={formData.driver_name}
                    onChange={e => setFormData({ ...formData, driver_name: e.target.value })}
                    placeholder="John Doe"
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="license_number">
                    {program.key === 'drone_program' ? 'Pilot Licence Number' : "Driver's Licence Number"}
                  </Label>
                  <Input
                    id="license_number"
                    value={formData.license_number}
                    onChange={e => setFormData({ ...formData, license_number: e.target.value })}
                    placeholder={program.key === 'drone_program' ? 'PL-2024-XXXXX' : 'DL-XXXXXXXX'}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="vehicle_type">
                    {program.key === 'drone_program' ? 'Drone Type' : 'Vehicle Type'}
                  </Label>
                  <select
                    id="vehicle_type"
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                    value={formData.vehicle_type}
                    onChange={e => setFormData({ ...formData, vehicle_type: e.target.value })}
                  >
                    <option value="">Select type…</option>
                    {program.vehicleTypes.map(vt => (
                      <option key={vt} value={vt}>{vt}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label htmlFor="school_or_operator">
                    {program.key === 'drone_program' ? 'Drone Operator / Company' : 'Taxi School Name'}
                  </Label>
                  <Input
                    id="school_or_operator"
                    value={formData.school_or_operator}
                    onChange={e => setFormData({ ...formData, school_or_operator: e.target.value })}
                    placeholder={program.key === 'drone_program' ? 'AeroPilot Solutions Ltd.' : 'Athens Taxi Academy'}
                  />
                </div>

                <div>
                  <Label htmlFor="doc_ver_id">
                    Existing Identity Verification ID{' '}
                    <span className="text-gray-400 font-normal">(optional — auto-signs identity step)</span>
                  </Label>
                  <Input
                    id="doc_ver_id"
                    type="number"
                    min={1}
                    value={formData.document_verification_id}
                    onChange={e =>
                      setFormData({ ...formData, document_verification_id: e.target.value })
                    }
                    placeholder="e.g. 42"
                  />
                </div>

                {/* Step preview */}
                <div className="border rounded-xl p-4 bg-gray-50">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                    Verification Steps
                  </p>
                  <div className="space-y-2">
                    {(program.key === 'taxi_school'
                      ? [
                          'Identity Document',
                          "Driver's Licence",
                          'Medical Certificate',
                          'Background Check',
                          'School Enrolment',
                        ]
                      : [
                          'Identity Document',
                          'Pilot Licence',
                          'Drone Certification',
                          'Route / Airspace Clearance',
                          'Call Agent Review',
                        ]
                    ).map((step, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm text-gray-600">
                        <div className="w-5 h-5 rounded-full bg-gray-200 text-gray-600 text-xs flex items-center justify-center font-bold">
                          {i + 1}
                        </div>
                        {step}
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-gray-400">
                    Each step will be signed by a Thronos miner on-chain.
                  </p>
                </div>

                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Submitting…
                    </>
                  ) : (
                    <>
                      <Shield className="mr-2 h-4 w-4" />
                      Submit for Verification
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ── Tracking view ─────────────────────────────────────────────────────

  if (view === 'tracking' && activeVer) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 py-12 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <button
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
              onClick={() => { setView('select'); loadMyVerifications(); }}
            >
              <ArrowLeft className="h-4 w-4" /> My Verifications
            </button>
            <span className="text-gray-300">/</span>
            <span className="text-sm text-gray-700">#{activeVer.id}</span>
          </div>

          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-bold text-gray-900">Verification Status</h1>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                apiClient
                  .get<DriverVerification>(`/api/v1/driver/${activeVer.id}`)
                  .then(r => setActiveVer(r.data))
              }
            >
              Refresh
            </Button>
          </div>

          <TrackingView ver={activeVer} />

          <div className="mt-8 text-center text-xs text-gray-400">
            Powered by Thronos VerifyID
          </div>
        </div>
      </div>
    );
  }

  // Fallback loading
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
    </div>
  );
}
