import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield, FileCheck, Video, PenTool, CheckCircle2, Lock, Brain,
  Globe, Server, Mail, BadgeCheck, X, ChevronRight, ChevronLeft,
  Phone, Building2, Users, Car, ShieldAlert, ClipboardList,
  Calendar, Headphones, Wrench, UserCheck, Plus, Trash2,
  Check, Star,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { apiClient } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

// ── Types ────────────────────────────────────────────────────────────────────

type ServiceCategory = {
  code: string;
  name: string;
  description: string;
  icon: string;
};

type CallCenterOption = {
  code: string;
  name: string;
  description: string;
  note: string;
};

type VerifyIDPlan = {
  code: string;
  name: string;
  monthly_price_eur: number;
  verifications_per_month: string;
  agents: string;
  features: string[];
  highlight: boolean;
};

// ── Static icon map ──────────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.ReactNode> = {
  FileCheck:    <FileCheck className="h-6 w-6" />,
  Calendar:     <Calendar className="h-6 w-6" />,
  ClipboardList:<ClipboardList className="h-6 w-6" />,
  Video:        <Video className="h-6 w-6" />,
  PenTool:      <PenTool className="h-6 w-6" />,
  Car:          <Car className="h-6 w-6" />,
  ShieldAlert:  <ShieldAlert className="h-6 w-6" />,
};

const CC_ICON_MAP: Record<string, React.ReactNode> = {
  thronos_callcenter: <Headphones className="h-7 w-7 text-indigo-400" />,
  own_with_support:   <Wrench className="h-7 w-7 text-blue-400" />,
  own_self_managed:   <UserCheck className="h-7 w-7 text-emerald-400" />,
};

const ORG_TYPES = [
  { code: 'taxi_school',     label: 'Σχολή Οδηγών / Taxi' },
  { code: 'drone_operator',  label: 'Drone Operator' },
  { code: 'fleet',           label: 'Fleet Management' },
  { code: 'call_center',     label: 'Call Center' },
  { code: 'other',           label: 'Άλλο' },
];

const STEP_LABELS = [
  'Κατηγορίες',
  'Call Center',
  'Πλάνο',
  'Οργανισμός',
  'Επιβεβαίωση',
];

// ── Wizard ───────────────────────────────────────────────────────────────────

type WizardState = {
  selectedServices: Set<string>;
  callCenterOption: string;
  verifyidPlan: string;
  companyName: string;
  orgType: string;
  contactName: string;
  email: string;
  phone: string;
  staffCount: string;
  managerEmails: string[];
  packageCode: string;
  notes: string;
};

function initWizard(): WizardState {
  return {
    selectedServices: new Set(),
    callCenterOption: '',
    verifyidPlan: '',
    companyName: '',
    orgType: 'other',
    contactName: '',
    email: '',
    phone: '',
    staffCount: '1',
    managerEmails: [''],
    packageCode: 'starter',
    notes: '',
  };
}

interface WizardProps {
  open: boolean;
  onClose: () => void;
}

