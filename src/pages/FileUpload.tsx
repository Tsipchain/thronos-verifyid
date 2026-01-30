import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { createClient } from '@metagptx/web-sdk';
import { rbac } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Upload, 
  X, 
  FileText, 
  Image as ImageIcon, 
  CheckCircle, 
  AlertCircle,
  ArrowLeft,
  Download,
  Eye
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useDropzone } from 'react-dropzone';

const client = createClient();

interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  object_key: string;
  bucket_name: string;
  upload_date: string;
  thumbnail_url?: string;
  status: 'uploading' | 'success' | 'error';
  progress: number;
  error_message?: string;
}

const ALLOWED_TYPES = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'application/pdf': ['.pdf'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx']
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const BUCKET_NAME = 'verification-documents';

export default function FileUpload() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);

  const validateFile = (file: File): string | null => {
    // Check file type
    if (!Object.keys(ALLOWED_TYPES).includes(file.type)) {
      return `File type ${file.type} is not allowed. Allowed types: images (jpg, png, gif), PDF, Word documents`;
    }

    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      return `File size ${(file.size / 1024 / 1024).toFixed(2)}MB exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024}MB`;
    }

    return null;
  };

  const generateThumbnail = async (file: File): Promise<string | undefined> => {
    if (!file.type.startsWith('image/')) return undefined;

    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const maxSize = 200;
          
          let width = img.width;
          let height = img.height;
          
          if (width > height) {
            if (width > maxSize) {
              height *= maxSize / width;
              width = maxSize;
            }
          } else {
            if (height > maxSize) {
              width *= maxSize / height;
              height = maxSize;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          ctx?.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  const uploadFile = async (file: File) => {
    const fileId = `${Date.now()}-${file.name}`;
    const objectKey = `documents/${Date.now()}-${file.name}`;

    // Add file to list with uploading status
    const newFile: UploadedFile = {
      id: fileId,
      name: file.name,
      size: file.size,
      type: file.type,
      object_key: objectKey,
      bucket_name: BUCKET_NAME,
      upload_date: new Date().toISOString(),
      status: 'uploading',
      progress: 0
    };

    setFiles(prev => [...prev, newFile]);

    try {
      // Generate thumbnail for images
      if (file.type.startsWith('image/')) {
        const thumbnail = await generateThumbnail(file);
        setFiles(prev => prev.map(f => 
          f.id === fileId ? { ...f, thumbnail_url: thumbnail } : f
        ));
      }

      // Update progress to 30%
      setFiles(prev => prev.map(f => 
        f.id === fileId ? { ...f, progress: 30 } : f
      ));

      // Step 1: Get upload URL from backend
      const urlResponse = await client.apiCall.invoke({
        url: '/api/v1/storage/upload-url',
        method: 'POST',
        data: {
          bucket_name: BUCKET_NAME,
          object_key: objectKey
        }
      });

      const uploadUrl = urlResponse.data.upload_url;

      // Update progress to 50%
      setFiles(prev => prev.map(f => 
        f.id === fileId ? { ...f, progress: 50 } : f
      ));

      // Step 2: Upload file to S3 using presigned URL
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type
        }
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload file to storage');
      }

      // Update progress to 100%
      setFiles(prev => prev.map(f => 
        f.id === fileId ? { ...f, progress: 100, status: 'success' } : f
      ));

      toast({
        title: 'Upload Successful',
        description: `${file.name} has been uploaded successfully`
      });

    } catch (error) {
      const errorMessage = (error as { data?: { detail?: string }; message?: string })?.data?.detail 
        || (error as { message?: string })?.message 
        || 'Upload failed';

      setFiles(prev => prev.map(f => 
        f.id === fileId ? { 
          ...f, 
          status: 'error', 
          progress: 0,
          error_message: errorMessage 
        } : f
      ));

      toast({
        title: 'Upload Failed',
        description: errorMessage,
        variant: 'destructive'
      });
    }
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    setUploading(true);

    // Validate all files first
    const validFiles: File[] = [];
    for (const file of acceptedFiles) {
      const error = validateFile(file);
      if (error) {
        toast({
          title: 'Invalid File',
          description: error,
          variant: 'destructive'
        });
      } else {
        validFiles.push(file);
      }
    }

    // Upload valid files
    await Promise.all(validFiles.map(file => uploadFile(file)));

    setUploading(false);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ALLOWED_TYPES,
    maxSize: MAX_FILE_SIZE,
    multiple: true
  });

  const removeFile = (fileId: string) => {
    setFiles(prev => prev.filter(f => f.id !== fileId));
  };

  const downloadFile = async (file: UploadedFile) => {
    try {
      const response = await client.apiCall.invoke({
        url: '/api/v1/storage/download-url',
        method: 'POST',
        data: {
          bucket_name: file.bucket_name,
          object_key: file.object_key
        }
      });

      const downloadUrl = response.data.download_url;
      window.open(downloadUrl, '_blank');
    } catch (error) {
      toast({
        title: 'Download Failed',
        description: 'Failed to generate download link',
        variant: 'destructive'
      });
    }
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return ImageIcon;
    return FileText;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <Upload className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-xl font-bold">Document Upload</h1>
              <p className="text-sm text-gray-600">Upload verification documents securely</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Upload Area */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Upload Documents</CardTitle>
            <CardDescription>
              Drag and drop files or click to browse. Max file size: 10MB. 
              Supported formats: Images (JPG, PNG, GIF), PDF, Word documents
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
                isDragActive 
                  ? 'border-blue-500 bg-blue-50' 
                  : 'border-gray-300 hover:border-gray-400'
              }`}
            >
              <input {...getInputProps()} />
              <Upload className="h-12 w-12 mx-auto mb-4 text-gray-400" />
              {isDragActive ? (
                <p className="text-lg font-medium text-blue-600">Drop files here...</p>
              ) : (
                <>
                  <p className="text-lg font-medium text-gray-700 mb-2">
                    Drag & drop files here, or click to select
                  </p>
                  <p className="text-sm text-gray-500">
                    Upload passport, ID cards, or other verification documents
                  </p>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Uploaded Files List */}
        {files.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Uploaded Files ({files.length})</CardTitle>
              <CardDescription>Manage your uploaded documents</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <div className="space-y-4">
                  {files.map((file) => {
                    const FileIcon = getFileIcon(file.type);
                    return (
                      <div
                        key={file.id}
                        className="flex items-center gap-4 p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        {/* Thumbnail or Icon */}
                        <div className="flex-shrink-0">
                          {file.thumbnail_url ? (
                            <img
                              src={file.thumbnail_url}
                              alt={file.name}
                              className="w-16 h-16 object-cover rounded"
                            />
                          ) : (
                            <div className="w-16 h-16 bg-gray-100 rounded flex items-center justify-center">
                              <FileIcon className="h-8 w-8 text-gray-400" />
                            </div>
                          )}
                        </div>

                        {/* File Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-medium text-sm truncate">{file.name}</p>
                            {file.status === 'success' && (
                              <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                            )}
                            {file.status === 'error' && (
                              <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <span>{formatFileSize(file.size)}</span>
                            <span>•</span>
                            <span>{new Date(file.upload_date).toLocaleString()}</span>
                          </div>
                          
                          {/* Progress Bar */}
                          {file.status === 'uploading' && (
                            <div className="mt-2">
                              <Progress value={file.progress} className="h-1" />
                              <p className="text-xs text-gray-500 mt-1">
                                Uploading... {file.progress}%
                              </p>
                            </div>
                          )}

                          {/* Error Message */}
                          {file.status === 'error' && file.error_message && (
                            <p className="text-xs text-red-600 mt-1">{file.error_message}</p>
                          )}

                          {/* Success Badge */}
                          {file.status === 'success' && (
                            <Badge variant="default" className="mt-2 bg-green-600">
                              Uploaded
                            </Badge>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2">
                          {file.status === 'success' && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => downloadFile(file)}
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => downloadFile(file)}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeFile(file.id)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}