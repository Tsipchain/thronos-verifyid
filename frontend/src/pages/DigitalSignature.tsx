import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, Download, CheckCircle2, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState, useRef } from 'react';
import { toast } from 'sonner';

export default function DigitalSignature() {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSigned, setHasSigned] = useState(false);
  const [signatureComplete, setSignatureComplete] = useState(false);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setIsDrawing(true);
    setHasSigned(true);
    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.strokeStyle = '#3B82F6';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSigned(false);
  };

  const submitSignature = () => {
    if (!hasSigned) {
      toast.error('Please sign the document first');
      return;
    }
    toast.success('Signature submitted successfully!');
    setSignatureComplete(true);
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
          <h1 className="text-4xl font-bold text-slate-50 mb-4">Digital Signature</h1>
          <p className="text-xl text-slate-400">Sign the verification documents electronically</p>
        </div>

        {!signatureComplete ? (
          <div className="space-y-6">
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <CardTitle className="text-slate-50">Verification Agreement</CardTitle>
                <CardDescription className="text-slate-400">
                  Please review and sign the following document
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="bg-slate-900 p-6 rounded-lg mb-6 max-h-96 overflow-y-auto">
                  <h3 className="text-lg font-semibold text-slate-50 mb-4">Identity Verification Consent Agreement</h3>
                  <div className="space-y-4 text-slate-300 text-sm">
                    <p>
                      By signing this document, I hereby confirm and agree to the following:
                    </p>
                    <ol className="list-decimal list-inside space-y-2 ml-4">
                      <li>I authorize VerifyID to verify my identity using the information and documents I have provided.</li>
                      <li>I confirm that all information provided is accurate, complete, and truthful to the best of my knowledge.</li>
                      <li>I understand that my personal data will be processed in accordance with applicable data protection laws and regulations.</li>
                      <li>I consent to the collection, storage, and processing of my biometric data (including facial recognition) for identity verification purposes.</li>
                      <li>I acknowledge that false or misleading information may result in the rejection of my verification request and potential legal consequences.</li>
                      <li>I understand that VerifyID may share my verification results with authorized third parties as required by law or with my explicit consent.</li>
                      <li>I have read and agree to the Terms of Service and Privacy Policy of VerifyID.</li>
                    </ol>
                    <p className="mt-4">
                      <strong>Data Retention:</strong> Your data will be retained for the period required by law and our internal policies, after which it will be securely deleted.
                    </p>
                    <p>
                      <strong>Your Rights:</strong> You have the right to access, correct, or delete your personal data at any time by contacting our support team.
                    </p>
                  </div>
                </div>

                <img
                  src="https://mgx-backend-cdn.metadl.com/generate/images/808729/2026-01-27/689ab7cf-23f0-4bef-a8d8-6013cabfbc3f.png"
                  alt="Digital Signature"
                  className="w-full h-48 object-cover rounded-lg mb-6"
                />
              </CardContent>
            </Card>

            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <CardTitle className="text-slate-50">Your Signature</CardTitle>
                <CardDescription className="text-slate-400">
                  Sign in the box below using your mouse or touchscreen
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="bg-white rounded-lg p-4 mb-4">
                  <canvas
                    ref={canvasRef}
                    width={700}
                    height={200}
                    className="border-2 border-dashed border-slate-300 rounded cursor-crosshair w-full"
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                  />
                </div>

                <div className="flex gap-4">
                  <Button
                    variant="outline"
                    className="border-slate-600 text-slate-300 hover:bg-slate-700"
                    onClick={clearSignature}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Clear Signature
                  </Button>
                  <Button
                    className="flex-1 bg-blue-500 hover:bg-blue-600 text-white"
                    onClick={submitSignature}
                  >
                    Submit Signature
                  </Button>
                </div>

                <p className="text-sm text-slate-400 mt-4 text-center">
                  By signing, you agree to the terms and conditions stated above
                </p>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-6">
              <div className="text-center space-y-6">
                <div className="inline-flex items-center justify-center w-20 h-20 bg-emerald-500/20 rounded-full">
                  <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                </div>
                <div>
                  <h2 className="text-3xl font-bold text-slate-50 mb-2">Document Signed Successfully!</h2>
                  <p className="text-xl text-slate-400">Your digital signature has been recorded</p>
                </div>
                <div className="bg-slate-700 p-6 rounded-lg">
                  <p className="text-slate-300 mb-4">
                    <strong>Signature Details:</strong>
                  </p>
                  <div className="text-left space-y-2 text-slate-300">
                    <p>• Signed on: {new Date().toLocaleString()}</p>
                    <p>• Document: Identity Verification Consent Agreement</p>
                    <p>• Signature ID: SIG-{Math.random().toString(36).substr(2, 9).toUpperCase()}</p>
                    <p>• Status: Legally Binding</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <Button className="flex-1 bg-blue-500 hover:bg-blue-600 text-white" onClick={() => navigate('/dashboard')}>
                    Continue to Next Step
                  </Button>
                  <Button variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-700">
                    <Download className="mr-2 h-4 w-4" />
                    Download PDF
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}