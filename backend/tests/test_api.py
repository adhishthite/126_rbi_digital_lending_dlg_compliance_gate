import json

import pytest
from fastapi.testclient import TestClient

from database import clear_ledger
from main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def run_around():
    clear_ledger()
    yield
    clear_ledger()


def get_valid_payload_dict():
    return {
        "transaction_id": "tx-api-1",
        "arrangement_id": "arr-api-999",
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
        "borrower_consent_token": "consent-abc-123",
        "aadhaar_raw": "367598324678",
        "pan_raw": "ABCPE1234F",
    }


def test_api_config():
    response = client.get("/api/config")
    assert response.status_code == 200
    data = response.json()
    assert "MODE" in data
    assert "GEMINI_MODEL" in data


def test_api_execute_transaction_success():
    payload = get_valid_payload_dict()
    response = client.post("/api/execute-transaction", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "CLEARED"
    assert data["transaction_id"] == "tx-api-1"
    assert data["audit_stamp"] is not None

    # Check ledger endpoint
    ledger_response = client.get("/api/ledger")
    assert ledger_response.status_code == 200
    ledger_data = ledger_response.json()
    assert len(ledger_data) == 1
    assert ledger_data[0]["transaction_id"] == "tx-api-1"

    # Check raw logs endpoint
    logs_response = client.get("/api/logs")
    assert logs_response.status_code == 200
    assert "tx-api-1" in logs_response.text


def test_api_execute_transaction_blocked():
    payload = get_valid_payload_dict()
    # Force block via invalid backing type
    payload["guarantee_backing_type"] = "UNSUPPORTED_TYPE"
    response = client.post("/api/execute-transaction", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "BLOCKED"
    assert len(data["violation_reasons"]) > 0
    assert "REG_DLG_BACKING Violated" in data["violation_reasons"][0]


def test_api_stream_transaction():
    payload = get_valid_payload_dict()
    payload_str = json.dumps(payload)

    # Call SSE stream endpoint
    # TestClient supports streaming responses using client.get with stream=True or similar,
    # or we can read the content from the response object.
    with client.stream("GET", f"/api/stream?payload={payload_str}") as response:
        assert response.status_code == 200
        # Read SSE lines
        lines = [line for line in response.iter_lines() if line]

    assert len(lines) > 0
    # Check if we have events containing IngestionAgent, AuditorAgent, etc.
    events_found = []
    for line in lines:
        if line.startswith("data: "):
            event_data = json.loads(line[6:])
            events_found.append(event_data)

    assert len(events_found) > 0
    assert events_found[-1]["author"] == "Orchestrator"
    assert events_found[-1]["done"] is True
    assert events_found[-1]["results"]["status"] == "CLEARED"
