import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Shield, CheckCircle2, Calendar } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { toast } from 'sonner';

export default function AgeVerification() {
  const navigate = useNavigate();
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [verified, setVerified] = useState(false);
  const [age, setAge] = useState(0);

  const calculateAge = (dob: string) => {
    const birthDate = new Date(dob);
    const today = new Date();
    let calculatedAge = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      calculatedAge--;
    }
    return calculatedAge;
  };

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dateOfBirth) {
      toast.error('Please enter your date of birth');
      return;
    }

    const calculatedAge = calculateAge(dateOfBirth);
    setAge(calculatedAge);

    if (calculatedAge >= 18) {
      setVerified(true);
      toast.success('Age verified successfully!');
    } else {
      toast.error('You must be 18 or older to proceed');
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
          <Button variant="ghost" className="text-slate-300 hover:text-slate-50" onClick={() => navigate('/dashboard')}>
            Back to Dashboard
          </Button>
        </div>
      </nav>

      <div className="container mx-auto px-6 py-12 max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold text-slate-50 mb-4">Age Verification</h1>
          <p className="text-xl text-slate-400">Confirm that you meet the age requirements</p>
        </div>

        {!verified ? (
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-slate-50">Enter Your Date of Birth</CardTitle>
              <CardDescription className="text-slate-400">
                You must be 18 years or older to use this service
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleVerify} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="dob" className="text-slate-300 flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Date of Birth
                  </Label>
                  <Input
                    id="dob"
                    type="date"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    max={new Date().toISOString().split('T')[0]}
                    className="bg-slate-900 border-slate-600 text-slate-50 focus:border-blue-500"
                  />
                </div>

                <div className="bg-slate-700 p-4 rounded-lg">
                  <p className="text-sm text-slate-300">
                    <strong>Privacy Notice:</strong> Your date of birth is used solely for age verification purposes and is handled in accordance with data protection regulations.
                  </p>
                </div>

                <div className="flex gap-4">
                  <Button type="submit" className="flex-1 bg-blue-500 hover:bg-blue-600 text-white">
                    Verify Age
                  </Button>
                  <Button type="button" variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-700" onClick={() => navigate('/dashboard')}>
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-6">
              <div className="text-center space-y-6">
                <div className="inline-flex items-center justify-center w-20 h-20 bg-emerald-500/20 rounded-full">
                  <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                </div>
                <div>
                  <h2 className="text-3xl font-bold text-slate-50 mb-2">Age Verified!</h2>
                  <p className="text-xl text-slate-400">You are {age} years old</p>
                </div>
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-6">
                  <p className="text-emerald-400 font-semibold mb-2">✓ Age Requirement Met</p>
                  <p className="text-slate-300">You meet the minimum age requirement of 18 years</p>
                </div>
                <Button className="w-full bg-blue-500 hover:bg-blue-600 text-white" onClick={() => navigate('/dashboard')}>
                  Continue to Next Step
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}