from validation import validate_aadhaar, validate_pan


def test_validate_aadhaar():
    # 3675 9832 4678 is a valid Aadhaar number (mock/randomly generated with correct Verhoeff check digit)
    assert validate_aadhaar("367598324678") is True

    # Test starting with 0 or 1
    assert validate_aadhaar("067598324677") is False
    assert validate_aadhaar("167598324677") is False

    # Test invalid length
    assert validate_aadhaar("36759832467") is False  # 11 digits
    assert validate_aadhaar("3675983246778") is False  # 13 digits

    # Test invalid characters
    assert validate_aadhaar("36759832467a") is False
    assert validate_aadhaar("3675-9832-4677") is False

    # Test wrong checksum digit
    assert validate_aadhaar("367598324677") is False


def test_validate_pan():
    # Valid individual PAN (4th char P)
    assert validate_pan("ABCPE1234F") is True
    # Valid company PAN (4th char C)
    assert validate_pan("ABCCE1234F") is True
    # Valid government PAN (4th char G)
    assert validate_pan("ABCGE1234Z") is True

    # Invalid holder type (4th character 'D' or 'X' is invalid)
    assert validate_pan("ABCDE1234F") is False
    assert validate_pan("ABCDX1234F") is False

    # Invalid length
    assert validate_pan("ABCPE1234") is False
    assert validate_pan("ABCPE12345F") is False

    # Invalid format (non-digits in middle)
    assert validate_pan("ABCPE12A4F") is False
    # Invalid format (non-letters at start/end)
    assert validate_pan("1BCPE1234F") is False
    assert validate_pan("ABCPE12345") is False

    # Lowercase characters
    assert validate_pan("abcpe1234f") is False
    assert validate_pan("ABCPe1234F") is False
