# Secure File Upload System Documentation

## Overview

This document describes the secure file upload system for identity verification documents. The system provides a complete solution for uploading, storing, and managing sensitive documents with client and staff portals.

## Architecture

### Frontend Components

#### 1. File Upload Page (`frontend/src/pages/FileUpload.tsx`)
**Features:**
- Drag-and-drop interface using react-dropzone
- File validation (type, size)
- Real-time upload progress tracking
- Thumbnail generation for images
- File preview and download
- Support for multiple file types

**Supported File Types:**
- Images: JPG, JPEG, PNG, GIF
- Documents: PDF, DOC, DOCX
- Maximum file size: 10MB per file

**Upload Process:**
1. User drags/drops files or clicks to browse
2. Client-side validation (type, size)
3. Thumbnail generation for images (200x200px)
4. Request presigned upload URL from backend
5. Direct upload to S3 using presigned URL
6. Progress tracking (0% → 30% → 50% → 100%)
7. Success/error notification

#### 2. Client Portal (`frontend/src/pages/ClientPortal.tsx`)
**Purpose:** Self-service portal for end customers

**Features:**
- Verification status dashboard
- Overall progress tracking
- Document upload access
- Real-time status updates
- Help and support information

**User Experience:**
- Clean, modern interface
- Mobile-responsive design
- Progress visualization
- Clear status indicators
- Easy navigation

**Status Types:**
- **Pending:** Awaiting document upload
- **In Progress:** Under review by verification team
- **Completed:** Verification successful
- **Failed:** Verification failed (with reason)

### Backend Integration

#### Storage API Endpoints

**POST /api/v1/storage/create-bucket**
Create a storage bucket for documents.

```typescript
// Request
{
  "bucket_name": "verification-documents",
  "visibility": "private"
}

// Response
{
  "bucket_name": "verification-documents",
  "visibility": "private",
  "created_at": "2024-01-27 10:00:00"
}
```

**POST /api/v1/storage/upload-url**
Get presigned URL for uploading a file.

```typescript
// Request
{
  "bucket_name": "verification-documents",
  "object_key": "documents/1706352000-passport.jpg"
}

// Response
{
  "upload_url": "https://s3.amazonaws.com/...",
  "expires_at": "2024-01-27 11:00:00"
}
```

**POST /api/v1/storage/download-url**
Get presigned URL for downloading a file.

```typescript
// Request
{
  "bucket_name": "verification-documents",
  "object_key": "documents/1706352000-passport.jpg"
}

// Response
{
  "download_url": "https://s3.amazonaws.com/...",
  "expires_at": "2024-01-27 11:00:00"
}
```

**GET /api/v1/storage/list-objects**
List all objects in a bucket.

```typescript
// Request
{
  "bucket_name": "verification-documents"
}

// Response
{
  "objects": [
    {
      "object_key": "documents/1706352000-passport.jpg",
      "size": 2048576,
      "last_modified": "2024-01-27 10:00:00",
      "etag": "abc123..."
    }
  ]
}
```

## File Validation

### Client-Side Validation

```typescript
const validateFile = (file: File): string | null => {
  // Check file type
  if (!ALLOWED_TYPES.includes(file.type)) {
    return "File type not allowed";
  }

  // Check file size (10MB max)
  if (file.size > 10 * 1024 * 1024) {
    return "File size exceeds 10MB";
  }

  return null;
};
```

### Allowed File Types

```typescript
const ALLOWED_TYPES = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'application/pdf': ['.pdf'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx']
};
```

## Thumbnail Generation

For image files, the system automatically generates thumbnails:

```typescript
const generateThumbnail = async (file: File): Promise<string> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxSize = 200;
        
        // Calculate dimensions maintaining aspect ratio
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
        canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
};
```

## Upload Flow

### Complete Upload Process

```typescript
const uploadFile = async (file: File) => {
  // 1. Generate object key
  const objectKey = `documents/${Date.now()}-${file.name}`;

  // 2. Create file entry with "uploading" status
  const newFile = {
    id: generateId(),
    name: file.name,
    size: file.size,
    type: file.type,
    object_key: objectKey,
    status: 'uploading',
    progress: 0
  };

  // 3. Generate thumbnail (for images)
  if (file.type.startsWith('image/')) {
    const thumbnail = await generateThumbnail(file);
    newFile.thumbnail_url = thumbnail;
  }

  // 4. Get presigned upload URL
  const urlResponse = await client.apiCall.invoke({
    url: '/api/v1/storage/upload-url',
    method: 'POST',
    data: {
      bucket_name: 'verification-documents',
      object_key: objectKey
    }
  });

  // 5. Upload to S3
  await fetch(urlResponse.data.upload_url, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type }
  });

  // 6. Update status to "success"
  updateFileStatus(newFile.id, 'success', 100);
};
```

## Security Features

### 1. Presigned URLs
- Time-limited access (1 hour expiration)
- No direct S3 credentials exposed
- Separate URLs for upload/download

### 2. File Validation
- Type checking (whitelist approach)
- Size limits (10MB max)
- Client and server-side validation

### 3. Private Buckets
- All documents stored in private buckets
- Access only via presigned URLs
- No public listing

### 4. Authentication
- All API calls require valid JWT token
- User can only access their own files
- Role-based access control

### 5. Encryption
- Files encrypted at rest (S3 server-side encryption)
- HTTPS for all transfers
- Secure presigned URL generation

## Client Portal Features

### Dashboard Overview
- Overall verification progress
- Quick access to upload
- Status summary (completed/in progress/pending)
- Recent activity

