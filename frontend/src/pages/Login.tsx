import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { authApi } from '@/lib/auth';

export default function Login() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await authApi.login(email, password);
      const user = await authApi.getCurrentUser();
      if (!user) {
        navigate('/login');
        return;
      }

      if (user.role === 'admin' || user.role === 'manager') {
        navigate('/admin');
      } else if (user.role === 'agent') {
        navigate('/agent');
      } else {
        navigate('/client');
      }
    } catch (error) {
      const detail = (error as { data?: { detail?: string }; response?: { data?: { detail?: string } }; message?: string })?.data?.detail 
        || (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail 
        || (error as { message?: string })?.message 
        || 'Invalid credentials';
      toast({
        title: 'Login Failed',
        description: detail,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center">
            <Shield className="h-8 w-8 text-white" />
          </div>
          <div>
            <CardTitle className="text-2xl">Identity Verification Platform</CardTitle>
            <CardDescription className="mt-2">
              Sign in to access the verification system
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="your.email@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>

          <div className="mt-6 p-4 bg-blue-50 rounded-lg text-center">
            <p className="text-sm text-gray-600 font-medium mb-2">Enterprise Solution</p>
            <p className="text-xs text-gray-500 mb-3">
              Interested in our identity verification platform for your business?
            </p>
            <a
              href="mailto:contact@thonos.com?subject=B2B%20Inquiry%20-%20VerifyID%20Platform"
              className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-blue-600 bg-white border border-blue-300 rounded-md hover:bg-blue-50 transition-colors"
            >
              Contact Sales
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
