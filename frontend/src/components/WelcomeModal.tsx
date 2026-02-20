/**
 * WelcomeModal — shown once to new users after first login.
 *
 * Explains what Thronos VerifyID is, how credits work, and how to pay.
 * Persists dismissal in localStorage so it only shows once per device.
 */

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ShieldCheck,
  Bot,
  Zap,
  Bitcoin,
  CreditCard,
  Link,
  Eye,
  Users,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';

const STORAGE_KEY = 'thronos_welcome_seen_v1';

interface FeatureItem {
  icon: React.ReactNode;
  title: string;
  description: string;
}

const FEATURES: FeatureItem[] = [
  {
    icon: <ShieldCheck className="h-5 w-5 text-blue-500" />,
    title: 'KYC & Identity Verification',
    description:
      'Upload passports, IDs, and residence permits. Our platform extracts, validates, and cross-checks data automatically.',
  },
  {
    icon: <Bot className="h-5 w-5 text-purple-500" />,
    title: 'AI-Powered Fraud Detection',
    description:
      'Built-in AI assistant analyses documents for MRZ mismatches, font inconsistencies, metadata anomalies, and deepfakes.',
  },
  {
    icon: <Eye className="h-5 w-5 text-emerald-500" />,
    title: 'Liveness & Biometrics',
    description:
      'Video call verification with real-time liveness checks. Agents can conduct live interviews and flag risk in seconds.',
  },
  {
    icon: <Link className="h-5 w-5 text-orange-500" />,
    title: 'Blockchain-Anchored Records',
    description:
      'Every verification is sealed on the Thronos Chain — tamper-proof, time-stamped, and auditable by any party.',
  },
  {
    icon: <Users className="h-5 w-5 text-sky-500" />,
    title: 'Team Collaboration',
    description:
      'Role-based access (Admin, Manager, Agent), real-time chat, task queues, and performance dashboards for your team.',
  },
  {
    icon: <Zap className="h-5 w-5 text-yellow-500" />,
    title: 'Multi-Service Gateway',
    description:
      'VerifyID is part of the Thronos ecosystem — the same credit and payment infrastructure powers Driver Intelligent and other services.',
  },
];

export function WelcomeModal() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'intro' | 'credits' | 'payments'>('intro');

  useEffect(() => {
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen) setOpen(true);
  }, []);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dismiss(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="bg-blue-600 text-white rounded-lg p-2">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <DialogTitle className="text-xl">Welcome to Thronos VerifyID</DialogTitle>
              <p className="text-sm text-muted-foreground">Identity verification for the modern web</p>
            </div>
            <Badge variant="secondary" className="ml-auto text-xs">v1.0</Badge>
          </div>
        </DialogHeader>

        {/* ── Step: Intro ─────────────────────────────────────────────────── */}
        {step === 'intro' && (
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground leading-relaxed">
              <strong className="text-foreground">Thronos VerifyID</strong> is a complete Know Your Customer (KYC)
              platform built for businesses that need to verify identities quickly, securely, and with full audit
              trails. From fintech onboarding to driver registration, VerifyID handles the entire verification
              lifecycle — document upload, AI analysis, agent review, and blockchain anchoring.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {FEATURES.map((f) => (
                <div key={f.title} className="flex gap-3 p-3 rounded-lg border bg-muted/30">
                  <div className="shrink-0 mt-0.5">{f.icon}</div>
                  <div>
                    <p className="text-sm font-medium">{f.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{f.description}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={dismiss}>
                Skip intro
              </Button>
              <Button onClick={() => setStep('credits')}>
                How credits work <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step: Credits ────────────────────────────────────────────────── */}
        {step === 'credits' && (
          <div className="space-y-5">
            <div className="rounded-lg border p-4 bg-blue-50 dark:bg-blue-950/30">
              <h3 className="font-semibold text-sm mb-1 flex items-center gap-2">
                <Zap className="h-4 w-4 text-yellow-500" /> How credits work
              </h3>
              <p className="text-sm text-muted-foreground">
                Credits are the internal currency of the Thronos ecosystem. Every AI assistant message,
                fraud analysis, and automated check consumes credits. You get{' '}
                <strong className="text-foreground">50 free credits</strong> when you join.
              </p>
            </div>

            <div className="space-y-2 text-sm">
              {[
                ['AI Assistant message', '10 credits'],
                ['Document fraud analysis', '25 credits'],
                ['Automated OCR extraction', '5 credits'],
                ['Blockchain anchor', '2 credits'],
              ].map(([action, cost]) => (
                <div key={action} className="flex justify-between items-center py-2 border-b last:border-0">
                  <span className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    {action}
                  </span>
                  <Badge variant="outline" className="text-xs font-mono">{cost}</Badge>
                </div>
              ))}
            </div>

            <div className="rounded-lg border p-4 bg-muted/30 text-sm text-muted-foreground">
              <strong className="text-foreground">Thronos Pool:</strong> A portion of every credit purchase
              flows into the Thronos Chain pool — a shared liquidity layer that powers all Thronos services,
              keeps fees low, and funds the infrastructure.
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep('intro')}>
                Back
              </Button>
              <Button onClick={() => setStep('payments')}>
                Payment options <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step: Payments ───────────────────────────────────────────────── */}
        {step === 'payments' && (
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Credits can be purchased with <strong className="text-foreground">fiat (card / bank)</strong> or{' '}
              <strong className="text-foreground">Bitcoin</strong>. Choose whichever works best for your
              organisation.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-lg border p-4 space-y-2">
                <div className="flex items-center gap-2 font-medium text-sm">
                  <CreditCard className="h-4 w-4 text-blue-500" /> Card / Bank (Fiat)
                </div>
                <p className="text-xs text-muted-foreground">
                  Processed via Stripe. Instant access granted on payment.
                  Supports all major cards, SEPA, and Apple/Google Pay.
                </p>
                <Badge className="text-xs bg-green-100 text-green-700 hover:bg-green-100">
                  Instant access
                </Badge>
              </div>

              <div className="rounded-lg border p-4 space-y-2">
                <div className="flex items-center gap-2 font-medium text-sm">
                  <Bitcoin className="h-4 w-4 text-orange-500" /> Bitcoin (BTC)
                </div>
                <p className="text-xs text-muted-foreground">
                  Send BTC to your unique address. Access activates after
                  3 on-chain confirmations (~30 min). No KYC on the BTC rail.
                </p>
                <Badge className="text-xs bg-orange-100 text-orange-700 hover:bg-orange-100">
                  ~30 min settlement
                </Badge>
              </div>
            </div>

            <div className="rounded-lg border p-4 bg-muted/30 text-xs text-muted-foreground space-y-1">
              <p>
                <strong className="text-foreground">Fee transparency:</strong> 10% platform fee on every
                purchase. The remaining 90% is contributed to the Thronos Chain pool and tracked on-chain.
              </p>
              <p>
                You can view the fee split in your transaction history at any time.
              </p>
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep('credits')}>
                Back
              </Button>
              <Button onClick={dismiss}>
                Get started <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Step indicator */}
        <div className="flex justify-center gap-1.5 pt-1">
          {(['intro', 'credits', 'payments'] as const).map((s) => (
            <div
              key={s}
              className={`h-1.5 rounded-full transition-all ${
                step === s ? 'w-6 bg-blue-500' : 'w-1.5 bg-muted-foreground/30'
              }`}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
