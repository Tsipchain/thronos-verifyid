# Thronos Blockchain Integration with VerifyID Platform
## System Architecture Design Document

**Version:** 1.0  
**Date:** 2026-01-28  
**Author:** Bob (System Architect)  
**Status:** Design Phase

---

## Executive Summary

This document outlines the comprehensive system architecture for integrating the Thronos blockchain ecosystem with the VerifyID identity verification platform. The integration provides immutable audit trails, AI-powered fraud detection, and automated video call queue management for agent verification workflows.

**Key Integration Points:**
- 4-node Thronos blockchain network for distributed verification storage
- SHA256-based document integrity verification
- AI-powered fraud detection via Pythia Node Manager
- Automated video call queue with agent availability management
- Real-time WebSocket communication for call assignments

---

## 1. System Architecture Overview

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    VerifyID Platform (Frontend)                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Client Portal│  │ Agent Dashboard│ │ Manager View │          │
│  │ (Video Call) │  │ (Call Queue)  │  │ (Analytics)  │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                  │                  │                   │
│         └──────────────────┴──────────────────┘                  │
│                            │                                      │
│                    WebSocket + REST API                          │
└────────────────────────────┼────────────────────────────────────┘
                             │
┌────────────────────────────┼────────────────────────────────────┐
│                  VerifyID Backend (FastAPI)                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Video Call Queue Manager                     │  │
│  │  - Agent Availability Tracker                            │  │
│  │  - Call Assignment Logic (Round-robin + Priority)        │  │
│  │  - WebSocket Connection Manager                          │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │           Blockchain Integration Service                  │  │
│  │  - SHA256 Document Hasher                                │  │
│  │  - Transaction Builder                                    │  │
│  │  - Node Health Monitor (4 nodes)                         │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              AI Fraud Detection Service                   │  │
│  │  - Pythia Node Manager Client                            │  │
│  │  - Risk Scoring Engine                                    │  │
│  │  - Document Analysis                                      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                            │                                     │
│                    PostgreSQL Database                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Tables: verifications, video_calls, agent_status,        │  │
│  │         blockchain_transactions, fraud_scores            │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┼────────────────────────────────────┘
                             │
┌────────────────────────────┼────────────────────────────────────┐
│              Thronos Blockchain Ecosystem                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Node 1     │  │   Node 2     │  │   Node 3     │          │
│  │  (Master)    │  │  (Replica)   │  │  (CDN/SDK)   │          │
│  │  Railway     │  │  Railway     │  │  Vercel      │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                  │                  │                   │
│         └──────────────────┴──────────────────┘                  │
│                            │                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Node 4 (AI Core - Render)                   │   │
│  │  - Pythia Node Manager (AI orchestration)               │   │
│  │  - OpenAI GPT-4, Anthropic Claude 3.5, Gemini 2.5      │   │
│  │  - Fraud Detection, Risk Scoring, Document Analysis     │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Component Interaction Flow

**Verification Completion → Video Call Trigger:**
1. User completes document upload (passport, ID)
2. Backend calculates SHA256 hash of documents
3. AI fraud detection analyzes documents (Pythia Node)
4. Verification record stored in PostgreSQL + Thronos blockchain
5. **Automatic trigger**: Video call request added to queue
6. Agent availability system assigns available agent
7. WebSocket notification sent to agent's dashboard
8. Agent accepts call → WebRTC connection established

---

## 2. Automatic Video Call Queue System

### 2.1 Architecture Components

**2.1.1 Queue Manager Service**
```python
# Location: /workspace/app/backend/services/video_call_queue.py

class VideoCallQueueManager:
    """
    Manages the video call queue with priority-based assignment
    """
    - add_to_queue(verification_id, priority, user_info)
    - assign_to_agent(agent_id, call_id)
    - get_pending_calls(agent_id=None, limit=50)
    - update_call_status(call_id, status)
    - get_agent_availability()
    - calculate_priority_score(verification)
```

**2.1.2 Trigger Mechanism**
```python
# Automatic trigger points:

1. Document Verification Complete:
   - Event: verification.status = "documents_uploaded"
   - Action: Create video_call_request with priority=NORMAL
   
2. Fraud Alert Detected:
   - Event: fraud_score > 0.7 (70% risk)
   - Action: Create video_call_request with priority=HIGH
   
3. Manual Request:
   - Event: User clicks "Request Video Verification"
   - Action: Create video_call_request with priority=URGENT
```

**2.1.3 Priority Queue Logic**
```
Priority Levels:
- URGENT (3): Manual requests, compliance flags
- HIGH (2): Fraud alerts, suspicious documents
- NORMAL (1): Standard verification flow
- LOW (0): Re-verification requests

Assignment Algorithm:
1. Sort by: priority DESC, created_at ASC
2. Filter available agents (status=online, current_calls < max_concurrent)
3. Load balancing: Assign to agent with fewest active calls
4. Fallback: Round-robin if all agents have equal load
```

### 2.2 Database Schema

**2.2.1 New Tables**

```sql
-- Video Call Requests Queue
CREATE TABLE video_call_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    verification_id UUID NOT NULL REFERENCES document_verifications(id),
    user_id UUID NOT NULL,
    priority INTEGER NOT NULL DEFAULT 1, -- 0=LOW, 1=NORMAL, 2=HIGH, 3=URGENT
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, assigned, in_progress, completed, cancelled
    assigned_agent_id UUID REFERENCES users(id),
    assigned_at TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    call_duration_seconds INTEGER,
    call_notes TEXT,
    blockchain_tx_hash VARCHAR(66), -- Thronos transaction hash
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    INDEX idx_status_priority (status, priority DESC, created_at ASC),
    INDEX idx_assigned_agent (assigned_agent_id, status),
    INDEX idx_verification (verification_id)
);

-- Agent Availability Status
CREATE TABLE agent_availability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES users(id) UNIQUE,
    status VARCHAR(50) NOT NULL DEFAULT 'offline', -- online, offline, busy, away
    max_concurrent_calls INTEGER DEFAULT 3,
    current_active_calls INTEGER DEFAULT 0,
    last_call_at TIMESTAMP,
    total_calls_today INTEGER DEFAULT 0,
    average_call_duration_seconds INTEGER,
    last_status_change TIMESTAMP DEFAULT NOW(),
    websocket_connection_id VARCHAR(255),
    
    INDEX idx_status (status),
    INDEX idx_agent_id (agent_id)
);

-- Video Call Sessions (WebRTC)
CREATE TABLE video_call_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_request_id UUID NOT NULL REFERENCES video_call_requests(id),
    agent_id UUID NOT NULL REFERENCES users(id),
    user_id UUID NOT NULL,
    webrtc_session_id VARCHAR(255) NOT NULL,
    ice_servers JSONB, -- STUN/TURN server configuration
    started_at TIMESTAMP DEFAULT NOW(),
    ended_at TIMESTAMP,
    connection_quality VARCHAR(50), -- excellent, good, fair, poor
    recording_url TEXT, -- Optional: S3 URL for call recording
    transcript TEXT, -- Optional: AI-generated transcript
    blockchain_tx_hash VARCHAR(66),
    
    INDEX idx_call_request (call_request_id),
    INDEX idx_agent (agent_id),
    INDEX idx_session (webrtc_session_id)
);

-- Blockchain Transaction Log
CREATE TABLE blockchain_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(50) NOT NULL, -- verification, video_call, document
    entity_id UUID NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL UNIQUE,
    thronos_node_url VARCHAR(255) NOT NULL,
    block_number BIGINT,
    data_hash VARCHAR(64) NOT NULL, -- SHA256 hash of data
    transaction_data JSONB NOT NULL,
    gas_used BIGINT,
    status VARCHAR(50) DEFAULT 'pending', -- pending, confirmed, failed
    confirmation_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    confirmed_at TIMESTAMP,
    
    INDEX idx_entity (entity_type, entity_id),
    INDEX idx_tx_hash (transaction_hash),
    INDEX idx_status (status)
);
```

### 2.3 API Endpoints

**2.3.1 Video Call Queue Management**

