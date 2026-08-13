
import pytest

from database import clear_ledger
from orchestrator import Orchestrator
from schema import RawTransactionPayload


@pytest.fixture(autouse=True)
def run_around():
    clear_ledger()
    yield
    clear_ledger()


def get_valid_payload():
    return RawTransactionPayload(
        transaction_id="tx-endtoend-1",
        arrangement_id="arr-endtoend-999",
        lsp_id="lsp-001",
        re_id="re-080",
        total_portfolio_amount_inr=10000000.0,
        current_loan_disbursement_inr=500000.0,
        cumulative_dlg_payout_inr=100000.0,
        current_payout_requested_inr=20000.0,
        guarantee_backing_type="FIXED_DEPOSIT",
        backing_secured_percentage=1.0,
        longest_loan_tenure_months=24,
        dlg_arrangement_tenure_months=36,
        borrower_consent_token="consent-abc-123",
        aadhaar_raw="367598324678",
        pan_raw="ABCPE1234F",
    )


def test_orchestrator_sync_success():
    payload = get_valid_payload()
    orchestrator = Orchestrator()
    response, events = orchestrator.execute_transaction_sync(payload)

    assert response.status == "CLEARED"
    assert response.transaction_id == "tx-endtoend-1"
    assert response.audit_stamp is not None
    assert len(response.violation_reasons) == 0

    # We should have events from all 4 agents
    agents_involved = {event["author"] for event in events}
    assert "IngestionAgent" in agents_involved
    assert "AuditorAgent" in agents_involved
    assert "CheckerAgent" in agents_involved
    assert "SettlementAgent" in agents_involved


@pytest.mark.anyio
async def test_orchestrator_stream_success():
    payload = get_valid_payload()
    orchestrator = Orchestrator()

    stream_events = []
    async for event in orchestrator.stream_transaction_events(payload):
        stream_events.append(event)

    assert len(stream_events) > 0
    # The last event should be the orchestrator's done signal
    last_event = stream_events[-1]
    assert last_event["author"] == "Orchestrator"
    assert last_event["done"] is True
    assert last_event["results"]["status"] == "CLEARED"
