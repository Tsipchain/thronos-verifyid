import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Coins, ArrowLeft, Loader2, CheckCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  price_eur: number;
  description: string;
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

export default function Credits() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [pkgRes, balRes, txRes] = await Promise.all([
        apiClient.get<CreditPackage[]>('/api/v1/credits/packages'),
        apiClient.get<CreditBalance>('/api/v1/credits/balance'),
        apiClient.get<CreditTransaction[]>('/api/v1/credits/transactions?limit=10'),
      ]);
      setPackages(pkgRes.data);
      setBalance(balRes.data);
      setTransactions(txRes.data);
    } catch {
      toast({ title: 'Error', description: 'Failed to load credits data', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handlePurchase = async (pkg: CreditPackage) => {
    setPurchasing(pkg.id);
    try {
      const successUrl = `${window.location.origin}/credits?success=1&session={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${window.location.origin}/credits?cancelled=1`;
      const res = await apiClient.post<{ checkout_url: string }>('/api/v1/credits/purchase', {
        package_id: pkg.id,
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      // Redirect to Stripe checkout
      window.location.href = res.data.checkout_url;
    } catch (error) {
      const detail = (error as { data?: { detail?: string } })?.data?.detail || 'Purchase failed';
      toast({ title: 'Error', description: detail, variant: 'destructive' });
    } finally {
      setPurchasing(null);
    }
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
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Coins className="h-6 w-6 text-yellow-500" /> AI Credits
            </h1>
            <p className="text-sm text-gray-500">Purchase credits to use the Thronos AI Assistant</p>
          </div>
        </div>

        {/* Current Balance */}
        {balance && (
          <Card className="mb-8 dark:bg-gray-800 dark:border-gray-700">
            <CardContent className="pt-6">
              <div className="grid grid-cols-3 gap-6 text-center">
                <div>
                  <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{balance.balance}</p>
                  <p className="text-sm text-gray-500 mt-1">Available Credits</p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-green-600 dark:text-green-400">{balance.total_purchased}</p>
                  <p className="text-sm text-gray-500 mt-1">Total Purchased</p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">{balance.total_used}</p>
                  <p className="text-sm text-gray-500 mt-1">Total Used</p>
                </div>
              </div>
              <p className="text-center text-xs text-gray-400 mt-4">
                Each AI assistant message costs {balance.ai_request_cost} credits
              </p>
            </CardContent>
          </Card>
        )}

        {/* Packages */}
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Credit Packages</h2>
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
                <div className="mb-4">
                  <span className="text-3xl font-bold text-blue-600 dark:text-blue-400">{pkg.credits}</span>
                  <span className="text-sm text-gray-500 ml-1">credits</span>
                </div>
                <div className="mb-4">
                  <span className="text-xl font-semibold text-gray-900 dark:text-white">€{pkg.price_eur.toFixed(2)}</span>
                </div>
                <div className="text-xs text-gray-400 mb-3 flex items-center gap-1">
                  <CheckCircle className="h-3 w-3 text-green-500" />
                  ~{pkg.credits / 10} AI messages
                </div>
                <Button
                  className="w-full"
                  onClick={() => handlePurchase(pkg)}
                  disabled={purchasing === pkg.id}
                >
                  {purchasing === pkg.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    'Buy Now'
                  )}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Transaction History */}
        {transactions.length > 0 && (
          <>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Recent Transactions</h2>
            <Card className="dark:bg-gray-800 dark:border-gray-700">
              <CardContent className="pt-4">
                <div className="space-y-2">
                  {transactions.map((tx) => (
                    <div key={tx.id} className="flex items-center justify-between py-2 border-b dark:border-gray-700 last:border-0">
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
