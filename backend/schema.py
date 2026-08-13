import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from validation import validate_aadhaar, validate_pan


class RawTransactionPayload(BaseModel):
    transaction_id: str = Field(..., description="Unique transaction UUID")
    arrangement_id: str = Field(..., description="Reference ID for the DLG contract")
    lsp_id: str = Field(..., description="Lending Service Provider identifier")
    re_id: str = Field(..., description="Regulated Entity (Bank/NBFC) identifier")

    # Financial Fields
    total_portfolio_amount_inr: float = Field(
        ..., description="Total loan portfolio size"
    )
    current_loan_disbursement_inr: float = Field(
        ..., description="Value of current loan being boarded"
    )
    cumulative_dlg_payout_inr: float = Field(
        ..., description="DLG amount already paid out historically"
    )
    current_payout_requested_inr: float = Field(
        0.0, description="Current payout amount claimed under guarantee"
    )

    # Collateral & Tenure Fields
    guarantee_backing_type: str = Field(
        ..., description="E.g., CASH_DEPOSIT, FIXED_DEPOSIT, BANK_GUARANTEE"
    )
    backing_secured_percentage: float = Field(
        ..., description="Fraction of guarantee backed by collateral (1.0 = 100%)"
    )
    longest_loan_tenure_months: int = Field(
        ..., description="Maturity of the longest loan in the portfolio"
    )
    dlg_arrangement_tenure_months: int = Field(
        ..., description="Tenure of the DLG arrangement contract"
    )

    # Unmasked PII (Input)
    borrower_consent_token: str = Field(
        ..., description="DPDP Consent Verification Token"
    )
    aadhaar_raw: str = Field(..., description="Raw Aadhaar (12 digits)")
    pan_raw: str = Field(..., description="Raw PAN (10 chars)")

    @field_validator("aadhaar_raw")
    @classmethod
    def check_aadhaar(cls, v: str) -> str:
        if not validate_aadhaar(v):
            raise ValueError(
                "Invalid Aadhaar number (must be 12 digits and satisfy Verhoeff checksum)"
            )
        return v

    @field_validator("pan_raw")
    @classmethod
    def check_pan(cls, v: str) -> str:
        if not validate_pan(v):
            raise ValueError("Invalid PAN format or holder type")
        return v

    def to_verified_payload(self) -> "VerifiedIngestionPayload":
        masked_aadhaar = "X" * 8 + self.aadhaar_raw[-4:]
        masked_pan = "X" * 5 + self.pan_raw[5:9] + "X"
        return VerifiedIngestionPayload(
            transaction_id=self.transaction_id,
            arrangement_id=self.arrangement_id,
            lsp_id=self.lsp_id,
            re_id=self.re_id,
            total_portfolio_amount_inr=self.total_portfolio_amount_inr,
            current_loan_disbursement_inr=self.current_loan_disbursement_inr,
            cumulative_dlg_payout_inr=self.cumulative_dlg_payout_inr,
            current_payout_requested_inr=self.current_payout_requested_inr,
            guarantee_backing_type=self.guarantee_backing_type,
            backing_secured_percentage=self.backing_secured_percentage,
            longest_loan_tenure_months=self.longest_loan_tenure_months,
            dlg_arrangement_tenure_months=self.dlg_arrangement_tenure_months,
            borrower_consent_token=self.borrower_consent_token,
            aadhaar_masked=masked_aadhaar,
            pan_masked=masked_pan,
        )


