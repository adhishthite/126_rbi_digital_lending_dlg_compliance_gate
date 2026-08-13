import json
import subprocess
import time
import sys
import os
import httpx

API_URL = "http://127.0.0.1:8126/api/execute-transaction"
CONFIG_URL = "http://127.0.0.1:8126/api/config"

def boot_backend():
    print("Booting backend server for evals...")
    env = os.environ.copy()
    env["PYTHONPATH"] = "../backend"
    process = subprocess.Popen(
        ["uv", "run", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8126"],
        cwd="../backend",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env
    )
    # Wait for ready
    retries = 10
    while retries > 0:
        try:
            res = httpx.get(CONFIG_URL, timeout=1.0)
            if res.status_code == 200:
                print("Backend server is ready!")
                return process
        except Exception:
            pass
        time.sleep(0.5)
        retries -= 1
    
    print("Failed to boot backend server. Logs:")
    process.terminate()
    stdout, stderr = process.communicate()
    print("STDOUT:", stdout.decode())
    print("STDERR:", stderr.decode())
    sys.exit(1)

def run_evaluation():
    process = None
    # Check if already running, otherwise boot it
    try:
        res = httpx.get(CONFIG_URL, timeout=0.5)
        if res.status_code == 200:
            print("Backend already running on port 8126.")
    except Exception:
        process = boot_backend()

    try:
        with open("eval_dataset.json", "r") as f:
            scenarios = json.load(f)
    except FileNotFoundError:
        print("eval_dataset.json not found!")
        if process: process.terminate()
        sys.exit(1)

    total_scenarios = len(scenarios)
    task_successes = 0
    cel_precision_successes = 0
    pii_leakage_successes = 0
    total_latency = 0.0
    
    results = []

    print(f"\n--- Running {total_scenarios} Evaluation Scenarios ---")
    
    for sc in scenarios:
        sc_id = sc["scenario_id"]
        description = sc["description"]
        payload = sc["payload"]
        expected_status = sc["expected_status"]
        expected_violations = sc["expected_violations"]
        
        print(f"\nScenario [{sc_id}]: {description}")
        
        start_time = time.time()
        
        # Test if it gets validation errors at schema level
        if expected_status == "REJECTED_API_VALIDATION":
            try:
                res = httpx.post(API_URL, json=payload, timeout=5.0)
                elapsed = time.time() - start_time
                total_latency += elapsed * 1000
                
                if res.status_code == 422:
                    print(f"  Result: Validation Blocked (HTTP 422) as expected.")
                    task_successes += 1
                    cel_precision_successes += 1
                    pii_leakage_successes += 1 # Blocked before reaching logic, no PII leakage
                    results.append({
                        "id": sc_id,
                        "success": True,
                        "latency_ms": elapsed * 1000,
                        "status": "PASSED"
                    })
                else:
                    print(f"  Result: FAILED. Expected HTTP 422, got {res.status_code}")
                    results.append({
                        "id": sc_id,
                        "success": False,
                        "latency_ms": elapsed * 1000,
                        "status": f"FAILED: Expected 422, got {res.status_code}"
                    })
            except Exception as e:
                print(f"  Result: FAILED. Error: {e}")
                results.append({
                    "id": sc_id,
                    "success": False,
                    "latency_ms": 0,
                    "status": f"ERROR: {e}"
                })
            continue

        # Normal execution paths
        try:
            res = httpx.post(API_URL, json=payload, timeout=5.0)
            elapsed = time.time() - start_time
            total_latency += elapsed * 1000
            
            if res.status_code != 200:
                print(f"  Result: FAILED. Got HTTP {res.status_code}: {res.text}")
                results.append({
                    "id": sc_id,
                    "success": False,
                    "latency_ms": elapsed * 1000,
                    "status": f"FAILED: HTTP {res.status_code}"
                })
                continue
                
            data = res.json()
            status = data["status"]
            violation_reasons = data.get("violation_reasons", [])
            
            # 1. Task Success Check
            is_success = (status == expected_status)
            if is_success:
                task_successes += 1
                print(f"  Task Success: PASSED (Expected {expected_status}, Got {status})")
            else:
                print(f"  Task Success: FAILED (Expected {expected_status}, Got {status})")
                
            # 2. Statutory CEL Precision Check
            cel_ok = True
            if expected_status == "BLOCKED":
                # Ensure at least one expected violation is mentioned in reasons
                violation_str = " ".join(violation_reasons)
                found = any(v in violation_str for v in expected_violations)
                if found:
                    cel_precision_successes += 1
                    print(f"  CEL Precision: PASSED (Violations found: {violation_reasons})")
                else:
                    cel_ok = False
                    print(f"  CEL Precision: FAILED (Expected violations {expected_violations}, Got {violation_reasons})")
            else:
                cel_precision_successes += 1
                
            # 3. PII Leakage Check
            # Check response does not contain raw Aadhaar or PAN
            res_str = res.text
            aadhaar_leaked = payload["aadhaar_raw"] in res_str
            pan_leaked = payload["pan_raw"] in res_str
            
            if not aadhaar_leaked and not pan_leaked:
                pii_leakage_successes += 1
                print("  PII Leakage: PASSED (0 bytes raw PII leaked)")
            else:
                print(f"  PII Leakage: FAILED (Aadhaar leaked: {aadhaar_leaked}, PAN leaked: {pan_leaked})")
                
            results.append({
                "id": sc_id,
                "success": is_success and cel_ok and (not aadhaar_leaked and not pan_leaked),
                "latency_ms": elapsed * 1000,
                "status": "PASSED" if is_success and cel_ok and (not aadhaar_leaked and not pan_leaked) else "FAILED"
            })
            
        except Exception as e:
            print(f"  Result: ERROR: {e}")
            results.append({
                "id": sc_id,
                "success": False,
                "latency_ms": 0,
                "status": f"ERROR: {e}"
            })

    # Calculations
    task_success_rate = (task_successes / total_scenarios) * 100
    cel_precision_rate = (cel_precision_successes / total_scenarios) * 100
    pii_protection_rate = (pii_leakage_successes / total_scenarios) * 100
    avg_latency = total_latency / total_scenarios if total_scenarios > 0 else 0
    
    overall_pass = (sum(1 for r in results if r["success"]) / total_scenarios) * 100

    print("\n================ EVALUATION SUMMARY ================")
    print(f"Task Success Rate:             {task_success_rate:.2f}% (Threshold: >= 95%)")
    print(f"Statutory Guardrail Precision:  {cel_precision_rate:.2f}% (Threshold: 100%)")
    print(f"PII Leakage Protection Rate:   {pii_protection_rate:.2f}% (Threshold: 100%)")
    print(f"Average Roundtrip Latency:     {avg_latency:.2f} ms")
    print(f"Overall Scenarios Passed:      {overall_pass:.2f}%")
    print("====================================================")

    # Generate Report
    with open("eval_report.md", "w") as f:
        f.write(f"""# Agent Platform Eval Quality Flywheel Report (ID 126)

## 1. Metrics Summary

| Metric | Score | Target Threshold | Status |
| :--- | :---: | :---: | :---: |
| **Task Success Rate** | {task_success_rate:.1f}% | $\\ge 95\\%$ | {"🟢 PASSED" if task_success_rate >= 95 else "🔴 FAILED"} |
| **Statutory Guardrail Precision** | {cel_precision_rate:.1f}% | $100\\%$ | {"🟢 PASSED" if cel_precision_rate >= 100 else "🔴 FAILED"} |
| **PII Leakage Protection Rate** | {pii_protection_rate:.1f}% | $100\\%$ | {"🟢 PASSED" if pii_protection_rate >= 100 else "🔴 FAILED"} |
| **Average Roundtrip Latency** | {avg_latency:.1f} ms | N/A | 🟢 OK |

## 2. Scenario Execution Details

| Scenario ID | Status | Latency | Remarks |
| :--- | :--- | :---: | :--- |
""")
        for r, sc in zip(results, scenarios):
            f.write(f"| `{r['id']}` | {r['status']} | {r['latency_ms']:.1f} ms | {sc['description']} |\n")
            
        f.write("\n## 3. Loss Cluster & Regression Analysis\n")
        if overall_pass == 100.0:
            f.write("All compliance scenarios passed successfully. Deterministic CEL guardrails blocked incorrect inputs, Verhoeff checksum filtered invalid IDs, and PII masking functioned without leakage.\n")
        else:
            f.write("Some scenarios failed. Review agent logs in `audit_trace.jsonl` to diagnose AST matching failures or schema inconsistencies.\n")

    print("\nSaved evaluation report to evals/eval_report.md")

    if process:
        print("Stopping backend server...")
        process.terminate()
        process.wait()

if __name__ == "__main__":
    run_evaluation()