function PackageWizard({ open, onClose }: WizardProps) {
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(initWizard());
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Static catalogs (loaded once on mount via API, fallback to hardcoded)
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [ccOptions, setCcOptions] = useState<CallCenterOption[]>([]);
  const [plans, setPlans] = useState<VerifyIDPlan[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogLoaded, setCatalogLoaded] = useState(false);

  const loadCatalog = async () => {
    if (catalogLoaded || loadingCatalog) return;
    setLoadingCatalog(true);
    try {
      const [catRes, ccRes, planRes] = await Promise.all([
        apiClient.get<ServiceCategory[]>('/api/v1/services/categories'),
        apiClient.get<CallCenterOption[]>('/api/v1/services/call-center-options'),
        apiClient.get<VerifyIDPlan[]>('/api/v1/services/verifyid-plans'),
      ]);
      setCategories(catRes.data);
      setCcOptions(ccRes.data);
      setPlans(planRes.data);
      setCatalogLoaded(true);
    } catch {
      // fallback to hardcoded
      setCategories(FALLBACK_CATEGORIES);
      setCcOptions(FALLBACK_CC);
      setPlans(FALLBACK_PLANS);
      setCatalogLoaded(true);
    } finally {
      setLoadingCatalog(false);
    }
  };

  // Load catalog when modal opens
  const handleOpen = () => {
    setStep(0);
    setState(initWizard());
    setSubmitted(false);
    loadCatalog();
  };

  const toggleService = (code: string) => {
    setState((prev) => {
      const next = new Set(prev.selectedServices);
      next.has(code) ? next.delete(code) : next.add(code);
      return { ...prev, selectedServices: next };
    });
  };

  const updateManagerEmail = (idx: number, val: string) => {
    setState((prev) => {
      const emails = [...prev.managerEmails];
      emails[idx] = val;
      return { ...prev, managerEmails: emails };
    });
  };

  const addManagerEmail = () =>
    setState((prev) => ({ ...prev, managerEmails: [...prev.managerEmails, ''] }));

  const removeManagerEmail = (idx: number) =>
    setState((prev) => ({
      ...prev,
      managerEmails: prev.managerEmails.filter((_, i) => i !== idx),
    }));

  const canNext = () => {
    if (step === 0) return state.selectedServices.size > 0;
    if (step === 1) return !!state.callCenterOption;
    if (step === 2) return !!state.verifyidPlan;
    if (step === 3) return !!(state.companyName && state.contactName && state.email && state.phone);
    return true;
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      await apiClient.post('/api/v1/services/leads', {
        company_name: state.companyName,
        org_type: state.orgType,
        contact_name: state.contactName,
        email: state.email,
        phone: state.phone,
        staff_count: parseInt(state.staffCount) || 1,
        manager_emails: state.managerEmails.filter((e) => e.trim()),
        selected_services: Array.from(state.selectedServices),
        verifyid_plan: state.verifyidPlan,
        call_center_option: state.callCenterOption,
        package_code: state.packageCode,
        notes: state.notes || null,
        needs_web2_domain: true,
        needs_hosting: true,
        hosting_tier: 'starter',
      });
      setSubmitted(true);
    } catch {
      toast({ title: 'Σφάλμα', description: 'Παρακαλώ δοκιμάστε ξανά.', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const selectedPlan = plans.find((p) => p.code === state.verifyidPlan);
  const selectedCC = ccOptions.find((c) => c.code === state.callCenterOption);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); else handleOpen(); }}>
      <DialogContent className="max-w-2xl p-0 gap-0 bg-slate-900 border-slate-700 text-slate-100 overflow-hidden max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-400" />
            <span className="font-semibold text-base">VerifyID — Επιλογή Πακέτου</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Step indicator */}
        {!submitted && (
          <div className="px-6 py-3 border-b border-slate-800 flex-shrink-0">
            <div className="flex items-center gap-1">
              {STEP_LABELS.map((label, i) => (
                <div key={i} className="flex items-center gap-1 flex-1 min-w-0">
                  <div className={`flex items-center justify-center h-6 w-6 rounded-full text-xs font-bold flex-shrink-0 ${
                    i < step ? 'bg-blue-500 text-white' :
                    i === step ? 'bg-blue-600 text-white ring-2 ring-blue-400/50' :
                    'bg-slate-700 text-slate-400'
                  }`}>
                    {i < step ? <Check className="h-3 w-3" /> : i + 1}
                  </div>
                  <span className={`text-[11px] truncate hidden sm:block ${i === step ? 'text-slate-200' : 'text-slate-500'}`}>
                    {label}
                  </span>
                  {i < STEP_LABELS.length - 1 && (
                    <div className={`h-px flex-1 ${i < step ? 'bg-blue-500' : 'bg-slate-700'}`} />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {loadingCatalog && (
            <div className="flex items-center justify-center h-40 text-slate-400 gap-3">
              <div className="animate-spin h-5 w-5 border-2 border-blue-400 border-t-transparent rounded-full" />
              Φόρτωση κατηγοριών…
            </div>
          )}

          {/* ── Step 0: Service categories ── */}
          {!loadingCatalog && step === 0 && (
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-lg text-slate-100">Τι υπηρεσίες χρειάζεστε;</h3>
                <p className="text-sm text-slate-400 mt-1">Επιλέξτε όσες κατηγορίες επιθυμείτε για τον οργανισμό σας.</p>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {categories.map((cat) => {
                  const selected = state.selectedServices.has(cat.code);
                  return (
                    <button
                      key={cat.code}
                      onClick={() => toggleService(cat.code)}
                      className={`flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all ${
                        selected
                          ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/30'
                          : 'border-slate-700 hover:border-slate-500 bg-slate-800/50'
                      }`}
                    >
                      <div className={`mt-0.5 flex-shrink-0 ${selected ? 'text-blue-400' : 'text-slate-400'}`}>
                        {ICON_MAP[cat.icon] ?? <FileCheck className="h-6 w-6" />}
                      </div>
                      <div className="min-w-0">
                        <p className={`text-sm font-medium leading-tight ${selected ? 'text-blue-300' : 'text-slate-200'}`}>
                          {cat.name}
                        </p>
                        <p className="text-xs text-slate-400 mt-1 leading-snug">{cat.description}</p>
                      </div>
                      {selected && (
                        <div className="ml-auto flex-shrink-0">
                          <Check className="h-4 w-4 text-blue-400" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              {state.selectedServices.size > 0 && (
                <p className="text-xs text-blue-400">
                  {state.selectedServices.size} κατηγορ{state.selectedServices.size === 1 ? 'ία' : 'ίες'} επιλεγμέν{state.selectedServices.size === 1 ? 'η' : 'ες'}
                </p>
              )}
            </div>
          )}

          {/* ── Step 1: Call center ── */}
          {!loadingCatalog && step === 1 && (
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-lg text-slate-100">Μοντέλο Call Center</h3>
                <p className="text-sm text-slate-400 mt-1">Πώς θέλετε να διαχειρίζεστε την ομάδα επαλήθευσης;</p>
              </div>
              <div className="space-y-3">
                {ccOptions.map((opt) => {
                  const selected = state.callCenterOption === opt.code;
                  return (
                    <button
                      key={opt.code}
                      onClick={() => setState((p) => ({ ...p, callCenterOption: opt.code }))}
                      className={`w-full flex items-start gap-4 p-4 rounded-xl border text-left transition-all ${
                        selected
                          ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/30'
                          : 'border-slate-700 hover:border-slate-500 bg-slate-800/50'
                      }`}
                    >
                      <div className="flex-shrink-0 mt-0.5">
                        {CC_ICON_MAP[opt.code] ?? <Headphones className="h-7 w-7 text-slate-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`font-semibold text-sm ${selected ? 'text-blue-300' : 'text-slate-100'}`}>
                          {opt.name}
                        </p>
                        <p className="text-xs text-slate-400 mt-1 leading-snug">{opt.description}</p>
                        <p className="text-xs text-amber-400/80 mt-2 italic">{opt.note}</p>
                      </div>
                      <div className={`flex-shrink-0 h-5 w-5 rounded-full border-2 flex items-center justify-center ${
                        selected ? 'border-blue-500 bg-blue-500' : 'border-slate-600'
                      }`}>
                        {selected && <Check className="h-3 w-3 text-white" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Step 2: VerifyID plan ── */}
          {!loadingCatalog && step === 2 && (
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-lg text-slate-100">Επιλέξτε Πλάνο VerifyID</h3>
                <p className="text-sm text-slate-400 mt-1">Το πλάνο καθορίζει verifications/μήνα και αριθμό agents.</p>
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                {plans.map((plan) => {
                  const selected = state.verifyidPlan === plan.code;
                  return (
                    <button
                      key={plan.code}
                      onClick={() => setState((p) => ({ ...p, verifyidPlan: plan.code }))}
                      className={`relative flex flex-col p-4 rounded-xl border text-left transition-all ${
                        selected
                          ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/30'
                          : 'border-slate-700 hover:border-slate-500 bg-slate-800/50'
                      }`}
                    >
                      {plan.highlight && (
                        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                          <span className="bg-blue-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Star className="h-2.5 w-2.5" /> POPULAR
                          </span>
                        </div>
                      )}
                      <div className="mb-3">
                        <p className={`font-bold text-base ${selected ? 'text-blue-300' : 'text-slate-100'}`}>
                          {plan.name}
                        </p>
                        <p className="text-2xl font-bold text-slate-50 mt-1">
                          €{plan.monthly_price_eur}
                          <span className="text-xs font-normal text-slate-400">/mo</span>
                        </p>
                      </div>
                      <div className="space-y-1.5 flex-1">
                        {plan.features.map((f) => (
                          <div key={f} className="flex items-start gap-1.5 text-xs text-slate-300">
                            <BadgeCheck className="h-3.5 w-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                            <span>{f}</span>
                          </div>
                        ))}
                      </div>
                      {selected && (
                        <div className="absolute top-3 right-3">
                          <Check className="h-4 w-4 text-blue-400" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Step 3: Organisation details ── */}
          {!loadingCatalog && step === 3 && (
            <div className="space-y-5">
              <div>
                <h3 className="font-semibold text-lg text-slate-100">Στοιχεία Οργανισμού</h3>
                <p className="text-sm text-slate-400 mt-1">Συμπληρώστε τα στοιχεία επικοινωνίας και το προσωπικό σας.</p>
              </div>

              {/* Org info */}
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="text-xs text-slate-400 mb-1 block">Επωνυμία εταιρείας *</label>
                  <Input
                    placeholder="π.χ. Sigma Taxi School"
                    value={state.companyName}
                    onChange={(e) => setState((p) => ({ ...p, companyName: e.target.value }))}
                    className="bg-slate-800 border-slate-600 text-slate-100 placeholder:text-slate-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Τύπος οργανισμού</label>
                  <select
                    value={state.orgType}
                    onChange={(e) => setState((p) => ({ ...p, orgType: e.target.value }))}
                    className="w-full h-10 rounded-md bg-slate-800 border border-slate-600 text-slate-100 px-3 text-sm"
                  >
                    {ORG_TYPES.map((t) => (
                      <option key={t.code} value={t.code}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Αριθμός προσωπικού</label>
                  <Input
                    type="number"
                    min="1"
                    placeholder="π.χ. 12"
                    value={state.staffCount}
                    onChange={(e) => setState((p) => ({ ...p, staffCount: e.target.value }))}
                    className="bg-slate-800 border-slate-600 text-slate-100 placeholder:text-slate-500"
                  />
                </div>
              </div>

              {/* Primary contact (General Director) */}
              <div>
                <p className="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
                  <UserCheck className="h-3.5 w-3.5 text-blue-400" />
                  Γενικός Διευθυντής / Κύρια Επαφή
                </p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Input
                    placeholder="Ονοματεπώνυμο *"
                    value={state.contactName}
                    onChange={(e) => setState((p) => ({ ...p, contactName: e.target.value }))}
                    className="bg-slate-800 border-slate-600 text-slate-100 placeholder:text-slate-500"
                  />
                  <Input
                    placeholder="Email *"
                    type="email"
                    value={state.email}
                    onChange={(e) => setState((p) => ({ ...p, email: e.target.value }))}
                    className="bg-slate-800 border-slate-600 text-slate-100 placeholder:text-slate-500"
                  />
                  <Input
                    placeholder="Τηλέφωνο *"
                    value={state.phone}
                    onChange={(e) => setState((p) => ({ ...p, phone: e.target.value }))}
                    className="bg-slate-800 border-slate-600 text-slate-100 placeholder:text-slate-500"
                  />
                </div>
              </div>

              {/* Manager emails */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-indigo-400" />
                    Manager emails
                    <span className="text-slate-500 font-normal">(προαιρετικό — μπορεί να έχετε και manager και διευθυντή)</span>
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={addManagerEmail}
                    className="h-7 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 gap-1"
                  >
                    <Plus className="h-3 w-3" /> Προσθήκη
                  </Button>
                </div>
                <div className="space-y-2">
                  {state.managerEmails.map((email, idx) => (
                    <div key={idx} className="flex gap-2">
                      <Input
                        placeholder={`Manager ${idx + 1} email`}
                        type="email"
                        value={email}
                        onChange={(e) => updateManagerEmail(idx, e.target.value)}
                        className="bg-slate-800 border-slate-600 text-slate-100 placeholder:text-slate-500 flex-1"
                      />
                      {state.managerEmails.length > 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeManagerEmail(idx)}
                          className="h-10 w-10 p-0 text-slate-500 hover:text-red-400 hover:bg-red-500/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Σημειώσεις / Επιπλέον απαιτήσεις</label>
                <Textarea
                  placeholder="π.χ. χρειάζομαι και domain, mailboxes, ή άλλες πληροφορίες…"
                  value={state.notes}
                  onChange={(e) => setState((p) => ({ ...p, notes: e.target.value }))}
                  className="bg-slate-800 border-slate-600 text-slate-100 placeholder:text-slate-500 min-h-20 resize-none"
                />
              </div>
            </div>
          )}

          {/* ── Step 4: Confirm ── */}
          {!loadingCatalog && step === 4 && !submitted && (
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-lg text-slate-100">Επιβεβαίωση & Αποστολή</h3>
                <p className="text-sm text-slate-400 mt-1">Ελέγξτε τις επιλογές σας πριν αποστείλετε.</p>
              </div>

              <div className="space-y-3">
                {/* Services */}
                <div className="rounded-xl bg-slate-800/60 border border-slate-700 p-4">
                  <p className="text-xs text-slate-400 mb-2 font-semibold uppercase tracking-wide">Υπηρεσίες</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from(state.selectedServices).map((code) => {
                      const cat = categories.find((c) => c.code === code);
                      return (
                        <Badge key={code} className="bg-blue-500/20 text-blue-300 border-blue-500/30 text-xs">
                          {cat?.name ?? code}
                        </Badge>
                      );
                    })}
                  </div>
                </div>

                {/* Call center */}
                <div className="rounded-xl bg-slate-800/60 border border-slate-700 p-4">
                  <p className="text-xs text-slate-400 mb-1 font-semibold uppercase tracking-wide">Call Center</p>
                  <p className="text-sm text-slate-200">{selectedCC?.name ?? state.callCenterOption}</p>
                </div>

                {/* Plan */}
                <div className="rounded-xl bg-slate-800/60 border border-slate-700 p-4">
                  <p className="text-xs text-slate-400 mb-1 font-semibold uppercase tracking-wide">Πλάνο VerifyID</p>
                  <p className="text-sm text-slate-200">
                    {selectedPlan?.name} — <span className="text-blue-400 font-bold">€{selectedPlan?.monthly_price_eur}/mo</span>
                  </p>
                </div>

                {/* Org */}
                <div className="rounded-xl bg-slate-800/60 border border-slate-700 p-4">
                  <p className="text-xs text-slate-400 mb-2 font-semibold uppercase tracking-wide">Οργανισμός</p>
                  <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <div className="flex gap-2"><span className="text-slate-500">Εταιρεία:</span><span className="text-slate-200">{state.companyName}</span></div>
                    <div className="flex gap-2"><span className="text-slate-500">Τύπος:</span><span className="text-slate-200">{ORG_TYPES.find(t => t.code === state.orgType)?.label}</span></div>
                    <div className="flex gap-2"><span className="text-slate-500">Επαφή:</span><span className="text-slate-200">{state.contactName}</span></div>
                    <div className="flex gap-2"><span className="text-slate-500">Email:</span><span className="text-slate-200 break-all">{state.email}</span></div>
                    <div className="flex gap-2"><span className="text-slate-500">Τηλ:</span><span className="text-slate-200">{state.phone}</span></div>
                    <div className="flex gap-2"><span className="text-slate-500">Προσωπικό:</span><span className="text-slate-200">{state.staffCount} άτομα</span></div>
                  </div>
                  {state.managerEmails.some((e) => e.trim()) && (
                    <div className="mt-2">
                      <p className="text-xs text-slate-500 mb-1">Manager emails:</p>
                      <div className="flex flex-wrap gap-1">
                        {state.managerEmails.filter((e) => e.trim()).map((e, i) => (
                          <Badge key={i} className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30 text-xs">{e}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Success ── */}
          {submitted && (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-4">
              <div className="h-16 w-16 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <Check className="h-8 w-8 text-emerald-400" />
              </div>
              <h3 className="text-xl font-bold text-slate-100">Αίτηση Υποβλήθηκε!</h3>
              <p className="text-slate-400 max-w-sm text-sm">
                Η ομάδα Thronos θα επικοινωνήσει μαζί σας εντός <strong className="text-slate-200">1-2 εργάσιμων ημερών</strong> για επιβεβαίωση και επόμενα βήματα.
              </p>
              <Button onClick={onClose} className="bg-blue-600 hover:bg-blue-700 mt-2">Κλείσιμο</Button>
            </div>
          )}
        </div>

        {/* Footer navigation */}
        {!submitted && !loadingCatalog && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-slate-700 flex-shrink-0">
            <Button
              variant="ghost"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
              className="text-slate-400 hover:text-slate-100 gap-1"
            >
              <ChevronLeft className="h-4 w-4" /> Πίσω
            </Button>

            {step < STEP_LABELS.length - 1 ? (
              <Button
                onClick={() => setStep((s) => s + 1)}
                disabled={!canNext()}
                className="bg-blue-600 hover:bg-blue-700 gap-1"
              >
                Επόμενο <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                onClick={submit}
                disabled={submitting || !canNext()}
                className="bg-emerald-600 hover:bg-emerald-700 gap-1"
              >
                {submitting ? 'Αποστολή…' : 'Υποβολή Αίτησης'}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Fallback static data (if API unavailable) ────────────────────────────────

const FALLBACK_CATEGORIES: ServiceCategory[] = [
  { code: 'document_verification', name: 'Document Verification', description: 'Passport, Driver\'s License, National ID, Residence Permit', icon: 'FileCheck' },
  { code: 'age_verification',      name: 'Age Verification',       description: 'DOB-based age check για regulatory compliance',         icon: 'Calendar' },
  { code: 'kyc_forms',             name: 'KYC Compliance Forms',   description: 'Full KYC data collection — personal info, occupation', icon: 'ClipboardList' },
  { code: 'video_verification',    name: 'Video Identification',   description: 'Live video call με verified agent',                    icon: 'Video' },
  { code: 'digital_signature',     name: 'Digital Signature',      description: 'Legally binding electronic signatures',               icon: 'PenTool' },
  { code: 'driver_program',        name: 'Driver Program',         description: 'Taxi school & drone operator verification',           icon: 'Car' },
  { code: 'fraud_analysis',        name: 'Fraud Analysis',         description: 'Deep-scan fraud scoring & deepfake detection',        icon: 'ShieldAlert' },
];

const FALLBACK_CC: CallCenterOption[] = [
  { code: 'thronos_callcenter', name: 'Thronos Support Call Center',     description: 'Χρησιμοποιείτε το managed call center της Thronos με εκπαιδευμένους agents.', note: 'Απαιτείται SLA agreement με την Thronos' },
  { code: 'own_with_support',   name: 'Δικό σας Call Center + Thronos IT', description: 'Δικό σας προσωπικό, η Thronos παρέχει τεχνική υποστήριξη & εκπαίδευση.',  note: 'IT support contract — τιμολογείται ξεχωριστά' },
  { code: 'own_self_managed',   name: 'Δικό σας — Αυτόνομο',            description: 'Πλήρης αυτονομία, η Thronos παρέχει μόνο την πλατφόρμα.',                   note: 'Περιλαμβάνεται στο subscription' },
];

const FALLBACK_PLANS: VerifyIDPlan[] = [
  { code: 'starter',      name: 'Starter',      monthly_price_eur: 49,  verifications_per_month: '100',       agents: '1',         highlight: false, features: ['100 verifications/μήνα', '1 call agent', 'Basic widget', 'Email support'] },
  { code: 'professional', name: 'Professional', monthly_price_eur: 199, verifications_per_month: '1.000',     agents: '5',         highlight: true,  features: ['1.000 verifications/μήνα', '5 call agents', 'Branded widget', 'Priority support'] },
  { code: 'enterprise',   name: 'Enterprise',   monthly_price_eur: 499, verifications_per_month: 'Unlimited', agents: 'Unlimited', highlight: false, features: ['Unlimited verifications', 'Unlimited agents', 'White-label widget', 'SLA + dedicated support'] },
];

// ── Main landing ─────────────────────────────────────────────────────────────

export default function Index() {
  const navigate = useNavigate();
  const [wizardOpen, setWizardOpen] = useState(false);

  const features = useMemo(
    () => [
      { icon: <Brain className="h-8 w-8 text-blue-500" />,        title: 'AI Fraud Detection',     description: 'Προηγμένος AI agent για ανίχνευση πλαστών εγγράφων με ακρίβεια 99.97%' },
      { icon: <FileCheck className="h-8 w-8 text-blue-500" />,    title: 'Document Verification',  description: 'Automated scanning and verification of ID documents with AI-powered analysis' },
      { icon: <Video className="h-8 w-8 text-blue-500" />,        title: 'Video Identification',   description: 'Live video call with verification agents for secure identity confirmation' },
      { icon: <PenTool className="h-8 w-8 text-blue-500" />,      title: 'Digital Signature',      description: 'Legally binding electronic signatures for contracts and documents' },
      { icon: <CheckCircle2 className="h-8 w-8 text-blue-500" />, title: 'Age Verification',       description: 'Quick and simple age verification for compliance requirements' },
      { icon: <Lock className="h-8 w-8 text-blue-500" />,         title: 'KYC Compliance',         description: 'Complete Know Your Customer forms with secure data handling' },
    ],
    []
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">

      {/* Nav */}
      <nav className="border-b border-slate-700 bg-slate-900/50 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Shield className="h-8 w-8 text-blue-500" />
            <span className="text-2xl font-bold text-slate-50">VerifyID</span>
          </div>
          <div className="flex gap-4">
            <Button variant="ghost" className="text-slate-300 hover:text-slate-50" onClick={() => navigate('/login')}>
              Login
            </Button>
            <Button className="bg-blue-500 hover:bg-blue-600 text-white" onClick={() => navigate('/register')}>
              Get Started
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="container mx-auto px-6 py-20">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div className="space-y-6">
            <h1 className="text-5xl font-bold text-slate-50 leading-tight">
              Secure Identity + Business Infrastructure
            </h1>
            <p className="text-xl text-slate-400">
              VerifyID προσφέρει έτοιμα πακέτα για εταιρικό email, Web2/Web3 domain και managed hosting μέσα στο οικοσύστημα Thronos.
            </p>
            <div className="flex flex-wrap gap-4">
              <Button size="lg" className="bg-blue-500 hover:bg-blue-600 text-white" onClick={() => navigate('/register')}>
                Start Verification
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-slate-500 text-slate-200 hover:bg-slate-700 hover:border-slate-400 gap-2"
                onClick={() => setWizardOpen(true)}
              >
                <Building2 className="h-5 w-5" />
                Business Packages
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-4 pt-4">
              <div className="rounded-xl border border-slate-700 p-4 bg-slate-900/40">
                <Mail className="h-6 w-6 text-blue-400 mb-2" />
                <p className="text-sm text-slate-300">Corporate Email</p>
              </div>
              <div className="rounded-xl border border-slate-700 p-4 bg-slate-900/40">
                <Globe className="h-6 w-6 text-blue-400 mb-2" />
                <p className="text-sm text-slate-300">Web2 + Web3 Domains</p>
              </div>
              <div className="rounded-xl border border-slate-700 p-4 bg-slate-900/40">
                <Server className="h-6 w-6 text-blue-400 mb-2" />
                <p className="text-sm text-slate-300">Managed Hosting</p>
              </div>
            </div>
          </div>
          <div className="relative">
            <img
              src="https://mgx-backend-cdn.metadl.com/generate/images/808729/2026-01-27/fcac4100-2280-49ca-a20a-8badd7bce8fc.png"
              alt="Identity Verification"
              className="rounded-2xl shadow-2xl"
            />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="container mx-auto px-6 pb-16">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-slate-50 mb-4">Comprehensive Verification Solutions</h2>
          <p className="text-xl text-slate-400">Everything you need for secure identity verification</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <Card key={index} className="bg-slate-800 border-slate-700 hover:border-blue-500 transition-all duration-300">
              <CardHeader>
                <div className="mb-4">{feature.icon}</div>
                <CardTitle className="text-slate-50">{feature.title}</CardTitle>
                <CardDescription className="text-slate-400">{feature.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      {/* CTA banner */}
      <section className="container mx-auto px-6 py-12">
        <Card className="bg-gradient-to-r from-blue-600 to-indigo-700 border-0">
          <CardContent className="flex flex-col md:flex-row items-center justify-between gap-6 py-8 px-6">
            <div>
              <h3 className="text-2xl font-bold text-white">Έτοιμοι να ξεκινήσετε;</h3>
              <p className="text-blue-100 mt-1">
                Επιλέξτε τις υπηρεσίες που χρειάζεστε — document verification, call center, KYC, fraud detection — και διαμορφώστε το πακέτο σας.
              </p>
            </div>
            <Button
              size="lg"
              className="bg-white text-blue-700 hover:bg-blue-50 font-semibold gap-2 flex-shrink-0"
              onClick={() => setWizardOpen(true)}
            >
              <Phone className="h-5 w-5" />
              Επικοινωνήστε μαζί μας
            </Button>
          </CardContent>
        </Card>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-700 bg-slate-900/50 backdrop-blur-sm py-8">
        <div className="container mx-auto px-6 text-center text-slate-400">
          <p>&copy; 2026 VerifyID. All rights reserved. Secure identity verification platform.</p>
        </div>
      </footer>

      {/* Package Wizard Modal */}
      <PackageWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}
