import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, FileCheck, Video, PenTool, CheckCircle2, Lock, Brain } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function Index() {
  const navigate = useNavigate();

  const features = [
    {
      icon: <Brain className="h-8 w-8 text-blue-500" />,
      title: 'AI Fraud Detection',
      description: 'Προηγμένος AI agent για ανίχνευση πλαστών εγγράφων με ακρίβεια 99.97%'
    },
    {
      icon: <FileCheck className="h-8 w-8 text-blue-500" />,
      title: 'Document Verification',
      description: 'Automated scanning and verification of ID documents with AI-powered analysis'
    },
    {
      icon: <Video className="h-8 w-8 text-blue-500" />,
      title: 'Video Identification',
      description: 'Live video call with verification agents for secure identity confirmation'
    },
    {
      icon: <PenTool className="h-8 w-8 text-blue-500" />,
      title: 'Digital Signature',
      description: 'Legally binding electronic signatures for contracts and documents'
    },
    {
      icon: <CheckCircle2 className="h-8 w-8 text-blue-500" />,
      title: 'Age Verification',
      description: 'Quick and simple age verification for compliance requirements'
    },
    {
      icon: <Lock className="h-8 w-8 text-blue-500" />,
      title: 'KYC Compliance',
      description: 'Complete Know Your Customer forms with secure data handling'
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Navigation */}
      <nav className="border-b border-slate-700 bg-slate-900/50 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Shield className="h-8 w-8 text-blue-500" />
            <span className="text-2xl font-bold text-slate-50">VerifyID</span>
          </div>
          <div className="flex gap-4">
            <Button variant="ghost" className="text-slate-300 hover:text-slate-50" onClick={() => navigate('/login')}>
              Login
            </Button>
            <Button className="bg-blue-500 hover:bg-blue-600 text-white" onClick={() => navigate('/register')}>
              Get Started
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="container mx-auto px-6 py-20">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div className="space-y-6">
            <h1 className="text-5xl font-bold text-slate-50 leading-tight">
              Secure Identity Verification Platform
            </h1>
            <p className="text-xl text-slate-400">
              Fast, secure, and compliant identity verification solutions. Verify identities in under one minute with 99.97% fraud prevention powered by AI.
            </p>
            <div className="flex gap-4">
              <Button size="lg" className="bg-blue-500 hover:bg-blue-600 text-white" onClick={() => navigate('/register')}>
                Start Verification
              </Button>
              <Button size="lg" variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-800" onClick={() => navigate('/login')}>
                Learn More
              </Button>
            </div>
            <div className="flex gap-8 pt-4">
              <div>
                <div className="text-3xl font-bold text-blue-500">115M+</div>
                <div className="text-sm text-slate-400">Identities Verified</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-blue-500">99.97%</div>
                <div className="text-sm text-slate-400">Fraud Prevention</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-blue-500">&lt;1 min</div>
                <div className="text-sm text-slate-400">Verification Time</div>
              </div>
            </div>
          </div>
          <div className="relative">
            <img
              src="https://mgx-backend-cdn.metadl.com/generate/images/808729/2026-01-27/fcac4100-2280-49ca-a20a-8badd7bce8fc.png"
              alt="Identity Verification"
              className="rounded-2xl shadow-2xl"
            />
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-slate-50 mb-4">Comprehensive Verification Solutions</h2>
          <p className="text-xl text-slate-400">Everything you need for secure identity verification</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <Card key={index} className="bg-slate-800 border-slate-700 hover:border-blue-500 transition-all duration-300">
              <CardHeader>
                <div className="mb-4">{feature.icon}</div>
                <CardTitle className="text-slate-50">{feature.title}</CardTitle>
                <CardDescription className="text-slate-400">{feature.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-6 py-20">
        <Card className="bg-gradient-to-r from-blue-600 to-blue-500 border-0">
          <CardContent className="p-12 text-center">
            <h2 className="text-4xl font-bold text-white mb-4">Ready to Get Verified?</h2>
            <p className="text-xl text-blue-50 mb-8">Start your secure identity verification process today</p>
            <Button size="lg" variant="secondary" className="bg-white text-blue-600 hover:bg-slate-100" onClick={() => navigate('/register')}>
              Create Free Account
            </Button>
          </CardContent>
        </Card>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-700 bg-slate-900/50 backdrop-blur-sm py-8">
        <div className="container mx-auto px-6 text-center text-slate-400">
          <p>&copy; 2026 VerifyID. All rights reserved. Secure identity verification platform.</p>
        </div>
      </footer>
    </div>
  );
}