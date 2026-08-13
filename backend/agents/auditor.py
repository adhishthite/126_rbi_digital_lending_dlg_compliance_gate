import time
from collections.abc import Callable
from typing import Any

from agents.base import BaseAgent
from guardrails import evaluate_guardrails
from math_engine import calculate_dlg_cap, calculate_payout_utilization
from schema import AuditAssessmentPayload, VerifiedIngestionPayload


class AuditorAgent(BaseAgent):
    def __init__(
        self, event_callback: Callable[[dict[str, Any]], None] | None = None
    ):
        super().__init__(
            name="AuditorAgent",
            role="Statutory Auditor & Compliance Evaluator",
            event_callback=event_callback,
        )

    def run(self, verified_payload: VerifiedIngestionPayload) -> AuditAssessmentPayload:
        start_time = time.perf_counter()
        self.thoughts = []

        self.log_thought(
            f"Initiating regulatory compliance audit for arrangement: {verified_payload.arrangement_id}"
        )
        self.emit_event(
            task="Auditing statutory rules and financial limits", status="processing"
        )

        # Calculate Math Metrics
        self.log_thought("Calculating portfolio 5% DLG cap limit...")
        dlg_cap = calculate_dlg_cap(verified_payload.total_portfolio_amount_inr)

        self.log_thought("Calculating current DLG utilization rate...")
        utilization = calculate_payout_utilization(
            verified_payload.cumulative_dlg_payout_inr,
            verified_payload.current_payout_requested_inr,
            dlg_cap,
        )

        # Check specific limits
        is_cap_exceeded = (
            verified_payload.cumulative_dlg_payout_inr
            + verified_payload.current_payout_requested_inr
        ) > dlg_cap
        is_tenure_valid = (
            verified_payload.dlg_arrangement_tenure_months
            >= verified_payload.longest_loan_tenure_months
        )

        self.log_thought(
            f"DLG Cap calculated: {dlg_cap:,.2f} INR. Cap exceeded: {is_cap_exceeded}"
        )
        self.log_thought(f"Tenure validity: {is_tenure_valid}")

        # Run statutory guardrails
        self.log_thought(
            "Evaluating statutory compliance rules (REG_DLG_CAP, REG_DPDP_SAFETY, REG_DLG_BACKING, REG_DLG_TENURE)..."
        )
        cel_eval, violation_reasons, suggested_status = evaluate_guardrails(
            verified_payload
        )

        if suggested_status == "BLOCKED":
            self.log_thought(
                f"Guardrail evaluation returned BLOCKED due to: {violation_reasons}"
            )
        else:
            self.log_thought("All statutory guardrails cleared successfully.")

        assessment = AuditAssessmentPayload(
            ingested_data=verified_payload,
            dlg_pool_limit_inr=dlg_cap,
            current_dlg_utilization_percentage=utilization
            * 100.0,  # percentage representation
            is_cap_exceeded=is_cap_exceeded,
            is_tenure_valid=is_tenure_valid,
            cel_rules_evaluation=cel_eval,
            suggested_status=suggested_status,
            violation_reasons=violation_reasons,
        )

        latency_ms = (time.perf_counter() - start_time) * 1000.0
        self.emit_event(
            task="Completed statutory compliance audit",
            status="completed",
            results=assessment.model_dump(),
            latency_ms=latency_ms,
        )
        return assessment
