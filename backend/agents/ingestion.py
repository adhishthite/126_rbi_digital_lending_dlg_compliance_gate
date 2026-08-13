import time
from collections.abc import Callable
from typing import Any

from agents.base import BaseAgent
from schema import RawTransactionPayload, VerifiedIngestionPayload


class IngestionAgent(BaseAgent):
    def __init__(
        self, event_callback: Callable[[dict[str, Any]], None] | None = None
    ):
        super().__init__(
            name="IngestionAgent",
            role="Data Validator & Masking Coordinator",
            event_callback=event_callback,
        )

    def run(self, raw_payload: RawTransactionPayload) -> VerifiedIngestionPayload:
        start_time = time.perf_counter()
        self.thoughts = []

        self.log_thought(f"Received raw transaction: {raw_payload.transaction_id}")
        self.emit_event(
            task=f"Validating and ingestion of raw transaction {raw_payload.transaction_id}",
            status="processing",
        )

        # Simulating PII Verification
        self.log_thought("Validating Aadhaar format and Verhoeff checksum...")
        self.log_thought("Validating PAN formatting and cardholder status character...")

        try:
            # Under the hood, RawTransactionPayload field validators run automatically,
            # but we invoke the schema conversion here to mask values and get VerifiedIngestionPayload.
            verified_payload = raw_payload.to_verified_payload()

            self.log_thought("Successfully verified PII checks.")
            self.log_thought(
                "Masked Aadhaar (8 leading X's) and PAN (5 leading, 1 trailing X)."
            )

            latency_ms = (time.perf_counter() - start_time) * 1000.0

            self.emit_event(
                task=f"Completed ingestion of transaction {raw_payload.transaction_id}",
                status="completed",
                results=verified_payload.model_dump(),
                latency_ms=latency_ms,
            )
            return verified_payload

        except Exception as e:
            self.log_thought(f"Validation failed: {e!s}")
            latency_ms = (time.perf_counter() - start_time) * 1000.0
            self.emit_event(
                task=f"Failed ingestion of transaction {raw_payload.transaction_id}",
                status="failed",
                results={"error": str(e)},
                latency_ms=latency_ms,
            )
            raise
