from guardrails import evaluate_guardrails
from math_engine import (
    calculate_dlg_cap,
    calculate_payout_utilization,
    calculate_recovery_allocation,
    calculate_remaining_buffer,
)
from schema import VerifiedIngestionPayload


def test_math_engine_calculations():
    # 5% of 10,000,000 is 500,000
    assert calculate_dlg_cap(10000000.0) == 500000.0

    # 5% of 0 is 0
    assert calculate_dlg_cap(0.0) == 0.0

    # Utilization
    assert calculate_payout_utilization(100000.0, 50000.0, 500000.0) == 0.3
    assert calculate_payout_utilization(0.0, 0.0, 0.0) == 0.0

    # Remaining Buffer
    assert calculate_remaining_buffer(500000.0, 100000.0, 50000.0) == 350000.0

    # Recovery allocation
    # Recovered = 100,000, claimed = 80,000
    # Replenished = 80,000, remaining = 20,000, RE = 16,000, NBFC = 4,000
    alloc = calculate_recovery_allocation(100000.0, 80000.0)
    assert alloc["replenished_to_dlg"] == 80000.0
    assert alloc["remaining_recovery"] == 20000.0
    assert alloc["re_share"] == 16000.0
    assert alloc["nbfc_share"] == 4000.0


def test_guardrails_evaluation_success():
    payload = VerifiedIngestionPayload(
        transaction_id="tx-123",
        arrangement_id="arr-456",
        lsp_id="lsp-789",
        re_id="re-101",
        total_portfolio_amount_inr=10000000.0,
        current_loan_disbursement_inr=50000.0,
        cumulative_dlg_payout_inr=100000.0,
        current_payout_requested_inr=50000.0,
        guarantee_backing_type="FIXED_DEPOSIT",
        backing_secured_percentage=1.0,
        longest_loan_tenure_months=24,
        dlg_arrangement_tenure_months=36,
        borrower_consent_token="consent-123",
        aadhaar_masked="XXXXXXXX1234",
        pan_masked="XXXXX1234X",
    )
    evaluation, violation_reasons, status = evaluate_guardrails(payload)
    assert status == "CLEARED"
    assert len(violation_reasons) == 0
    assert all(evaluation.values())


def test_guardrails_evaluation_failure_cap_exceeded():
    payload = VerifiedIngestionPayload(
        transaction_id="tx-123",
        arrangement_id="arr-456",
        lsp_id="lsp-789",
        re_id="re-101",
        total_portfolio_amount_inr=10000000.0,
        current_loan_disbursement_inr=50000.0,
        cumulative_dlg_payout_inr=400000.0,
        # Total requested + cumulative = 550,000 > 5% of 10,000,000 (500,000)
        current_payout_requested_inr=150000.0,
        guarantee_backing_type="FIXED_DEPOSIT",
        backing_secured_percentage=1.0,
        longest_loan_tenure_months=24,
        dlg_arrangement_tenure_months=36,
        borrower_consent_token="consent-123",
        aadhaar_masked="XXXXXXXX1234",
        pan_masked="XXXXX1234X",
    )
    evaluation, violation_reasons, status = evaluate_guardrails(payload)
    assert status == "BLOCKED"
    assert not evaluation["REG_DLG_CAP"]
    assert len(violation_reasons) == 1
    assert "REG_DLG_CAP Violated" in violation_reasons[0]
