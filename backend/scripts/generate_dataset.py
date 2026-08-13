import json
import os
import random
from typing import Any

# Verhoeff tables
VERHOEFF_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]

VERHOEFF_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]


def generate_valid_aadhaar() -> str:
    """
    Generates a valid 12-digit Aadhaar number with correct Verhoeff checksum.
    """
    # Start digit should not be 0 or 1
    prefix = str(random.randint(2, 9))
    for _ in range(10):
        prefix += str(random.randint(0, 9))

    c = 0
    for i, digit in enumerate(reversed(prefix)):
        p_val = VERHOEFF_P[(i + 1) % 8][int(digit)]
        c = VERHOEFF_D[c][p_val]

    for d in range(10):
        if VERHOEFF_D[c][d] == 0:
            return prefix + str(d)
    return prefix + "0"


def generate_valid_pan() -> str:
    """
    Generates a valid Indian PAN card format (regex matched & valid holder status).
    """
    letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    pan = "".join(random.choices(letters, k=3))

    # 4th char: Cardholder status
    holder_status = random.choice(["P", "C", "H", "F", "A", "T", "B", "L", "J", "G"])
    pan += holder_status

    # 5th char: Surname first character
    pan += random.choice(letters)

    # 4 digits
    pan += "".join(random.choices("0123456789", k=4))

    # 1 check digit letter
    pan += random.choice(letters)

    return pan


def generate_profile(tx_idx: int) -> dict[str, Any]:
    """
    Generates a realistic transaction profile.
    """
    total_portfolio = float(
        random.choice([5000000.0, 10000000.0, 20000000.0, 50000000.0])
    )
    dlg_cap = total_portfolio * 0.05

    # Cumulative payout should be less than cap
    cumulative_payout = float(random.randint(0, int(dlg_cap * 0.5)))

    # Current requested payout should keep total under cap
    max_safe_request = dlg_cap - cumulative_payout
    current_request = (
        float(random.randint(1000, int(max_safe_request * 0.8)))
        if max_safe_request > 1000
        else 0.0
    )

    # Longest loan tenure 12 to 60 months
    longest_loan_tenure = random.choice([12, 24, 36, 48, 60])
    # DLG arrangement tenure should match or exceed longest loan tenure
    dlg_tenure = longest_loan_tenure + random.choice([0, 6, 12, 24])

    return {
        "transaction_id": f"tx-valid-{tx_idx:03d}",
        "arrangement_id": f"arr-{random.randint(100, 999)}",
        "lsp_id": f"lsp-{random.randint(10, 99)}",
        "re_id": f"re-{random.randint(10, 99)}",
        "total_portfolio_amount_inr": total_portfolio,
        "current_loan_disbursement_inr": float(random.randint(100000, 1000000)),
        "cumulative_dlg_payout_inr": cumulative_payout,
        "current_payout_requested_inr": current_request,
        "guarantee_backing_type": random.choice(
            ["CASH_DEPOSIT", "FIXED_DEPOSIT", "BANK_GUARANTEE"]
        ),
        "backing_secured_percentage": 1.0,
        "longest_loan_tenure_months": longest_loan_tenure,
        "dlg_arrangement_tenure_months": dlg_tenure,
        "borrower_consent_token": f"consent-token-{random.randint(100000, 999999)}",
        "aadhaar_raw": generate_valid_aadhaar(),
        "pan_raw": generate_valid_pan(),
    }


def main():
    dataset = []

    # Generate 25 valid records
    for i in range(1, 26):
        dataset.append(generate_profile(i))

    # Generate invalid records

    # 1. Invalid Aadhaar checksum
    record_bad_aadhaar = generate_profile(26)
    record_bad_aadhaar["transaction_id"] = "tx-invalid-bad-aadhaar"
    # Mutate the last digit of Aadhaar to corrupt Verhoeff checksum
    aadhaar_list = list(record_bad_aadhaar["aadhaar_raw"])
    original_last = int(aadhaar_list[-1])
    aadhaar_list[-1] = str((original_last + 1) % 10)
    record_bad_aadhaar["aadhaar_raw"] = "".join(aadhaar_list)
    dataset.append(record_bad_aadhaar)

    # 2. Invalid PAN format
    record_bad_pan = generate_profile(27)
    record_bad_pan["transaction_id"] = "tx-invalid-bad-pan"
    record_bad_pan["pan_raw"] = "ABCDE12345F"  # 11 characters, invalid length/format
    dataset.append(record_bad_pan)

    # 3. DLG backing type not allowed
    record_bad_backing = generate_profile(28)
    record_bad_backing["transaction_id"] = "tx-invalid-bad-backing"
    record_bad_backing["guarantee_backing_type"] = "UNSECURED_PROMISE"
    dataset.append(record_bad_backing)

    # 4. DLG tenure too short
    record_bad_tenure = generate_profile(29)
    record_bad_tenure["transaction_id"] = "tx-invalid-bad-tenure"
    record_bad_tenure["longest_loan_tenure_months"] = 36
    record_bad_tenure["dlg_arrangement_tenure_months"] = 24  # less than 36
    dataset.append(record_bad_tenure)

    # 5. DLG amount exceeding 5% cap
    record_exceed_cap = generate_profile(30)
    record_exceed_cap["transaction_id"] = "tx-invalid-exceed-cap"
    record_exceed_cap["total_portfolio_amount_inr"] = 10000000.0  # cap = 500k
    record_exceed_cap["cumulative_dlg_payout_inr"] = 400000.0
    record_exceed_cap["current_payout_requested_inr"] = 150000.0  # total = 550k > 500k
    dataset.append(record_exceed_cap)

    output_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "seed_data.json"
    )

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(dataset, f, indent=2)

    print(
        f"Dataset generated successfully with {len(dataset)} records at: {output_path}"
    )


if __name__ == "__main__":
    main()
