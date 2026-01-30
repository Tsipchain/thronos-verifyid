-- Migration: Add Blockchain and Video Call Tables
-- Date: 2026-01-28
-- Description: Add tables for video call queue, agent availability, and blockchain transactions

-- 1. Add blockchain fields to existing document_verifications table
ALTER TABLE document_verifications
ADD COLUMN IF NOT EXISTS blockchain_tx_hash VARCHAR(66),
ADD COLUMN IF NOT EXISTS risk_level VARCHAR(20) DEFAULT 'low',
ADD COLUMN IF NOT EXISTS extracted_data TEXT;

-- 2. Create video_call_queue table
CREATE TABLE IF NOT EXISTS video_call_queue (
    id SERIAL PRIMARY KEY,
    verification_id INTEGER NOT NULL REFERENCES document_verifications(id) ON DELETE CASCADE,
    customer_id VARCHAR(255) NOT NULL,
    agent_id VARCHAR(255),
    priority VARCHAR(20) NOT NULL DEFAULT 'normal',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    assigned_at TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_video_call_queue_status ON video_call_queue(status);
CREATE INDEX IF NOT EXISTS idx_video_call_queue_priority ON video_call_queue(priority, created_at);
CREATE INDEX IF NOT EXISTS idx_video_call_queue_agent ON video_call_queue(agent_id);
CREATE INDEX IF NOT EXISTS idx_video_call_queue_verification ON video_call_queue(verification_id);

-- 3. Create agent_availability table
CREATE TABLE IF NOT EXISTS agent_availability (
    agent_id VARCHAR(255) PRIMARY KEY,
    status VARCHAR(20) NOT NULL DEFAULT 'offline',
    last_heartbeat TIMESTAMP NOT NULL DEFAULT NOW(),
    current_call_id INTEGER,
    total_calls_today INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_availability_status ON agent_availability(status);

-- 4. Create blockchain_transactions table
CREATE TABLE IF NOT EXISTS blockchain_transactions (
    id SERIAL PRIMARY KEY,
    verification_id INTEGER NOT NULL REFERENCES document_verifications(id) ON DELETE CASCADE,
    tx_hash VARCHAR(66) NOT NULL UNIQUE,
    document_hash VARCHAR(64) NOT NULL,
    node_url VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMP,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_blockchain_tx_hash ON blockchain_transactions(tx_hash);
CREATE INDEX IF NOT EXISTS idx_blockchain_verification ON blockchain_transactions(verification_id);
CREATE INDEX IF NOT EXISTS idx_blockchain_status ON blockchain_transactions(status);

-- 5. Add video call permissions to permissions table (if RBAC is enabled)
INSERT INTO permissions (name, description, created_at)
VALUES 
    ('video_calls.view_queue', 'View video call queue', NOW()),
    ('video_calls.accept', 'Accept and start video calls', NOW()),
    ('video_calls.manage', 'Manage all video calls', NOW()),
    ('video_calls.analytics', 'View video call analytics', NOW())
ON CONFLICT (name) DO NOTHING;

-- 6. Assign video call permissions to kyc_agent role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'kyc_agent' 
  AND p.name IN ('video_calls.view_queue', 'video_calls.accept')
ON CONFLICT DO NOTHING;

-- 7. Assign all video call permissions to manager role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'manager' 
  AND p.name LIKE 'video_calls.%'
ON CONFLICT DO NOTHING;

-- 8. Create function to automatically add to video call queue when verification is completed
CREATE OR REPLACE FUNCTION trigger_video_call_queue()
RETURNS TRIGGER AS $$
BEGIN
    -- Only trigger if status changed to 'completed'
    IF NEW.verification_status = 'COMPLETED' AND (OLD.verification_status IS NULL OR OLD.verification_status != 'COMPLETED') THEN
        -- Determine priority based on fraud_score
        INSERT INTO video_call_queue (verification_id, customer_id, priority, status)
        VALUES (
            NEW.id,
            NEW.user_id,
            CASE
                WHEN NEW.fraud_score >= 70 THEN 'high'
                WHEN NEW.fraud_score >= 40 THEN 'normal'
                ELSE 'low'
            END,
            'pending'
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 9. Create trigger on document_verifications table
DROP TRIGGER IF EXISTS auto_add_video_call_queue ON document_verifications;
CREATE TRIGGER auto_add_video_call_queue
AFTER UPDATE ON document_verifications
FOR EACH ROW
EXECUTE FUNCTION trigger_video_call_queue();

-- 10. Create function to reset daily call counts
CREATE OR REPLACE FUNCTION reset_daily_call_counts()
RETURNS void AS $$
BEGIN
    UPDATE agent_availability
    SET total_calls_today = 0
    WHERE DATE(updated_at) < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql;

-- Migration completed successfully