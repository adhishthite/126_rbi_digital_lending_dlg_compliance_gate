export interface RawTransactionPayload {
  transaction_id: string;
  arrangement_id: string;
  lsp_id: string;
  re_id: string;
  total_portfolio_amount_inr: number;
  current_loan_disbursement_inr: number;
  cumulative_dlg_payout_inr: number;
  current_payout_requested_inr: number;
  guarantee_backing_type: string;
  backing_secured_percentage: number;
  longest_loan_tenure_months: number;
  dlg_arrangement_tenure_months: number;
  borrower_consent_token: string;
  aadhaar_raw: string;
  pan_raw: string;
}

export interface TransactionResponse {
  status: "CLEARED" | "BLOCKED" | "HELD";
  transaction_id: string;
  message: string;
  audit_stamp: string | null;
  remaining_dlg_buffer_inr: number | null;
  escrow_splits: Record<string, number> | null;
  violation_reasons: string[];
}

export interface AgentEvent {
  author: string;
  role: string;
  task: string;
  thoughts: string[];
  status: "processing" | "completed" | "failed";
  results?: any;
  latency_ms: number;
  timestamp: number;
  done?: boolean;
}

export interface OnboardingConfig {
  preset: "standard" | "strict" | "custom";
  dlgCap: number; // e.g. 5 for 5%
  coLendingSplitRE: number; // e.g. 80 for 80%
  coLendingSplitLSP: number; // e.g. 20 for 20%
  minBackingSecured: number; // e.g. 100 for 100%
}

// Format INR nicely with standard Indian numbering system (e.g. 1,00,000)
export function formatINR(num: number | null | undefined): string {
  if (num === null || num === undefined) return "₹0.00";
  // Standard Indian formatting
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(num);
}

export function formatPercent(num: number): string {
  return `${num.toFixed(1)}%`;
}

// Validates Aadhaar format and Verhoeff-like checksum locally for visual feedback
export function isValidAadhaar(aadhaar: string): boolean {
  if (!/^\d{12}$/.test(aadhaar)) return false;

  // Verhoeff checksum algorithm implementation
  const d = [
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
  ];

  const p = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
  ];

  let c = 0;
  const numArr = aadhaar.split("").map(Number).reverse();
  for (let i = 0; i < numArr.length; i++) {
    c = d[c][p[i % 8][numArr[i]]];
  }
  return c === 0;
}

// Validates PAN format locally
export function isValidPAN(pan: string): boolean {
  return /^[A-Z]{5}\d{4}[A-Z]$/.test(pan);
}

export interface CELRuleResult {
  passed: boolean;
  formula: string;
  description: string;
  evaluatedValues: Record<string, string>;
  tooltip: string;
}

