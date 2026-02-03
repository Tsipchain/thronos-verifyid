import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/lib/api';
import { rbac } from '@/lib/rbac';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Settings } from 'lucide-react';

interface EnvVariable {
  key: string;
  value: string;
  description: string;
}

interface EnvConfigResponse {
  backend_vars: Record<string, EnvVariable>;
  frontend_vars: Record<string, EnvVariable>;
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<EnvConfigResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkPermissions = async () => {
      try {
        await rbac.initialize();
        if (!rbac.canAccessSettings()) {
          toast({
            title: 'Access Denied',
            description: 'You do not have permission to access settings',
            variant: 'destructive'
          });
          navigate('/admin');
          return;
        }

        const response = await apiClient.get<EnvConfigResponse>('/api/v1/admin/settings');
        setSettings(response.data);
      } catch (err) {
        console.error('Failed to load settings', err);
        setError('Failed to load settings.');
      } finally {
        setLoading(false);
      }
    };

    checkPermissions();
  }, [navigate, toast]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/admin')}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <Settings className="h-6 w-6 text-gray-600" />
            <h1 className="text-xl font-bold">Settings</h1>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <Card>
          <CardHeader>
            <CardTitle>System Settings</CardTitle>
          </CardHeader>
          <CardContent>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {!error && !settings && <p className="text-sm text-gray-600">No settings found.</p>}
            {settings && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-sm font-semibold text-gray-700">Backend</h2>
                  <div className="mt-2 space-y-2">
                    {Object.values(settings.backend_vars).map((item) => (
                      <div key={item.key} className="rounded-lg border border-gray-200 p-3">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-gray-900">{item.key}</span>
                          <span className="text-xs text-gray-500">{item.description}</span>
                        </div>
                        <p className="mt-1 text-xs text-gray-600 break-all">{item.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-700">Frontend</h2>
                  <div className="mt-2 space-y-2">
                    {Object.values(settings.frontend_vars).map((item) => (
                      <div key={item.key} className="rounded-lg border border-gray-200 p-3">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-gray-900">{item.key}</span>
                          <span className="text-xs text-gray-500">{item.description}</span>
                        </div>
                        <p className="mt-1 text-xs text-gray-600 break-all">{item.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
