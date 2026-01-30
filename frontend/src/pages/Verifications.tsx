import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createClient } from '@metagptx/web-sdk';
import { rbac } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, FileCheck, Clock, CheckCircle, XCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const client = createClient();

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

export default function Verifications() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkPermissions();
  }, []);

  const checkPermissions = async () => {
    await rbac.initialize();
    if (!rbac.canAccessVerifications()) {
      toast({
        title: 'Access Denied',
        description: 'You do not have permission to access verifications',
        variant: 'destructive'
      });
      navigate('/dashboard');
    }
    setLoading(false);
  };

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

  const mockVerifications = [
    { id: 1, name: 'John Doe', type: 'Passport', status: 'pending', date: '2024-01-27' },
    { id: 2, name: 'Jane Smith', type: 'National ID', status: 'completed', date: '2024-01-26' },
    { id: 3, name: 'Bob Johnson', type: 'Driver License', status: 'in_progress', date: '2024-01-27' },
  ];

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: BadgeVariant; icon: React.ComponentType<{ className?: string }>; label: string }> = {
      pending: { variant: 'secondary', icon: Clock, label: 'Pending' },
      in_progress: { variant: 'default', icon: FileCheck, label: 'In Progress' },
      completed: { variant: 'default', icon: CheckCircle, label: 'Completed' },
      failed: { variant: 'destructive', icon: XCircle, label: 'Failed' }
    };
    const config = variants[status] || variants.pending;
    const Icon = config.icon;
    return (
      <Badge variant={config.variant} className="gap-1">
        <Icon className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <FileCheck className="h-6 w-6 text-blue-600" />
            <h1 className="text-xl font-bold">Identity Verifications</h1>
          </div>
          {rbac.canCreateVerifications() && (
            <Button>New Verification</Button>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid gap-4">
          {mockVerifications.map((verification) => (
            <Card key={verification.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{verification.name}</CardTitle>
                  {getStatusBadge(verification.status)}
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm text-gray-600">Document Type: <span className="font-medium">{verification.type}</span></p>
                    <p className="text-sm text-gray-600">Submitted: <span className="font-medium">{verification.date}</span></p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm">View Details</Button>
                    {rbac.canUpdateVerifications() && (
                      <Button size="sm">Process</Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}