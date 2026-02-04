import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Shield, CheckCircle2, Download, Share2, FileCheck, Video, PenTool, Clock, Calendar } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '@/lib/auth';

export default function VerificationDashboard() {
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await authApi.logout();
      navigate('/login');
    } catch (error) {
      navigate('/login');
    }
  };

  const verificationSteps = [
    {
      icon: <FileCheck className="h-5 w-5" />,
      title: 'Document Upload',
      status: 'completed',
      completedAt: '2026-01-27 10:30 AM'
    },
    {
      icon: <CheckCircle2 className="h-5 w-5" />,
      title: 'Document Verification',
      status: 'completed',
      completedAt: '2026-01-27 10:32 AM'
    },
    {
      icon: <CheckCircle2 className="h-5 w-5" />,
      title: 'Age Verification',
      status: 'completed',
      completedAt: '2026-01-27 10:35 AM'
    },
    {
      icon: <FileCheck className="h-5 w-5" />,
      title: 'KYC Form',
      status: 'completed',
      completedAt: '2026-01-27 10:40 AM'
    },
    {
      icon: <Video className="h-5 w-5" />,
      title: 'Video Call Verification',
      status: 'completed',
      completedAt: '2026-01-27 10:50 AM'
    },
    {
      icon: <PenTool className="h-5 w-5" />,
      title: 'Digital Signature',
      status: 'completed',
      completedAt: '2026-01-27 10:55 AM'
    }
  ];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-emerald-500 text-white">Completed</Badge>;
      case 'pending':
        return <Badge className="bg-amber-500 text-white">Pending</Badge>;
      case 'failed':
        return <Badge className="bg-red-500 text-white">Failed</Badge>;
      default:
        return <Badge className="bg-slate-600 text-white">Not Started</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <nav className="border-b border-slate-700 bg-slate-900/50 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Shield className="h-8 w-8 text-blue-500" />
            <span className="text-2xl font-bold text-slate-50">VerifyID</span>
          </div>
          <div className="flex gap-4">
            <Button variant="ghost" className="text-slate-300 hover:text-slate-50" onClick={() => navigate('/dashboard')}>
              Dashboard
            </Button>
            <Button variant="ghost" className="text-slate-300 hover:text-slate-50" onClick={handleLogout}>
              Logout
            </Button>
          </div>
        </div>
      </nav>

      <div className="container mx-auto px-6 py-12 max-w-6xl">
        {/* Success Banner */}
        <Card className="bg-gradient-to-r from-emerald-600 to-emerald-500 border-0 mb-8">
          <CardContent className="p-8">
            <div className="flex items-center gap-6">
              <div className="flex-shrink-0">
                <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center">
                  <CheckCircle2 className="h-10 w-10 text-white" />
                </div>
              </div>
              <div className="flex-1">
                <h2 className="text-3xl font-bold text-white mb-2">Verification Complete!</h2>
                <p className="text-emerald-50 text-lg">
                  Your identity has been successfully verified. All verification steps have been completed.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Progress Overview */}
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-slate-50">Overall Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Completed</span>
                  <span className="text-slate-50 font-semibold">100%</span>
                </div>
                <Progress value={100} className="h-3" />
                <p className="text-xs text-slate-400 mt-2">6 of 6 steps completed</p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-slate-50">Verification Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                <div>
                  <p className="text-2xl font-bold text-slate-50">Verified</p>
                  <p className="text-sm text-slate-400">Identity confirmed</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-slate-50">Verification ID</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <p className="text-lg font-mono text-slate-50">VER-2026-{Math.random().toString(36).substr(2, 6).toUpperCase()}</p>
                <p className="text-xs text-slate-400">Use this ID for reference</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Verification Steps Timeline */}
        <Card className="bg-slate-800 border-slate-700 mb-8">
          <CardHeader>
            <CardTitle className="text-slate-50">Verification Timeline</CardTitle>
            <CardDescription className="text-slate-400">
              Complete history of your verification process
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {verificationSteps.map((step, index) => (
                <div key={index} className="flex items-center gap-4 p-4 bg-slate-700 rounded-lg">
                  <div className="flex-shrink-0 w-10 h-10 bg-emerald-500/20 rounded-full flex items-center justify-center text-emerald-500">
                    {step.icon}
                  </div>
                  <div className="flex-1">
                    <h3 className="text-slate-50 font-semibold">{step.title}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <Clock className="h-3 w-3 text-slate-400" />
                      <p className="text-sm text-slate-400">{step.completedAt}</p>
                    </div>
                  </div>
                  {getStatusBadge(step.status)}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Verification Certificate */}
        <Card className="bg-slate-800 border-slate-700 mb-8">
          <CardHeader>
            <CardTitle className="text-slate-50">Verification Certificate</CardTitle>
            <CardDescription className="text-slate-400">
              Official certificate of identity verification
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="bg-gradient-to-br from-slate-700 to-slate-800 p-8 rounded-lg border-2 border-blue-500/30">
              <div className="text-center space-y-4">
                <Shield className="h-16 w-16 text-blue-500 mx-auto" />
                <h2 className="text-2xl font-bold text-slate-50">Certificate of Identity Verification</h2>
                <p className="text-slate-300">This certifies that the identity of</p>
                <p className="text-3xl font-bold text-blue-400">John Michael Doe</p>
                <p className="text-slate-300">has been successfully verified by VerifyID</p>
                <div className="flex items-center justify-center gap-2 text-slate-400 mt-6">
                  <Calendar className="h-4 w-4" />
                  <span>Issued on: {new Date().toLocaleDateString()}</span>
                </div>
                <div className="pt-4 border-t border-slate-600">
                  <p className="text-sm text-slate-400">Certificate ID: CERT-{Math.random().toString(36).substr(2, 12).toUpperCase()}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="grid md:grid-cols-3 gap-4">
          <Button className="bg-blue-500 hover:bg-blue-600 text-white">
            <Download className="mr-2 h-4 w-4" />
            Download Certificate
          </Button>
          <Button variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-700">
            <Share2 className="mr-2 h-4 w-4" />
            Share Verification
          </Button>
          <Button variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-700" onClick={() => navigate('/dashboard')}>
            Back to Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
