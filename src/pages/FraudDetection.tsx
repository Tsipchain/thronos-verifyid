import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Shield, AlertTriangle, CheckCircle2, XCircle, Brain, Scan, FileWarning, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { toast } from 'sonner';

export default function FraudDetection() {
  const navigate = useNavigate();
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisComplete, setAnalysisComplete] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
      toast.success('Έγγραφο ανέβηκε για ανάλυση');
    }
  };

  const startAnalysis = () => {
    if (!selectedFile) {
      toast.error('Παρακαλώ ανεβάστε ένα έγγραφο πρώτα');
      return;
    }
    setAnalyzing(true);
    toast.info('Ο AI Agent ξεκινά την ανάλυση...');
    
    // Simulate AI analysis
    setTimeout(() => {
      setAnalyzing(false);
      setAnalysisComplete(true);
      toast.success('Ανάλυση ολοκληρώθηκε!');
    }, 3000);
  };

  const fraudChecks = [
    {
      category: 'Ανάλυση Εγγράφου',
      checks: [
        { name: 'Ποιότητα Εικόνας', status: 'pass', score: 98 },
        { name: 'Χαρακτηριστικά Ασφαλείας', status: 'pass', score: 95 },
        { name: 'Μικρογραφήματα & Υδατογραφήματα', status: 'pass', score: 92 },
        { name: 'Γραμματοσειρές & Κείμενο', status: 'pass', score: 97 }
      ]
    },
    {
      category: 'Βιομετρική Ανάλυση',
      checks: [
        { name: 'Αναγνώριση Προσώπου', status: 'pass', score: 96 },
        { name: 'Έλεγχος Ζωντάνιας (Liveness)', status: 'pass', score: 94 },
        { name: 'Σύγκριση με Φωτογραφία Εγγράφου', status: 'pass', score: 93 }
      ]
    },
    {
      category: 'Έλεγχος Δεδομένων',
      checks: [
        { name: 'Ημερομηνία Λήξης', status: 'pass', score: 100 },
        { name: 'Αριθμός Εγγράφου', status: 'pass', score: 99 },
        { name: 'Συνέπεια Δεδομένων', status: 'pass', score: 97 },
        { name: 'Cross-Reference με Βάσεις Δεδομένων', status: 'pass', score: 95 }
      ]
    },
    {
      category: 'Ανίχνευση Χειραγώγησης',
      checks: [
        { name: 'Ψηφιακή Επεξεργασία', status: 'pass', score: 98 },
        { name: 'Deepfake Detection', status: 'pass', score: 96 },
        { name: 'Φωτογραφική Χειραγώγηση', status: 'pass', score: 94 }
      ]
    }
  ];

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pass':
        return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-amber-500" />;
      case 'fail':
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return null;
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-emerald-500';
    if (score >= 70) return 'text-amber-500';
    return 'text-red-500';
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
            Πίσω στο Dashboard
          </Button>
        </div>
      </nav>

      <div className="container mx-auto px-6 py-12 max-w-6xl">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-500/20 rounded-full mb-4">
            <Brain className="h-8 w-8 text-blue-500" />
          </div>
          <h1 className="text-4xl font-bold text-slate-50 mb-4">AI Fraud Detection Agent</h1>
          <p className="text-xl text-slate-400">Προηγμένη ανίχνευση πλαστών εγγράφων με τεχνητή νοημοσύνη</p>
        </div>

        {!analysisComplete ? (
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Upload Section */}
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <CardTitle className="text-slate-50 flex items-center gap-2">
                  <Upload className="h-5 w-5" />
                  Ανέβασμα Εγγράφου
                </CardTitle>
                <CardDescription className="text-slate-400">
                  Ανεβάστε το έγγραφο για ανάλυση από τον AI Agent
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!preview ? (
                  <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-slate-600 rounded-lg cursor-pointer hover:border-blue-500 transition-colors">
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <Upload className="h-12 w-12 text-slate-400 mb-4" />
                      <p className="mb-2 text-lg text-slate-300">
                        <span className="font-semibold">Κλικ για ανέβασμα</span>
                      </p>
                      <p className="text-sm text-slate-400">PNG, JPG, PDF (MAX. 10MB)</p>
                    </div>
                    <input type="file" className="hidden" accept="image/*,.pdf" onChange={handleFileSelect} />
                  </label>
                ) : (
                  <div>
                    <img src={preview} alt="Document preview" className="w-full h-auto rounded-lg mb-4" />
                    <Button 
                      className="w-full bg-blue-500 hover:bg-blue-600 text-white" 
                      onClick={startAnalysis}
                      disabled={analyzing}
                    >
                      {analyzing ? (
                        <>
                          <Scan className="mr-2 h-4 w-4 animate-spin" />
                          Ανάλυση σε εξέλιξη...
                        </>
                      ) : (
                        <>
                          <Brain className="mr-2 h-4 w-4" />
                          Έναρξη Ανάλυσης AI
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* AI Agent Info */}
            <div className="space-y-6">
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-slate-50">Δυνατότητες AI Agent</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-blue-500 mt-1" />
                    <div>
                      <p className="text-slate-50 font-semibold">Ανάλυση Χαρακτηριστικών Ασφαλείας</p>
                      <p className="text-sm text-slate-400">Έλεγχος υδατογραφημάτων, μικρογραφημάτων, UV στοιχείων</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-blue-500 mt-1" />
                    <div>
                      <p className="text-slate-50 font-semibold">Βιομετρική Επαλήθευση</p>
                      <p className="text-sm text-slate-400">Αναγνώριση προσώπου και έλεγχος ζωντάνιας</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-blue-500 mt-1" />
                    <div>
                      <p className="text-slate-50 font-semibold">Deepfake Detection</p>
                      <p className="text-sm text-slate-400">Ανίχνευση ψηφιακά χειραγωγημένων εικόνων</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-blue-500 mt-1" />
                    <div>
                      <p className="text-slate-50 font-semibold">Cross-Reference Validation</p>
                      <p className="text-sm text-slate-400">Σύγκριση με διεθνείς βάσεις δεδομένων</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-r from-blue-600 to-blue-500 border-0">
                <CardContent className="p-6">
                  <div className="flex items-center gap-4">
                    <Brain className="h-12 w-12 text-white" />
                    <div>
                      <h3 className="text-white font-bold text-lg mb-1">AI-Powered Analysis</h3>
                      <p className="text-blue-50 text-sm">
                        Χρήση προηγμένων αλγορίθμων μηχανικής μάθησης για ακρίβεια 99.97%
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Analysis Results Header */}
            <Card className="bg-gradient-to-r from-emerald-600 to-emerald-500 border-0">
              <CardContent className="p-8">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center">
                      <CheckCircle2 className="h-8 w-8 text-white" />
                    </div>
                    <div>
                      <h2 className="text-3xl font-bold text-white mb-1">Έγγραφο Γνήσιο</h2>
                      <p className="text-emerald-50">Δεν εντοπίστηκαν ενδείξεις πλαστογράφησης</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-5xl font-bold text-white">96%</div>
                    <p className="text-emerald-50">Συνολική Βαθμολογία</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Detailed Analysis */}
            {fraudChecks.map((category, idx) => (
              <Card key={idx} className="bg-slate-800 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-slate-50">{category.category}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {category.checks.map((check, checkIdx) => (
                    <div key={checkIdx} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {getStatusIcon(check.status)}
                          <span className="text-slate-300">{check.name}</span>
                        </div>
                        <span className={`font-bold ${getScoreColor(check.score)}`}>
                          {check.score}%
                        </span>
                      </div>
                      <Progress value={check.score} className="h-2" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}

            {/* AI Agent Insights */}
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <CardTitle className="text-slate-50 flex items-center gap-2">
                  <Brain className="h-5 w-5 text-blue-500" />
                  Ανάλυση AI Agent
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-slate-700 p-4 rounded-lg">
                  <h4 className="text-slate-50 font-semibold mb-2">Θετικά Ευρήματα:</h4>
                  <ul className="space-y-2 text-slate-300 text-sm">
                    <li>✓ Όλα τα χαρακτηριστικά ασφαλείας είναι γνήσια και ανιχνεύσιμα</li>
                    <li>✓ Η βιομετρική ανάλυση επιβεβαιώνει την ταυτότητα του ατόμου</li>
                    <li>✓ Δεν εντοπίστηκαν σημάδια ψηφιακής επεξεργασίας</li>
                    <li>✓ Τα δεδομένα είναι συνεπή και επαληθεύσιμα</li>
                  </ul>
                </div>
                <div className="bg-blue-500/10 border border-blue-500/30 p-4 rounded-lg">
                  <h4 className="text-blue-400 font-semibold mb-2">Σύσταση AI:</h4>
                  <p className="text-slate-300 text-sm">
                    Το έγγραφο έχει περάσει όλους τους ελέγχους επιτυχώς. Συνιστάται η έγκριση της επαλήθευσης ταυτότητας.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Actions */}
            <div className="flex gap-4">
              <Button className="flex-1 bg-blue-500 hover:bg-blue-600 text-white" onClick={() => navigate('/dashboard')}>
                Επιστροφή στο Dashboard
              </Button>
              <Button variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-700" onClick={() => {
                setAnalysisComplete(false);
                setSelectedFile(null);
                setPreview(null);
              }}>
                Νέα Ανάλυση
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}