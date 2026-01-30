import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Shield, CheckCircle2, User, Calendar, Hash, MapPin } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function DocumentVerification() {
  const navigate = useNavigate();

  const verificationData = {
    status: 'verified',
    documentType: 'Passport',
    fullName: 'John Michael Doe',
    dateOfBirth: '1990-05-15',
    documentNumber: 'P12345678',
    nationality: 'United States',
    issueDate: '2020-01-10',
    expiryDate: '2030-01-10',
    verifiedAt: new Date().toLocaleString()
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <nav className="border-b border-slate-700 bg-slate-900/50 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Shield className="h-8 w-8 text-blue-500" />
            <span className="text-2xl font-bold text-slate-50">VerifyID</span>
          </div>
          <Button variant="ghost" className="text-slate-300 hover:text-slate-50" onClick={() => navigate('/dashboard')}>
            Back to Dashboard
          </Button>
        </div>
      </nav>

      <div className="container mx-auto px-6 py-12 max-w-4xl">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-emerald-500/20 rounded-full mb-4">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
          </div>
          <h1 className="text-4xl font-bold text-slate-50 mb-4">Document Verified Successfully</h1>
          <p className="text-xl text-slate-400">Your identity document has been verified and authenticated</p>
        </div>

        <div className="grid gap-6 mb-8">
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-slate-50">Verification Status</CardTitle>
                <Badge className="bg-emerald-500 text-white">Verified</Badge>
              </div>
              <CardDescription className="text-slate-400">
                Verified on {verificationData.verifiedAt}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <img
                src="https://mgx-backend-cdn.metadl.com/generate/images/808729/2026-01-27/27c93555-b779-4b38-9b31-34831c3ea9cc.png"
                alt="Document Scan"
                className="w-full h-64 object-cover rounded-lg mb-4"
              />
            </CardContent>
          </Card>

          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-slate-50">Extracted Information</CardTitle>
              <CardDescription className="text-slate-400">
                Data extracted from your {verificationData.documentType}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="flex items-start gap-3">
                  <User className="h-5 w-5 text-blue-500 mt-1" />
                  <div>
                    <p className="text-sm text-slate-400">Full Name</p>
                    <p className="text-slate-50 font-semibold">{verificationData.fullName}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Calendar className="h-5 w-5 text-blue-500 mt-1" />
                  <div>
                    <p className="text-sm text-slate-400">Date of Birth</p>
                    <p className="text-slate-50 font-semibold">{verificationData.dateOfBirth}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Hash className="h-5 w-5 text-blue-500 mt-1" />
                  <div>
                    <p className="text-sm text-slate-400">Document Number</p>
                    <p className="text-slate-50 font-semibold">{verificationData.documentNumber}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <MapPin className="h-5 w-5 text-blue-500 mt-1" />
                  <div>
                    <p className="text-sm text-slate-400">Nationality</p>
                    <p className="text-slate-50 font-semibold">{verificationData.nationality}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Calendar className="h-5 w-5 text-blue-500 mt-1" />
                  <div>
                    <p className="text-sm text-slate-400">Issue Date</p>
                    <p className="text-slate-50 font-semibold">{verificationData.issueDate}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Calendar className="h-5 w-5 text-blue-500 mt-1" />
                  <div>
                    <p className="text-sm text-slate-400">Expiry Date</p>
                    <p className="text-slate-50 font-semibold">{verificationData.expiryDate}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-slate-50">Security Checks Passed</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                <span className="text-slate-300">Document authenticity verified</span>
              </div>
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                <span className="text-slate-300">Security features validated</span>
              </div>
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                <span className="text-slate-300">Data integrity confirmed</span>
              </div>
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                <span className="text-slate-300">Expiry date valid</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex gap-4">
          <Button className="flex-1 bg-blue-500 hover:bg-blue-600 text-white" onClick={() => navigate('/dashboard')}>
            Continue to Next Step
          </Button>
          <Button variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-700">
            Download Report
          </Button>
        </div>
      </div>
    </div>
  );
}