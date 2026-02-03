import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { rbac } from '@/lib/rbac';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Settings } from 'lucide-react';

export default function SettingsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkPermissions = async () => {
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
      setLoading(false);
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
            <p className="text-sm text-gray-600">
              Settings configuration will appear here once the backend endpoints are connected.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
