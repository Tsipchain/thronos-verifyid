import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Coins,
  ArrowLeft,
  Loader2,
  CheckCircle,
  CreditCard,
  Bitcoin,
  ShieldCheck,
  Zap,
  Copy,
  Clock,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// ── Types ──────────────────────────────────────────────────────────────────

interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  price_eur: number;
  description: string;
}

interface BillingPlan {
  id: string;
  name: string;
  description: string;
  credits: number;
  price_eur: number;
  price_sats: number;
}

interface CreditBalance {
  balance: number;
  total_purchased: number;
  total_used: number;
  ai_request_cost: number;
}

interface CreditTransaction {
  id: number;
  amount: number;
  type: string;
  description: string;
  created_at: string;
}

interface SubscriptionStatus {
  org_id: string;
  plan?: string;
  plan_status?: string;
  current_period_end?: string;
  last_payment_source?: string;
}

interface BtcCheckoutResponse {
  intent_id: string;
  btc_address: string;
  sats_expected: number;
  price_eur: number;
  plan: string;
  credits: number;
  confirmations_required: number;
  expires_in_hours: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function satsToDisplay(sats: number): string {
  if (sats >= 100_000_000) return `${(sats / 100_000_000).toFixed(4)} BTC`;
  return `${(sats / 100_000).toFixed(0)} k sat`;
}

function planStatusBadge(status: string, source?: string) {
  if (status === 'active' && source === 'btc')
    return <Badge className="text-xs bg-orange-100 text-orange-700 border-orange-300">Settled (BTC)</Badge>;
  if (status === 'active')
    return <Badge className="text-xs bg-green-100 text-green-700 border-green-300">Paid (fiat)</Badge>;
  if (status === 'pending_settlement')
    return <Badge className="text-xs bg-yellow-100 text-yellow-700 border-yellow-300">Pending settlement</Badge>;
  if (status === 'trialing')
    return <Badge className="text-xs bg-blue-100 text-blue-700 border-blue-300">Trial</Badge>;
  if (status === 'past_due')
    return <Badge variant="destructive" className="text-xs">Past due</Badge>;
  return <Badge variant="secondary" className="text-xs">{status}</Badge>;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function Credits() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [btcPending, setBtcPending] = useState<BtcCheckoutResponse | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchData();
    if (searchParams.get('success')) {
      toast({ title: 'Payment successful!', description: 'Your credits have been added.' });
    }
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [pkgRes, planRes, balRes, txRes, subRes] = await Promise.allSettled([
        apiClient.get<CreditPackage[]>('/api/v1/credits/packages'),
        apiClient.get<BillingPlan[]>('/api/v1/billing/plans'),
        apiClient.get<CreditBalance>('/api/v1/credits/balance'),
        apiClient.get<CreditTransaction[]>('/api/v1/credits/transactions?limit=10'),
        apiClient.get<SubscriptionStatus>('/api/v1/billing/status'),
      ]);
      if (pkgRes.status === 'fulfilled') setPackages(pkgRes.value.data);
      if (planRes.status === 'fulfilled') setPlans(planRes.value.data);
      if (balRes.status === 'fulfilled') setBalance(balRes.value.data);
      if (txRes.status === 'fulfilled') setTransactions(txRes.value.data);
      if (subRes.status === 'fulfilled') setSubscription(subRes.value.data);
    } catch {
      toast({ title: 'Error', description: 'Failed to load credits data', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // ── Fiat purchase (credits pack) ──────────────────────────────────────────
  const handleCreditPackPurchase = async (pkg: CreditPackage) => {
    setPurchasing(`credits-${pkg.id}`);
    try {
      const successUrl = `${window.location.origin}/credits?success=1`;
      const cancelUrl = `${window.location.origin}/credits?cancelled=1`;
      const res = await apiClient.post<{ checkout_url: string }>('/api/v1/credits/purchase', {
        package_id: pkg.id,
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      window.location.href = res.data.checkout_url;
    } catch (error) {
      const detail = (error as { data?: { detail?: string } })?.data?.detail || 'Purchase failed';
      toast({ title: 'Error', description: detail, variant: 'destructive' });
    } finally {
      setPurchasing(null);
    }
  };

  // ── Fiat purchase (billing plan) ──────────────────────────────────────────
  const handlePlanFiat = async (plan: BillingPlan) => {
    setPurchasing(`plan-fiat-${plan.id}`);
    try {
      const successUrl = `${window.location.origin}/credits?success=1`;
      const cancelUrl = `${window.location.origin}/credits?cancelled=1`;
      const res = await apiClient.post<{ checkout_url: string }>('/api/v1/billing/checkout/fiat', {
        plan_id: plan.id,
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      window.location.href = res.data.checkout_url;
    } catch (error) {
      const detail = (error as { data?: { detail?: string } })?.data?.detail || 'Purchase failed';
      toast({ title: 'Error', description: detail, variant: 'destructive' });
    } finally {
      setPurchasing(null);
    }
  };

  // ── BTC purchase (billing plan) ───────────────────────────────────────────
  const handlePlanBtc = async (plan: BillingPlan) => {
    setPurchasing(`plan-btc-${plan.id}`);
    try {
      const res = await apiClient.post<BtcCheckoutResponse>('/api/v1/billing/checkout/btc', {
        plan_id: plan.id,
      });
      setBtcPending(res.data);
    } catch (error) {
      const detail = (error as { data?: { detail?: string } })?.data?.detail || 'Failed to generate BTC address';
      toast({ title: 'Error', description: detail, variant: 'destructive' });
    } finally {
      setPurchasing(null);
    }
  };

  const copyAddress = () => {
    if (!btcPending) return;
    navigator.clipboard.writeText(btcPending.btc_address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: 'Copied!', description: 'BTC address copied to clipboard.' });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 dark:from-gray-900 dark:to-blue-900 p-6">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Coins className="h-6 w-6 text-yellow-500" /> Credits & Plans
            </h1>
            <p className="text-sm text-gray-500">Purchase credits or a subscription plan</p>
          </div>
        </div>

        {/* Subscription status banner */}
        {subscription?.plan && (
          <div className="mb-6 flex items-center gap-3 rounded-lg border p-4 bg-white dark:bg-gray-800 dark:border-gray-700">
            <ShieldCheck className="h-5 w-5 text-blue-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-white capitalize">
                {subscription.plan} Plan
              </p>
              {subscription.current_period_end && (
                <p className="text-xs text-gray-400">
                  Renews {new Date(subscription.current_period_end).toLocaleDateString()}
                </p>
              )}
            </div>
            {planStatusBadge(subscription.plan_status || '', subscription.last_payment_source)}
          </div>
        )}

        {/* Current Balance */}
        {balance && (
          <Card className="mb-8 dark:bg-gray-800 dark:border-gray-700">
            <CardContent className="pt-6">
              <div className="grid grid-cols-3 gap-6 text-center">
                <div>
                  <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{balance.balance.toLocaleString()}</p>
                  <p className="text-sm text-gray-500 mt-1">Available Credits</p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-green-600 dark:text-green-400">{balance.total_purchased.toLocaleString()}</p>
                  <p className="text-sm text-gray-500 mt-1">Total Purchased</p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">{balance.total_used.toLocaleString()}</p>
                  <p className="text-sm text-gray-500 mt-1">Total Used</p>
                </div>
              </div>
              <p className="text-center text-xs text-gray-400 mt-4">
                Each AI assistant message costs {balance.ai_request_cost} credits
              </p>
            </CardContent>
          </Card>
        )}

        {/* BTC Payment Pending */}
        {btcPending && (
          <Card className="mb-8 border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Bitcoin className="h-4 w-4 text-orange-500" />
                Send BTC to activate your {btcPending.plan} plan
              </CardTitle>
              <CardDescription>
                Waiting for payment — expires in {btcPending.expires_in_hours}h
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 rounded-lg bg-white dark:bg-gray-900 border p-3 font-mono text-sm break-all">
                <span className="flex-1">{btcPending.btc_address}</span>
                <Button variant="ghost" size="sm" onClick={copyAddress} className="shrink-0">
                  {copied ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Amount to send</span>
                <span className="font-semibold">{satsToDisplay(btcPending.sats_expected)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Confirmations needed</span>
                <span className="font-semibold flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" /> {btcPending.confirmations_required}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Credits on settlement</span>
                <span className="font-semibold text-green-600">+{btcPending.credits.toLocaleString()}</span>
              </div>
              <Button variant="outline" size="sm" className="w-full" onClick={() => setBtcPending(null)}>
                Cancel / choose different plan
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Tabs: Plans vs Credit Packs */}
        <Tabs defaultValue="plans">
          <TabsList className="mb-6">
            <TabsTrigger value="plans" className="gap-2">
              <Zap className="h-4 w-4" /> Subscription Plans
            </TabsTrigger>
            <TabsTrigger value="packs" className="gap-2">
              <Coins className="h-4 w-4" /> AI Credit Packs
            </TabsTrigger>
          </TabsList>

          {/* ── Subscription Plans ──────────────────────────────────────────── */}
          <TabsContent value="plans">
            <p className="text-sm text-muted-foreground mb-4">
              Plans include large credit bundles for the full VerifyID platform. Pay with card or Bitcoin.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {plans.map((plan) => (
                <Card
                  key={plan.id}
                  className={`dark:bg-gray-800 dark:border-gray-700 hover:shadow-lg transition-shadow flex flex-col ${
                    plan.id === 'pro' ? 'ring-2 ring-blue-500' : ''
                  }`}
                >
                  <CardHeader className="pb-2">
                    {plan.id === 'pro' && (
                      <Badge className="w-fit mb-1 text-xs">Most Popular</Badge>
                    )}
                    <CardTitle className="text-base dark:text-white">{plan.name}</CardTitle>
                    <CardDescription className="text-xs">{plan.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col flex-1">
                    <div className="mb-3">
                      <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                        {plan.credits.toLocaleString()}
                      </span>
                      <span className="text-xs text-gray-500 ml-1">credits</span>
                    </div>
                    <div className="text-xs text-gray-400 mb-4 flex items-center gap-1">
                      <CheckCircle className="h-3 w-3 text-green-500" />
                      ~{Math.floor(plan.credits / 10).toLocaleString()} AI messages
                    </div>

                    {/* Fiat price + button */}
                    <div className="mt-auto space-y-2">
                      <Button
                        className="w-full"
                        onClick={() => handlePlanFiat(plan)}
                        disabled={!!purchasing}
                      >
                        {purchasing === `plan-fiat-${plan.id}` ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <CreditCard className="h-3.5 w-3.5 mr-1.5" />
                            €{plan.price_eur.toFixed(0)} Card / Bank
                          </>
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full border-orange-300 text-orange-600 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-400 dark:hover:bg-orange-950/20"
                        onClick={() => handlePlanBtc(plan)}
                        disabled={!!purchasing}
                      >
                        {purchasing === `plan-btc-${plan.id}` ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Bitcoin className="h-3.5 w-3.5 mr-1.5" />
                            {satsToDisplay(plan.price_sats)} BTC
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className="text-xs text-muted-foreground text-center">
              10% platform fee applies to all purchases. 90% goes to the Thronos Chain pool.
            </p>
          </TabsContent>

          {/* ── AI Credit Packs ─────────────────────────────────────────────── */}
          <TabsContent value="packs">
            <p className="text-sm text-muted-foreground mb-4">
              Smaller top-up packs for occasional AI assistant usage. Card only.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
              {packages.map((pkg) => (
                <Card
                  key={pkg.id}
                  className={`dark:bg-gray-800 dark:border-gray-700 hover:shadow-lg transition-shadow ${
                    pkg.id === 'pro' ? 'ring-2 ring-blue-500' : ''
                  }`}
                >
                  <CardHeader className="pb-2">
                    {pkg.id === 'pro' && (
                      <Badge className="w-fit mb-1 text-xs">Most Popular</Badge>
                    )}
                    <CardTitle className="text-lg dark:text-white">{pkg.name}</CardTitle>
                    <CardDescription className="text-xs">{pkg.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-3">
                      <span className="text-3xl font-bold text-blue-600 dark:text-blue-400">{pkg.credits}</span>
                      <span className="text-sm text-gray-500 ml-1">credits</span>
                    </div>
                    <div className="mb-4">
                      <span className="text-xl font-semibold text-gray-900 dark:text-white">
                        €{pkg.price_eur.toFixed(2)}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mb-3 flex items-center gap-1">
                      <CheckCircle className="h-3 w-3 text-green-500" />
                      ~{pkg.credits / 10} AI messages
                    </div>
                    <Button
                      className="w-full"
                      onClick={() => handleCreditPackPurchase(pkg)}
                      disabled={purchasing === `credits-${pkg.id}`}
                    >
                      {purchasing === `credits-${pkg.id}` ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <CreditCard className="h-3.5 w-3.5 mr-1.5" />
                          Buy with Card
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>

        {/* Transaction History */}
        {transactions.length > 0 && (
          <>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 mt-6">
              Recent Transactions
            </h2>
            <Card className="dark:bg-gray-800 dark:border-gray-700">
              <CardContent className="pt-4">
                <div className="space-y-2">
                  {transactions.map((tx) => (
                    <div
                      key={tx.id}
                      className="flex items-center justify-between py-2 border-b dark:border-gray-700 last:border-0"
                    >
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{tx.description}</p>
                        <p className="text-xs text-gray-400">{new Date(tx.created_at).toLocaleString()}</p>
                      </div>
                      <Badge variant={tx.amount > 0 ? 'default' : 'secondary'} className="text-xs">
                        {tx.amount > 0 ? '+' : ''}{tx.amount}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
