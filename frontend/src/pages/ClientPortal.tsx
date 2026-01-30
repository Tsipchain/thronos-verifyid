import { useEffect, useState } from 'react';
import { createClient } from '@metagptx/web-sdk';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Shield, 
  Upload, 
  FileCheck, 
  Clock, 
  CheckCircle,
  AlertCircle,
  LogOut
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';

const client = createClient();

interface VerificationStatus {
  id: number;
  document_type: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  submitted_date: string;
  completion_percentage: number;
  notes?: string;
}

export default function ClientPortal() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [user, setUser] = useState<{ email: string } | null>(null);
  const [verifications, setVerifications] = useState<VerificationStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
    loadVerifications();
  }, []);

  const checkAuth = async () => {
    try {
      const userData = await client.auth.me();
      setUser(userData.data as { email: string });
    } catch (error) {
      navigate('/login');
    }
  };

  const loadVerifications = async () => {
    try {
      // Mock data - replace with actual API call
      const mockData: VerificationStatus[] = [
        {
          id: 1,
          document_type: 'Passport',
          status: 'completed',
          submitted_date: '2024-01-20',
          completion_percentage: 100,
          notes: 'Verification completed successfully'
        },
        {
          id: 2,
          document_type: 'National ID',
          status: 'in_progress',
          submitted_date: '2024-01-25',
          completion_percentage: 65,
          notes: 'Under review by verification team'
        },
        {
          id: 3,
          document_type: 'Proof of Address',
          status: 'pending',
          submitted_date: '2024-01-27',
          completion_percentage: 20,
          notes: 'Awaiting document upload'
        }
      ];
      setVerifications(mockData);
      setLoading(false);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load verification status',
        variant: 'destructive'
      });
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await client.auth.logout();
      navigate('/login');
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to logout',
        variant: 'destructive'
      });
    }
  };

  const getStatusBadge = (status: string) => {
    const config: Record<string, { variant: 'default' | 'secondary' | 'destructive'; icon: React.ComponentType<{ className?: string }>; label: string; color: string }> = {
      pending: { variant: 'secondary', icon: Clock, label: 'Pending', color: 'text-yellow-600' },
      in_progress: { variant: 'default', icon: FileCheck, label: 'In Progress', color: 'text-blue-600' },
      completed: { variant: 'default', icon: CheckCircle, label: 'Completed', color: 'text-green-600' },
      failed: { variant: 'destructive', icon: AlertCircle, label: 'Failed', color: 'text-red-600' }
    };
    const statusConfig = config[status] || config.pending;
    const Icon = statusConfig.icon;
    return (
      <Badge variant={statusConfig.variant} className="gap-1">
        <Icon className="h-3 w-3" />
        {statusConfig.label}
      </Badge>
    );
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

  const overallProgress = verifications.length > 0
    ? Math.round(verifications.reduce((acc, v) => acc + v.completion_percentage, 0) / verifications.length)
    : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <Shield className="h-8 w-8 text-blue-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Client Portal</h1>
                <p className="text-sm text-gray-600">Track your verification status</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-medium text-gray-900">{user?.email}</p>
                <Badge variant="secondary" className="text-xs mt-1">Client</Badge>
              </div>
              <Button variant="outline" size="sm" onClick={handleLogout}>
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome Section */}
        <Card className="mb-8 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
          <CardHeader>
            <CardTitle className="text-2xl">Welcome to Your Verification Portal</CardTitle>
            <CardDescription className="text-blue-100">
              Track your identity verification progress and upload required documents
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Overall Progress</span>
                <span className="font-bold">{overallProgress}%</span>
              </div>
              <Progress value={overallProgress} className="h-2 bg-blue-400" />
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <Card 
            className="hover:shadow-lg transition-shadow cursor-pointer group"
            onClick={() => navigate('/client/upload')}
          >
            <CardHeader>
              <div className="w-12 h-12 rounded-lg bg-blue-50 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Upload className="h-6 w-6 text-blue-600" />
              </div>
              <CardTitle>Upload Documents</CardTitle>
              <CardDescription>
                Upload passport, ID, or other verification documents
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full">Upload Now →</Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="w-12 h-12 rounded-lg bg-green-50 flex items-center justify-center mb-4">
                <FileCheck className="h-6 w-6 text-green-600" />
              </div>
              <CardTitle>Verification Status</CardTitle>
              <CardDescription>
                View the status of your submitted documents
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Completed:</span>
                  <span className="font-medium">{verifications.filter(v => v.status === 'completed').length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">In Progress:</span>
                  <span className="font-medium">{verifications.filter(v => v.status === 'in_progress').length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Pending:</span>
                  <span className="font-medium">{verifications.filter(v => v.status === 'pending').length}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Verification List */}
        <Card>
          <CardHeader>
            <CardTitle>Your Verifications</CardTitle>
            <CardDescription>Track the progress of each verification request</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {verifications.map((verification) => (
                <div
                  key={verification.id}
                  className="p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-lg">{verification.document_type}</h3>
                      <p className="text-sm text-gray-600">
                        Submitted: {new Date(verification.submitted_date).toLocaleDateString()}
                      </p>
                    </div>
                    {getStatusBadge(verification.status)}
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Progress</span>
                      <span className="font-medium">{verification.completion_percentage}%</span>
                    </div>
                    <Progress value={verification.completion_percentage} className="h-2" />
                  </div>

                  {verification.notes && (
                    <p className="text-sm text-gray-600 mt-3 p-3 bg-blue-50 rounded">
                      <strong>Note:</strong> {verification.notes}
                    </p>
                  )}

                  {verification.status === 'pending' && (
                    <Button 
                      className="w-full mt-3"
                      onClick={() => navigate('/client/upload')}
                    >
                      Upload Documents
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Help Section */}
        <Card className="mt-8 bg-gray-50">
          <CardHeader>
            <CardTitle className="text-lg">Need Help?</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm text-gray-600">
              <p>• <strong>Accepted Documents:</strong> Passport, National ID, Driver's License, Proof of Address</p>
              <p>• <strong>File Formats:</strong> JPG, PNG, PDF (max 10MB per file)</p>
              <p>• <strong>Processing Time:</strong> Most verifications complete within 24-48 hours</p>
              <p>• <strong>Support:</strong> Contact support@company.com for assistance</p>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}