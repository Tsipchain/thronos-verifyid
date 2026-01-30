import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, Upload, FileCheck, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { toast } from 'sonner';

export default function DocumentUpload() {
  const navigate = useNavigate();
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
      toast.success('Document uploaded successfully');
    }
  };

  const handleRemove = () => {
    setSelectedFile(null);
    setPreview(null);
  };

  const handleSubmit = () => {
    if (selectedFile) {
      toast.success('Document submitted for verification');
      navigate('/verification');
    } else {
      toast.error('Please upload a document first');
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

      <div className="container mx-auto px-6 py-12 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-50 mb-4">Upload Your Documents</h1>
          <p className="text-xl text-slate-400">Please upload a clear photo of your ID document</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-slate-50">Accepted Documents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-slate-300">
              <div className="flex items-center gap-2">
                <FileCheck className="h-5 w-5 text-blue-500" />
                <span>Passport</span>
              </div>
              <div className="flex items-center gap-2">
                <FileCheck className="h-5 w-5 text-blue-500" />
                <span>National ID Card</span>
              </div>
              <div className="flex items-center gap-2">
                <FileCheck className="h-5 w-5 text-blue-500" />
                <span>Driver's License</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-slate-50">Photo Requirements</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-slate-300">
              <div className="flex items-center gap-2">
                <FileCheck className="h-5 w-5 text-blue-500" />
                <span>Clear and readable text</span>
              </div>
              <div className="flex items-center gap-2">
                <FileCheck className="h-5 w-5 text-blue-500" />
                <span>All corners visible</span>
              </div>
              <div className="flex items-center gap-2">
                <FileCheck className="h-5 w-5 text-blue-500" />
                <span>Good lighting, no glare</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-slate-800 border-slate-700">
          <CardHeader>
            <CardTitle className="text-slate-50">Upload Document</CardTitle>
            <CardDescription className="text-slate-400">Drag and drop or click to select</CardDescription>
          </CardHeader>
          <CardContent>
            {!preview ? (
              <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-slate-600 rounded-lg cursor-pointer hover:border-blue-500 transition-colors">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="h-12 w-12 text-slate-400 mb-4" />
                  <p className="mb-2 text-lg text-slate-300">
                    <span className="font-semibold">Click to upload</span> or drag and drop
                  </p>
                  <p className="text-sm text-slate-400">PNG, JPG, PDF (MAX. 10MB)</p>
                </div>
                <input type="file" className="hidden" accept="image/*,.pdf" onChange={handleFileSelect} />
              </label>
            ) : (
              <div className="relative">
                <img src={preview} alt="Document preview" className="w-full h-auto rounded-lg" />
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute top-2 right-2"
                  onClick={handleRemove}
                >
                  <X className="h-4 w-4" />
                </Button>
                <div className="mt-4 p-4 bg-slate-700 rounded-lg">
                  <p className="text-slate-300">
                    <span className="font-semibold">File:</span> {selectedFile?.name}
                  </p>
                  <p className="text-slate-300">
                    <span className="font-semibold">Size:</span> {(selectedFile?.size || 0 / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
              </div>
            )}

            <div className="mt-6 flex gap-4">
              <Button className="flex-1 bg-blue-500 hover:bg-blue-600 text-white" onClick={handleSubmit}>
                Submit for Verification
              </Button>
              <Button variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-700" onClick={() => navigate('/dashboard')}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}