import time
from collections.abc import Callable
from typing import Any

from agents.base import BaseAgent
from database import append_to_ledger, get_last_audit_stamp
from math_engine import calculate_recovery_allocation, calculate_remaining_buffer
from schema import CheckedDecisionPayload, SettlementReceiptPayload


class SettlementAgent(BaseAgent):
    def __init__(
        self, event_callback: Callable[[dict[str, Any]], None] | None = None
    ):
        super().__init__(
            name="SettlementAgent",
            role="Financial Settlement & Ledger Publisher",
            event_callback=event_callback,
        )

    def run(self, decision: CheckedDecisionPayload) -> SettlementReceiptPayload:
        start_time = time.perf_counter()
        self.thoughts = []

        self.log_thought(
            f"Processing settlement for transaction {decision.audit_assessment.ingested_data.transaction_id} with status {decision.final_status}"
        )
        self.emit_event(
            task="Executing financial split calculations and ledger publication",
            status="processing",
        )

        ingested = decision.audit_assessment.ingested_data

        # Initialize default values
        settled_payout_amount_inr = 0.0
        remaining_dlg_buffer_inr = calculate_remaining_buffer(
            decision.audit_assessment.dlg_pool_limit_inr,
            ingested.cumulative_dlg_payout_inr,
            0.0,
        )

        escrow_splits = {"RE Share": 0.0, "LSP Share": 0.0, "Collateral Release": 0.0}

        audit_stamp = ""

        if decision.final_status == "CLEARED":
            # Determine if it's a claim payout or a default recovery
            current_payout_requested = ingested.current_payout_requested_inr

            # Remaining buffer after applying this transaction
            remaining_dlg_buffer_inr = calculate_remaining_buffer(
                decision.audit_assessment.dlg_pool_limit_inr,
                ingested.cumulative_dlg_payout_inr,
                current_payout_requested,
            )

            if current_payout_requested >= 0:
                # Normal claim payout requested by RE from DLG pool
                settled_payout_amount_inr = current_payout_requested
                escrow_splits["RE Share"] = current_payout_requested
                self.log_thought(
                    f"Calculated standard DLG claim payout splits: RE Share = {current_payout_requested:,.2f} INR"
                )
            else:
                # Recovery (current_payout_requested is negative)
                recovered_amount = abs(current_payout_requested)
                settled_payout_amount_inr = current_payout_requested  # negative

                # Apply 80:20 RE-NBFC split recovery logic
                alloc = calculate_recovery_allocation(
                    recovered_amount=recovered_amount,
                    claimed_payout_amount=ingested.cumulative_dlg_payout_inr,
                )

                # RE Share = 80% of remaining recovery
                # LSP Share = 20% of remaining recovery (here NBFC is the LSP/NBFC partner)
                # Collateral Release = amount replenished to DLG
                escrow_splits["RE Share"] = alloc["re_share"]
                escrow_splits["LSP Share"] = alloc["nbfc_share"]
                escrow_splits["Collateral Release"] = alloc["replenished_to_dlg"]

                self.log_thought(
                    f"Calculated default recovery splits: "
                    f"Replenished to DLG = {alloc['replenished_to_dlg']:,.2f} INR, "
                    f"RE Share (80%) = {alloc['re_share']:,.2f} INR, "
                    f"LSP Share (20%) = {alloc['nbfc_share']:,.2f} INR"
                )

            # Prepare ledger record
            record_data = {
                "transaction_id": ingested.transaction_id,
                "arrangement_id": ingested.arrangement_id,
                "final_status": decision.final_status,
                "settled_payout_amount_inr": settled_payout_amount_inr,
                "remaining_dlg_buffer_inr": remaining_dlg_buffer_inr,
                "escrow_splits": escrow_splits,
            }

            self.log_thought(
                "Appending transaction record to the JSONL ledger and chaining SHA-256 state..."
            )
            audit_stamp = append_to_ledger(record_data)
            self.log_thought(
                f"Ledger append successful. New audit stamp: {audit_stamp}"
            )

        else:
            # BLOCKED or HELD
            self.log_thought("Transaction was BLOCKED or HELD. Skipping ledger append.")
            audit_stamp = get_last_audit_stamp()

        receipt = SettlementReceiptPayload(
            transaction_id=ingested.transaction_id,
            arrangement_id=ingested.arrangement_id,
            final_status=decision.final_status,
            settled_payout_amount_inr=settled_payout_amount_inr,
            remaining_dlg_buffer_inr=remaining_dlg_buffer_inr,
            escrow_splits=escrow_splits,
            audit_stamp=audit_stamp,
        )

        latency_ms = (time.perf_counter() - start_time) * 1000.0
        self.emit_event(
            task="Completed settlement and ledger publishing",
            status="completed",
            results=receipt.model_dump(),
            latency_ms=latency_ms,
        )
        return receipt
