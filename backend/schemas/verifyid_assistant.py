"""Schemas for VerifyID AI Assistant."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class AssistantChatRequest(BaseModel):
    message: str
    context: Optional[dict] = None


class SuggestedAction(BaseModel):
    label: str
    action: str
    params: dict = {}


class AssistantChatResponse(BaseModel):
    response: str
    data: Optional[dict] = None
    suggested_actions: list[SuggestedAction] = []
    intent: Optional[str] = None
    role_context: Optional[str] = None  # agent or manager


class CaseOverview(BaseModel):
    id: int
    user_id: str
    full_name: Optional[str] = None
    document_type: Optional[str] = None
    status: str
    risk_level: Optional[str] = None
    fraud_score: int = 0
    created_at: Optional[datetime] = None
    agent_id: Optional[str] = None


class CaseDetails(BaseModel):
    id: int
    user_id: str
    full_name: Optional[str] = None
    document_type: Optional[str] = None
    document_number: Optional[str] = None
    nationality: Optional[str] = None
    date_of_birth: Optional[str] = None
    issue_date: Optional[str] = None
    expiry_date: Optional[str] = None
    status: str
    risk_level: Optional[str] = None
    fraud_score: int = 0
    created_at: Optional[datetime] = None
    verified_at: Optional[datetime] = None
    kyc_form: Optional[dict] = None
    fraud_analysis: Optional[dict] = None
    discrepancies: list[str] = []


class CompletenessReport(BaseModel):
    case_id: int
    completeness_pct: float
    present_items: list[str]
    missing_items: list[str]
    recommendation: str


class DiscrepancyReport(BaseModel):
    case_id: int
    discrepancies: list[dict]
    risk_flags: list[str]
    overall_risk: str


class NextStepSuggestion(BaseModel):
    case_id: int
    recommended_action: str
    reason: str
    priority: str  # low, medium, high, critical


class CustomerResponseDraft(BaseModel):
    case_id: int
    response_type: str
    subject: str
    body: str


class CaseClassification(BaseModel):
    case_id: int
    classification: str  # straightforward, needs_review, high_risk, escalate
    confidence: float
    reasons: list[str]


class QueueOverview(BaseModel):
    total_pending: int
    total_in_review: int
    total_approved: int
    total_rejected: int
    by_agent: dict = {}
    avg_processing_hours: float
    sla_breaches: int
    oldest_pending_hours: float


class AgentPerformanceReport(BaseModel):
    agent_id: Optional[str] = None
    cases_today: int = 0
    cases_this_week: int = 0
    cases_this_month: int = 0
    avg_processing_hours: float = 0.0
    approval_rate: float = 0.0
    rejection_rate: float = 0.0


class BottleneckReport(BaseModel):
    stuck_cases: list[dict]
    overloaded_agents: list[dict]
    common_rejection_reasons: list[dict]
    avg_wait_time_hours: float


class SLAReport(BaseModel):
    total_cases: int
    on_time_count: int
    breached_count: int
    on_time_pct: float
    avg_processing_hours: float
    breached_cases: list[dict]


class RiskFlagRequest(BaseModel):
    risk_type: str  # fraud_suspected, document_tampering, identity_mismatch, other
    notes: str


class OverrideRequest(BaseModel):
    new_status: str  # approved, rejected
    reason: str


class EscalationRequest(BaseModel):
    reason: str
    priority: str = "high"  # medium, high, critical


class AdditionalDocsRequest(BaseModel):
    doc_types: list[str]
    message: Optional[str] = None


class GenerateResponseRequest(BaseModel):
    response_type: str  # approval, rejection, additional_docs_needed, under_review
