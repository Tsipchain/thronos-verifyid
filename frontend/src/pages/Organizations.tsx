/**
 * Organizations — SaaS subscriber management page (admin-only).
 *
 * Shows every organization that has purchased access to the DriverIntelligent
 * verification platform.  Admins can:
 *   - View all subscriptions with plan, status, usage
 *   - Create a new subscriber organization
 *   - Edit org details & upgrade/downgrade plan
 *   - Suspend / reactivate an org
 *   - Rotate the widget API key
 *   - Copy the embeddable widget snippet
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/lib/api';
import { rbac } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft,
  Building2,
  Plus,
  RefreshCw,
  Shield,
  Car,
  Plane,
  Users,
  Key,
  Copy,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Power,
  PowerOff,
  Code,
  TrendingUp,
  Zap,
  Star,
  Lock,
  CreditCard,
  Info,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────

interface PlanLimits {
  verifications: number;
  agents: number;
  price_eur: number;
}

interface Organization {
  id: string;
  name: string;
  org_type: string;
  status: string;
  country: string | null;
  contact_name: string | null;
  contact_email: string;
  contact_phone: string | null;
  plan: string;
  plan_status: string;
  plan_limits: PlanLimits;
  verifications_this_month: number;
  verifications_total: number;
  /** "PENDING_PAYMENT" when subscription not yet paid; real key once active */
  widget_api_key: string;
  /** true only after payment confirmed (plan_status == "active") */
  key_is_live: boolean;
  widget_allowed_origins: string[] | null;
  custom_branding: Record<string, string> | null;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
  suspended_at: string | null;
  plan_expires_at: string | null;
}

// ── Static config ──────────────────────────────────────────────────────────

const PLAN_CONFIG: Record<string, { label: string; color: string; icon: React.FC<{ className?: string }>; features: string[] }> = {
  starter: {
    label: 'Starter',
    color: 'bg-gray-100 text-gray-700',
    icon: Zap,
    features: ['100 verifications/mo', '1 call agent', 'Basic widget', 'Email support'],
  },
  professional: {
    label: 'Professional',
    color: 'bg-blue-100 text-blue-700',
    icon: TrendingUp,
    features: ['1,000 verifications/mo', '5 call agents', 'Branded widget', 'Priority support'],
  },
  enterprise: {
    label: 'Enterprise',
    color: 'bg-purple-100 text-purple-700',
    icon: Star,
    features: ['Unlimited verifications', 'Unlimited agents', 'White-label widget', 'Dedicated support'],
  },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  trial:     { label: 'Trial',     color: 'bg-yellow-100 text-yellow-800', dot: 'bg-yellow-400' },
  active:    { label: 'Active',    color: 'bg-green-100 text-green-800',   dot: 'bg-green-500' },
  suspended: { label: 'Suspended', color: 'bg-red-100 text-red-800',       dot: 'bg-red-500' },
  pending:   { label: 'Pending',   color: 'bg-gray-100 text-gray-600',     dot: 'bg-gray-400' },
  cancelled: { label: 'Cancelled', color: 'bg-gray-100 text-gray-500',     dot: 'bg-gray-400' },
};

const ORG_TYPE_LABEL: Record<string, string> = {
  taxi_school:    'Taxi School',
  drone_operator: 'Drone Operator',
  fleet:          'Fleet Company',
  call_center:    'Call Center',
  other:          'Other',
};

const ORG_TYPE_ICON: Record<string, React.FC<{ className?: string }>> = {
  taxi_school:    Car,
  drone_operator: Plane,
  fleet:          Car,
  call_center:    Users,
  other:          Building2,
};

// ── Helpers ───────────────────────────────────────────────────────────────

const fmtTs = (ts?: string | null) => (ts ? new Date(ts).toLocaleDateString() : '—');