class VerifiedIngestionPayload(BaseModel):
    transaction_id: str = Field(..., description="Unique transaction UUID")
    arrangement_id: str = Field(..., description="Reference ID for the DLG contract")
    lsp_id: str = Field(..., description="Lending Service Provider identifier")
    re_id: str = Field(..., description="Regulated Entity (Bank/NBFC) identifier")

    # Financial Fields
    total_portfolio_amount_inr: float = Field(
        ..., description="Total loan portfolio size"
    )
    current_loan_disbursement_inr: float = Field(
        ..., description="Value of current loan being boarded"
    )
    cumulative_dlg_payout_inr: float = Field(
        ..., description="DLG amount already paid out historically"
    )
    current_payout_requested_inr: float = Field(
        0.0, description="Current payout amount claimed under guarantee"
    )

    # Collateral & Tenure Fields
    guarantee_backing_type: str = Field(
        ..., description="E.g., CASH_DEPOSIT, FIXED_DEPOSIT, BANK_GUARANTEE"
    )
    backing_secured_percentage: float = Field(
        ..., description="Fraction of guarantee backed by collateral (1.0 = 100%)"
    )
    longest_loan_tenure_months: int = Field(
        ..., description="Maturity of the longest loan in the portfolio"
    )
    dlg_arrangement_tenure_months: int = Field(
        ..., description="Tenure of the DLG arrangement contract"
    )

    # Masked PII (DPDP Compliant)
    borrower_consent_token: str = Field(
        ..., description="DPDP Consent Verification Token"
    )
    aadhaar_masked: str = Field(..., description="Masked Aadhaar (e.g., XXXXXXXX1234)")
    pan_masked: str = Field(..., description="Masked PAN (e.g., XXXXX1234X)")

    @field_validator("aadhaar_masked")
    @classmethod
    def check_aadhaar_mask(cls, v: str) -> str:
        if not re.match(r"^X{8}\d{4}$", v):
            raise ValueError("Aadhaar must be fully masked: 8 'X's and 4 suffix digits")
        return v

    @field_validator("pan_masked")
    @classmethod
    def check_pan_mask(cls, v: str) -> str:
        if not re.match(r"^X{5}\d{4}X$", v):
            raise ValueError("PAN must be fully masked: 5 'X's, 4 digits, 1 'X'")
        return v


class AuditAssessmentPayload(BaseModel):
    ingested_data: VerifiedIngestionPayload

    # Calculated Math Metrics
    dlg_pool_limit_inr: float = Field(..., description="5.0% cap ceiling value")
    current_dlg_utilization_percentage: float = Field(
        ..., description="Current utilization of the DLG pool"
    )
    is_cap_exceeded: bool = Field(
        ..., description="True if DLG requested + cumulative exceeds 5% limit"
    )
    is_tenure_valid: bool = Field(
        ..., description="True if DLG tenure matches/exceeds longest loan tenure"
    )

    # Guardrail Outcomes
    cel_rules_evaluation: dict[str, bool] = Field(
        ..., description="Individual CEL rule checks and outcomes"
    )
    suggested_status: Literal["CLEARED", "BLOCKED"] = Field(...)
    violation_reasons: list[str] = Field(default_factory=list)


class CheckedDecisionPayload(BaseModel):
    audit_assessment: AuditAssessmentPayload
    checker_id: str = Field(..., description="Checker Agent Identity Signature")
    double_entry_verified: bool = Field(
        ..., description="Asserts ledger matches request totals"
    )
    final_status: Literal["CLEARED", "BLOCKED", "HELD"] = Field(...)
    rejection_reasons: list[str] = Field(default_factory=list)
    adversarial_remarks: str | None = Field(
        None, description="Gemini 3.5 Pro risk remarks"
    )


class SettlementReceiptPayload(BaseModel):
    transaction_id: str
    arrangement_id: str
    final_status: str
    settled_payout_amount_inr: float
    remaining_dlg_buffer_inr: float
    escrow_splits: dict[str, float] = Field(
        ...,
        description="Payout distributions (RE Share, LSP Share, Collateral Release)",
    )
    audit_stamp: str = Field(
        ..., description="SHA-256 verification hash of complete transaction state"
    )


# API Response wrapper for execute-transaction endpoint
class TransactionResponse(BaseModel):
    status: Literal["CLEARED", "BLOCKED", "HELD"]
    transaction_id: str
    message: str
    audit_stamp: str | None = None
    remaining_dlg_buffer_inr: float | None = None
    escrow_splits: dict[str, float] | None = None
    violation_reasons: list[str] = Field(default_factory=list)
