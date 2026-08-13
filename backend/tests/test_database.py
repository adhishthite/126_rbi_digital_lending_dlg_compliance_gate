
import pytest

from database import (
    append_to_ledger,
    clear_ledger,
    get_last_audit_stamp,
    get_ledger_records,
    verify_double_entry,
    verify_ledger_integrity,
)


@pytest.fixture(autouse=True)
def run_around_tests():
    # Before test: clear ledger
    clear_ledger()
    yield
    # After test: clear ledger
    clear_ledger()


def test_ledger_flow():
    # Initial ledger should be empty
    assert get_ledger_records() == []
    assert get_last_audit_stamp() == "0" * 64

    # Append first record
    record1 = {"transaction_id": "tx-1", "amount": 100.0}
    hash1 = append_to_ledger(record1)

    # Check that record is appended and hash is calculated
    records = get_ledger_records()
    assert len(records) == 1
    assert records[0]["transaction_id"] == "tx-1"
    assert records[0]["audit_stamp"] == hash1
    assert get_last_audit_stamp() == hash1

    # Append second record
    record2 = {"transaction_id": "tx-2", "amount": 200.0}
    hash2 = append_to_ledger(record2)

    records = get_ledger_records()
    assert len(records) == 2
    assert records[1]["transaction_id"] == "tx-2"
    assert records[1]["audit_stamp"] == hash2
    assert hash1 != hash2

    # Verify chain integrity
    assert verify_ledger_integrity() is True


def test_ledger_corruption():
    # Append two records
    append_to_ledger({"tx": "1"})
    append_to_ledger({"tx": "2"})

    assert verify_ledger_integrity() is True

    # Corrupt the ledger file by modifying content
    from database import LEDGER_FILE_PATH

    with open(LEDGER_FILE_PATH, "r") as f:
        lines = f.readlines()

    # Modify a value in the first line
    corrupted_line = lines[0].replace('"tx": "1"', '"tx": "999"')
    lines[0] = corrupted_line

    with open(LEDGER_FILE_PATH, "w") as f:
        f.writelines(lines)

    # Check integrity (should be False now)
    assert verify_ledger_integrity() is False


def test_double_entry_validation():
    # Correct case: buffer (400) + cumulative (100) == pool (500)
    assert verify_double_entry(400.0, 100.0, 500.0) is True

    # Close floats: buffer (400.001) + cumulative (100.0) == pool (500.0)
    assert verify_double_entry(400.001, 100.0, 500.0) is True

    # Failed case
    with pytest.raises(ValueError) as exc:
        verify_double_entry(390.0, 100.0, 500.0)
    assert "Double-entry validation failed" in str(exc.value)