function UsageBar({ used, limit }: { used: number; limit: number }) {
  const pct = limit < 0 ? 0 : Math.min((used / limit) * 100, 100);
  const isUnlimited = limit < 0;
  const isWarning = pct >= 80 && !isUnlimited;
  const isOver = pct >= 100 && !isUnlimited;
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>{used.toLocaleString()} used</span>
        <span>{isUnlimited ? '∞ unlimited' : limit.toLocaleString()}</span>
      </div>
      {!isUnlimited && (
        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${
              isOver ? 'bg-red-500' : isWarning ? 'bg-yellow-500' : 'bg-green-500'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ── Widget snippet modal ───────────────────────────────────────────────────

function SnippetModal({
  orgId,
  keyIsLive,
  onClose,
}: {
  orgId: string;
  keyIsLive: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [data, setData] = useState<{ snippet: string; iframe_url: string; api_key: string } | null>(null);
  const [blocked, setBlocked] = useState(!keyIsLive);

  useEffect(() => {
    if (!keyIsLive) return;
    apiClient
      .get(`/api/v1/organizations/${orgId}/widget-snippet`)
      .then(r => setData(r.data))
      .catch(() => setBlocked(true));
  }, [orgId, keyIsLive]);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: 'Copied to clipboard' });
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-6 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Code className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-bold">Embed Widget</h2>
          </div>
          <button className="text-gray-400 hover:text-gray-600 text-xl" onClick={onClose}>✕</button>
        </div>

        {blocked ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="w-14 h-14 bg-yellow-100 rounded-full flex items-center justify-center">
              <Lock className="h-7 w-7 text-yellow-600" />
            </div>
            <p className="font-semibold text-gray-900">Widget locked — payment not yet confirmed</p>
            <p className="text-sm text-gray-500 max-w-sm">
              Confirm the organisation's payment first. The widget API key and embed code will be
              revealed automatically once the subscription is active.
            </p>
          </div>
        ) : !data ? (
          <div className="flex justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-blue-600" />
          </div>
        ) : (
          <>
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Script Tag (paste before &lt;/body&gt;)</p>
              <div className="relative bg-gray-900 rounded-xl p-4">
                <pre className="text-xs text-green-400 overflow-x-auto whitespace-pre-wrap break-all">
                  {data.snippet}
                </pre>
                <button
                  className="absolute top-2 right-2 p-1.5 bg-gray-700 hover:bg-gray-600 rounded text-white"
                  onClick={() => copy(data.snippet)}
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Direct iFrame URL</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-gray-100 rounded px-3 py-2 break-all">
                  {data.iframe_url}
                </code>
                <button
                  className="p-2 bg-gray-100 hover:bg-gray-200 rounded"
                  onClick={() => copy(data.iframe_url)}
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Widget API Key</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-gray-100 rounded px-3 py-2 font-mono">
                  {data.api_key}
                </code>
                <button
                  className="p-2 bg-gray-100 hover:bg-gray-200 rounded"
                  onClick={() => copy(data.api_key)}
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 space-y-1">
              <p className="font-semibold">How to integrate:</p>
              <p>1. Paste the script tag into your website's HTML.</p>
              <p>2. The widget will automatically mount into <code>#driverintelligent-widget</code>.</p>
              <p>3. All verification data flows through the Thronos central platform — your organization retains full oversight via the admin panel.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Create Org modal ───────────────────────────────────────────────────────

function CreateOrgModal({
  onCreated,
  onClose,
}: {
  onCreated: () => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    org_type: 'taxi_school',
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    country: '',
    plan: 'starter',
    admin_notes: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiClient.post('/api/v1/organizations', {
        ...form,
        country: form.country || undefined,
        contact_phone: form.contact_phone || undefined,
        admin_notes: form.admin_notes || undefined,
      });
      toast({ title: 'Organisation created', description: 'Widget API key generated and ready.' });
      onCreated();
      onClose();
    } catch (err: any) {
      toast({
        title: 'Failed to create',
        description: err?.response?.data?.detail || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-bold">New Subscriber Organisation</h2>
          </div>
          <button className="text-gray-400 hover:text-gray-600 text-xl" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label>Organisation Name *</Label>
            <Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Athens Taxi Academy" required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <select
                className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                value={form.org_type}
                onChange={e => set('org_type', e.target.value)}
              >
                {Object.entries(ORG_TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Country (ISO-2)</Label>
              <Input value={form.country} onChange={e => set('country', e.target.value)} placeholder="GR" maxLength={2} />
            </div>
          </div>

          <div>
            <Label>Contact Name</Label>
            <Input value={form.contact_name} onChange={e => set('contact_name', e.target.value)} placeholder="John Doe" />
          </div>
          <div>
            <Label>Contact Email *</Label>
            <Input type="email" value={form.contact_email} onChange={e => set('contact_email', e.target.value)} placeholder="contact@org.com" required />
          </div>
          <div>
            <Label>Contact Phone</Label>
            <Input value={form.contact_phone} onChange={e => set('contact_phone', e.target.value)} placeholder="+30 210 000 0000" />
          </div>

          <div>
            <Label>Service Plan</Label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              {Object.entries(PLAN_CONFIG).map(([k, pc]) => {
                const PlanIcon = pc.icon;
                return (
                  <button
                    key={k}
                    type="button"
                    className={`p-3 border-2 rounded-xl text-left transition-all ${
                      form.plan === k ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                    }`}
                    onClick={() => set('plan', k)}
                  >
                    <PlanIcon className="h-4 w-4 mb-1 text-gray-600" />
                    <p className="text-xs font-bold">{pc.label}</p>
                    <p className="text-xs text-gray-500">
                      €{
                        k === 'starter' ? 49 : k === 'professional' ? 199 : 499
                      }/mo
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <Label>Admin Notes</Label>
            <textarea
              className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md text-sm resize-none"
              rows={2}
              value={form.admin_notes}
              onChange={e => set('admin_notes', e.target.value)}
              placeholder="Internal notes…"
            />
          </div>

          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            {saving ? 'Creating…' : 'Create Organisation & Generate API Key'}
          </Button>
        </form>
      </div>
    </div>
  );
}

// ── Org card ───────────────────────────────────────────────────────────────

function OrgCard({
  org,
  onRefresh,
}: {
  org: Organization;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [snippetOpen, setSnippetOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const statusCfg = STATUS_CONFIG[org.status] ?? STATUS_CONFIG.pending;
  const planCfg = PLAN_CONFIG[org.plan] ?? PLAN_CONFIG.starter;
  const PlanIcon = planCfg.icon;
  const OrgIcon = ORG_TYPE_ICON[org.org_type] ?? Building2;
  const isActive = org.status === 'active' || org.status === 'trial';
  const usagePct =
    org.plan_limits.verifications > 0
      ? Math.round((org.verifications_this_month / org.plan_limits.verifications) * 100)
      : 0;

  const action = async (path: string, label: string) => {
    setActionLoading(label);
    try {
      const res = await apiClient.post(`/api/v1/organizations/${org.id}/${path}`);
      toast({ title: `${label} done`, description: res.data?.new_api_key ? `New key: ${res.data.new_api_key}` : undefined });
      onRefresh();
    } catch (err: any) {
      toast({ title: `${label} failed`, description: err?.response?.data?.detail, variant: 'destructive' });
    } finally {
      setActionLoading(null);
    }
  };

  const copyKey = () => {
    navigator.clipboard.writeText(org.widget_api_key).then(() => {
      toast({ title: 'API key copied' });
    });
  };

  return (
    <>
      {snippetOpen && (
        <SnippetModal
          orgId={org.id}
          keyIsLive={org.key_is_live}
          onClose={() => setSnippetOpen(false)}
        />
      )}

      <Card className={`hover:shadow-md transition-shadow ${org.status === 'suspended' ? 'opacity-60 border-red-200' : ''}`}>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="p-2 rounded-xl bg-gray-100 flex-shrink-0">
                <OrgIcon className="h-5 w-5 text-gray-600" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <CardTitle className="text-base">{org.name}</CardTitle>
                  {/* Status dot */}
                  <span className="flex items-center gap-1">
                    <span className={`w-2 h-2 rounded-full ${statusCfg.dot}`} />
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusCfg.color}`}>
                      {statusCfg.label}
                    </span>
                  </span>
                  <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${planCfg.color}`}>
                    <PlanIcon className="h-3 w-3" />
                    {planCfg.label}
                  </span>
                  {!org.key_is_live && (
                    <Badge className="bg-yellow-100 text-yellow-800 text-xs gap-1 border border-yellow-300">
                      <Lock className="h-3 w-3" /> Awaiting Payment
                    </Badge>
                  )}
                  {usagePct >= 80 && org.key_is_live && (
                    <Badge className="bg-orange-100 text-orange-700 text-xs gap-1">
                      <AlertTriangle className="h-3 w-3" /> {usagePct}% usage
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-0.5">
                  {ORG_TYPE_LABEL[org.org_type] ?? org.org_type}
                  {org.country ? ` · ${org.country}` : ''}
                  {org.contact_email ? ` · ${org.contact_email}` : ''}
                </p>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                size="sm"
                variant={org.key_is_live ? 'outline' : 'ghost'}
                className={org.key_is_live ? '' : 'text-gray-400 cursor-not-allowed'}
                onClick={() => setSnippetOpen(true)}
                title={org.key_is_live ? 'Get embed snippet' : 'Locked until payment confirmed'}
              >
                {org.key_is_live
                  ? <><Code className="h-3 w-3 mr-1" /> Embed</>
                  : <><Lock className="h-3 w-3 mr-1" /> Locked</>
                }
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setExpanded(e => !e)}
              >
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          {/* Quick stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
            <div>
              <span className="text-gray-500 text-xs">This Month</span>
              <p className="font-medium">
                {org.verifications_this_month.toLocaleString()} / {org.plan_limits.verifications < 0 ? '∞' : org.plan_limits.verifications.toLocaleString()}
              </p>
            </div>
            <div>
              <span className="text-gray-500 text-xs">Total Verifications</span>
              <p className="font-medium">{org.verifications_total.toLocaleString()}</p>
            </div>
            <div>
              <span className="text-gray-500 text-xs">Max Agents</span>
              <p className="font-medium">{org.plan_limits.agents < 0 ? '∞' : org.plan_limits.agents}</p>
            </div>
            <div>
              <span className="text-gray-500 text-xs">Plan Price</span>
              <p className="font-medium">€{org.plan_limits.price_eur}/mo</p>
            </div>
          </div>

          {/* Usage bar */}
          {org.plan_limits.verifications > 0 && (
            <div className="mb-3">
              <UsageBar used={org.verifications_this_month} limit={org.plan_limits.verifications} />
            </div>
          )}

          {/* API key row */}
          {org.key_is_live ? (
            <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 mb-2">
              <Key className="h-3 w-3 text-green-500 flex-shrink-0" />
              <code className="font-mono flex-1 truncate">{org.widget_api_key}</code>
              <button className="hover:text-gray-700 flex-shrink-0" onClick={copyKey} title="Copy API key">
                <Copy className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 mb-2">
              <Lock className="h-3 w-3 text-yellow-500 flex-shrink-0" />
              <code className="font-mono flex-1 text-yellow-700 tracking-widest">wk_••••••••••••••••••••••••••••••••</code>
              <span className="text-yellow-600 flex-shrink-0 text-xs font-medium">Awaiting payment</span>
            </div>
          )}

          {/* Expanded details */}
          {expanded && (
            <div className="mt-3 space-y-3 border-t pt-3">
              {/* Contact */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-400">Contact</p>
                  <p>{org.contact_name || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Phone</p>
                  <p>{org.contact_phone || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Joined</p>
                  <p>{fmtTs(org.created_at)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Plan Expires</p>
                  <p>{fmtTs(org.plan_expires_at)}</p>
                </div>
              </div>

              {/* Admin notes */}
              {org.admin_notes && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-2 text-xs text-yellow-800">
                  <span className="font-semibold">Notes:</span> {org.admin_notes}
                </div>
              )}

              {/* Plan features */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Plan Features</p>
                <div className="grid grid-cols-2 gap-1">
                  {planCfg.features.map((f, i) => (
                    <div key={i} className="flex items-center gap-1 text-xs text-gray-600">
                      <CheckCircle className="h-3 w-3 text-green-500 flex-shrink-0" />
                      {f}
                    </div>
                  ))}
                </div>
              </div>

              {/* Allowed origins */}
              {org.widget_allowed_origins && org.widget_allowed_origins.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Allowed Widget Origins</p>
                  <div className="flex flex-wrap gap-1">
                    {org.widget_allowed_origins.map((o, i) => (
                      <code key={i} className="text-xs bg-gray-100 rounded px-2 py-0.5">{o}</code>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-2 pt-1">
                {/* Primary CTA: Confirm payment if not yet active */}
                {!org.key_is_live && org.status !== 'suspended' && (
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white"
                    disabled={actionLoading !== null}
                    onClick={() => action('confirm-payment', 'Confirm Payment')}
                  >
                    <CreditCard className="h-3 w-3 mr-1" />
                    {actionLoading === 'Confirm Payment' ? 'Activating…' : 'Confirm Payment & Activate'}
                  </Button>
                )}

                {/* Suspend / reactivate */}
                {isActive && org.key_is_live ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-red-300 text-red-600 hover:bg-red-50"
                    disabled={actionLoading !== null}
                    onClick={() => action('suspend', 'Suspend')}
                  >
                    <PowerOff className="h-3 w-3 mr-1" />
                    {actionLoading === 'Suspend' ? 'Suspending…' : 'Suspend'}
                  </Button>
                ) : org.status === 'suspended' ? (
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white"
                    disabled={actionLoading !== null}
                    onClick={() => action('confirm-payment', 'Reactivate')}
                  >
                    <Power className="h-3 w-3 mr-1" />
                    {actionLoading === 'Reactivate' ? 'Reactivating…' : 'Reactivate'}
                  </Button>
                ) : null}

                {/* Rotate key — only when live */}
                {org.key_is_live && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={actionLoading !== null}
                    onClick={() => action('api-key/rotate', 'Rotate API Key')}
                  >
                    <Key className="h-3 w-3 mr-1" />
                    {actionLoading === 'Rotate API Key' ? 'Rotating…' : 'Rotate API Key'}
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

// ── Plan pricing summary ───────────────────────────────────────────────────

function PricingOverview({ orgs }: { orgs: Organization[] }) {
  const mrr = orgs
    .filter(o => o.key_is_live)
    .reduce((sum, o) => {
      const prices: Record<string, number> = { starter: 49, professional: 199, enterprise: 499 };
      return sum + (prices[o.plan] ?? 0);
    }, 0);

  const awaitingPayment = orgs.filter(o => !o.key_is_live && o.status !== 'suspended').length;
  const activeCount = orgs.filter(o => o.key_is_live).length;
  const suspendedCount = orgs.filter(o => o.status === 'suspended').length;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {[
        { label: 'Total Orgs', value: orgs.length, color: 'text-blue-600', sub: null },
        { label: 'Active (paid)', value: activeCount, color: 'text-green-600', sub: null },
        { label: 'Awaiting Payment', value: awaitingPayment, color: 'text-yellow-600', sub: awaitingPayment > 0 ? 'action needed' : null },
        { label: 'MRR', value: `€${mrr.toLocaleString()}`, color: 'text-purple-600', sub: null },
      ].map(stat => (
        <Card key={stat.label} className="text-center py-4">
          <p className={`text-3xl font-bold ${stat.color}`}>{stat.value}</p>
          <p className="text-xs text-gray-500 mt-1">{stat.label}</p>
          {stat.sub && <p className="text-xs font-medium text-yellow-600 mt-0.5">{stat.sub}</p>}
        </Card>
      ))}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function Organizations() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [search, setSearch] = useState('');

  const checkAccess = useCallback(async () => {
    await rbac.initialize();
    if (!rbac.isAdmin()) {
      toast({ title: 'Access Denied', description: 'Administrator role required.', variant: 'destructive' });
      navigate('/admin');
    }
  }, [navigate, toast]);

  const fetchOrgs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (planFilter) params.append('plan', planFilter);
      const qs = params.toString() ? `?${params}` : '';
      const res = await apiClient.get<Organization[]>(`/api/v1/organizations${qs}`);
      setOrgs(res.data);
    } catch (err: any) {
      toast({ title: 'Failed to load', description: err?.response?.data?.detail || err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, planFilter, toast]);

  useEffect(() => { checkAccess(); }, [checkAccess]);
  useEffect(() => { fetchOrgs(); }, [fetchOrgs]);

  const filtered = orgs.filter(o =>
    !search || o.name.toLowerCase().includes(search.toLowerCase()) || o.contact_email.toLowerCase().includes(search.toLowerCase())
  );

  const STATUS_FILTERS = [
    { value: '', label: 'All' },
    { value: 'trial', label: 'Trial' },
    { value: 'active', label: 'Active' },
    { value: 'suspended', label: 'Suspended' },
  ];

  const PLAN_FILTERS = [
    { value: '', label: 'All Plans' },
    { value: 'starter', label: 'Starter' },
    { value: 'professional', label: 'Professional' },
    { value: 'enterprise', label: 'Enterprise' },
  ];

  return (
    <>
      {creating && (
        <CreateOrgModal onCreated={fetchOrgs} onClose={() => setCreating(false)} />
      )}

      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="bg-white border-b px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={() => navigate('/admin')}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Back
              </Button>
              <Building2 className="h-6 w-6 text-blue-600" />
              <div>
                <h1 className="text-xl font-bold">Subscriber Organisations</h1>
                <p className="text-sm text-gray-500">
                  SaaS tenants using the DriverIntelligent platform
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={fetchOrgs} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4 mr-2" /> New Organisation
              </Button>
            </div>
          </div>
        </header>

        {/* Filter bar */}
        <div className="bg-white border-b px-6 py-2">
          <div className="max-w-7xl mx-auto flex items-center gap-4 flex-wrap">
            <Input
              className="h-8 w-48 text-sm"
              placeholder="Search name or email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div className="flex items-center gap-1">
              {STATUS_FILTERS.map(f => (
                <button
                  key={f.value}
                  onClick={() => setStatusFilter(f.value)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    statusFilter === f.value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              {PLAN_FILTERS.map(f => (
                <button
                  key={f.value}
                  onClick={() => setPlanFilter(f.value)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    planFilter === f.value ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <main className="max-w-7xl mx-auto px-6 py-6">
          {/* Info: Thronos staff don't need subscriptions */}
          <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-5 text-sm">
            <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
            <div>
              <span className="font-semibold text-blue-900">Thronos Chain employees do not need a subscription.</span>
              <span className="text-blue-700 ml-1">
                Staff access the platform via user roles (admin / manager / agent).
                Subscriptions are for <strong>external organisations</strong> that bring their own personnel and call centres.
              </span>
            </div>
          </div>

          {/* Pricing overview */}
          {!loading && <PricingOverview orgs={orgs} />}

          {/* List */}
          <div className="space-y-3">
            {loading && (
              <div className="flex items-center justify-center py-16 text-gray-400">
                <RefreshCw className="h-6 w-6 animate-spin mr-2" /> Loading…
              </div>
            )}

            {!loading && filtered.length === 0 && (
              <div className="text-center py-16 text-gray-400">
                <Building2 className="h-12 w-12 mx-auto mb-3 opacity-40" />
                <p>No organisations found.</p>
                <Button className="mt-4" size="sm" onClick={() => setCreating(true)}>
                  <Plus className="h-4 w-4 mr-2" /> Add First Organisation
                </Button>
              </div>
            )}

            {filtered.map(org => (
              <OrgCard key={org.id} org={org} onRefresh={fetchOrgs} />
            ))}
          </div>
        </main>
      </div>
    </>
  );
}
