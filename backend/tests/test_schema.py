import pytest
from pydantic import ValidationError

from schema import RawTransactionPayload, VerifiedIngestionPayload


def get_base_payload_dict():
    return {
        "transaction_id": "tx-12345",
        "arrangement_id": "arr-999",
        "lsp_id": "lsp-001",
        "re_id": "re-080",
        "total_portfolio_amount_inr": 10000000.0,
        "current_loan_disbursement_inr": 500000.0,
        "cumulative_dlg_payout_inr": 100000.0,
        "current_payout_requested_inr": 20000.0,
        "guarantee_backing_type": "FIXED_DEPOSIT",
        "backing_secured_percentage": 1.0,
        "longest_loan_tenure_months": 24,
        "dlg_arrangement_tenure_months": 36,
        "borrower_consent_token": "consent-token-abc-123",
        "aadhaar_raw": "367598324678",
        "pan_raw": "ABCPE1234F",
    }


def test_raw_transaction_payload_validation_success():
    payload_data = get_base_payload_dict()
    payload = RawTransactionPayload(**payload_data)
    assert payload.transaction_id == "tx-12345"
    assert payload.aadhaar_raw == "367598324678"
    assert payload.pan_raw == "ABCPE1234F"


def test_raw_transaction_payload_validation_failure_aadhaar():
    payload_data = get_base_payload_dict()
    # Invalid Aadhaar checksum
    payload_data["aadhaar_raw"] = "367598324677"
    with pytest.raises(ValidationError) as exc_info:
        RawTransactionPayload(**payload_data)
    assert "Invalid Aadhaar number" in str(exc_info.value)


def test_raw_transaction_payload_validation_failure_pan():
    payload_data = get_base_payload_dict()
    # Invalid PAN format
    payload_data["pan_raw"] = "ABCDE12345F"
    with pytest.raises(ValidationError) as exc_info:
        RawTransactionPayload(**payload_data)
    assert "Invalid PAN format" in str(exc_info.value)


def test_to_verified_payload_masking():
    payload_data = get_base_payload_dict()
    raw_payload = RawTransactionPayload(**payload_data)
    verified_payload = raw_payload.to_verified_payload()

    assert isinstance(verified_payload, VerifiedIngestionPayload)
    assert verified_payload.aadhaar_masked == "XXXXXXXX4678"
    assert verified_payload.pan_masked == "XXXXX1234X"
    # Ensure regular fields carry over
    assert verified_payload.total_portfolio_amount_inr == 10000000.0
