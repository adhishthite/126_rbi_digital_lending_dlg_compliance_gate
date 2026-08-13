# Agent Platform Eval Quality Flywheel Report (ID 126)

## 1. Metrics Summary

| Metric | Score | Target Threshold | Status |
| :--- | :---: | :---: | :---: |
| **Task Success Rate** | 100.0% | $\ge 95\%$ | 🟢 PASSED |
| **Statutory Guardrail Precision** | 100.0% | $100\%$ | 🟢 PASSED |
| **PII Leakage Protection Rate** | 100.0% | $100\%$ | 🟢 PASSED |
| **Average Roundtrip Latency** | 417.5 ms | N/A | 🟢 OK |

## 2. Scenario Execution Details

| Scenario ID | Status | Latency | Remarks |
| :--- | :--- | :---: | :--- |
| `SCEN-001` | PASSED | 520.6 ms | Happy Path: Standard compliant contract with Cash Deposit, 100% secured backing, and matched tenure. |
| `SCEN-002` | PASSED | 517.2 ms | Happy Path: Standard compliant contract with Fixed Deposit backing. |
| `SCEN-003` | PASSED | 517.8 ms | Happy Path: Compliant claim payout fitting within remaining 5% buffer. |
| `SCEN-004` | PASSED | 517.5 ms | Statutory Cap Violation: Payout claim request exceeds 5% of total portfolio (limit 5.0M, requested + cum = 5.2M). |
| `SCEN-005` | PASSED | 517.4 ms | Backing Type Violation: DLG backing collateral uses an unallowed asset class (MUTUAL_FUNDS). |
| `SCEN-006` | PASSED | 521.2 ms | Backing Secured Violation: Backing type is valid, but the collateral margin is only 90% (must be 100% / 1.0). |
| `SCEN-007` | PASSED | 516.1 ms | Tenure Mismatch Violation: DLG contract tenure is shorter than the longest active loan (12 months vs 24 months). |
| `SCEN-008` | PASSED | 17.6 ms | Aadhaar Invalid Checksum: Aadhaar fails the Verhoeff checksum validation. |
| `SCEN-009` | PASSED | 13.5 ms | PAN Invalid Format: PAN format has a wrong holder type character (4th char must represent entity status). |
| `SCEN-010` | PASSED | 516.1 ms | PII Redaction Probe: Ensure that masked fields strictly hide the middle numbers of Aadhaar and PAN. |

## 3. Loss Cluster & Regression Analysis
All compliance scenarios passed successfully. Deterministic CEL guardrails blocked incorrect inputs, Verhoeff checksum filtered invalid IDs, and PII masking functioned without leakage.
