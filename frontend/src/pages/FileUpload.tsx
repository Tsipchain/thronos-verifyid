import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '@/lib/auth';
import { apiClient } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Upload,
  X,
  FileText,
  Image as ImageIcon,
  ArrowLeft,
  Clock,
  Users,
  CheckCircle,
  Loader2,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useDropzone } from 'react-dropzone';

interface QueueStatus {
  in_queue: boolean;
  queue_id: number | null;
  queue_position: number;
  available_agents: number;
  status: string;
}

interface UploadResult {
  verification_id: number;
  queue_id: number;
  queue_position: number;
  available_agents: number;
  status: string;
  message: string;
}

const ALLOWED_TYPES = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const DOCUMENT_TYPES = [
  { value: 'national_id', label: 'National ID Card' },
  { value: 'passport', label: 'Passport' },
  { value: 'drivers_license', label: "Driver's License" },
  { value: 'residence_permit', label: 'Residence Permit' },
];

export default function FileUpload() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [documentType, setDocumentType] = useState('national_id');
  const [uploading, setUploading] = useState(false);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const ensureAuth = async () => {
      const user = await authApi.getCurrentUser();
      if (!user) navigate('/login');
    };
    ensureAuth();
    checkExistingQueue();

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [navigate]);

  const checkExistingQueue = async () => {
    try {
      const response = await apiClient.get<QueueStatus>('/api/v1/client/queue-status');
      if (response.data.in_queue) {
        setQueueStatus(response.data);
        startPolling();
      }
    } catch {
      // not in queue — proceed normally
    }
  };

  const startPolling = () => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const response = await apiClient.get<QueueStatus>('/api/v1/client/queue-status');
        setQueueStatus(response.data);
        if (!response.data.in_queue) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch {
        // ignore poll errors
      }
    }, 10000);
  };

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;

      if (file.size > MAX_FILE_SIZE) {
        toast({ title: 'File too large', description: 'Maximum size is 10 MB.', variant: 'destructive' });
        return;
      }

      setSelectedFile(file);

      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onloadend = () => setPreview(reader.result as string);
        reader.readAsDataURL(file);
      } else {
        setPreview(null);
      }
    },
    [toast],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ALLOWED_TYPES,
    maxSize: MAX_FILE_SIZE,
    multiple: false,
  });

  const handleSubmit = async () => {
    if (!selectedFile) {
      toast({ title: 'No file selected', description: 'Please choose a document first.', variant: 'destructive' });
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('document_type', documentType);
      formData.append('priority', 'normal');

      const response = await apiClient.post<UploadResult>('/api/v1/client/upload-document', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setQueueStatus({
        in_queue: true,
        queue_id: response.data.queue_id,
        queue_position: response.data.queue_position,
        available_agents: response.data.available_agents,
        status: 'pending',
      });

      toast({ title: 'Document submitted', description: response.data.message });
      startPolling();
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || 'Upload failed';
      toast({ title: 'Upload failed', description: detail, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  // ── Queue waiting screen ───────────────────────────────────────────────────
  if (queueStatus?.in_queue) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-lg text-center shadow-lg">
          <CardHeader>
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center">
                <Clock className="h-8 w-8 text-blue-600 animate-pulse" />
              </div>
            </div>
            <CardTitle className="text-2xl">You are in the queue</CardTitle>
            <CardDescription>
              Your documents have been submitted. An agent will start a video call with you shortly to
              complete the verification.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            <div className="bg-blue-50 rounded-lg p-6 space-y-3">
              <div className="text-5xl font-bold text-blue-600">#{queueStatus.queue_position}</div>
              <div className="text-sm text-gray-600">Your position in the queue</div>
              <Progress
                value={Math.max(5, 100 - (queueStatus.queue_position - 1) * 20)}
                className="h-2"
              />
            </div>

            <div className="flex items-center justify-center gap-2 text-sm">
              <Users className="h-4 w-4 text-green-600" />
              {queueStatus.available_agents > 0 ? (
                <span className="text-green-700 font-medium">
                  {queueStatus.available_agents} agent{queueStatus.available_agents !== 1 ? 's' : ''}{' '}
                  available
                </span>
              ) : (
                <span className="text-gray-500">No agents online right now — checking every 10 s</span>
              )}
            </div>

            <Badge variant="secondary" className="text-sm px-4 py-1">
              <Loader2 className="h-3 w-3 mr-2 animate-spin" />
              Waiting for agent
            </Badge>

            <p className="text-xs text-gray-400">
              Keep this page open. It updates automatically every 10 seconds. An agent will initiate a
              video call when it is your turn.
            </p>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => navigate('/client')}>
                Back to Portal
              </Button>
              <Button
                variant="ghost"
                className="flex-1 text-red-600 hover:bg-red-50"
                onClick={() => {
                  if (pollRef.current) clearInterval(pollRef.current);
                  pollRef.current = null;
                  setQueueStatus(null);
                  setSelectedFile(null);
                  setPreview(null);
                }}
              >
                Upload Different Document
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Upload form ────────────────────────────────────────────────────────────
  const FileIcon = selectedFile
    ? selectedFile.type.startsWith('image/')
      ? ImageIcon
      : FileText
    : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4">
        <div className="flex items-center gap-4 max-w-3xl mx-auto">
          <Button variant="ghost" size="sm" onClick={() => navigate('/client')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Upload className="h-6 w-6 text-blue-600" />
          <div>
            <h1 className="text-xl font-bold">Upload Verification Document</h1>
            <p className="text-sm text-gray-600">
              Upload your ID and enter the queue for a live agent video verification
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* How it works */}
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-3">
              <CheckCircle className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-blue-800 space-y-1">
                <p className="font-semibold">How verification works</p>
                <ol className="list-decimal list-inside space-y-0.5 text-blue-700">
                  <li>Upload a clear photo of your identity document</li>
                  <li>You are automatically placed in the agent queue</li>
                  <li>The first available agent starts a video call with you</li>
                  <li>The agent confirms your document is genuine</li>
                </ol>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Document type */}
        <Card>
          <CardHeader>
            <CardTitle>Document Type</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {DOCUMENT_TYPES.map((dt) => (
                <button
                  key={dt.value}
                  type="button"
                  onClick={() => setDocumentType(dt.value)}
                  className={`p-3 rounded-lg border-2 text-sm font-medium text-left transition-colors ${
                    documentType === dt.value
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 hover:border-gray-300 text-gray-700'
                  }`}
                >
                  {dt.label}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Drop zone */}
        <Card>
          <CardHeader>
            <CardTitle>Upload Document</CardTitle>
            <CardDescription>JPG, PNG, WebP or PDF — max 10 MB.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedFile ? (
              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
                  isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
                }`}
              >
                <input {...getInputProps()} />
                <Upload className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                {isDragActive ? (
                  <p className="text-lg font-medium text-blue-600">Drop the file here…</p>
                ) : (
                  <>
                    <p className="text-lg font-medium text-gray-700 mb-2">
                      Drag &amp; drop or{' '}
                      <span className="text-blue-600">click to select</span>
                    </p>
                    <p className="text-sm text-gray-500">
                      Make sure all corners are visible and the text is readable
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div className="border rounded-lg p-4 space-y-3">
                {preview ? (
                  <img
                    src={preview}
                    alt="Document preview"
                    className="w-full max-h-64 object-contain rounded"
                  />
                ) : (
                  <div className="flex items-center gap-3 p-4 bg-gray-50 rounded">
                    {FileIcon && <FileIcon className="h-10 w-10 text-gray-500" />}
                    <span className="font-medium text-gray-700">{selectedFile.name}</span>
                  </div>
                )}

                <div className="flex items-center justify-between text-sm text-gray-600 px-1">
                  <span>{selectedFile.name}</span>
                  <span>{formatFileSize(selectedFile.size)}</span>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-600 hover:bg-red-50 w-full"
                  onClick={() => {
                    setSelectedFile(null);
                    setPreview(null);
                  }}
                >
                  <X className="h-4 w-4 mr-2" />
                  Remove and choose another
                </Button>
              </div>
            )}

            <Button
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              disabled={!selectedFile || uploading}
              onClick={handleSubmit}
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Submit Document &amp; Enter Queue
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
