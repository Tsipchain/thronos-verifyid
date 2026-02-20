import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, FileCheck, Video, PenTool, CheckCircle2, Lock, Brain, Globe, Server, Mail, BadgeCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { apiClient } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

type ServicePackage = {
  code: string;
  name: string;
  monthly_price_eur: number;
  description: string;
  features: string[];
};

export default function Index() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [packages, setPackages] = useState<ServicePackage[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [sendingLead, setSendingLead] = useState(false);
  const [form, setForm] = useState({
    company_name: '',
    contact_name: '',
    email: '',
    phone: '',
    package_code: 'starter',
    needs_web2_domain: true,
    needs_web3_domain: false,
    web3_tld: '.thron',
    needs_hosting: true,
    hosting_tier: 'starter',
    logo_url: '',
    notes: '',
  });

  const features = useMemo(
    () => [
      {
        icon: <Brain className="h-8 w-8 text-blue-500" />,
        title: 'AI Fraud Detection',
        description: 'Προηγμένος AI agent για ανίχνευση πλαστών εγγράφων με ακρίβεια 99.97%',
      },
      {
        icon: <FileCheck className="h-8 w-8 text-blue-500" />,
        title: 'Document Verification',
        description: 'Automated scanning and verification of ID documents with AI-powered analysis',
      },
      {
        icon: <Video className="h-8 w-8 text-blue-500" />,
        title: 'Video Identification',
        description: 'Live video call with verification agents for secure identity confirmation',
      },
      {
        icon: <PenTool className="h-8 w-8 text-blue-500" />,
        title: 'Digital Signature',
        description: 'Legally binding electronic signatures for contracts and documents',
      },
      {
        icon: <CheckCircle2 className="h-8 w-8 text-blue-500" />,
        title: 'Age Verification',
        description: 'Quick and simple age verification for compliance requirements',
      },
      {
        icon: <Lock className="h-8 w-8 text-blue-500" />,
        title: 'KYC Compliance',
        description: 'Complete Know Your Customer forms with secure data handling',
      },
    ],
    []
  );

  const loadPackages = async () => {
    if (packages.length > 0 || loadingPackages) return;
    try {
      setLoadingPackages(true);
      const response = await apiClient.get<ServicePackage[]>('/api/v1/services/packages');
      setPackages(response.data);
      if (response.data[0]) {
        setForm((prev) => ({ ...prev, package_code: response.data[0].code }));
      }
    } catch {
      toast({
        title: 'Package load failed',
        description: 'Could not load package catalog right now.',
        variant: 'destructive',
      });
    } finally {
      setLoadingPackages(false);
    }
  };

  const submitLead = async () => {
    if (!form.company_name || !form.contact_name || !form.email || !form.phone) {
      toast({
        title: 'Missing fields',
        description: 'Please fill in company, contact name, email and phone.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setSendingLead(true);
      await apiClient.post('/api/v1/services/leads', {
        ...form,
        logo_url: form.logo_url || null,
        notes: form.notes || null,
      });
      toast({
        title: 'Request submitted',
        description: 'Our team will contact you for domain, hosting and business email onboarding.',
      });
      setForm((prev) => ({ ...prev, notes: '', logo_url: '' }));
    } catch {
      toast({
        title: 'Submission failed',
        description: 'Please try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      setSendingLead(false);
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
            <Button variant="ghost" className="text-slate-300 hover:text-slate-50" onClick={() => navigate('/login')}>
              Login
            </Button>
            <Button className="bg-blue-500 hover:bg-blue-600 text-white" onClick={() => navigate('/register')}>
              Get Started
            </Button>
          </div>
        </div>
      </nav>

      <section className="container mx-auto px-6 py-20">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div className="space-y-6">
            <h1 className="text-5xl font-bold text-slate-50 leading-tight">Secure Identity + Business Infrastructure</h1>
            <p className="text-xl text-slate-400">
              VerifyID πλέον προσφέρει και έτοιμα πακέτα για εταιρικό email, Web2/Web3 domain και managed hosting μέσα στο οικοσύστημα Thronos.
            </p>
            <div className="flex gap-4">
              <Button size="lg" className="bg-blue-500 hover:bg-blue-600 text-white" onClick={() => navigate('/register')}>
                Start Verification
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-slate-600 text-slate-300 hover:bg-slate-800"
                onClick={loadPackages}
              >
                Load Business Packages
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-4 pt-4">
              <div className="rounded-xl border border-slate-700 p-4 bg-slate-900/40">
                <Mail className="h-6 w-6 text-blue-400 mb-2" />
                <p className="text-sm text-slate-300">Corporate Email</p>
              </div>
              <div className="rounded-xl border border-slate-700 p-4 bg-slate-900/40">
                <Globe className="h-6 w-6 text-blue-400 mb-2" />
                <p className="text-sm text-slate-300">Web2 + Web3 Domains</p>
              </div>
              <div className="rounded-xl border border-slate-700 p-4 bg-slate-900/40">
                <Server className="h-6 w-6 text-blue-400 mb-2" />
                <p className="text-sm text-slate-300">Managed Hosting</p>
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

      <section className="container mx-auto px-6 pb-16">
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

      <section className="container mx-auto px-6 py-12">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-3xl font-bold text-slate-50">Business Packages (Web2/Web3 + Mail + Hosting)</h2>
          <Button variant="outline" className="border-slate-600 text-slate-300" onClick={loadPackages}>
            {loadingPackages ? 'Loading...' : 'Refresh'}
          </Button>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {packages.map((pkg) => (
            <Card key={pkg.code} className="bg-slate-800 border-slate-700">
              <CardHeader>
                <CardTitle className="text-slate-50 flex items-center justify-between">
                  {pkg.name}
                  <span className="text-blue-400 text-lg">€{pkg.monthly_price_eur}/mo</span>
                </CardTitle>
                <CardDescription className="text-slate-400">{pkg.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {pkg.features.map((feature) => (
                  <div key={feature} className="flex items-start gap-2 text-sm text-slate-300">
                    <BadgeCheck className="h-4 w-4 text-emerald-400 mt-0.5" />
                    <span>{feature}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
          {packages.length === 0 && (
            <Card className="lg:col-span-3 bg-slate-800 border-slate-700">
              <CardContent className="p-8 text-center text-slate-400">
                Click <strong>Load Business Packages</strong> to fetch the latest package catalog.
              </CardContent>
            </Card>
          )}
        </div>
      </section>

      <section className="container mx-auto px-6 py-12">
        <Card className="bg-gradient-to-r from-blue-600 to-indigo-600 border-0">
          <CardHeader>
            <CardTitle className="text-white text-3xl">Request Your Company Stack</CardTitle>
            <CardDescription className="text-blue-100">
              Get your own business email, custom domain, hosting, and partner logo placement on VerifyID.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid md:grid-cols-2 gap-4">
            <Input placeholder="Company name" value={form.company_name} onChange={(e) => setForm((p) => ({ ...p, company_name: e.target.value }))} className="bg-white/95" />
            <Input placeholder="Contact name" value={form.contact_name} onChange={(e) => setForm((p) => ({ ...p, contact_name: e.target.value }))} className="bg-white/95" />
            <Input placeholder="Business email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} className="bg-white/95" />
            <Input placeholder="Phone" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} className="bg-white/95" />

            <select
              value={form.package_code}
              onChange={(e) => setForm((p) => ({ ...p, package_code: e.target.value }))}
              className="h-10 rounded-md border border-slate-200 px-3 text-sm"
            >
              {(packages.length ? packages : [{ code: 'starter', name: 'Starter Business Identity' } as ServicePackage]).map((pkg) => (
                <option key={pkg.code} value={pkg.code}>
                  {pkg.name}
                </option>
              ))}
            </select>
            <select
              value={form.hosting_tier}
              onChange={(e) => setForm((p) => ({ ...p, hosting_tier: e.target.value }))}
              className="h-10 rounded-md border border-slate-200 px-3 text-sm"
            >
              <option value="starter">Starter Hosting</option>
              <option value="business">Business Hosting</option>
              <option value="enterprise">Enterprise Hosting</option>
            </select>

            <Input placeholder="Preferred Web3 TLD (.thron/.eth)" value={form.web3_tld} onChange={(e) => setForm((p) => ({ ...p, web3_tld: e.target.value }))} className="bg-white/95" />
            <Input placeholder="Partner Logo URL (optional)" value={form.logo_url} onChange={(e) => setForm((p) => ({ ...p, logo_url: e.target.value }))} className="bg-white/95" />

            <div className="md:col-span-2 grid sm:grid-cols-3 gap-4 text-sm text-white">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.needs_web2_domain} onChange={(e) => setForm((p) => ({ ...p, needs_web2_domain: e.target.checked }))} />
                Web2 Domain
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.needs_web3_domain} onChange={(e) => setForm((p) => ({ ...p, needs_web3_domain: e.target.checked }))} />
                Web3 Domain
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.needs_hosting} onChange={(e) => setForm((p) => ({ ...p, needs_hosting: e.target.checked }))} />
                Managed Hosting
              </label>
            </div>

            <div className="md:col-span-2">
              <Textarea
                placeholder="Tell us your requirements (mailboxes, migration, DNS, etc.)"
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                className="bg-white/95 min-h-24"
              />
            </div>

            <div className="md:col-span-2 flex justify-end">
              <Button onClick={submitLead} disabled={sendingLead} className="bg-slate-900 hover:bg-slate-800 text-white">
                {sendingLead ? 'Submitting...' : 'Submit Business Request'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <footer className="border-t border-slate-700 bg-slate-900/50 backdrop-blur-sm py-8">
        <div className="container mx-auto px-6 text-center text-slate-400">
          <p>&copy; 2026 VerifyID. All rights reserved. Secure identity verification platform.</p>
        </div>
      </footer>
    </div>
  );
}
