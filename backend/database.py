import hashlib
import json
import math
import os
from typing import Any

LEDGER_FILE_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "audit_trace.jsonl"
)

GENESIS_HASH = "0" * 64


def get_ledger_records() -> list[dict[str, Any]]:
    """
    Read all records from the audit trace JSONL file.
    """
    if not os.path.exists(LEDGER_FILE_PATH):
        return []

    records = []
    with open(LEDGER_FILE_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line_str = line.strip()
            if line_str:
                records.append(json.loads(line_str))
    return records


def get_last_audit_stamp() -> str:
    """
    Get the audit stamp of the latest record, or the genesis hash if the ledger is empty.
    """
    records = get_ledger_records()
    if not records:
        return GENESIS_HASH
    return records[-1].get("audit_stamp", GENESIS_HASH)


def append_to_ledger(record_data: dict[str, Any]) -> str:
    """
    Appends a record to the JSONL ledger, calculates the next SHA-256 audit stamp,
    and returns the new audit stamp.
    """
    # Clone record data to avoid modifying the input dictionary
    record = dict(record_data)
    # Pop audit_stamp if it exists, to hash only the payload
    record.pop("audit_stamp", None)

    previous_audit_stamp = get_last_audit_stamp()

    # Serialize data deterministically
    current_record_json = json.dumps(record, sort_keys=True, separators=(",", ":"))

    # Calculate SHA-256
    hash_input = previous_audit_stamp + current_record_json
    new_audit_stamp = hashlib.sha256(hash_input.encode("utf-8")).hexdigest()

    # Add stamp to record and append to file
    record["audit_stamp"] = new_audit_stamp

    with open(LEDGER_FILE_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")

    return new_audit_stamp


def verify_ledger_integrity() -> bool:
    """
    Verifies the SHA-256 chain integrity of the ledger.
    """
    records = get_ledger_records()
    if not records:
        return True

    previous_hash = GENESIS_HASH
    for record in records:
        # Extract stored audit stamp
        stored_hash = record.get("audit_stamp")
        if not stored_hash:
            return False

        # Prepare record without stamp for hashing
        record_copy = dict(record)
        record_copy.pop("audit_stamp", None)

        current_record_json = json.dumps(
            record_copy, sort_keys=True, separators=(",", ":")
        )
        hash_input = previous_hash + current_record_json
        expected_hash = hashlib.sha256(hash_input.encode("utf-8")).hexdigest()

        if stored_hash != expected_hash:
            return False

        previous_hash = stored_hash

    return True


def verify_double_entry(
    buffer_balance: float, cumulative_payouts: float, initial_pool_amount: float
) -> bool:
    """
    Double-entry validation check:
    Buffer Balance + Cumulative Payouts == Initial Permissible Pool Amount
    Raises ValueError if validation fails.
    """
    left_side = buffer_balance + cumulative_payouts
    # Compare with a tolerance of 0.01 to avoid floating-point issues
    if not math.isclose(left_side, initial_pool_amount, abs_tol=0.01):
        raise ValueError(
            f"Double-entry validation failed: Buffer Balance ({buffer_balance:,.2f}) + "
            f"Cumulative Payouts ({cumulative_payouts:,.2f}) = {left_side:,.2f}, which does not match "
            f"Initial Permissible Pool Amount ({initial_pool_amount:,.2f})."
        )
    return True


def clear_ledger() -> None:
    """
    Clears the ledger file (useful for testing).
    """
    if os.path.exists(LEDGER_FILE_PATH):
        os.remove(LEDGER_FILE_PATH)
