import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient } from '@/lib/api';
import { getAPIBaseURL } from '@/lib/config';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  Upload,
  FileText,
  Video,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
  Shield,
  User,
  Calendar,
} from 'lucide-react';

interface VerificationStatus {
  verification_id: number;
  status: 'pending' | 'ai_review' | 'in_queue' | 'in_call' | 'approved' | 'completed' | 'rejected';
  ai_score?: number;
  risk_level?: string;
  agent_name?: string;
  estimated_wait_minutes?: number;
  blockchain_tx_hash?: string;
}

const VERIFICATION_STEPS = [
  { key: 'pending', label: 'Upload Documents', icon: Upload },
  { key: 'ai_review', label: 'AI Analysis', icon: Shield },
  { key: 'in_queue', label: 'Waiting for Agent', icon: Clock },
  { key: 'in_call', label: 'Video Verification', icon: Video },
  { key: 'completed', label: 'Verified', icon: CheckCircle2 },
];

export default function ClientVerification() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  
  const [step, setStep] = useState<'upload' | 'tracking'>('upload');
  const [verificationId, setVerificationId] = useState<number | null>(null);
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [uploading, setUploading] = useState(false);
  
  // Form data
  const [formData, setFormData] = useState({
    document_type: 'passport',
    full_name: '',
    document_number: '',
    date_of_birth: '',
    nationality: '',
    front_image: '',
    back_image: '',
  });
  
  const [frontPreview, setFrontPreview] = useState<string | null>(null);
  const [backPreview, setBackPreview] = useState<string | null>(null);

  useEffect(() => {
    // Check if resuming existing verification
    const vid = searchParams.get('vid');
    if (vid) {
      setVerificationId(parseInt(vid));
      setStep('tracking');
      loadVerificationStatus(parseInt(vid));
    }
  }, [searchParams]);

  useEffect(() => {
    if (verificationId && step === 'tracking') {
      connectWebSocket(verificationId);
      const interval = setInterval(() => loadVerificationStatus(verificationId), 10000);
      return () => clearInterval(interval);
    }
  }, [verificationId, step]);

  const loadVerificationStatus = async (vid: number) => {
    try {
      const response = await apiClient.get(`/api/v1/client/verifications/${vid}/status`);
      setStatus(response.data);
    } catch (error) {
      console.error('Failed to load status', error);
    }
  };

  const connectWebSocket = (vid: number) => {
    const apiBaseUrl = getAPIBaseURL();
    const wsBaseUrl = apiBaseUrl.startsWith('https')
      ? apiBaseUrl.replace('https', 'wss')
      : apiBaseUrl.replace('http', 'ws');
    const ws = new WebSocket(`${wsBaseUrl}/api/v1/client/ws/${vid}`);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'status_update') {
        setStatus(data.status);
        
        if (data.status.status === 'completed') {
          toast({
            title: '✅ Verification Complete!',
            description: 'Your identity has been successfully verified.',
          });
        } else if (data.status.status === 'rejected') {
          toast({
            title: '❌ Verification Failed',
            description: 'Please contact support for assistance.',
            variant: 'destructive',
          });
        }
      }
    };

    ws.onerror = () => console.error('WebSocket error');
    return () => ws.close();
  };

  const handleImageUpload = (field: 'front' | 'back', file: File) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      if (field === 'front') {
        setFormData((prev) => ({ ...prev, front_image: base64 }));
        setFrontPreview(base64);
      } else {
        setFormData((prev) => ({ ...prev, back_image: base64 }));
        setBackPreview(base64);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.front_image) {
      toast({ title: 'Missing document', description: 'Please upload document front image', variant: 'destructive' });
      return;
    }

    setUploading(true);
    try {
      const response = await apiClient.post('/api/v1/client/verifications/upload', formData);
      const vid = response.data.verification_id;
      
      setVerificationId(vid);
      setStep('tracking');
      
      toast({
        title: 'Documents uploaded!',
        description: 'Your verification is now being processed.',
      });
      
      // Update URL
      navigate(`/verify?vid=${vid}`, { replace: true });
      
    } catch (error: any) {
      toast({
        title: 'Upload failed',
        description: error?.data?.detail || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  const getCurrentStepIndex = () => {
    if (!status) return 0;
    const statusKey = status.status;
    const index = VERIFICATION_STEPS.findIndex((s) => s.key === statusKey);
    return index === -1 ? 0 : index;
  };

  if (step === 'tracking' && status) {
    const currentIndex = getCurrentStepIndex();
    
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4">
        <div className="max-w-4xl mx-auto">
          <Card className="p-8">
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
                <Shield className="h-8 w-8 text-blue-600" />
              </div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Identity Verification</h1>
              <p className="text-gray-600">Verification ID: #{verificationId}</p>
            </div>

            {/* Progress Steps */}
            <div className="mb-12">
              <div className="flex items-center justify-between">
                {VERIFICATION_STEPS.map((stepItem, index) => {
                  const Icon = stepItem.icon;
                  const isActive = index === currentIndex;
                  const isCompleted = index < currentIndex;
                  const isFailed = status.status === 'rejected' && index === currentIndex;
                  
                  return (
                    <div key={stepItem.key} className="flex flex-col items-center flex-1">
                      <div className="relative flex items-center w-full">
                        {index > 0 && (
                          <div
                            className={`flex-1 h-1 ${
                              isCompleted ? 'bg-green-500' : 'bg-gray-200'
                            }`}
                          />
                        )}
                        <div
                          className={`relative z-10 flex items-center justify-center w-12 h-12 rounded-full border-2 ${
                            isFailed
                              ? 'bg-red-100 border-red-500'
                              : isCompleted
                              ? 'bg-green-100 border-green-500'
                              : isActive
                              ? 'bg-blue-100 border-blue-500 animate-pulse'
                              : 'bg-gray-100 border-gray-300'
                          }`}
                        >
                          {isFailed ? (
                            <AlertCircle className="h-6 w-6 text-red-600" />
                          ) : isCompleted ? (
                            <CheckCircle2 className="h-6 w-6 text-green-600" />
                          ) : isActive ? (
                            <Icon className="h-6 w-6 text-blue-600" />
                          ) : (
                            <Icon className="h-6 w-6 text-gray-400" />
                          )}
                        </div>
                        {index < VERIFICATION_STEPS.length - 1 && (
                          <div
                            className={`flex-1 h-1 ${
                              isCompleted ? 'bg-green-500' : 'bg-gray-200'
                            }`}
                          />
                        )}
                      </div>
                      <p
                        className={`mt-2 text-xs font-medium ${
                          isActive ? 'text-blue-600' : isCompleted ? 'text-green-600' : 'text-gray-500'
                        }`}
                      >
                        {stepItem.label}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Status Details */}
            <div className="bg-gray-50 rounded-lg p-6 mb-6">
              {status.status === 'ai_review' && (
                <div className="text-center">
                  <Loader2 className="h-12 w-12 text-blue-600 animate-spin mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-2">AI Analysis in Progress</h3>
                  <p className="text-gray-600">Our AI is analyzing your documents for authenticity...</p>
                </div>
              )}
              
              {status.status === 'in_queue' && (
                <div className="text-center">
                  <Clock className="h-12 w-12 text-blue-600 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-2">Waiting for Agent</h3>
                  <p className="text-gray-600 mb-2">
                    Estimated wait time: {status.estimated_wait_minutes || 5} minutes
                  </p>
                  {status.ai_score && (
                    <div className="inline-flex items-center gap-2 bg-green-50 px-4 py-2 rounded-full">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <span className="text-sm text-green-700">AI Score: {status.ai_score}/100</span>
                    </div>
                  )}
                </div>
              )}
              
              {status.status === 'in_call' && (
                <div className="text-center">
                  <Video className="h-12 w-12 text-blue-600 mx-auto mb-4 animate-pulse" />
                  <h3 className="text-lg font-semibold mb-2">Live Verification in Progress</h3>
                  <p className="text-gray-600">Agent {status.agent_name || 'assigned'} is verifying your identity...</p>
                </div>
              )}
              
              {status.status === 'completed' && (
                <div className="text-center">
                  <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto mb-4" />
                  <h3 className="text-2xl font-bold text-green-600 mb-2">Verification Complete!</h3>
                  <p className="text-gray-600 mb-4">Your identity has been successfully verified.</p>
                  {status.blockchain_tx_hash && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <p className="text-sm font-medium text-blue-900 mb-1">Blockchain Proof</p>
                      <code className="text-xs text-blue-700 break-all">{status.blockchain_tx_hash}</code>
                    </div>
                  )}
                </div>
              )}
              
              {status.status === 'rejected' && (
                <div className="text-center">
                  <AlertCircle className="h-16 w-16 text-red-600 mx-auto mb-4" />
                  <h3 className="text-2xl font-bold text-red-600 mb-2">Verification Failed</h3>
                  <p className="text-gray-600">Please contact support for assistance.</p>
                </div>
              )}
            </div>

            <div className="text-center">
              <p className="text-xs text-gray-500 mb-4">
                Powered by Thronos VerifyID • Blockchain-secured verification
              </p>
              <Button variant="outline" onClick={() => navigate('/')}>
                Return Home
              </Button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  // Upload Form
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <Card className="p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
              <FileText className="h-8 w-8 text-blue-600" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Identity Verification</h1>
            <p className="text-gray-600">Upload your documents to get started</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <Label htmlFor="document_type">Document Type</Label>
              <select
                id="document_type"
                value={formData.document_type}
                onChange={(e) => setFormData({ ...formData, document_type: e.target.value })}
                className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="passport">Passport</option>
                <option value="national_id">National ID</option>
                <option value="drivers_license">Driver's License</option>
              </select>
            </div>

            <div>
              <Label htmlFor="full_name">
                <User className="inline h-4 w-4 mr-1" /> Full Name
              </Label>
              <Input
                id="full_name"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                placeholder="John Doe"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="document_number">Document Number</Label>
                <Input
                  id="document_number"
                  value={formData.document_number}
                  onChange={(e) => setFormData({ ...formData, document_number: e.target.value })}
                  placeholder="X1234567"
                  required
                />
              </div>
              <div>
                <Label htmlFor="nationality">Nationality</Label>
                <Input
                  id="nationality"
                  value={formData.nationality}
                  onChange={(e) => setFormData({ ...formData, nationality: e.target.value })}
                  placeholder="GR"
                  maxLength={2}
                  required
                />
              </div>
            </div>

            <div>
              <Label htmlFor="date_of_birth">
                <Calendar className="inline h-4 w-4 mr-1" /> Date of Birth
              </Label>
              <Input
                id="date_of_birth"
                type="date"
                value={formData.date_of_birth}
                onChange={(e) => setFormData({ ...formData, date_of_birth: e.target.value })}
                required
              />
            </div>

            <div>
              <Label>Front of Document *</Label>
              <div className="mt-2 border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-500 transition-colors">
                {frontPreview ? (
                  <div className="relative">
                    <img src={frontPreview} alt="Front" className="max-h-48 mx-auto rounded" />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => {
                        setFrontPreview(null);
                        setFormData({ ...formData, front_image: '' });
                      }}
                    >
                      Change
                    </Button>
                  </div>
                ) : (
                  <label className="cursor-pointer">
                    <Upload className="h-12 w-12 text-gray-400 mx-auto mb-2" />
                    <p className="text-sm text-gray-600">Click to upload front image</p>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && handleImageUpload('front', e.target.files[0])}
                    />
                  </label>
                )}
              </div>
            </div>

            <div>
              <Label>Back of Document (optional)</Label>
              <div className="mt-2 border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-500 transition-colors">
                {backPreview ? (
                  <div className="relative">
                    <img src={backPreview} alt="Back" className="max-h-48 mx-auto rounded" />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => {
                        setBackPreview(null);
                        setFormData({ ...formData, back_image: '' });
                      }}
                    >
                      Change
                    </Button>
                  </div>
                ) : (
                  <label className="cursor-pointer">
                    <Upload className="h-12 w-12 text-gray-400 mx-auto mb-2" />
                    <p className="text-sm text-gray-600">Click to upload back image</p>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && handleImageUpload('back', e.target.files[0])}
                    />
                  </label>
                )}
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={uploading}>
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Submit Verification
                </>
              )}
            </Button>
          </form>

          <p className="text-xs text-center text-gray-500 mt-6">
            Your data is encrypted and secured on the Thronos blockchain
          </p>
        </Card>
      </div>
    </div>
  );
}
