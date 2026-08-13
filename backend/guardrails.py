
from math_engine import calculate_dlg_cap
from schema import VerifiedIngestionPayload

# CEL-like Rule definitions represented as strings for transparency / audit logging
RULES = {
    "REG_DLG_CAP": "(cumulative_dlg_payout_inr + current_payout_requested_inr) <= (total_portfolio_amount_inr * 0.05)",
    "REG_DPDP_SAFETY": "borrower_consent_token != '' and aadhaar_masked != '' and pan_masked != ''",
    "REG_DLG_BACKING": "guarantee_backing_type in ['CASH_DEPOSIT', 'FIXED_DEPOSIT', 'BANK_GUARANTEE']",
    "REG_DLG_TENURE": "dlg_arrangement_tenure_months >= longest_loan_tenure_months",
}


def evaluate_guardrails(
    payload: VerifiedIngestionPayload,
) -> tuple[dict[str, bool], list[str], str]:
    """
    Evaluates statutory rules against the VerifiedIngestionPayload.
    Returns:
        - A dictionary of rule names to boolean pass status
        - A list of violation reasons
        - Suggested status: "CLEARED" or "BLOCKED"
    """
    evaluation: dict[str, bool] = {}
    violation_reasons: list[str] = []

    # 1. Evaluate REG_DLG_CAP
    dlg_cap = calculate_dlg_cap(payload.total_portfolio_amount_inr)
    total_requested_and_cumulative = (
        payload.cumulative_dlg_payout_inr + payload.current_payout_requested_inr
    )
    if total_requested_and_cumulative <= dlg_cap:
        evaluation["REG_DLG_CAP"] = True
    else:
        evaluation["REG_DLG_CAP"] = False
        violation_reasons.append(
            f"REG_DLG_CAP Violated: Total DLG exposure ({total_requested_and_cumulative:,.2f} INR) "
            f"exceeds the 5.0% DLG cap limit ({dlg_cap:,.2f} INR) based on portfolio size."
        )

    # 2. Evaluate REG_DPDP_SAFETY
    # DPDP consent token must be present and PII must be masked correctly (handled by Pydantic, but double-checked here)
    has_consent = bool(
        payload.borrower_consent_token and payload.borrower_consent_token.strip()
    )
    has_masked_aadhaar = bool(
        payload.aadhaar_masked and payload.aadhaar_masked.startswith("XXXXXXXX")
    )
    has_masked_pan = bool(payload.pan_masked and payload.pan_masked.startswith("XXXXX"))

    if has_consent and has_masked_aadhaar and has_masked_pan:
        evaluation["REG_DPDP_SAFETY"] = True
    else:
        evaluation["REG_DPDP_SAFETY"] = False
        reasons = []
        if not has_consent:
            reasons.append("Missing borrower DPDP consent token")
        if not has_masked_aadhaar:
            reasons.append("Aadhaar is not properly masked")
        if not has_masked_pan:
            reasons.append("PAN is not properly masked")
        violation_reasons.append(f"REG_DPDP_SAFETY Violated: {', '.join(reasons)}.")

    # 3. Evaluate REG_DLG_BACKING
    allowed_backings = {"CASH_DEPOSIT", "FIXED_DEPOSIT", "BANK_GUARANTEE"}
    if payload.guarantee_backing_type in allowed_backings:
        # Check if backing is properly secured (must be 100% / 1.0)
        if payload.backing_secured_percentage == 1.0:
            evaluation["REG_DLG_BACKING"] = True
        else:
            evaluation["REG_DLG_BACKING"] = False
            violation_reasons.append(
                f"REG_DLG_BACKING Violated: Guarantee backing secured percentage must be exactly 100% (1.0) "
                f"(current: {payload.backing_secured_percentage * 100}%)."
            )
    else:
        evaluation["REG_DLG_BACKING"] = False
        violation_reasons.append(
            f"REG_DLG_BACKING Violated: Guarantee backing type '{payload.guarantee_backing_type}' "
            f"is not permitted. Must be one of: {', '.join(allowed_backings)}."
        )

    # 4. Evaluate REG_DLG_TENURE
    if payload.dlg_arrangement_tenure_months >= payload.longest_loan_tenure_months:
        evaluation["REG_DLG_TENURE"] = True
    else:
        evaluation["REG_DLG_TENURE"] = False
        violation_reasons.append(
            f"REG_DLG_TENURE Violated: DLG arrangement tenure ({payload.dlg_arrangement_tenure_months} months) "
            f"is shorter than the longest loan tenure ({payload.longest_loan_tenure_months} months) in the portfolio."
        )

    # Determine suggested status
    all_passed = all(evaluation.values())
    suggested_status = "CLEARED" if all_passed else "BLOCKED"

    return evaluation, violation_reasons, suggested_status