### Upload Interface
- Drag-and-drop support
- Multiple file upload
- Real-time progress
- Thumbnail previews
- Error handling

### Status Tracking
- Document-level progress
- Status badges with icons
- Submission dates
- Notes from verification team

### Mobile Support
- Responsive design
- Touch-friendly interface
- Mobile camera integration (future)
- Progressive Web App ready

## Usage Examples

### For Clients (End Users)

**Access Portal:**
1. Navigate to `/client`
2. Login with credentials
3. View verification dashboard

**Upload Documents:**
1. Click "Upload Documents" card
2. Drag files or click to browse
3. Wait for upload completion
4. Return to dashboard to track status

**Check Status:**
1. View "Your Verifications" section
2. Check progress bars
3. Read verification notes
4. Upload additional documents if needed

### For Staff (Internal Users)

**Access Upload Page:**
1. Login to dashboard
2. Navigate to `/upload`
3. Upload documents on behalf of clients

**Manage Files:**
1. View uploaded files list
2. Download files for review
3. Preview images
4. Remove invalid uploads

## Integration with Verification System

### Database Schema

```sql
-- Store file metadata in database
CREATE TABLE document_uploads (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  verification_id INTEGER,
  object_key VARCHAR(500) NOT NULL,
  bucket_name VARCHAR(255) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_size INTEGER NOT NULL,
  file_type VARCHAR(100) NOT NULL,
  thumbnail_url TEXT,
  upload_date TIMESTAMP DEFAULT NOW(),
  status VARCHAR(50) DEFAULT 'pending',
  FOREIGN KEY (verification_id) REFERENCES verifications(id)
);
```

### Linking Files to Verifications

```typescript
// Create verification record
const verification = await client.entities.verifications.create({
  data: {
    document_type: 'passport',
    status: 'pending'
  }
});

// Link uploaded files
await client.entities.document_uploads.create({
  data: {
    verification_id: verification.data.id,
    object_key: file.object_key,
    bucket_name: file.bucket_name,
    file_name: file.name,
    file_size: file.size,
    file_type: file.type
  }
});
```

## Error Handling

### Common Errors

**File Too Large**
```typescript
if (file.size > MAX_FILE_SIZE) {
  toast({
    title: 'File Too Large',
    description: `Maximum file size is ${MAX_FILE_SIZE / 1024 / 1024}MB`,
    variant: 'destructive'
  });
}
```

**Invalid File Type**
```typescript
if (!ALLOWED_TYPES.includes(file.type)) {
  toast({
    title: 'Invalid File Type',
    description: 'Please upload JPG, PNG, PDF, or Word documents',
    variant: 'destructive'
  });
}
```

**Upload Failed**
```typescript
try {
  await uploadFile(file);
} catch (error) {
  toast({
    title: 'Upload Failed',
    description: error.message || 'Please try again',
    variant: 'destructive'
  });
  
  // Update file status to error
  updateFileStatus(file.id, 'error', 0, error.message);
}
```

## Performance Optimization

### 1. Thumbnail Generation
- Generate on client-side (no server load)
- Compress to 70% quality
- Max 200x200px size
- Async processing

### 2. Direct S3 Upload
- No backend proxy
- Parallel uploads
- Reduced server bandwidth
- Faster upload speeds

### 3. Progress Tracking
- Real-time updates
- Smooth animations
- Cancel support (future)

### 4. Lazy Loading
- Load thumbnails on demand
- Paginate file lists
- Virtual scrolling for large lists

## Testing

### Unit Tests

```typescript
describe('File Validation', () => {
  it('should reject files larger than 10MB', () => {
    const largeFile = new File(['x'.repeat(11 * 1024 * 1024)], 'large.jpg');
    expect(validateFile(largeFile)).toBeTruthy();
  });

  it('should accept valid image files', () => {
    const validFile = new File(['data'], 'image.jpg', { type: 'image/jpeg' });
    expect(validateFile(validFile)).toBeNull();
  });
});
```

### Integration Tests

```typescript
describe('File Upload', () => {
  it('should upload file successfully', async () => {
    const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
    const result = await uploadFile(file);
    expect(result.status).toBe('success');
  });
});
```

## Troubleshooting

### Upload Fails
1. Check file size (< 10MB)
2. Verify file type is allowed
3. Check network connection
4. Verify authentication token
5. Check S3 bucket permissions

### Thumbnail Not Generated
1. Verify file is an image
2. Check browser console for errors
3. Ensure file is not corrupted
4. Try different image format

### Download Fails
1. Verify file exists in S3
2. Check presigned URL expiration
3. Verify user permissions
4. Check network connection

## Best Practices

1. **Always validate files client-side first**
2. **Generate thumbnails asynchronously**
3. **Show clear progress indicators**
4. **Handle errors gracefully**
5. **Provide helpful error messages**
6. **Use presigned URLs (never expose credentials)**
7. **Implement retry logic for failed uploads**
8. **Clean up failed uploads**
9. **Log all upload activities**
10. **Regular security audits**

## Future Enhancements

- [ ] Mobile camera integration
- [ ] Drag-and-drop reordering
- [ ] Batch upload with folder support
- [ ] Image cropping/rotation
- [ ] OCR text extraction
- [ ] Automatic document classification
- [ ] Virus scanning
- [ ] Watermarking
- [ ] Version control
- [ ] Upload resume on network failure

## Support

For issues or questions:
- Check browser console for errors
- Review network tab for failed requests
- Verify S3 bucket configuration
- Contact IT support team