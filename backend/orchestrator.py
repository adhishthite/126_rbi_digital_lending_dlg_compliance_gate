import asyncio
import time
from collections.abc import AsyncGenerator
from typing import Any

from agents.auditor import AuditorAgent
from agents.checker import CheckerAgent
from agents.ingestion import IngestionAgent
from agents.settlement import SettlementAgent
from schema import RawTransactionPayload, TransactionResponse


class Orchestrator:
    def __init__(self):
        pass

    def execute_transaction_sync(
        self, raw_payload: RawTransactionPayload
    ) -> tuple[TransactionResponse, list[dict[str, Any]]]:
        """
        Executes the compliance pipeline synchronously.
        Returns the final TransactionResponse and a list of all agent log events.
        """
        events: list[dict[str, Any]] = []

        def callback(event: dict[str, Any]):
            events.append(event)

        ingestion = IngestionAgent(event_callback=callback)
        auditor = AuditorAgent(event_callback=callback)
        checker = CheckerAgent(event_callback=callback)
        settlement = SettlementAgent(event_callback=callback)

        try:
            # Step 1: Ingestion
            verified = ingestion.run(raw_payload)

            # Step 2: Statutory Audit
            assessment = auditor.run(verified)

            # Step 3: Checker Evaluation
            decision = checker.run(assessment)

            # Step 4: Settlement & Ledger append
            receipt = settlement.run(decision)

            # Construct final response
            response = TransactionResponse(
                status=receipt.final_status,
                transaction_id=receipt.transaction_id,
                message=f"Transaction processed with final status: {receipt.final_status}",
                audit_stamp=receipt.audit_stamp,
                remaining_dlg_buffer_inr=receipt.remaining_dlg_buffer_inr,
                escrow_splits=receipt.escrow_splits,
                violation_reasons=decision.rejection_reasons,
            )
            return response, events

        except Exception as e:  # noqa: BLE001
            # In case of validation or system errors during pipeline execution
            error_response = TransactionResponse(
                status="HELD",
                transaction_id=raw_payload.transaction_id,
                message=f"Execution error: {e!s}",
                audit_stamp=None,
                remaining_dlg_buffer_inr=None,
                escrow_splits=None,
                violation_reasons=[str(e)],
            )
            return error_response, events

    async def stream_transaction_events(
        self, raw_payload: RawTransactionPayload
    ) -> AsyncGenerator[dict[str, Any]]:
        """
        Executes the compliance pipeline asynchronously and streams events as they occur.
        """
        queue: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def callback(event: dict[str, Any]):
            loop.call_soon_threadsafe(queue.put_nowait, event)

        async def run_pipeline():
            try:
                ingestion = IngestionAgent(event_callback=callback)
                auditor = AuditorAgent(event_callback=callback)
                checker = CheckerAgent(event_callback=callback)
                settlement = SettlementAgent(event_callback=callback)

                # Execute steps sequentially (since agents are CPU bound, running in thread is also fine,
                # but standard execution is fast enough)
                verified = ingestion.run(raw_payload)
                assessment = auditor.run(verified)
                decision = checker.run(assessment)
                receipt = settlement.run(decision)

                # Send terminal response event
                response = TransactionResponse(
                    status=receipt.final_status,
                    transaction_id=receipt.transaction_id,
                    message=f"Transaction processed with final status: {receipt.final_status}",
                    audit_stamp=receipt.audit_stamp,
                    remaining_dlg_buffer_inr=receipt.remaining_dlg_buffer_inr,
                    escrow_splits=receipt.escrow_splits,
                    violation_reasons=decision.rejection_reasons,
                )

                loop.call_soon_threadsafe(
                    queue.put_nowait,
                    {
                        "author": "Orchestrator",
                        "role": "Pipeline Coordinator",
                        "task": "Final response generation",
                        "thoughts": ["Orchestrator pipeline completed successfully."],
                        "status": "completed",
                        "results": response.model_dump(),
                        "latency_ms": 0.0,
                        "timestamp": time.time(),
                        "done": True,
                    },
                )
            except Exception as e:  # noqa: BLE001
                loop.call_soon_threadsafe(
                    queue.put_nowait,
                    {
                        "author": "Orchestrator",
                        "role": "Pipeline Coordinator",
                        "task": "Error handling",
                        "thoughts": [f"Orchestrator caught exception: {e!s}"],
                        "status": "failed",
                        "results": {"error": str(e)},
                        "latency_ms": 0.0,
                        "timestamp": time.time(),
                        "done": True,
                    },
                )

        # Run pipeline as a background task
        asyncio.create_task(run_pipeline())

        while True:
            event = await queue.get()
            yield event
            if event.get("done") is True:
                break
