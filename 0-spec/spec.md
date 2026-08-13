# Spec: RBI Digital Lending DLG Compliance Gate (ID 126)

## 1. Overview
This application serves as an automated compliance gate validating Default Loss Guarantee (DLG) / First Loss Default Guarantee (FLDG) contracts and transactions between Fintech Loan Service Providers (LSPs) and Regulated Entities (REs) like Banks or NBFCs. It ensures compliance with the RBI Master Directions on DLG (which enforces a strict 5% cap on the total guaranteed amount relative to the loan portfolio).

## 2. Core Architecture
The system consists of:
- **Backend (Python / FastAPI / uv):**
  - **Multi-Agent Orchestrator:** Sequential pipeline parsing contracts, auditing DLG pools, checking statutory rules, and settling transactions.
  - **Financial Math Engine:** Calculates DLG pool size, guarantee caps, utilization rate, outstanding balances, and 80:20 co-lending splits if applicable.
  - **CEL Guardrail Engine:** Evaluation of RBI limits and ReBIT consent formats.
  - **SSE Telemetry:** Dynamic multi-agent event stream (/api/stream).
- **Frontend (Next.js 16 / React 19 / pnpm):**
  - **Split-Screen Workspace:** Scenario selector on the left, storyboard walkthrough and SSE audit log on the right.
  - **Signature Element:** Real-time CEL Rule Inspector and DLG Pool Stress-Tester.
  - **Design System:** Cloud Design System (CDS / Carbon / Pantheon archetype).

## 3. Directory Structure
```
126_rbi_digital_lending_dlg_compliance_gate/
├── Makefile
├── README.md
├── DEMO_SCRIPT.md
├── ARCHITECTURE.md
├── portless.json
├── backend/
│   ├── pyproject.toml
│   ├── uv.lock
│   ├── main.py
│   ├── config.py
│   ├── schema.py
│   ├── orchestrator.py
│   ├── agents/
│   │   ├── base.py
│   │   ├── ingestion.py
│   │   ├── auditor.py
│   │   ├── checker.py
│   │   └── settlement.py
│   ├── math_engine.py
│   ├── guardrails.py
│   ├── database.py
│   ├── seed_data.json
│   └── tests/
│       ├── test_agents.py
│       └── test_e2e_scenarios.py
├── frontend/
│   ├── package.json
│   ├── pnpm-lock.yaml
│   ├── next.config.ts
│   ├── app/
│   └── components/
└── evals/
    ├── eval_dataset.json
    ├── run_evals.py
    └── eval_report.md
```

## 4. Port Configuration
- Backend API: `https://126-api.localhost` / Fallback: `http://localhost:8126`
- Frontend UI: `https://126-ui.localhost` / Fallback: `http://localhost:3126`
