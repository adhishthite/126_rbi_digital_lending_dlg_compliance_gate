import re

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


def validate_aadhaar(aadhaar: str) -> bool:
    """
    Validates a 12-digit Aadhaar number using the Verhoeff algorithm.
    """
    if not isinstance(aadhaar, str):
        return False
    if not aadhaar.isdigit() or len(aadhaar) != 12:
        return False

    # Aadhaar numbers do not start with 0 or 1
    if aadhaar[0] in ("0", "1"):
        return False

    c = 0
    # Process digits in reverse order
    for i, digit in enumerate(reversed(aadhaar)):
        p_val = VERHOEFF_P[i % 8][int(digit)]
        c = VERHOEFF_D[c][p_val]

    return c == 0


def validate_pan(pan: str) -> bool:
    """
    Validates Indian PAN structure and cardholder type.
    Format: AAAAA9999A
    """
    if not isinstance(pan, str):
        return False
    if len(pan) != 10:
        return False

    # Check standard regex format
    if not re.match(r"^[A-Z]{5}[0-9]{4}[A-Z]$", pan):
        return False

    # 4th character represents holder status:
    # P - Individual, C - Company, H - HUF, F - Firm/LLP, A - AOP, T - Trust,
    # B - BOI, L - Local Authority, J - Artificial Juridical Person, G - Government
    valid_holder_types = {"P", "C", "H", "F", "A", "T", "B", "L", "J", "G"}
    return pan[3] in valid_holder_types