```
POST /api/v1/video-calls/queue
Description: Add verification to video call queue (automatic trigger)
Request Body:
{
  "verification_id": "uuid",
  "priority": 1,  // 0-3
  "user_info": {
    "name": "John Doe",
    "email": "john@example.com"
  }
}
Response: 201 Created
{
  "call_request_id": "uuid",
  "position_in_queue": 5,
  "estimated_wait_minutes": 15
}

GET /api/v1/video-calls/queue/pending
Description: Get pending video calls (Agent/Manager only)
Query Params: ?limit=50&priority_min=1
Response: 200 OK
{
  "pending_calls": [
    {
      "id": "uuid",
      "verification_id": "uuid",
      "user_name": "John Doe",
      "priority": 2,
      "wait_time_minutes": 12,
      "created_at": "2026-01-28T10:30:00Z"
    }
  ],
  "total_pending": 8,
  "your_active_calls": 1
}

POST /api/v1/video-calls/{call_id}/assign
Description: Assign call to agent (or auto-assign)
Request Body:
{
  "agent_id": "uuid"  // Optional, auto-assign if not provided
}
Response: 200 OK
{
  "assigned_agent_id": "uuid",
  "webrtc_session_id": "session_123",
  "ice_servers": [...]
}

POST /api/v1/video-calls/{call_id}/start
Description: Start video call session
Response: 200 OK
{
  "session_id": "uuid",
  "webrtc_config": {...},
  "blockchain_tx_hash": "0x..."
}

POST /api/v1/video-calls/{call_id}/complete
Description: Complete video call and store on blockchain
Request Body:
{
  "call_notes": "Verification successful",
  "verification_result": "approved",
  "duration_seconds": 300
}
Response: 200 OK
{
  "blockchain_tx_hash": "0x...",
  "call_summary": {...}
}
```

**2.3.2 Agent Availability Management**

```
POST /api/v1/agents/availability/status
Description: Update agent status
Request Body:
{
  "status": "online",  // online, offline, busy, away
  "max_concurrent_calls": 3
}
Response: 200 OK

GET /api/v1/agents/availability
Description: Get all agents availability
Response: 200 OK
{
  "agents": [
    {
      "agent_id": "uuid",
      "name": "Agent Smith",
      "status": "online",
      "current_calls": 1,
      "max_calls": 3,
      "average_call_duration": 420
    }
  ]
}

WebSocket: ws://backend/api/v1/agents/ws/{agent_id}
Description: Real-time call assignment notifications
Messages:
{
  "type": "new_call_assigned",
  "call_id": "uuid",
  "user_name": "John Doe",
  "priority": 2,
  "verification_data": {...}
}
```

---

## 3. Blockchain Integration Architecture

### 3.1 Thronos Node Connection Strategy

**3.1.1 Multi-Node Configuration**

```python
# Location: /workspace/app/backend/core/blockchain_config.py

THRONOS_NODES = {
    "master": {
        "url": "https://thrchain.up.railway.app",
        "role": "write",  # Transaction submission
        "priority": 1,
        "health_check_interval": 30
    },
    "replica": {
        "url": "https://node-2.up.railway.app", 
        "role": "read",  # Query blockchain state
        "priority": 2,
        "health_check_interval": 60
    },
    "cdn": {
        "url": "https://thrchain.vercel.app",
        "role": "static",  # Wallet SDK, static assets
        "priority": 3,
        "health_check_interval": 120
    },
    "ai_core": {
        "url": "https://thronos-v3-6.onrender.com",
        "role": "ai",  # AI fraud detection, risk scoring
        "priority": 1,
        "health_check_interval": 30
    }
}
```

**3.1.2 Node Health Monitoring**

```python
class ThronosNodeHealthMonitor:
    """
    Monitors health of all 4 Thronos nodes
    Implements automatic failover
    """
    
    async def check_node_health(self, node_url: str) -> bool:
        """Ping node /health endpoint"""
        
    async def get_active_write_node(self) -> str:
        """Returns healthy master node, falls back to replica"""
        
    async def get_active_read_node(self) -> str:
        """Returns any healthy node for read operations"""
        
    async def monitor_nodes(self):
        """Background task: Check all nodes every 30s"""
```

### 3.2 SHA256 Document Integrity Implementation

**3.2.1 Hash Calculation Service**

```python
# Location: /workspace/app/backend/services/document_hasher.py

import hashlib
from typing import BinaryIO

class DocumentHasher:
    """
    SHA256 hashing for document integrity verification
    Based on Thronos phantom_whisper_node_sha256.py
    """
    
    @staticmethod
    def calculate_file_hash(file: BinaryIO) -> str:
        """
        Calculate SHA256 hash of uploaded file
        
        Returns: Hex string (64 characters)
        Example: "a3f5b9c2d1e8f7a6b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1"
        """
        sha256_hash = hashlib.sha256()
        
        # Read file in chunks to handle large files
        for byte_block in iter(lambda: file.read(4096), b""):
            sha256_hash.update(byte_block)
        
        return sha256_hash.hexdigest()
    
    @staticmethod
    def calculate_data_hash(data: dict) -> str:
        """
        Calculate SHA256 hash of JSON data
        Used for verification records
        """
        import json
        json_str = json.dumps(data, sort_keys=True)
        return hashlib.sha256(json_str.encode()).hexdigest()
    
    @staticmethod
    async def verify_document_integrity(
        file: BinaryIO, 
        stored_hash: str
    ) -> bool:
        """
        Verify document hasn't been tampered with
        """
        current_hash = DocumentHasher.calculate_file_hash(file)
        return current_hash == stored_hash
```

**3.2.2 Integration with File Upload**

```python
# Modified: /workspace/app/backend/routers/storage.py

@router.post("/upload")
async def upload_document(
    file: UploadFile,
    verification_id: str,
    db: AsyncSession = Depends(get_db)
):
    # 1. Calculate SHA256 hash BEFORE upload
    file_hash = DocumentHasher.calculate_file_hash(file.file)
    
    # 2. Upload to S3/Storage
    file_url = await storage_service.upload(file)
    
    # 3. Store hash in database
    await db.execute(
        "UPDATE document_verifications SET document_hash = :hash WHERE id = :id",
        {"hash": file_hash, "id": verification_id}
    )
    
    # 4. Create blockchain transaction with hash
    tx_hash = await blockchain_service.store_document_hash(
        verification_id=verification_id,
        document_hash=file_hash,
        metadata={"filename": file.filename, "size": file.size}
    )
    
    return {
        "file_url": file_url,
        "document_hash": file_hash,
        "blockchain_tx": tx_hash
    }
```

### 3.3 Transaction Flow for Verification Records

**3.3.1 Blockchain Transaction Builder**

```python
# Location: /workspace/app/backend/services/blockchain_service.py

class ThronosBlockchainService:
    """
    Service for interacting with Thronos blockchain
    """
    
    async def store_verification_record(
        self,
        verification_id: str,
        user_id: str,
        document_hashes: list[str],
        verification_result: str,
        fraud_score: float
    ) -> str:
        """
        Store verification record on Thronos blockchain
        
        Returns: Transaction hash
        """
        # 1. Build transaction data
        tx_data = {
            "type": "identity_verification",
            "verification_id": verification_id,
            "user_id": user_id,
            "timestamp": datetime.utcnow().isoformat(),
            "document_hashes": document_hashes,
            "result": verification_result,
            "fraud_score": fraud_score,
            "platform": "VerifyID"
        }
        
        # 2. Calculate data hash
        data_hash = DocumentHasher.calculate_data_hash(tx_data)
        
        # 3. Submit transaction to Thronos master node
        master_node = await self.health_monitor.get_active_write_node()
        
        response = await self.http_client.post(
            f"{master_node}/api/v1/transactions",
            json={
                "data": tx_data,
                "data_hash": data_hash,
                "sender": "VerifyID_Platform",
                "gas_limit": 100000
            }
        )
        
        tx_hash = response.json()["transaction_hash"]
        
        # 4. Store in local database
        await self.db.execute(
            """
            INSERT INTO blockchain_transactions 
            (entity_type, entity_id, transaction_hash, thronos_node_url, 
             data_hash, transaction_data, status)
            VALUES (:type, :id, :tx_hash, :node, :hash, :data, 'pending')
            """,
            {
                "type": "verification",
                "id": verification_id,
                "tx_hash": tx_hash,
                "node": master_node,
                "hash": data_hash,
                "data": tx_data
            }
        )
        
        # 5. Start background task to monitor confirmation
        asyncio.create_task(self.monitor_transaction_confirmation(tx_hash))
        
        return tx_hash
    
    async def store_video_call_record(
        self,
        call_id: str,
        agent_id: str,
        user_id: str,
        duration_seconds: int,
        call_notes: str
    ) -> str:
        """
        Store video call record on blockchain for audit trail
        """
        tx_data = {
            "type": "video_call_verification",
            "call_id": call_id,
            "agent_id": agent_id,
            "user_id": user_id,
            "timestamp": datetime.utcnow().isoformat(),
            "duration_seconds": duration_seconds,
            "notes_hash": hashlib.sha256(call_notes.encode()).hexdigest(),
            "platform": "VerifyID"
        }
        
        # Similar flow as store_verification_record
        # ...
        
        return tx_hash
    
    async def verify_transaction(self, tx_hash: str) -> dict:
        """
        Verify transaction exists on blockchain
        """
        read_node = await self.health_monitor.get_active_read_node()
        
        response = await self.http_client.get(
            f"{read_node}/api/v1/transactions/{tx_hash}"
        )
        
        return response.json()
    
    async def monitor_transaction_confirmation(self, tx_hash: str):
        """
        Background task: Monitor transaction until confirmed
        """
        max_attempts = 60  # 5 minutes (5s intervals)
        
        for attempt in range(max_attempts):
            await asyncio.sleep(5)
            
            tx_data = await self.verify_transaction(tx_hash)
            
            if tx_data["status"] == "confirmed":
                # Update local database
                await self.db.execute(
                    """
                    UPDATE blockchain_transactions
                    SET status = 'confirmed', 
                        block_number = :block,
                        confirmation_count = :count,
                        confirmed_at = NOW()
                    WHERE transaction_hash = :tx_hash
                    """,
                    {
                        "block": tx_data["block_number"],
                        "count": tx_data["confirmations"],
                        "tx_hash": tx_hash
                    }
                )
                break
```

