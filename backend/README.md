# Identity Verification Platform - Backend API

## Overview

This is a FastAPI-based backend for an Identity Verification Platform with the following features:

- **Document Verification**: Upload and verify identity documents (passport, national ID, driver's license)
- **Age Verification**: Verify user age based on date of birth
- **KYC Forms**: Complete Know Your Customer forms
- **Video Verification**: Live video verification with agents
- **Digital Signatures**: Capture and store digital signatures
- **AI Fraud Detection**: Advanced fraud analysis using AI

## Technology Stack

- **Framework**: FastAPI 0.110.0+
- **Database**: PostgreSQL with SQLAlchemy 2.0+ (async)
- **Authentication**: JWT tokens with python-jose
- **AI Integration**: OpenAI API for fraud detection
- **Storage**: Object storage for documents and images

## Railway Deployment Notes

### Build/Start configuration

- **Root Directory**: `backend`
- **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- **Nixpacks**: keep the repository root `requirements.txt` pointing at `backend/requirements.txt`

### Required Service Variables

| Variable | Value/Description |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string with asyncpg, e.g. `postgresql+asyncpg://user:pass@host:port/db?sslmode=require` |
| `JWT_SECRET_KEY` | Random secret (64+ chars) |
| `JWT_ALGORITHM` | `HS256` |
| `JWT_EXPIRE_MINUTES` | `43200` (30 days) or desired duration |
| `KYC_AUTH_MODE` | `admin_key` (or `jwt` if full login is implemented) |
| `KYC_ADMIN_KEY` | Random secret (64+ chars) |
| `THRONOS_ADMIN_SECRET` | Secret used to communicate with Thronos node |
| `FRONTEND_URL` | `https://thrchain.vercel.app` |
| `DEV_BASE_URL` | `https://thrchain.vercel.app` (or dev URL) |
| `THRONOS_NODE1_URL` | `https://thrchain.up.railway.app` |
| `THRONOS_NODE2_URL` | `https://node-2.up.railway.app` |
| `THRONOS_AI_CORE_URL` | `https://thronos-v3-6.onrender.com` (if needed) |
| `LOG_LEVEL` | `info` (or `debug` for testing) |
| `NIXPACKS_PYTHON_VERSION` | `3.11` |

OIDC variables (`OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_SCOPE`) are only required when `KYC_AUTH_MODE=oidc`.

## Project Structure

```
backend/
├── alembic/              # Database migrations
├── core/                 # Core configurations
│   ├── auth.py          # Authentication utilities
│   ├── config.py        # Settings and configuration
│   └── database.py      # Database connection
├── dependencies/         # FastAPI dependencies
│   ├── auth.py          # Auth dependencies
│   └── database.py      # DB session dependencies
├── models/              # SQLAlchemy models
│   ├── auth.py          # User model
│   └── verifications.py # Verification models
├── routers/             # API endpoints
│   ├── auth.py          # Authentication endpoints
│   ├── verifications.py # Verification endpoints
│   ├── aihub.py         # AI integration endpoints
│   └── storage.py       # File storage endpoints
├── schemas/             # Pydantic schemas
│   ├── auth.py          # Auth schemas
│   └── verifications.py # Verification schemas
├── services/            # Business logic
│   ├── auth.py          # Auth service
│   ├── verifications.py # Verification service
│   └── database.py      # Database service
├── main.py              # Application entry point
└── requirements.txt     # Python dependencies
```

## Database Models

### DocumentVerifications
- Stores uploaded identity documents
- Fields: document_type, document_number, full_name, date_of_birth, nationality, etc.
- Status tracking: pending, in_progress, completed, failed

### AgeVerifications
- Age verification records
- Calculates age from date of birth
- Boolean verification flag

### KYCForms
- Complete KYC information
- Personal details, address, occupation
- Source of funds tracking

### VideoVerifications
- Video call verification records
- Agent information and session duration
- Verification notes

### DigitalSignatures
- Digital signature storage (Base64)
- Unique signature IDs
- Legal binding status

### FraudAnalysis
- AI-powered fraud detection results
- Multiple scoring categories (0-100):
  - Document quality
  - Security features
  - Biometric analysis
  - Liveness detection
  - Data consistency
  - Manipulation detection
  - Deepfake detection
- Risk level classification (low/medium/high)

## API Endpoints

### Authentication
- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/login` - User login
- `GET /api/v1/auth/me` - Get current user info

### Verifications
- `POST /api/v1/verifications/document` - Create document verification
- `GET /api/v1/verifications/document` - Get document verification
- `POST /api/v1/verifications/age` - Create age verification
- `GET /api/v1/verifications/age` - Get age verification
- `POST /api/v1/verifications/kyc` - Submit KYC form
- `GET /api/v1/verifications/kyc` - Get KYC form
- `POST /api/v1/verifications/video` - Create video verification
- `GET /api/v1/verifications/video` - Get video verification
- `POST /api/v1/verifications/signature` - Create digital signature
- `GET /api/v1/verifications/signature` - Get digital signature
- `POST /api/v1/verifications/fraud-analysis` - Run fraud analysis
- `GET /api/v1/verifications/fraud-analysis` - Get fraud analysis
- `GET /api/v1/verifications/status` - Get complete verification status

### AI Hub
- `POST /api/v1/aihub/gentxt` - Generate text using AI
- `POST /api/v1/aihub/genimg` - Generate images using AI

### Storage
- `POST /api/v1/storage/create-bucket` - Create storage bucket
- `GET /api/v1/storage/list-buckets` - List user buckets
- `GET /api/v1/storage/list-objects` - List objects in bucket
- `POST /api/v1/storage/upload-url` - Get upload presigned URL
- `POST /api/v1/storage/download-url` - Get download presigned URL

## Installation

### Prerequisites
- Python 3.10+
- PostgreSQL 14+
- pip or poetry

### Setup

1. **Clone the repository**
```bash
cd /workspace/app/backend
```

2. **Install dependencies**
```bash
pip install -r requirements.txt
```

3. **Set up environment variables**

Create a `.env` file in the backend directory:

```env
# Database
DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/identity_verification

# JWT Authentication
SECRET_KEY=your-secret-key-here-change-in-production
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30

# API Settings
PORT=8000
DEBUG=true

# OpenAI (for AI fraud detection)
OPENAI_API_KEY=your-openai-api-key

# Storage (if using S3)
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
S3_BUCKET_NAME=identity-verification
```

4. **Initialize the database**

```bash
# Run migrations
alembic upgrade head
```

5. **Run the server**

```bash
# Development mode
python main.py

# Production mode with uvicorn
uvicorn main:app --host 0.0.0.0 --port 8000
```

## Deployment to EXSI 7.01 Server

### Option 1: Docker Deployment (Recommended)

1. **Create Dockerfile**
```dockerfile
FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

2. **Build and run**
```bash
docker build -t identity-verification-backend .
docker run -d -p 8000:8000 --env-file .env identity-verification-backend
```

### Option 2: Direct Deployment

1. **Transfer files to server**
```bash
scp -r backend/ user@your-server:/opt/identity-verification/
```

2. **Install dependencies on server**
```bash
ssh user@your-server
cd /opt/identity-verification/backend
pip install -r requirements.txt
```

3. **Set up systemd service**

Create `/etc/systemd/system/identity-verification.service`:

```ini
[Unit]
Description=Identity Verification Backend
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/identity-verification/backend
Environment="PATH=/usr/local/bin"
ExecStart=/usr/local/bin/uvicorn main:app --host 0.0.0.0 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

4. **Start the service**
```bash
sudo systemctl daemon-reload
sudo systemctl enable identity-verification
sudo systemctl start identity-verification
```

### Option 3: Using Gunicorn + Nginx

1. **Install Gunicorn**
```bash
pip install gunicorn
```

2. **Run with Gunicorn**
```bash
gunicorn main:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
```

3. **Configure Nginx as reverse proxy**

Create `/etc/nginx/sites-available/identity-verification`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

4. **Enable and restart Nginx**
```bash
sudo ln -s /etc/nginx/sites-available/identity-verification /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## Database Setup for Production

### PostgreSQL Setup

1. **Install PostgreSQL**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
```

2. **Create database and user**
```bash
sudo -u postgres psql

CREATE DATABASE identity_verification;
CREATE USER identity_user WITH PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE identity_verification TO identity_user;
\q
```

3. **Update connection string in .env**
```env
DATABASE_URL=postgresql+asyncpg://identity_user:secure_password@localhost:5432/identity_verification
```

4. **Run migrations**
```bash
cd /opt/identity-verification/backend
alembic upgrade head
```

## Security Considerations

1. **Change default SECRET_KEY** in production
2. **Use HTTPS** with SSL certificates (Let's Encrypt)
3. **Enable CORS** only for trusted domains
4. **Set up firewall** rules (UFW or iptables)
5. **Regular backups** of database
6. **Monitor logs** for suspicious activity
7. **Keep dependencies updated**

## Monitoring and Logs

Logs are stored in `backend/logs/` directory with timestamps.

To view logs:
```bash
tail -f logs/app_*.log
```

For systemd service:
```bash
sudo journalctl -u identity-verification -f
```

## API Documentation

Once running, access interactive API documentation at:
- Swagger UI: `http://your-server:8000/docs`
- ReDoc: `http://your-server:8000/redoc`

## Support

For issues or questions, please check the logs or contact the development team.

## License

Proprietary - All rights reserved
