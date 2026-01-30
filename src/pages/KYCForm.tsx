import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Shield } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { toast } from 'sonner';

export default function KYCForm() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    country: '',
    postalCode: '',
    nationality: '',
    occupation: '',
    sourceOfFunds: ''
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const requiredFields = ['fullName', 'email', 'phone', 'address', 'city', 'country', 'nationality', 'occupation'];
    const missingFields = requiredFields.filter(field => !formData[field as keyof typeof formData]);

    if (missingFields.length > 0) {
      toast.error('Please fill in all required fields');
      return;
    }

    toast.success('KYC form submitted successfully!');
    navigate('/dashboard');
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
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-50 mb-4">KYC Information Form</h1>
          <p className="text-xl text-slate-400">Please provide your personal information for Know Your Customer compliance</p>
        </div>

        <Card className="bg-slate-800 border-slate-700">
          <CardHeader>
            <CardTitle className="text-slate-50">Personal Information</CardTitle>
            <CardDescription className="text-slate-400">
              All information is encrypted and stored securely
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="fullName" className="text-slate-300">Full Name *</Label>
                  <Input
                    id="fullName"
                    placeholder="John Doe"
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                    className="bg-slate-900 border-slate-600 text-slate-50 focus:border-blue-500"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email" className="text-slate-300">Email Address *</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="john@example.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="bg-slate-900 border-slate-600 text-slate-50 focus:border-blue-500"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone" className="text-slate-300">Phone Number *</Label>
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="+1 (555) 000-0000"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="bg-slate-900 border-slate-600 text-slate-50 focus:border-blue-500"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="nationality" className="text-slate-300">Nationality *</Label>
                  <Select value={formData.nationality} onValueChange={(value) => setFormData({ ...formData, nationality: value })}>
                    <SelectTrigger className="bg-slate-900 border-slate-600 text-slate-50 focus:border-blue-500">
                      <SelectValue placeholder="Select nationality" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-900 border-slate-600">
                      <SelectItem value="us">United States</SelectItem>
                      <SelectItem value="uk">United Kingdom</SelectItem>
                      <SelectItem value="ca">Canada</SelectItem>
                      <SelectItem value="au">Australia</SelectItem>
                      <SelectItem value="de">Germany</SelectItem>
                      <SelectItem value="fr">France</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address" className="text-slate-300">Street Address *</Label>
                <Textarea
                  id="address"
                  placeholder="123 Main Street, Apt 4B"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="bg-slate-900 border-slate-600 text-slate-50 focus:border-blue-500"
                  rows={3}
                />
              </div>

              <div className="grid md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="city" className="text-slate-300">City *</Label>
                  <Input
                    id="city"
                    placeholder="New York"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    className="bg-slate-900 border-slate-600 text-slate-50 focus:border-blue-500"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="country" className="text-slate-300">Country *</Label>
                  <Input
                    id="country"
                    placeholder="United States"
                    value={formData.country}
                    onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                    className="bg-slate-900 border-slate-600 text-slate-50 focus:border-blue-500"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="postalCode" className="text-slate-300">Postal Code</Label>
                  <Input
                    id="postalCode"
                    placeholder="10001"
                    value={formData.postalCode}
                    onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })}
                    className="bg-slate-900 border-slate-600 text-slate-50 focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="occupation" className="text-slate-300">Occupation *</Label>
                  <Input
                    id="occupation"
                    placeholder="Software Engineer"
                    value={formData.occupation}
                    onChange={(e) => setFormData({ ...formData, occupation: e.target.value })}
                    className="bg-slate-900 border-slate-600 text-slate-50 focus:border-blue-500"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sourceOfFunds" className="text-slate-300">Source of Funds</Label>
                  <Select value={formData.sourceOfFunds} onValueChange={(value) => setFormData({ ...formData, sourceOfFunds: value })}>
                    <SelectTrigger className="bg-slate-900 border-slate-600 text-slate-50 focus:border-blue-500">
                      <SelectValue placeholder="Select source" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-900 border-slate-600">
                      <SelectItem value="employment">Employment Income</SelectItem>
                      <SelectItem value="business">Business Income</SelectItem>
                      <SelectItem value="investment">Investment Returns</SelectItem>
                      <SelectItem value="savings">Savings</SelectItem>
                      <SelectItem value="inheritance">Inheritance</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="bg-slate-700 p-4 rounded-lg">
                <p className="text-sm text-slate-300">
                  <strong>Data Protection:</strong> Your information is encrypted and stored in compliance with GDPR and other data protection regulations. We will never share your personal information without your explicit consent.
                </p>
              </div>

              <div className="flex gap-4">
                <Button type="submit" className="flex-1 bg-blue-500 hover:bg-blue-600 text-white">
                  Submit KYC Form
                </Button>
                <Button type="button" variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-700" onClick={() => navigate('/dashboard')}>
                  Save as Draft
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}