### 3.4 Smart Contract Integration

**3.4.1 Verification Smart Contract (Solidity)**

```solidity
// Location: /workspace/app/blockchain/contracts/VerificationRegistry.sol

pragma solidity ^0.8.0;

contract VerificationRegistry {
    struct Verification {
        string verificationId;
        address userId;
        string[] documentHashes;
        string result;
        uint256 timestamp;
        uint8 fraudScore;
        bool isActive;
    }
    
    mapping(string => Verification) public verifications;
    mapping(address => string[]) public userVerifications;
    
    event VerificationStored(
        string indexed verificationId,
        address indexed userId,
        string result,
        uint256 timestamp
    );
    
    event VideoCallRecorded(
        string indexed callId,
        address indexed agentId,
        address indexed userId,
        uint256 duration,
        uint256 timestamp
    );
    
    function storeVerification(
        string memory _verificationId,
        address _userId,
        string[] memory _documentHashes,
        string memory _result,
        uint8 _fraudScore
    ) public {
        require(!verifications[_verificationId].isActive, "Verification already exists");
        
        verifications[_verificationId] = Verification({
            verificationId: _verificationId,
            userId: _userId,
            documentHashes: _documentHashes,
            result: _result,
            timestamp: block.timestamp,
            fraudScore: _fraudScore,
            isActive: true
        });
        
        userVerifications[_userId].push(_verificationId);
        
        emit VerificationStored(_verificationId, _userId, _result, block.timestamp);
    }
    
    function getVerification(string memory _verificationId) 
        public 
        view 
        returns (Verification memory) 
    {
        return verifications[_verificationId];
    }
    
    function getUserVerifications(address _userId) 
        public 
        view 
        returns (string[] memory) 
    {
        return userVerifications[_userId];
    }
}
```

**3.4.2 Smart Contract Deployment Script**

```python
# Location: /workspace/app/backend/services/smart_contract_deployer.py

class SmartContractDeployer:
    """
    Deploy and interact with Thronos smart contracts
    """
    
    async def deploy_verification_registry(self) -> str:
        """
        Deploy VerificationRegistry smart contract to Thronos
        
        Returns: Contract address
        """
        master_node = await self.health_monitor.get_active_write_node()
        
        # Read compiled contract bytecode
        with open("contracts/VerificationRegistry.bin", "r") as f:
            bytecode = f.read()
        
        # Deploy contract
        response = await self.http_client.post(
            f"{master_node}/api/v1/contracts/deploy",
            json={
                "bytecode": bytecode,
                "gas_limit": 3000000,
                "sender": "VerifyID_Platform"
            }
        )
        
        contract_address = response.json()["contract_address"]
        
        # Store contract address in database
        await self.db.execute(
            """
            INSERT INTO smart_contracts (name, address, deployed_at)
            VALUES ('VerificationRegistry', :address, NOW())
            """,
            {"address": contract_address}
        )
        
        return contract_address
    
    async def call_contract_method(
        self,
        contract_address: str,
        method_name: str,
        params: list
    ) -> dict:
        """
        Call smart contract method
        """
        master_node = await self.health_monitor.get_active_write_node()
        
        response = await self.http_client.post(
            f"{master_node}/api/v1/contracts/{contract_address}/call",
            json={
                "method": method_name,
                "params": params,
                "gas_limit": 500000
            }
        )
        
        return response.json()
```

---

## 4. Agent Availability Management System

### 4.1 Real-Time Status Tracking

**4.1.1 Agent Status Service**

```python
# Location: /workspace/app/backend/services/agent_status_service.py

class AgentStatusService:
    """
    Manages real-time agent availability and status
    """
    
    def __init__(self, db: AsyncSession):
        self.db = db
        self.redis_client = redis.Redis()  # For real-time status cache
    
    async def update_agent_status(
        self,
        agent_id: str,
        status: str,  # online, offline, busy, away
        websocket_connection_id: str = None
    ):
        """
        Update agent status in database and Redis cache
        """
        # 1. Update database
        await self.db.execute(
            """
            INSERT INTO agent_availability 
            (agent_id, status, websocket_connection_id, last_status_change)
            VALUES (:agent_id, :status, :ws_id, NOW())
            ON CONFLICT (agent_id) DO UPDATE SET
                status = :status,
                websocket_connection_id = :ws_id,
                last_status_change = NOW()
            """,
            {
                "agent_id": agent_id,
                "status": status,
                "ws_id": websocket_connection_id
            }
        )
        
        # 2. Update Redis cache for fast lookup
        await self.redis_client.hset(
            "agent_status",
            agent_id,
            json.dumps({
                "status": status,
                "updated_at": datetime.utcnow().isoformat(),
                "ws_connection": websocket_connection_id
            })
        )
        
        # 3. Broadcast status change to all managers
        await self.websocket_manager.broadcast_to_managers({
            "type": "agent_status_changed",
            "agent_id": agent_id,
            "status": status
        })
    
    async def get_available_agents(self) -> list[dict]:
        """
        Get all available agents for call assignment
        """
        result = await self.db.execute(
            """
            SELECT 
                aa.agent_id,
                u.email,
                u.full_name,
                aa.status,
                aa.current_active_calls,
                aa.max_concurrent_calls,
                aa.average_call_duration_seconds,
                aa.total_calls_today
            FROM agent_availability aa
            JOIN users u ON aa.agent_id = u.id
            WHERE aa.status = 'online'
              AND aa.current_active_calls < aa.max_concurrent_calls
            ORDER BY aa.current_active_calls ASC, aa.last_call_at ASC
            """
        )
        
        return [dict(row) for row in result.fetchall()]
    
    async def increment_active_calls(self, agent_id: str):
        """Increment agent's active call count"""
        await self.db.execute(
            """
            UPDATE agent_availability
            SET current_active_calls = current_active_calls + 1,
                last_call_at = NOW()
            WHERE agent_id = :agent_id
            """,
            {"agent_id": agent_id}
        )
    
    async def decrement_active_calls(self, agent_id: str):
        """Decrement agent's active call count"""
        await self.db.execute(
            """
            UPDATE agent_availability
            SET current_active_calls = GREATEST(current_active_calls - 1, 0),
                total_calls_today = total_calls_today + 1
            WHERE agent_id = :agent_id
            """,
            {"agent_id": agent_id}
        )
```

### 4.2 Load Balancing Algorithm

**4.2.1 Call Assignment Logic**