// Local CEL evaluator incorporating onboarding configs
export function evaluateCELRules(
  payload: RawTransactionPayload,
  config: OnboardingConfig,
): Record<string, CELRuleResult> {
  const capFraction = config.dlgCap / 100;
  const totalExposure = payload.cumulative_dlg_payout_inr + payload.current_payout_requested_inr;
  const limitCap = payload.total_portfolio_amount_inr * capFraction;
  const capPassed = totalExposure <= limitCap;

  const hasConsent = payload.borrower_consent_token.trim().length > 0;
  // Aadhaar raw and PAN raw are checked in input, but we simulate DPDP check
  const aadhaarValid = isValidAadhaar(payload.aadhaar_raw);
  const panValid = isValidPAN(payload.pan_raw);
  const dpdpPassed = hasConsent && aadhaarValid && panValid;

  const allowedBackings = ["CASH_DEPOSIT", "FIXED_DEPOSIT", "BANK_GUARANTEE"];
  const backingTypeOk = allowedBackings.includes(payload.guarantee_backing_type);
  const backingSecuredOk = payload.backing_secured_percentage >= config.minBackingSecured / 100;
  const backingPassed = backingTypeOk && backingSecuredOk;

  const tenurePassed = payload.dlg_arrangement_tenure_months >= payload.longest_loan_tenure_months;

  return {
    REG_DLG_CAP: {
      passed: capPassed,
      formula: `(double(cumulative_dlg_payout_inr) + double(current_payout_requested_inr)) <= (${capFraction.toFixed(3)} * double(total_portfolio_amount_inr))`,
      description: "Verify exposure fits within DLG Cap",
      evaluatedValues: {
        cumulative_dlg_payout_inr: formatINR(payload.cumulative_dlg_payout_inr),
        current_payout_requested_inr: formatINR(payload.current_payout_requested_inr),
        total_exposure: formatINR(totalExposure),
        total_portfolio_amount_inr: formatINR(payload.total_portfolio_amount_inr),
        dlg_cap_percentage: `${config.dlgCap}%`,
        cap_limit_ceiling: formatINR(limitCap),
      },
      tooltip: `Verifies that the historical DLG payouts plus the current guarantee claim (${formatINR(totalExposure)}) does not exceed the configured policy cap of ${config.dlgCap}% (${formatINR(limitCap)}).`,
    },
    REG_DPDP_SAFETY: {
      passed: dpdpPassed,
      formula: `borrower_consent_token != "" && matches(aadhaar_masked, "^X{8}\\\\d{4}$") && matches(pan_masked, "^X{5}\\\\d{4}X$")`,
      description: "DPDP compliance validation",
      evaluatedValues: {
        borrower_consent_token: payload.borrower_consent_token ? "Present" : "Missing",
        aadhaar_checksum: aadhaarValid ? "Valid (Verhoeff Passed)" : "Invalid Checksum",
        pan_format: panValid ? "Valid" : "Invalid",
        aadhaar_masked: `XXXXXXXX${payload.aadhaar_raw.slice(-4)}`,
        pan_masked: `XXXXX${payload.pan_raw.slice(5, 9)}X`,
      },
      tooltip:
        "Asserts borrower's explicit digital consent token is attached, and verifies deterministic hashing/masking of identity documents (Aadhaar & PAN) prior to risk orchestration.",
    },
    REG_DLG_BACKING: {
      passed: backingPassed,
      formula: `guarantee_backing_type in ["CASH_DEPOSIT", "FIXED_DEPOSIT", "BANK_GUARANTEE"] && backing_secured_percentage >= ${config.minBackingSecured / 100}`,
      description: "Statutory collateral backing verification",
      evaluatedValues: {
        guarantee_backing_type: payload.guarantee_backing_type,
        backing_secured_percentage: `${(payload.backing_secured_percentage * 100).toFixed(0)}%`,
        min_required_percentage: `${config.minBackingSecured}%`,
      },
      tooltip: `Enforces that the DLG backing instrument is Cash, Fixed Deposit, or Bank Guarantee, and is backed by collateral of at least ${config.minBackingSecured}%.`,
    },
    REG_DLG_TENURE: {
      passed: tenurePassed,
      formula: `dlg_arrangement_tenure_months >= longest_loan_tenure_months`,
      description: "DLG contract tenure matching",
      evaluatedValues: {
        dlg_arrangement_tenure_months: `${payload.dlg_arrangement_tenure_months} months`,
        longest_loan_tenure_months: `${payload.longest_loan_tenure_months} months`,
      },
      tooltip:
        "Matches tenure of the guarantee contract against the longest loan boarded in the LSP's portfolio. The guarantee contract cannot mature before the loans it protects.",
    },
  };
}

