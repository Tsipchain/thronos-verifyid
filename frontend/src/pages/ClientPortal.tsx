import { useEffect, useState } from 'react';
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
import { authApi } from '@/lib/auth';
import { apiClient } from '@/lib/api';

interface VerificationStatus {
  id: number;
  document_type: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  submitted_date: string;
  completion_percentage: number;
  notes?: string;
}

interface VerificationStatusResponse {
  user_id: string;
  overall_progress: number;
  document_verification?: {
    id: number;
    document_type: string;
    verification_status: string;
    created_at: string;
  };
  age_verification?: {
    id: number;
    is_verified: boolean;
    created_at: string;
  };
  kyc_form?: {
    id: number;
    status: string;
    created_at: string;
  };
  video_verification?: {
    id: number;
    verification_status: string;
    created_at: string;
  };
  digital_signature?: {
    id: number;
    created_at: string;
  };
  fraud_analysis?: {
    id: number;
    risk_level: string;
    created_at: string;
  };
}

export default function ClientPortal() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [user, setUser] = useState<{ email: string; role?: string } | null>(null);
  const [verifications, setVerifications] = useState<VerificationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [overallProgress, setOverallProgress] = useState(0);

  useEffect(() => {
    checkAuth();
    loadVerifications();
  }, []);

  const checkAuth = async () => {
    try {
      const userData = await authApi.getCurrentUser();
      if (!userData) {
        navigate('/login');
        return;
      }
      setUser(userData as { email: string; role?: string });
    } catch (error) {
      navigate('/login');
    }
  };

  const mapStatus = (status?: string): VerificationStatus['status'] => {
    if (!status) return 'pending';
    const normalized = status.toLowerCase();
    if (['completed', 'complete', 'verified', 'approved', 'success'].some((value) => normalized.includes(value))) {
      return 'completed';
    }
    if (['failed', 'rejected', 'deny', 'error'].some((value) => normalized.includes(value))) {
      return 'failed';
    }
    if (['in_progress', 'processing', 'review', 'in progress'].some((value) => normalized.includes(value))) {
      return 'in_progress';
    }
    if (['pending', 'submitted', 'queued'].some((value) => normalized.includes(value))) {
      return 'pending';
    }
    return 'pending';
  };

  const statusToProgress = (status: VerificationStatus['status']) => {
    switch (status) {
      case 'completed':
        return 100;
      case 'in_progress':
        return 60;
      case 'failed':
        return 0;
      default:
        return 20;
    }
  };

  const buildVerificationList = (status: VerificationStatusResponse): VerificationStatus[] => {
    const items: VerificationStatus[] = [];

    if (status.document_verification) {
      const state = mapStatus(status.document_verification.verification_status);
      items.push({
        id: status.document_verification.id,
        document_type: status.document_verification.document_type || 'Document Verification',
        status: state,
        submitted_date: status.document_verification.created_at,
        completion_percentage: statusToProgress(state),
      });
    }

    if (status.age_verification) {
      const state = status.age_verification.is_verified ? 'completed' : 'pending';
      items.push({
        id: status.age_verification.id,
        document_type: 'Age Verification',
        status: state,
        submitted_date: status.age_verification.created_at,
        completion_percentage: statusToProgress(state),
      });
    }

    if (status.kyc_form) {
      const state = mapStatus(status.kyc_form.status);
      items.push({
        id: status.kyc_form.id,
        document_type: 'KYC Form',
        status: state,
        submitted_date: status.kyc_form.created_at,
        completion_percentage: statusToProgress(state),
      });
    }

    if (status.video_verification) {
      const state = mapStatus(status.video_verification.verification_status);
      items.push({
        id: status.video_verification.id,
        document_type: 'Video Verification',
        status: state,
        submitted_date: status.video_verification.created_at,
        completion_percentage: statusToProgress(state),
      });
    }

    if (status.digital_signature) {
      items.push({
        id: status.digital_signature.id,
        document_type: 'Digital Signature',
        status: 'completed',
        submitted_date: status.digital_signature.created_at,
        completion_percentage: statusToProgress('completed'),
      });
    }

    if (status.fraud_analysis) {
      const state = mapStatus(status.fraud_analysis.risk_level);
      items.push({
        id: status.fraud_analysis.id,
        document_type: 'Fraud Analysis',
        status: state,
        submitted_date: status.fraud_analysis.created_at,
        completion_percentage: statusToProgress(state),
      });
    }

    return items;
  };

  const loadVerifications = async () => {
    try {
      const response = await apiClient.get('/api/v1/verifications/status');
      const statusData = response.data as VerificationStatusResponse;

      setVerifications(buildVerificationList(statusData));
      setOverallProgress(statusData?.overall_progress ?? 0);
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
      await authApi.logout();
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
                <Badge variant="secondary" className="text-xs mt-1">
                  {user?.role ?? 'client'}
                </Badge>
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