```python
# Location: /workspace/app/backend/services/call_assignment_service.py

class CallAssignmentService:
    """
    Intelligent call assignment with load balancing
    """
    
    async def assign_call_to_agent(
        self,
        call_request_id: str,
        priority: int
    ) -> str:
        """
        Assign call to best available agent
        
        Returns: agent_id
        """
        # 1. Get available agents
        available_agents = await self.agent_status_service.get_available_agents()
        
        if not available_agents:
            raise NoAgentsAvailableError("All agents are busy")
        
        # 2. Calculate assignment score for each agent
        scored_agents = []
        for agent in available_agents:
            score = self._calculate_assignment_score(agent, priority)
            scored_agents.append((agent, score))
        
        # 3. Sort by score (highest first)
        scored_agents.sort(key=lambda x: x[1], reverse=True)
        
        # 4. Assign to best agent
        best_agent = scored_agents[0][0]
        agent_id = best_agent["agent_id"]
        
        # 5. Update database
        await self.db.execute(
            """
            UPDATE video_call_requests
            SET assigned_agent_id = :agent_id,
                assigned_at = NOW(),
                status = 'assigned'
            WHERE id = :call_id
            """,
            {"agent_id": agent_id, "call_id": call_request_id}
        )
        
        # 6. Increment agent's active call count
        await self.agent_status_service.increment_active_calls(agent_id)
        
        # 7. Send WebSocket notification to agent
        await self.websocket_manager.send_to_agent(agent_id, {
            "type": "new_call_assigned",
            "call_id": call_request_id,
            "priority": priority
        })
        
        return agent_id
    
    def _calculate_assignment_score(
        self,
        agent: dict,
        call_priority: int
    ) -> float:
        """
        Calculate assignment score for agent
        
        Factors:
        - Current load (fewer calls = higher score)
        - Average call duration (faster = higher score)
        - Total calls today (more experience = higher score)
        """
        max_calls = agent["max_concurrent_calls"]
        current_calls = agent["current_active_calls"]
        avg_duration = agent["average_call_duration_seconds"] or 600
        total_today = agent["total_calls_today"]
        
        # Load factor (0-1, higher is better)
        load_factor = 1 - (current_calls / max_calls)
        
        # Efficiency factor (0-1, lower duration is better)
        efficiency_factor = 1 - min(avg_duration / 1200, 1)  # 20 min max
        
        # Experience factor (0-1)
        experience_factor = min(total_today / 20, 1)  # 20 calls = max exp
        
        # Weighted score
        score = (
            load_factor * 0.5 +
            efficiency_factor * 0.3 +
            experience_factor * 0.2
        )
        
        # Priority boost for urgent calls
        if call_priority >= 2:
            score *= 1.2
        
        return score
```

### 4.3 Priority Queue Management

**4.3.1 Queue Reordering**

```python
class VideoCallQueueManager:
    """
    Manages priority queue with dynamic reordering
    """
    
    async def reorder_queue(self):
        """
        Reorder queue based on priority and wait time
        Background task runs every 60 seconds
        """
        # Get all pending calls
        pending_calls = await self.db.execute(
            """
            SELECT id, priority, created_at
            FROM video_call_requests
            WHERE status = 'pending'
            ORDER BY priority DESC, created_at ASC
            """
        )
        
        for call in pending_calls:
            wait_time_minutes = (datetime.utcnow() - call.created_at).seconds / 60
            
            # Escalate priority if waiting too long
            if wait_time_minutes > 30 and call.priority < 2:
                await self.escalate_priority(call.id)
            
            # Try to assign if agents available
            available_agents = await self.agent_status_service.get_available_agents()
            if available_agents:
                await self.call_assignment_service.assign_call_to_agent(
                    call.id,
                    call.priority
                )
    
    async def escalate_priority(self, call_id: str):
        """Escalate call priority due to long wait time"""
        await self.db.execute(
            """
            UPDATE video_call_requests
            SET priority = LEAST(priority + 1, 3)
            WHERE id = :call_id
            """,
            {"call_id": call_id}
        )
```

---

## 5. Call Agent Tab Design

### 5.1 UI/UX Specifications

**5.1.1 Agent Dashboard Layout**

```
┌─────────────────────────────────────────────────────────────────┐
│  Agent Dashboard - Video Call Queue                             │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Status: ● Online  │  Active Calls: 1/3  │  Queue: 8    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Pending Video Calls                                      │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │ 🔴 URGENT │ John Doe │ Wait: 15m │ [Accept Call]   │  │  │
│  │  │ Verification ID: #12345                            │  │  │
│  │  │ Documents: Passport, ID Card                       │  │  │
│  │  │ Fraud Score: 0.85 (High Risk)                      │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │ 🟠 HIGH │ Jane Smith │ Wait: 8m │ [Accept Call]    │  │  │
│  │  │ Verification ID: #12346                            │  │  │
│  │  │ Documents: Driver License                          │  │  │
│  │  │ Fraud Score: 0.72 (Medium Risk)                    │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │ 🟢 NORMAL │ Bob Johnson │ Wait: 5m │ [Accept Call] │  │  │
│  │  │ Verification ID: #12347                            │  │  │
│  │  │ Documents: Passport                                │  │  │
│  │  │ Fraud Score: 0.15 (Low Risk)                       │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Active Call - John Doe                                   │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │                                                      │  │  │
│  │  │           [Video Call Interface]                    │  │  │
│  │  │                                                      │  │  │
│  │  │  Duration: 05:23  │  Quality: Good                  │  │  │
│  │  │  [End Call] [Mute] [Camera Off] [Share Screen]     │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  │  Call Notes:                                              │  │
│  │  [Text area for agent notes]                             │  │
│  │  Verification Result: ○ Approve  ○ Reject  ○ Review     │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**5.1.2 Manager Dashboard Layout**

```
┌─────────────────────────────────────────────────────────────────┐
│  Manager Dashboard - Video Call Analytics                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Real-Time Metrics                                        │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │  │
│  │  │ Agents   │ │ Active   │ │ Pending  │ │ Avg Wait │   │  │
│  │  │ Online   │ │ Calls    │ │ Queue    │ │ Time     │   │  │
│  │  │   5/8    │ │    7     │ │    12    │ │  8 min   │   │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Agent Status Overview                                    │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │ Agent Smith     │ ● Online  │ Calls: 2/3 │ 95% Sat │  │  │
│  │  │ Agent Johnson   │ ● Online  │ Calls: 1/3 │ 88% Sat │  │  │
│  │  │ Agent Williams  │ ⚫ Busy    │ Calls: 3/3 │ 92% Sat │  │  │
│  │  │ Agent Brown     │ ○ Away    │ Calls: 0/3 │ 90% Sat │  │  │
│  │  │ Agent Davis     │ ⚪ Offline │ Calls: 0/3 │ 87% Sat │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Priority Queue Distribution                              │  │
│  │  [Bar Chart: URGENT: 2, HIGH: 5, NORMAL: 5, LOW: 0]     │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Frontend Components

**5.2.1 VideoCallQueue Component**