// Local stream simulator when backend is offline
export function generateLocalSimulatedStream(
  payload: RawTransactionPayload,
  config: OnboardingConfig,
  onEvent: (event: AgentEvent) => void,
) {
  const celResults = evaluateCELRules(payload, config);
  const allPassed = Object.values(celResults).every((r) => r.passed);

  const capPassed = celResults.REG_DLG_CAP.passed;
  const dpdpPassed = celResults.REG_DPDP_SAFETY.passed;
  const backingPassed = celResults.REG_DLG_BACKING.passed;
  const tenurePassed = celResults.REG_DLG_TENURE.passed;

  // Calculate splits
  const requested = payload.current_payout_requested_inr;
  const isClaim = requested > 0;

  let escrowSplits: Record<string, number> | null = null;
  let remainingBuffer = 0;
  const capLimit = payload.total_portfolio_amount_inr * (config.dlgCap / 100);

  if (allPassed) {
    if (isClaim) {
      const reShareFrac = config.coLendingSplitRE / 100;
      const lspShareFrac = config.coLendingSplitLSP / 100;
      escrowSplits = {
        RE_Share: requested * reShareFrac,
        LSP_Share: requested * lspShareFrac,
        Replenish_DLG_Pool: Math.min(requested, 50000), // Dummy replenishment logic
      };
      remainingBuffer = capLimit - (payload.cumulative_dlg_payout_inr + requested);
    } else {
      // Normal boarding split
      escrowSplits = {
        RE_Disbursement_Split:
          payload.current_loan_disbursement_inr * (config.coLendingSplitRE / 100),
        LSP_Partner_Split: payload.current_loan_disbursement_inr * (config.coLendingSplitLSP / 100),
      };
      remainingBuffer = capLimit - payload.cumulative_dlg_payout_inr;
    }
  }

  const finalStatus: "CLEARED" | "BLOCKED" = allPassed ? "CLEARED" : "BLOCKED";

  const events: Omit<AgentEvent, "timestamp">[] = [
    {
      author: "IngestionAgent",
      role: "Data Validator & Masking Coordinator",
      task: `Validating and ingestion of raw transaction ${payload.transaction_id}`,
      thoughts: [
        `Received raw payload for LSP ${payload.lsp_id} and RE ${payload.re_id}.`,
        "Validating Aadhaar format and Verhoeff checksum...",
        `Aadhaar checksum: ${isValidAadhaar(payload.aadhaar_raw) ? "VALID" : "INVALID"}`,
        "Validating PAN formatting and cardholder status character...",
        `PAN format: ${isValidPAN(payload.pan_raw) ? "VALID" : "INVALID"}`,
        "DPDP Borrower Consent Token detected: " +
          (payload.borrower_consent_token ? "ACTIVE" : "MISSING"),
        `Enforcing masking: masking Aadhaar to XXXXXXXX${payload.aadhaar_raw.slice(-4)}`,
        `Enforcing masking: masking PAN to XXXXX${payload.pan_raw.slice(5, 9)}X`,
      ],
      status:
        isValidAadhaar(payload.aadhaar_raw) &&
        isValidPAN(payload.pan_raw) &&
        payload.borrower_consent_token
          ? "completed"
          : "failed",
      results: {
        transaction_id: payload.transaction_id,
        arrangement_id: payload.arrangement_id,
        aadhaar_masked: `XXXXXXXX${payload.aadhaar_raw.slice(-4)}`,
        pan_masked: `XXXXX${payload.pan_raw.slice(5, 9)}X`,
        borrower_consent_token: payload.borrower_consent_token,
      },
      latency_ms: 12.4,
    },
    {
      author: "AuditorAgent",
      role: "Statutory CEL & Financial Math Auditor",
      task: "Run Compliance Audit & Policy Evaluations",
      thoughts: [
        "Analyzing DLG Pool Limits under configured policies...",
        `Configured Cap Limit: ${config.dlgCap}% of Portfolio.`,
        `Cumulative Payouts: ${formatINR(payload.cumulative_dlg_payout_inr)}`,
        `Requested Payout: ${formatINR(payload.current_payout_requested_inr)}`,
        `Total DLG Exposure: ${formatINR(payload.cumulative_dlg_payout_inr + payload.current_payout_requested_inr)}`,
        `Cap limit ceiling: ${formatINR(capLimit)}`,
        `Exposure check: ${capLimit >= (payload.cumulative_dlg_payout_inr + payload.current_payout_requested_inr) ? "PASSED" : "FAILED (Exceeds Cap)"}`,
        `Backing verification: Backing type ${payload.guarantee_backing_type} is ${celResults.REG_DLG_BACKING.passed ? "ALLOWED" : "DISALLOWED"}`,
        `Tenure matching: DLG tenure (${payload.dlg_arrangement_tenure_months}m) vs max loan tenure (${payload.longest_loan_tenure_months}m): ${tenurePassed ? "PASSED" : "FAILED"}`,
      ],
      status: allPassed ? "completed" : "failed",
      results: {
        dlg_pool_limit_inr: capLimit,
        current_dlg_utilization_percentage:
          ((payload.cumulative_dlg_payout_inr + payload.current_payout_requested_inr) / capLimit) *
          100,
        is_cap_exceeded: !capPassed,
        is_tenure_valid: tenurePassed,
        cel_rules_evaluation: {
          REG_DLG_CAP: capPassed,
          REG_DPDP_SAFETY: dpdpPassed,
          REG_DLG_BACKING: backingPassed,
          REG_DLG_TENURE: tenurePassed,
        },
        suggested_status: finalStatus,
        violation_reasons: Object.entries(celResults)
          .filter(([_, r]) => !r.passed)
          .map(([name, r]) => `${name} violated: ${r.description}`),
      },
      latency_ms: 22.8,
    },
    {
      author: "CheckerAgent",
      role: "Maker-Checker & Adversarial Risk Assessor",
      task: "Maker-Checker Verification & Adversarial Audit",
      thoughts: [
        "Reviewing Auditor assessment data...",
        "Double-entry validation: matching total assets with ledger outstanding...",
        allPassed
          ? "No statutory rule breaches detected. Performing adversarial check via LLM..."
          : "Statutory breach verified. Flagging transaction for blocking.",
        allPassed
          ? "Gemini Underwriting Audit: LSP default curves remain within historical ranges. Settlement splits approved."
          : "Transaction rejected. Blocking transaction pipeline.",
      ],
      status: allPassed ? "completed" : "failed",
      results: {
        checker_id: "checker-agent-gemini-pro-9",
        double_entry_verified: true,
        final_status: finalStatus,
        rejection_reasons: Object.entries(celResults)
          .filter(([_, r]) => !r.passed)
          .map(([name, r]) => `${name} violated: ${r.description}`),
        adversarial_remarks: allPassed
          ? "Approved: The co-lending arrangement respects the RBI 5% DLG guidelines. Ledger balances match perfectly. Risk exposure checks confirm high-liquidity backing."
          : "Blocked: Rule violations present. Security threshold breached.",
      },
      latency_ms: 140.5,
    },
    {
      author: "SettlementAgent",
      role: "Escrow Split & Ledger Registrar",
      task: "Settle Transaction, Escrow routing, Ledger Commitment",
      thoughts: [
        allPassed
          ? `Preparing payout distribution splits using co-lending split (${config.coLendingSplitRE}:${config.coLendingSplitLSP}).`
          : "Bypassing escrow splits due to transaction rejection.",
        allPassed
          ? "Calculating SHA-256 state hash for audit trail commitment..."
          : "Logging violation event in JSONL audit ledger.",
        allPassed
          ? "Append-only ledger registry entry committed successfully."
          : "Ledger commit marked as BLOCKED.",
      ],
      status: allPassed ? "completed" : "failed",
      results: {
        transaction_id: payload.transaction_id,
        arrangement_id: payload.arrangement_id,
        final_status: finalStatus,
        settled_payout_amount_inr: allPassed ? requested : 0,
        remaining_dlg_buffer_inr: remainingBuffer,
        escrow_splits: escrowSplits,
        audit_stamp: allPassed
          ? "ea3b922c0192e2729a924b172a6b2917ae6b2918ae6b2918846c4fef9019283f"
          : "847291a27e8d69f0b182e73f8a92f8373cf2b2917aeb2918074c6d8376ef816a",
      },
      latency_ms: 18.2,
    },
  ];

  // Stream each event with a delay simulating real-time agent thoughts
  let currentIdx = 0;
  function nextStep() {
    if (currentIdx < events.length) {
      const e = events[currentIdx];
      const timestamp = Date.now() / 1000;
      onEvent({ ...e, timestamp });
      currentIdx++;
      setTimeout(nextStep, 1000); // 1 second between agent runs
    } else {
      // Send done event
      onEvent({
        author: "Orchestrator",
        role: "Pipeline Coordinator",
        task: "Final response generation",
        thoughts: ["Simulated local orchestrator pipeline completed."],
        status: "completed",
        results: {
          status: finalStatus,
          transaction_id: payload.transaction_id,
          message: `Transaction processed with final status: ${finalStatus}`,
          audit_stamp: allPassed
            ? "ea3b922c0192e2729a924b172a6b2917ae6b2918ae6b2918846c4fef9019283f"
            : null,
          remaining_dlg_buffer_inr: allPassed ? remainingBuffer : null,
          escrow_splits: escrowSplits,
          violation_reasons: Object.entries(celResults)
            .filter(([_, r]) => !r.passed)
            .map(([name, r]) => `${name} violated: ${r.description}`),
        },
        latency_ms: 220,
        timestamp: Date.now() / 1000,
        done: true,
      });
    }
  }

  setTimeout(nextStep, 400); // initial small delay
}