```tsx
// Location: /workspace/app/frontend/src/pages/VideoCallQueue.tsx

import { useEffect, useState } from 'react';
import { createClient } from '@metagptx/web-sdk';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Video, Clock, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const client = createClient();

interface VideoCallRequest {
  id: string;
  verification_id: string;
  user_name: string;
  priority: number;
  wait_time_minutes: number;
  fraud_score: number;
  documents: string[];
  created_at: string;
}

export default function VideoCallQueue() {
  const [pendingCalls, setPendingCalls] = useState<VideoCallRequest[]>([]);
  const [activeCalls, setActiveCalls] = useState<number>(0);
  const [agentStatus, setAgentStatus] = useState<string>('offline');
  const { toast } = useToast();
  
  useEffect(() => {
    // Connect to WebSocket for real-time updates
    const ws = new WebSocket(`wss://backend/api/v1/agents/ws/${agentId}`);
    
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      if (message.type === 'new_call_assigned') {
        toast({
          title: '🔔 New Call Assigned',
          description: `${message.user_name} is waiting for verification`,
        });
        fetchPendingCalls();
      }
    };
    
    fetchPendingCalls();
    
    return () => ws.close();
  }, []);
  
  const fetchPendingCalls = async () => {
    try {
      const response = await client.request({
        url: '/api/v1/video-calls/queue/pending',
        method: 'GET'
      });
      
      setPendingCalls(response.data.pending_calls);
      setActiveCalls(response.data.your_active_calls);
    } catch (error) {
      console.error('Failed to fetch pending calls:', error);
    }
  };
  
  const acceptCall = async (callId: string) => {
    try {
      const response = await client.request({
        url: `/api/v1/video-calls/${callId}/start`,
        method: 'POST'
      });
      
      // Open video call interface
      window.open(`/video-call/${callId}`, '_blank');
      
      toast({
        title: 'Call Started',
        description: 'Video call interface opened',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to start call',
        variant: 'destructive'
      });
    }
  };
  
  const getPriorityBadge = (priority: number) => {
    const badges = {
      3: { label: 'URGENT', color: 'bg-red-500', icon: '🔴' },
      2: { label: 'HIGH', color: 'bg-orange-500', icon: '🟠' },
      1: { label: 'NORMAL', color: 'bg-green-500', icon: '🟢' },
      0: { label: 'LOW', color: 'bg-gray-500', icon: '⚪' }
    };
    
    const badge = badges[priority] || badges[1];
    
    return (
      <Badge className={badge.color}>
        {badge.icon} {badge.label}
      </Badge>
    );
  };
  
  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Video Call Queue</h1>
        <div className="flex gap-4 mt-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{activeCalls}/3</div>
              <div className="text-sm text-gray-500">Active Calls</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{pendingCalls.length}</div>
              <div className="text-sm text-gray-500">Pending Queue</div>
            </CardContent>
          </Card>
        </div>
      </div>
      
      <div className="space-y-4">
        {pendingCalls.map((call) => (
          <Card key={call.id} className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    {getPriorityBadge(call.priority)}
                    <span className="font-semibold text-lg">{call.user_name}</span>
                  </div>
                  <div className="text-sm text-gray-500">
                    Verification ID: #{call.verification_id}
                  </div>
                </div>
                <Button onClick={() => acceptCall(call.id)}>
                  <Video className="mr-2 h-4 w-4" />
                  Accept Call
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-sm text-gray-500">Wait Time</div>
                  <div className="flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    {call.wait_time_minutes} minutes
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-500">Fraud Score</div>
                  <div className="flex items-center gap-1">
                    {call.fraud_score > 0.7 && <AlertTriangle className="h-4 w-4 text-red-500" />}
                    {(call.fraud_score * 100).toFixed(0)}%
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-500">Documents</div>
                  <div>{call.documents.join(', ')}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

### 5.3 Role-Based Access Control

**5.3.1 Permission Configuration**

```python
# Location: /workspace/app/backend/services/rbac.py

# Add new permissions for video call management
VIDEO_CALL_PERMISSIONS = {
    "video_calls.view_queue": "View video call queue",
    "video_calls.accept": "Accept and start video calls",
    "video_calls.manage": "Manage all video calls (assign, reassign)",
    "video_calls.analytics": "View video call analytics and reports"
}

# Role assignments
ROLE_PERMISSIONS_UPDATE = {
    "kyc_agent": [
        "video_calls.view_queue",
        "video_calls.accept"
    ],
    "manager": [
        "video_calls.view_queue",
        "video_calls.accept",
        "video_calls.manage",
        "video_calls.analytics"
    ],
    "it_staff": [
        "video_calls.view_queue",
        "video_calls.manage",
        "video_calls.analytics"
    ]
}
```

**5.3.2 Route Protection**

```python
# Location: /workspace/app/backend/routers/video_call.py

from core.auth import require_permission

@router.get("/queue/pending")
@require_permission("video_calls.view_queue")
async def get_pending_calls(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get pending video calls (Agent/Manager only)"""
    # Implementation
    pass

@router.post("/{call_id}/assign")
@require_permission("video_calls.manage")
async def assign_call(
    call_id: str,
    agent_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Assign call to agent (Manager only)"""
    # Implementation
    pass
```

### 5.4 Real-Time Updates via WebSocket

**5.4.1 WebSocket Connection Manager**

```python
# Location: /workspace/app/backend/services/websocket_manager.py

from fastapi import WebSocket
from typing import Dict, List

class VideoCallWebSocketManager:
    """
    Manages WebSocket connections for real-time video call updates
    """
    
    def __init__(self):
        # agent_id -> WebSocket connection
        self.agent_connections: Dict[str, WebSocket] = {}
        
        # manager_id -> WebSocket connection
        self.manager_connections: Dict[str, WebSocket] = {}
    
    async def connect_agent(self, agent_id: str, websocket: WebSocket):
        """Register agent WebSocket connection"""
        await websocket.accept()
        self.agent_connections[agent_id] = websocket
        
        # Update agent status to online
        await self.agent_status_service.update_agent_status(
            agent_id=agent_id,
            status="online",
            websocket_connection_id=str(id(websocket))
        )
    
    async def disconnect_agent(self, agent_id: str):
        """Unregister agent WebSocket connection"""
        if agent_id in self.agent_connections:
            del self.agent_connections[agent_id]
        
        # Update agent status to offline
        await self.agent_status_service.update_agent_status(
            agent_id=agent_id,
            status="offline"
        )
    
    async def send_to_agent(self, agent_id: str, message: dict):
        """Send message to specific agent"""
        if agent_id in self.agent_connections:
            websocket = self.agent_connections[agent_id]
            await websocket.send_json(message)
    
    async def broadcast_to_managers(self, message: dict):
        """Broadcast message to all managers"""
        for websocket in self.manager_connections.values():
            await websocket.send_json(message)
    
    async def notify_new_call(self, call_request: dict):
        """Notify all online agents about new call in queue"""
        message = {
            "type": "new_call_in_queue",
            "call_id": call_request["id"],
            "user_name": call_request["user_name"],
            "priority": call_request["priority"],
            "queue_position": call_request["queue_position"]
        }
        
        for agent_id, websocket in self.agent_connections.items():
            await websocket.send_json(message)
```

**5.4.2 WebSocket Endpoint**

```python
# Location: /workspace/app/backend/routers/video_call.py

@router.websocket("/ws/{agent_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    agent_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    WebSocket endpoint for real-time agent notifications
    """
    await websocket_manager.connect_agent(agent_id, websocket)
    
    try:
        while True:
            # Keep connection alive and handle incoming messages
            data = await websocket.receive_json()
            
            if data["type"] == "ping":
                await websocket.send_json({"type": "pong"})
            
            elif data["type"] == "status_update":
                await agent_status_service.update_agent_status(
                    agent_id=agent_id,
                    status=data["status"]
                )
    
    except WebSocketDisconnect:
        await websocket_manager.disconnect_agent(agent_id)
```

---

## 6. AI Core Node Integration

### 6.1 Pythia Node Manager Integration

**6.1.1 AI Service Client**

```python
# Location: /workspace/app/backend/services/thronos_ai_service.py

import httpx
from typing import Dict, List

class ThronosAIService:
    """
    Client for Thronos AI Core Node (Pythia Node Manager)
    """
    
    def __init__(self):
        self.ai_node_url = "https://thronos-v3-6.onrender.com"
        self.http_client = httpx.AsyncClient(timeout=30.0)
    
    async def analyze_document_fraud(
        self,
        document_images: List[str],  # Base64 encoded images
        user_info: Dict
    ) -> Dict:
        """
        AI-powered fraud detection for identity documents
        
        Uses Pythia Node Manager's AI capabilities:
        - OpenAI GPT-4 Vision for document analysis
        - Anthropic Claude 3.5 for text extraction
        - Custom fraud detection models
        
        Returns:
        {
            "fraud_score": 0.85,  # 0-1, higher = more suspicious
            "risk_level": "high",  # low, medium, high
            "flags": [
                "Document quality poor",
                "Face mismatch detected",
                "Potential tampering"
            ],
            "confidence": 0.92,
            "analysis_details": {...}
        }
        """
        try:
            response = await self.http_client.post(
                f"{self.ai_node_url}/api/v1/ai/fraud-detection",
                json={
                    "documents": document_images,
                    "user_info": user_info,
                    "model": "gpt-4-vision-preview",
                    "analysis_depth": "comprehensive"
                }
            )
            
            return response.json()
        
        except Exception as e:
            logger.error(f"AI fraud detection failed: {e}")
            # Fallback to rule-based detection
            return self._fallback_fraud_detection(document_images, user_info)
    
    async def generate_risk_score(
        self,
        verification_data: Dict
    ) -> float:
        """
        Generate comprehensive risk score using AI
        
        Factors analyzed:
        - Document authenticity
        - Face matching accuracy
        - Behavioral patterns
        - Historical data
        - Cross-reference with known fraud patterns
        """
        response = await self.http_client.post(
            f"{self.ai_node_url}/api/v1/ai/risk-scoring",
            json={
                "verification_data": verification_data,
                "model": "claude-3-5-sonnet",
                "include_reasoning": True
            }
        )
        
        result = response.json()
        return result["risk_score"]
    
    async def extract_document_data(
        self,
        document_image: str
    ) -> Dict:
        """
        Extract structured data from identity documents using AI OCR
        
        Returns:
        {
            "document_type": "passport",
            "full_name": "John Doe",
            "date_of_birth": "1990-01-15",
            "document_number": "AB123456",
            "expiry_date": "2030-01-15",
            "nationality": "US",
            "extracted_fields": {...}
        }
        """
        response = await self.http_client.post(
            f"{self.ai_node_url}/api/v1/ai/document-extraction",
            json={
                "image": document_image,
                "model": "gemini-2.5-flash",
                "language": "auto"
            }
        )
        
        return response.json()
    
    async def analyze_video_call_behavior(
        self,
        video_frames: List[str],  # Sample frames from video call
        audio_transcript: str
    ) -> Dict:
        """
        Analyze user behavior during video call for suspicious patterns
        
        Returns:
        {
            "behavior_score": 0.15,  # 0-1, higher = more suspicious
            "flags": ["nervous_behavior", "script_reading"],
            "confidence": 0.88,
            "recommendations": ["request_additional_verification"]
        }
        """
        response = await self.http_client.post(
            f"{self.ai_node_url}/api/v1/ai/behavior-analysis",
            json={
                "video_frames": video_frames,
                "transcript": audio_transcript,
                "model": "gpt-4-vision-preview"
            }
        )
        
        return response.json()
    
    def _fallback_fraud_detection(
        self,
        document_images: List[str],
        user_info: Dict
    ) -> Dict:
        """
        Rule-based fraud detection fallback
        """
        # Simple rule-based checks
        fraud_score = 0.0
        flags = []
        
        # Check document quality
        if len(document_images) < 2:
            fraud_score += 0.2
            flags.append("Insufficient documents")
        
        # Check user info completeness
        required_fields = ["name", "email", "date_of_birth"]
        missing_fields = [f for f in required_fields if f not in user_info]
        if missing_fields:
            fraud_score += 0.1 * len(missing_fields)
            flags.append(f"Missing fields: {', '.join(missing_fields)}")
        
        risk_level = "low"
        if fraud_score > 0.7:
            risk_level = "high"
        elif fraud_score > 0.4:
            risk_level = "medium"
        
        return {
            "fraud_score": fraud_score,
            "risk_level": risk_level,
            "flags": flags,
            "confidence": 0.6,
            "analysis_details": {"method": "rule_based_fallback"}
        }
```

### 6.2 Integration with Verification Workflow

**6.2.1 Enhanced Verification Service**

```python
# Location: /workspace/app/backend/services/verifications.py

class VerificationService:
    """
    Enhanced verification service with AI integration
    """
    
    def __init__(self, db: AsyncSession):
        self.db = db
        self.ai_service = ThronosAIService()
        self.blockchain_service = ThronosBlockchainService()
        self.queue_manager = VideoCallQueueManager()
    
    async def process_document_verification(
        self,
        verification_id: str,
        document_files: List[UploadFile],
        user_info: Dict
    ) -> Dict:
        """
        Complete document verification workflow with AI and blockchain
        """
        # 1. Calculate SHA256 hashes
        document_hashes = []
        document_images = []
        
        for file in document_files:
            file_hash = DocumentHasher.calculate_file_hash(file.file)
            document_hashes.append(file_hash)
            
            # Convert to base64 for AI analysis
            file.file.seek(0)
            image_base64 = base64.b64encode(file.file.read()).decode()
            document_images.append(image_base64)
        
        # 2. AI fraud detection
        fraud_analysis = await self.ai_service.analyze_document_fraud(
            document_images=document_images,
            user_info=user_info
        )
        
        # 3. Extract document data using AI OCR
        extracted_data = await self.ai_service.extract_document_data(
            document_image=document_images[0]
        )
        
        # 4. Store verification in database
        await self.db.execute(
            """
            UPDATE document_verifications
            SET document_hashes = :hashes,
                fraud_score = :fraud_score,
                risk_level = :risk_level,
                extracted_data = :data,
                status = 'documents_uploaded'
            WHERE id = :id
            """,
            {
                "hashes": document_hashes,
                "fraud_score": fraud_analysis["fraud_score"],
                "risk_level": fraud_analysis["risk_level"],
                "data": extracted_data,
                "id": verification_id
            }
        )
        
        # 5. Store on blockchain
        tx_hash = await self.blockchain_service.store_verification_record(
            verification_id=verification_id,
            user_id=user_info["user_id"],
            document_hashes=document_hashes,
            verification_result="pending_video_call",
            fraud_score=fraud_analysis["fraud_score"]
        )
        
        # 6. **AUTOMATIC TRIGGER**: Add to video call queue
        priority = self._calculate_call_priority(fraud_analysis["fraud_score"])
        
        call_request_id = await self.queue_manager.add_to_queue(
            verification_id=verification_id,
            priority=priority,
            user_info=user_info
        )
        
        # 7. Try to assign to available agent
        try:
            await self.queue_manager.assign_call_to_agent(call_request_id)
        except NoAgentsAvailableError:
            # Will be assigned when agent becomes available
            pass
        
        return {
            "verification_id": verification_id,
            "fraud_analysis": fraud_analysis,
            "extracted_data": extracted_data,
            "blockchain_tx": tx_hash,
            "video_call_request_id": call_request_id,
            "status": "pending_video_call"
        }
    
    def _calculate_call_priority(self, fraud_score: float) -> int:
        """
        Calculate video call priority based on fraud score
        """
        if fraud_score >= 0.7:
            return 2  # HIGH priority
        elif fraud_score >= 0.4:
            return 1  # NORMAL priority
        else:
            return 0  # LOW priority
```

---

## 7. Data Flow Diagrams

### 7.1 Complete Verification Flow

```
User Upload Documents
        │
        ▼
┌───────────────────────┐
│ Calculate SHA256 Hash │
└───────┬───────────────┘
        │
        ▼
┌───────────────────────┐
│ Upload to S3 Storage  │
└───────┬───────────────┘
        │
        ▼
┌───────────────────────────────┐
│ AI Fraud Detection            │
│ (Thronos AI Core Node)        │
│ - Document Analysis           │
│ - Face Matching               │
│ - Risk Scoring                │
└───────┬───────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ Store in PostgreSQL           │
│ - Verification record         │
│ - Document hashes             │
│ - Fraud score                 │
└───────┬───────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ Store on Thronos Blockchain   │
│ - Transaction with SHA256     │
│ - Immutable audit trail       │
└───────┬───────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ **AUTOMATIC TRIGGER**         │
│ Add to Video Call Queue       │
│ - Priority based on fraud     │
│ - User notification           │
└───────┬───────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ Agent Assignment Logic        │
│ - Check available agents      │
│ - Load balancing              │
│ - WebSocket notification      │
└───────┬───────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ Agent Accepts Call            │
│ - WebRTC connection           │
│ - Video call session starts   │
└───────┬───────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ Video Call Verification       │
│ - Live agent review           │
│ - AI behavior analysis        │
│ - Call recording (optional)   │
└───────┬───────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ Call Completion               │
│ - Agent notes                 │
│ - Verification result         │
│ - Store on blockchain         │
└───────┬───────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ Final Verification Status     │
│ - Approved / Rejected         │
│ - User notification           │
│ - Blockchain confirmation     │
└───────────────────────────────┘
```

### 7.2 Agent Assignment Flow

```
Video Call Request Created
        │
        ▼
┌───────────────────────────────┐
│ Add to Priority Queue         │
│ - Calculate priority          │
│ - Insert with timestamp       │
└───────┬───────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ Query Available Agents        │
│ SELECT * FROM agent_availability│
│ WHERE status = 'online'       │
│   AND current_calls < max     │
└───────┬───────────────────────┘
        │
        ├─── No agents available ───┐
        │                            │
        ▼                            ▼
┌───────────────────┐    ┌──────────────────┐
│ Agents Available  │    │ Stay in Queue    │
└───────┬───────────┘    │ Wait for agent   │
        │                └──────────────────┘
        ▼
┌───────────────────────────────┐
│ Calculate Assignment Score    │
│ For each agent:               │
│ - Load factor (50%)           │
│ - Efficiency factor (30%)     │
│ - Experience factor (20%)     │
└───────┬───────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ Select Best Agent             │
│ - Highest score               │
│ - Least current calls         │
└───────┬───────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ Update Database               │
│ - Assign call to agent        │
│ - Increment active calls      │
└───────┬───────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ Send WebSocket Notification   │
│ - Agent receives alert        │
│ - Call details displayed      │
└───────────────────────────────┘
```

### 7.3 Blockchain Transaction Flow

```
Verification Data Ready
        │
        ▼
┌───────────────────────────────┐
│ Build Transaction Data        │
│ {                             │
│   type: "verification",       │
│   verification_id: "...",     │
│   document_hashes: [...],     │
│   fraud_score: 0.85,          │
│   timestamp: "..."            │
│ }                             │
└───────┬───────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ Calculate Data Hash (SHA256)  │
│ hash = sha256(json_data)      │
└───────┬───────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ Check Node Health             │
│ - Master node available?      │
│ - Fallback to replica         │
└───────┬───────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ Submit Transaction            │
│ POST /api/v1/transactions     │
│ to Thronos master node        │
└───────┬───────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ Receive Transaction Hash      │
│ tx_hash = "0x..."             │
└───────┬───────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ Store in Local Database       │
│ blockchain_transactions table │
│ status = 'pending'            │
└───────┬───────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ Background Monitoring Task    │
│ Check every 5 seconds         │
│ GET /api/v1/transactions/{tx} │
└───────┬───────────────────────┘
        │
        ├─── Pending ───┐
        │               │
        ▼               ▼
┌──────────────┐  ┌──────────────┐
│ Confirmed    │  │ Keep Waiting │
│ Update DB    │  │ Max 5 min    │
│ Notify User  │  └──────────────┘
└──────────────┘
```

---

## 8. Security Considerations

### 8.1 Data Security

**8.1.1 Document Storage Security**

```python
# Encrypted storage for sensitive documents
class SecureDocumentStorage:
    """
    Secure document storage with encryption
    """
    
    def __init__(self):
        self.encryption_key = os.getenv("DOCUMENT_ENCRYPTION_KEY")
        self.fernet = Fernet(self.encryption_key)
    
    async def store_encrypted_document(
        self,
        file: UploadFile,
        verification_id: str
    ) -> str:
        """
        Encrypt document before storing
        """
        # 1. Read file content
        content = await file.read()
        
        # 2. Encrypt content
        encrypted_content = self.fernet.encrypt(content)
        
        # 3. Calculate hash of original content
        original_hash = hashlib.sha256(content).hexdigest()
        
        # 4. Upload encrypted content to S3
        file_url = await self.s3_client.upload(
            encrypted_content,
            f"verifications/{verification_id}/{file.filename}"
        )
        
        return file_url, original_hash
```

**8.1.2 Blockchain Transaction Security**

```python
# Digital signatures for blockchain transactions
class BlockchainTransactionSigner:
    """
    Sign transactions before submitting to blockchain
    """
    
    def __init__(self):
        self.private_key = os.getenv("BLOCKCHAIN_PRIVATE_KEY")
    
    def sign_transaction(self, tx_data: dict) -> str:
        """
        Create digital signature for transaction
        """
        # 1. Serialize transaction data
        tx_json = json.dumps(tx_data, sort_keys=True)
        
        # 2. Calculate hash
        tx_hash = hashlib.sha256(tx_json.encode()).hexdigest()
        
        # 3. Sign with private key
        signature = self._sign_with_private_key(tx_hash)
        
        return signature
```

### 8.2 Video Call Security

**8.2.1 WebRTC Security**

```python
# Secure WebRTC configuration
WEBRTC_CONFIG = {
    "iceServers": [
        {
            "urls": "stun:stun.l.google.com:19302"
        },
        {
            "urls": "turn:turn.verifyid.com:3478",
            "username": "verifyid",
            "credential": os.getenv("TURN_SERVER_PASSWORD")
        }
    ],
    "iceCandidatePoolSize": 10,
    "bundlePolicy": "max-bundle",
    "rtcpMuxPolicy": "require",
    "sdpSemantics": "unified-plan"
}
```

**8.2.2 Call Recording Security**

```python
# Encrypted call recording storage
class CallRecordingService:
    """
    Secure call recording with encryption
    """
    
    async def store_call_recording(
        self,
        call_id: str,
        video_file: bytes
    ) -> str:
        """
        Encrypt and store call recording
        """
        # 1. Encrypt video file
        encrypted_video = self.fernet.encrypt(video_file)
        
        # 2. Upload to secure S3 bucket
        recording_url = await self.s3_client.upload(
            encrypted_video,
            f"call-recordings/{call_id}.enc",
            bucket="verifyid-recordings-encrypted"
        )
        
        # 3. Store blockchain hash
        recording_hash = hashlib.sha256(video_file).hexdigest()
        await self.blockchain_service.store_recording_hash(
            call_id=call_id,
            recording_hash=recording_hash
        )
        
        return recording_url
```

### 8.3 Access Control

**8.3.1 API Authentication**

```python
# JWT token validation with role checking
async def verify_video_call_access(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db)
) -> User:
    """
    Verify user has access to video call features
    """
    # 1. Validate JWT token
    payload = jwt.decode(token, settings.jwt_secret_key, algorithms=["HS256"])
    user_id = payload.get("sub")
    
    # 2. Get user from database
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    # 3. Check role permissions
    if not rbac.has_permission(user, "video_calls.view_queue"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    return user
```

### 8.4 Rate Limiting

```python
# Rate limiting for API endpoints
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

@router.post("/queue")
@limiter.limit("10/minute")
async def add_to_queue(
    request: Request,
    verification_id: str
):
    """
    Rate-limited endpoint to prevent abuse
    """
    pass
```

---

## 9. Integration Points with Existing Codebase

### 9.1 Modified Files

**9.1.1 Backend Files to Modify**

```
/workspace/app/backend/
├── models/
│   ├── __init__.py                    # Add new model imports
│   ├── video_calls.py                 # NEW: Video call models
│   ├── blockchain.py                  # NEW: Blockchain models
│   └── verifications.py               # MODIFY: Add blockchain_tx_hash field
│
├── routers/
│   ├── __init__.py                    # Add new router imports
│   ├── video_call.py                  # NEW: Video call endpoints
│   └── verifications.py               # MODIFY: Add blockchain integration
│
├── services/
│   ├── video_call_queue.py            # NEW: Queue management
│   ├── agent_status_service.py        # NEW: Agent availability
│   ├── call_assignment_service.py     # NEW: Call assignment logic
│   ├── thronos_ai_service.py          # NEW: AI integration
│   ├── blockchain_service.py          # NEW: Blockchain integration
│   ├── document_hasher.py             # NEW: SHA256 hashing
│   ├── websocket_manager.py           # NEW: WebSocket management
│   └── verifications.py               # MODIFY: Add AI and blockchain
│
├── core/
│   ├── blockchain_config.py           # NEW: Thronos node config
│   └── database.py                    # MODIFY: Add new tables
│
└── main.py                            # MODIFY: Add WebSocket routes
```

**9.1.2 Frontend Files to Modify**

```
/workspace/app/frontend/src/
├── pages/
│   ├── VideoCallQueue.tsx             # NEW: Agent call queue
│   ├── VideoCall.tsx                  # NEW: Video call interface
│   ├── ManagerDashboard.tsx           # NEW: Manager analytics
│   └── Dashboard.tsx                  # MODIFY: Add video call link
│
├── components/
│   ├── VideoCallCard.tsx              # NEW: Call request card
│   ├── AgentStatusIndicator.tsx       # NEW: Agent status badge
│   └── BlockchainVerificationBadge.tsx # NEW: Blockchain confirmation
│
├── lib/
│   ├── websocket.ts                   # NEW: WebSocket client
│   ├── webrtc.ts                      # NEW: WebRTC utilities
│   └── rbac.ts                        # MODIFY: Add video call permissions
│
└── App.tsx                            # MODIFY: Add new routes
```

### 9.2 Database Migration Script

```sql
-- Location: /workspace/app/backend/migrations/add_video_call_blockchain.sql

-- 1. Add blockchain_tx_hash to existing verifications table
ALTER TABLE document_verifications
ADD COLUMN blockchain_tx_hash VARCHAR(66),
ADD COLUMN fraud_score DECIMAL(3,2) DEFAULT 0.0,
ADD COLUMN risk_level VARCHAR(20) DEFAULT 'low',
ADD COLUMN extracted_data JSONB;

-- 2. Create video_call_requests table
CREATE TABLE video_call_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    verification_id UUID NOT NULL REFERENCES document_verifications(id),
    user_id UUID NOT NULL,
    priority INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    assigned_agent_id UUID REFERENCES users(id),
    assigned_at TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    call_duration_seconds INTEGER,
    call_notes TEXT,
    blockchain_tx_hash VARCHAR(66),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_video_calls_status_priority ON video_call_requests(status, priority DESC, created_at ASC);
CREATE INDEX idx_video_calls_agent ON video_call_requests(assigned_agent_id, status);

-- 3. Create agent_availability table
CREATE TABLE agent_availability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES users(id) UNIQUE,
    status VARCHAR(50) NOT NULL DEFAULT 'offline',
    max_concurrent_calls INTEGER DEFAULT 3,
    current_active_calls INTEGER DEFAULT 0,
    last_call_at TIMESTAMP,
    total_calls_today INTEGER DEFAULT 0,
    average_call_duration_seconds INTEGER,
    last_status_change TIMESTAMP DEFAULT NOW(),
    websocket_connection_id VARCHAR(255)
);

CREATE INDEX idx_agent_status ON agent_availability(status);

-- 4. Create video_call_sessions table
CREATE TABLE video_call_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_request_id UUID NOT NULL REFERENCES video_call_requests(id),
    agent_id UUID NOT NULL REFERENCES users(id),
    user_id UUID NOT NULL,
    webrtc_session_id VARCHAR(255) NOT NULL,
    ice_servers JSONB,
    started_at TIMESTAMP DEFAULT NOW(),
    ended_at TIMESTAMP,
    connection_quality VARCHAR(50),
    recording_url TEXT,
    transcript TEXT,
    blockchain_tx_hash VARCHAR(66)
);

CREATE INDEX idx_video_sessions_call ON video_call_sessions(call_request_id);

-- 5. Create blockchain_transactions table
CREATE TABLE blockchain_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL UNIQUE,
    thronos_node_url VARCHAR(255) NOT NULL,
    block_number BIGINT,
    data_hash VARCHAR(64) NOT NULL,
    transaction_data JSONB NOT NULL,
    gas_used BIGINT,
    status VARCHAR(50) DEFAULT 'pending',
    confirmation_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    confirmed_at TIMESTAMP
);

CREATE INDEX idx_blockchain_entity ON blockchain_transactions(entity_type, entity_id);
CREATE INDEX idx_blockchain_tx ON blockchain_transactions(transaction_hash);
CREATE INDEX idx_blockchain_status ON blockchain_transactions(status);

-- 6. Add video call permissions
INSERT INTO permissions (name, description) VALUES
('video_calls.view_queue', 'View video call queue'),
('video_calls.accept', 'Accept and start video calls'),
('video_calls.manage', 'Manage all video calls'),
('video_calls.analytics', 'View video call analytics');

-- 7. Assign permissions to roles
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'kyc_agent' AND p.name IN ('video_calls.view_queue', 'video_calls.accept');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'manager' AND p.name LIKE 'video_calls.%';
```

### 9.3 Environment Variables

```bash
# Add to /workspace/app/.env

# Thronos Blockchain Configuration
THRONOS_MASTER_NODE=https://thrchain.up.railway.app
THRONOS_REPLICA_NODE=https://node-2.up.railway.app
THRONOS_CDN_NODE=https://thrchain.vercel.app
THRONOS_AI_NODE=https://thronos-v3-6.onrender.com

# Blockchain Security
BLOCKCHAIN_PRIVATE_KEY=your_private_key_here
BLOCKCHAIN_SENDER_ADDRESS=VerifyID_Platform

# Document Encryption
DOCUMENT_ENCRYPTION_KEY=your_fernet_key_here

# WebRTC Configuration
TURN_SERVER_URL=turn:turn.verifyid.com:3478
TURN_SERVER_USERNAME=verifyid
TURN_SERVER_PASSWORD=your_turn_password_here

# Video Call Configuration
MAX_CONCURRENT_CALLS_PER_AGENT=3
VIDEO_CALL_TIMEOUT_MINUTES=30
CALL_RECORDING_ENABLED=true
CALL_RECORDING_BUCKET=verifyid-recordings-encrypted

# AI Configuration
AI_FRAUD_DETECTION_THRESHOLD=0.7
AI_BEHAVIOR_ANALYSIS_ENABLED=true
```

---

## 10. Implementation Roadmap

### 10.1 Phase 1: Foundation (Week 1-2)

**Backend:**
- [ ] Create database tables (video_call_requests, agent_availability, blockchain_transactions)
- [ ] Implement DocumentHasher service (SHA256)
- [ ] Set up Thronos node health monitoring
- [ ] Create basic blockchain service (store/retrieve transactions)

**Frontend:**
- [ ] Create VideoCallQueue component skeleton
- [ ] Set up WebSocket client utilities
- [ ] Add video call routes to App.tsx

### 10.2 Phase 2: Core Features (Week 3-4)

**Backend:**
- [ ] Implement VideoCallQueueManager
- [ ] Implement AgentStatusService
- [ ] Implement CallAssignmentService with load balancing
- [ ] Create WebSocket endpoints for real-time notifications
- [ ] Integrate ThronosAIService for fraud detection

**Frontend:**
- [ ] Complete VideoCallQueue UI with priority badges
- [ ] Implement real-time WebSocket updates
- [ ] Create AgentStatusIndicator component
- [ ] Add role-based access control for video call features

### 10.3 Phase 3: Video Call Integration (Week 5-6)

**Backend:**
- [ ] Implement WebRTC signaling server
- [ ] Create video call session management
- [ ] Implement call recording service (optional)
- [ ] Add blockchain transaction for call completion

**Frontend:**
- [ ] Create VideoCall component with WebRTC
- [ ] Implement video/audio controls
- [ ] Add call notes and verification result form
- [ ] Create ManagerDashboard for analytics

### 10.4 Phase 4: AI & Blockchain (Week 7-8)

**Backend:**
- [ ] Complete ThronosAIService integration
- [ ] Implement AI fraud detection in verification workflow
- [ ] Deploy smart contracts to Thronos
- [ ] Implement automatic video call trigger after document upload
- [ ] Add blockchain transaction monitoring

**Frontend:**
- [ ] Add BlockchainVerificationBadge component
- [ ] Display fraud scores and AI analysis results
- [ ] Show blockchain confirmation status
- [ ] Add transaction hash links to Thronos explorer

### 10.5 Phase 5: Testing & Optimization (Week 9-10)

- [ ] End-to-end testing of complete workflow
- [ ] Load testing for video call queue
- [ ] Security audit of blockchain integration
- [ ] Performance optimization
- [ ] Documentation and deployment guides

---

## 11. Success Metrics

### 11.1 Performance Metrics

- **Video Call Assignment Time**: < 30 seconds from document upload to agent assignment
- **Agent Utilization Rate**: > 80% during peak hours
- **Average Call Duration**: 5-10 minutes
- **Queue Wait Time**: < 15 minutes for NORMAL priority

### 11.2 Quality Metrics

- **Fraud Detection Accuracy**: > 95% (AI-powered)
- **Blockchain Confirmation Rate**: 100% within 5 minutes
- **Call Completion Rate**: > 90%
- **Agent Satisfaction Score**: > 4.0/5.0

### 11.3 Security Metrics

- **Document Hash Verification**: 100% match rate
- **Blockchain Transaction Integrity**: 0 tampering incidents
- **Access Control Violations**: 0 unauthorized access attempts
- **Data Encryption Coverage**: 100% for sensitive data

---

## 12. Conclusion

This comprehensive system architecture integrates Thronos blockchain with the VerifyID platform to provide:

1. **Automatic Video Call Queue**: Seamless workflow from document upload to agent verification
2. **Blockchain Immutability**: SHA256-based document integrity with Thronos 4-node network
3. **AI-Powered Fraud Detection**: Pythia Node Manager integration for risk scoring
4. **Intelligent Agent Assignment**: Load balancing with priority queue management
5. **Real-Time Communication**: WebSocket-based notifications and status updates

**Key Benefits:**
- **Security**: Blockchain-based audit trails prevent tampering
- **Efficiency**: Automated workflow reduces manual intervention
- **Scalability**: Multi-node architecture supports high transaction volume
- **Intelligence**: AI-powered fraud detection improves accuracy
- **Transparency**: Immutable blockchain records provide full audit trail

**Next Steps:**
1. Review and approve this design document
2. Begin Phase 1 implementation (database tables and foundation)
3. Set up Thronos blockchain connection and test transactions
4. Develop video call queue management system
5. Integrate AI fraud detection with Pythia Node Manager

---

**Document Status:** Ready for Implementation  
**Approval Required:** Technical Lead, Security Team, Product Owner  
**Estimated Timeline:** 10 weeks for full implementation  
**Risk Level:** Medium (new blockchain integration, WebRTC complexity)
