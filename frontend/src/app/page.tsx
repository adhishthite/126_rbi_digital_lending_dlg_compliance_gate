"use client";

import {
  Activity,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Cpu,
  FileSpreadsheet,
  Info,
  Lock,
  Moon,
  Play,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Sun,
  Terminal,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Tooltip as RechartsTooltip,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import seedScenarios from "./seed_data.json";
import {
  type AgentEvent,
  evaluateCELRules,
  formatINR,
  formatPercent,
  generateLocalSimulatedStream,
  type OnboardingConfig,
  type RawTransactionPayload,
  type TransactionResponse,
} from "./utils";

export default function ComplianceGateConsole() {
  // Navigation & Theme
  const [step, setStep] = useState<1 | 2>(1);
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [isMounted, setIsMounted] = useState<boolean>(false);

  // Backend config & connection status
  const [backendStatus, setBackendStatus] = useState<"connected" | "offline">("offline");
  const [backendConfig, setBackendConfig] = useState<{
    MODE: string;
    GCP_PROJECT: string;
    GCP_LOCATION: string;
    GEMINI_MODEL: string;
  } | null>(null);

  // Onboarding Config State
  const [config, setConfig] = useState<OnboardingConfig>({
    preset: "standard",
    dlgCap: 5.0,
    coLendingSplitRE: 80,
    coLendingSplitLSP: 20,
    minBackingSecured: 100,
  });

  // Cockpit States
  const [selectedScenario, setSelectedScenario] = useState<RawTransactionPayload | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "HAPPY" | "VIOLATION">("ALL");

  // Pipeline Run States
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamEvents, setStreamEvents] = useState<AgentEvent[]>([]);
  const [finalResult, setFinalResult] = useState<TransactionResponse | null>(null);
  const [showConsoleDrawer, setShowConsoleDrawer] = useState(true);
  const [hoveredCELVar, setHoveredCELVar] = useState<{ name: string; val: string } | null>(null);
  const [activeCELTab, setActiveCELTab] = useState<string>("REG_DLG_CAP");
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<"story" | "inspector">("story");

  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Auto-detect theme
  useEffect(() => {
    setIsMounted(true);
    const storedTheme = localStorage.getItem("theme");
    if (
      storedTheme === "dark" ||
      (!storedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches)
    ) {
      setDarkMode(true);
      document.documentElement.classList.add("dark");
    } else {
      setDarkMode(false);
      document.documentElement.classList.remove("dark");
    }
  }, []);

  // Poll backend health & fetch configurations
  useEffect(() => {
    const checkBackend = async () => {
      try {
        const hostname = window.location.hostname;
        const res = await fetch(`http://${hostname}:8126/api/config`);
        if (res.ok) {
          const data = await res.json();
          setBackendStatus("connected");
          setBackendConfig(data);
        } else {
          setBackendStatus("offline");
        }
      } catch (_err) {
        setBackendStatus("offline");
      }
    };
    checkBackend();
    const interval = setInterval(checkBackend, 5000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll terminal console
  useEffect(() => {
    if (streamEvents.length > 0 && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [streamEvents]);

  const toggleDarkMode = () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    if (newMode) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  };

  // Adjust config based on Presets
  const handlePresetChange = (preset: "standard" | "strict" | "custom") => {
    if (preset === "standard") {
      setConfig({
        preset: "standard",
        dlgCap: 5.0,
        coLendingSplitRE: 80,
        coLendingSplitLSP: 20,
        minBackingSecured: 100,
      });
    } else if (preset === "strict") {
      setConfig({
        preset: "strict",
        dlgCap: 3.0,
        coLendingSplitRE: 90,
        coLendingSplitLSP: 10,
        minBackingSecured: 100,
      });
    } else {
      setConfig((prev) => ({ ...prev, preset: "custom" }));
    }
  };

  // Process transaction compliance verification (synchronous or stream)
  const runVerification = async () => {
    if (!selectedScenario) return;
    setIsStreaming(true);
    setStreamEvents([]);
    setFinalResult(null);

    // If backend is running, stream from FastAPI `/api/stream` SSE
    if (backendStatus === "connected") {
      try {
        const hostname = window.location.hostname;
        const payloadStr = encodeURIComponent(JSON.stringify(selectedScenario));
        const sseUrl = `http://${hostname}:8126/api/stream?payload=${payloadStr}`;
        const eventSource = new EventSource(sseUrl);

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.error) {
              setStreamEvents((prev) => [
                ...prev,
                {
                  author: "System",
                  role: "Gateway Egress",
                  task: "Stream Error",
                  thoughts: [data.error],
                  status: "failed",
                  latency_ms: 0,
                  timestamp: Date.now() / 1000,
                },
              ]);
              setIsStreaming(false);
              eventSource.close();
              return;
            }

            if (data.done) {
              setFinalResult(data.results);
              setIsStreaming(false);
              eventSource.close();
            } else {
              setStreamEvents((prev) => [...prev, data]);
            }
          } catch (err) {
            console.error("SSE parse error", err);
          }
        };

        eventSource.onerror = (err) => {
          console.error("SSE connection error", err);
          setStreamEvents((prev) => [
            ...prev,
            {
              author: "System",
              role: "Gateway Egress",
              task: "SSE Connection Failure",
              thoughts: ["Lost connection to streaming endpoint. Switched to offline simulation."],
              status: "failed",
              latency_ms: 0,
              timestamp: Date.now() / 1000,
            },
          ]);
          setIsStreaming(false);
          eventSource.close();
          // Failover to local simulation
          runLocalSimulation();
        };
      } catch (_err) {
        runLocalSimulation();
      }
    } else {
      // Backend is offline, run local browser-based simulator
      runLocalSimulation();
    }
  };

  const runLocalSimulation = () => {
    if (!selectedScenario) return;
    generateLocalSimulatedStream(selectedScenario, config, (event) => {
      if (event.done) {
        setFinalResult(event.results);
        setIsStreaming(false);
      } else {
        setStreamEvents((prev) => [...prev, event]);
      }
    });
  };

  // Helper to categorize scenarios
  const getScenarioLabel = (sc: (typeof seedScenarios)[0]) => {
    if (sc.transaction_id.includes("bad-aadhaar"))
      return {
        text: "Bad Aadhaar",
        color:
          "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/50",
      };
    if (sc.transaction_id.includes("bad-pan"))
      return {
        text: "Bad PAN",
        color:
          "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/50",
      };
    if (sc.transaction_id.includes("bad-backing"))
      return {
        text: "Invalid Collateral",
        color:
          "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/50",
      };
    if (sc.transaction_id.includes("bad-tenure"))
      return {
        text: "Tenure Mismatch",
        color:
          "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50",
      };
    if (sc.transaction_id.includes("exceed-cap"))
      return {
        text: "Cap Breach Probe",
        color:
          "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/50",
      };
    return {
      text: "Happy Path",
      color:
        "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/50",
    };
  };

  // Filter Scenarios
  const filteredScenarios = seedScenarios.filter((sc) => {
    const matchesSearch =
      sc.transaction_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sc.lsp_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sc.re_id.toLowerCase().includes(searchQuery.toLowerCase());

    const label = getScenarioLabel(sc).text;
    if (statusFilter === "ALL") return matchesSearch;
    if (statusFilter === "HAPPY") return matchesSearch && label === "Happy Path";
    if (statusFilter === "VIOLATION") return matchesSearch && label !== "Happy Path";
    return matchesSearch;
  });

  // Calculate local live metrics for charts & panels
  const localCEL = selectedScenario ? evaluateCELRules(selectedScenario, config) : null;
  const isLocalBreach = localCEL ? !localCEL.REG_DLG_CAP.passed : false;

  const capLimitVal = selectedScenario
    ? selectedScenario.total_portfolio_amount_inr * (config.dlgCap / 100)
    : 0;
  const utilizationPercentage = selectedScenario
    ? ((selectedScenario.cumulative_dlg_payout_inr +
        selectedScenario.current_payout_requested_inr) /
        capLimitVal) *
      100
    : 0;

  // Chart Data
  const chartData = selectedScenario
    ? [
        {
          name: "Exposure Ratio",
          "Statutory Cap Limit": capLimitVal,
          "Historical Payouts": selectedScenario.cumulative_dlg_payout_inr,
          "Current Request": selectedScenario.current_payout_requested_inr,
        },
      ]
    : [];

  if (!isMounted) return null;

  return (
    <div className="min-h-screen flex flex-col antialiased bg-slate-50 text-slate-900 dark:bg-[#070b13] dark:text-slate-100">
      {/* GLOBAL HEADER */}
      <header className="sticky top-0 z-30 flex items-center justify-between px-4 py-2 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 shadow-xs h-12">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-6 h-6 bg-blue-600 rounded-[2px] text-white font-bold text-xs">
            DLG
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-slate-800 dark:text-slate-200">
              RBI DLG Gatekeeper Console
            </h1>
            <span className="hidden sm:inline-block text-[10px] text-slate-400 font-mono">
              v1.0.0 · Circular-41 Compliance
            </span>
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-4">
          {/* Connection Status Badge */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-xs bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] font-mono">
            <span
              className={`w-2 h-2 rounded-full ${backendStatus === "connected" ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`}
            />
            <span className="text-slate-600 dark:text-slate-400">
              {backendStatus === "connected"
                ? `Connected · Vertex AI (${backendConfig?.GCP_LOCATION}) · ${backendConfig?.MODE === "MOCK" ? "MOCK Mode" : "LIVE Mode"}`
                : "Offline · Local Simulation Mode"}
            </span>
          </div>

          {/* Configuration Summary Badge (Visible in Step 2) */}
          {step === 2 && (
            <div className="hidden lg:flex items-center gap-3 text-[11px] font-mono border-l border-slate-200 dark:border-slate-800 pl-4 text-slate-500 dark:text-slate-400">
              <span>
                Cap: <strong className="text-blue-600 dark:text-blue-400">{config.dlgCap}%</strong>
              </span>
              <span>
                Split:{" "}
                <strong className="text-blue-600 dark:text-blue-400">
                  {config.coLendingSplitRE}/{config.coLendingSplitLSP}
                </strong>
              </span>
              <span>
                Backing:{" "}
                <strong className="text-blue-600 dark:text-blue-400">
                  {config.minBackingSecured}%
                </strong>
              </span>
            </div>
          )}

          {/* Step Switching / Reconfigure */}
          {step === 2 && (
            <button
              onClick={() => setStep(1)}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xs transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
              Reconfigure Rules
            </button>
          )}

          {/* Dark Mode Toggle */}
          <button
            onClick={toggleDarkMode}
            className="p-1.5 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xs"
            aria-label="Toggle dark mode"
          >
            {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>
        </div>
      </header>

      {/* OFFLINE WARNING BANNER */}
      {backendStatus === "offline" && (
        <div className="bg-amber-500/10 dark:bg-amber-950/20 border-b border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs px-4 py-1.5 flex items-center justify-between gap-2 font-mono">
          <div className="flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>
              <strong>Fallback Active:</strong> FastAPI Backend (port 8126) is offline. Interactive
              screens will run via high-fidelity sandbox client-side simulation.
            </span>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="underline hover:text-amber-900 dark:hover:text-amber-100"
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* MAIN CONTAINER */}
      <main className="flex-1 flex flex-col">
        {/* STEP 1: CONFIGURATION GATE (ONBOARDING) */}
        {step === 1 && (
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="w-full max-w-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xs shadow-md p-6">
              {/* Institutional Header */}
              <div className="border-b border-slate-200 dark:border-slate-800 pb-4 mb-6">
                <div className="flex items-center gap-3 mb-2">
                  <ShieldCheck className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                  <div>
                    <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                      RBI DLG Policy Gatekeeper
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Configure risk parameters and compliance rules under Circular RBI/2023-24/41
                    </p>
                  </div>
                </div>
                <div className="mt-3 bg-blue-500/5 dark:bg-blue-900/10 border border-blue-500/20 rounded-xs px-3 py-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400 font-mono">
                  This console regulates Credit Enhancement (DLG) arrangements between Lending
                  Service Providers (LSPs) and Regulated Entities. Onboard your policy presets
                  below.
                </div>
              </div>

              {/* Policy Preset Selection */}
              <div className="mb-6">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                  1. Policy Preset
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Preset 1 */}
                  <button
                    type="button"
                    onClick={() => handlePresetChange("standard")}
                    className={`flex flex-col items-start p-3 text-left border rounded-xs transition-all ${
                      config.preset === "standard"
                        ? "border-blue-600 bg-blue-50/20 dark:border-blue-500 dark:bg-blue-950/20"
                        : "border-slate-200 bg-slate-50 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:bg-slate-900"
                    }`}
                  >
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Standard RBI 5% Cap
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                      Statutory regulatory cap. 80:20 risk split. 100% secured collateral.
                    </span>
                  </button>

                  {/* Preset 2 */}
                  <button
                    type="button"
                    onClick={() => handlePresetChange("strict")}
                    className={`flex flex-col items-start p-3 text-left border rounded-xs transition-all ${
                      config.preset === "strict"
                        ? "border-blue-600 bg-blue-50/20 dark:border-blue-500 dark:bg-blue-950/20"
                        : "border-slate-200 bg-slate-50 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:bg-slate-900"
                    }`}
                  >
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Strict Internal 3% Cap
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                      Conservative risk tolerance. 90:10 risk split. 100% secured collateral.
                    </span>
                  </button>

                  {/* Preset 3 */}
                  <button
                    type="button"
                    onClick={() => handlePresetChange("custom")}
                    className={`flex flex-col items-start p-3 text-left border rounded-xs transition-all ${
                      config.preset === "custom"
                        ? "border-blue-600 bg-blue-50/20 dark:border-blue-500 dark:bg-blue-950/20"
                        : "border-slate-200 bg-slate-50 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:bg-slate-900"
                    }`}
                  >
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Custom Sliders
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                      Manually adjust thresholds, splits, and collateral levels.
                    </span>
                  </button>
                </div>
              </div>

              {/* Custom Sliders Panel */}
              <div
                className={`p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xs mb-6 ${
                  config.preset !== "custom" ? "opacity-50 pointer-events-none" : ""
                }`}
              >
                <div className="flex items-center gap-1.5 mb-3 border-b border-slate-200 dark:border-slate-800 pb-1.5">
                  <Sliders className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Policy Parameter Customization {config.preset !== "custom" && "(Locked)"}
                  </h3>
                </div>

                <div className="space-y-4">
                  {/* Slider 1: DLG Cap */}
                  <div>
                    <div className="flex justify-between items-center text-xs mb-1">
                      <span className="text-slate-600 dark:text-slate-400">
                        Default Loss Guarantee (DLG) Cap Limit
                      </span>
                      <span className="font-bold font-mono text-blue-600 dark:text-blue-400">
                        {config.dlgCap}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="10"
                      step="0.5"
                      value={config.dlgCap}
                      onChange={(e) =>
                        setConfig((prev) => ({ ...prev, dlgCap: Number(e.target.value) }))
                      }
                      className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-xs appearance-none cursor-pointer accent-blue-600"
                    />
                    <span className="text-[10px] text-slate-400">
                      RBI circular ceiling is 5.0%. Exceeding 5% is a statutory breach.
                    </span>
                  </div>

                  {/* Slider 2: Co-Lending Split */}
                  <div>
                    <div className="flex justify-between items-center text-xs mb-1">
                      <span className="text-slate-600 dark:text-slate-400">
                        Co-Lending Risk-Recovery Split (RE / LSP)
                      </span>
                      <span className="font-bold font-mono text-blue-600 dark:text-blue-400">
                        {config.coLendingSplitRE} : {config.coLendingSplitLSP}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="100"
                      step="5"
                      value={config.coLendingSplitRE}
                      onChange={(e) => {
                        const re = Number(e.target.value);
                        setConfig((prev) => ({
                          ...prev,
                          coLendingSplitRE: re,
                          coLendingSplitLSP: 100 - re,
                        }));
                      }}
                      className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-xs appearance-none cursor-pointer accent-blue-600"
                    />
                    <span className="text-[10px] text-slate-400">
                      Portion of loans / default recoveries routed back to Regulated Entity vs LSP
                      Partner.
                    </span>
                  </div>

                  {/* Slider 3: Backing secured percentage */}
                  <div>
                    <div className="flex justify-between items-center text-xs mb-1">
                      <span className="text-slate-600 dark:text-slate-400">
                        Minimum Collateral Backing Secured %
                      </span>
                      <span className="font-bold font-mono text-blue-600 dark:text-blue-400">
                        {config.minBackingSecured}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="100"
                      step="10"
                      value={config.minBackingSecured}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          minBackingSecured: Number(e.target.value),
                        }))
                      }
                      className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-xs appearance-none cursor-pointer accent-blue-600"
                    />
                    <span className="text-[10px] text-slate-400">
                      Minimum required lien margin coverage on bank guarantees or cash/fixed
                      deposits.
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <button
                type="button"
                onClick={() => setStep(2)}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-xs flex items-center justify-center gap-2 cursor-pointer shadow-sm hover:shadow-md transition-all border border-blue-700"
              >
                Access Compliance Cockpit
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: COMPLIANCE COCKPIT (SPLIT-SCREEN WORKSPACE) */}
        {step === 2 && (
          <div className="flex-1 flex flex-col md:flex-row min-h-0 border-t border-slate-200 dark:border-slate-800">
            {/* LEFT PANE: SCENARIOS SELECTOR */}
            <aside className="w-full md:w-80 bg-white dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 flex flex-col shrink-0">
              {/* Search & Filter Header */}
              <div className="p-3 border-b border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1 flex-1">
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    Ledger Scenarios ({filteredScenarios.length})
                  </h3>
                </div>

                {/* Search Bar */}
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-slate-400">
                    <Search className="w-3.5 h-3.5" />
                  </span>
                  <input
                    type="text"
                    placeholder="Search scenario ID..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-7 pr-2 py-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xs text-xs focus:outline-hidden focus:border-blue-500 font-mono"
                  />
                </div>

                {/* Filter Selector tabs */}
                <div className="flex bg-slate-100 dark:bg-slate-900 p-0.5 rounded-xs text-[10px] font-semibold">
                  <button
                    onClick={() => setStatusFilter("ALL")}
                    className={`flex-1 py-1 text-center rounded-xs ${statusFilter === "ALL" ? "bg-white text-slate-900 dark:bg-slate-800 dark:text-white shadow-xs" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setStatusFilter("HAPPY")}
                    className={`flex-1 py-1 text-center rounded-xs ${statusFilter === "HAPPY" ? "bg-white text-slate-900 dark:bg-slate-800 dark:text-white shadow-xs" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}
                  >
                    Happy
                  </button>
                  <button
                    onClick={() => setStatusFilter("VIOLATION")}
                    className={`flex-1 py-1 text-center rounded-xs ${statusFilter === "VIOLATION" ? "bg-white text-slate-900 dark:bg-slate-800 dark:text-white shadow-xs" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}
                  >
                    Violating
                  </button>
                </div>
              </div>

              {/* Scenarios List (Scrollable) */}
              <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-900">
                {filteredScenarios.length > 0 ? (
                  filteredScenarios.map((sc) => {
                    const isSelected = selectedScenario?.transaction_id === sc.transaction_id;
                    const labelInfo = getScenarioLabel(sc);
                    return (
                      <button
                        key={sc.transaction_id}
                        onClick={() => {
                          setSelectedScenario(sc);
                          setFinalResult(null);
                          setStreamEvents([]);
                        }}
                        className={`w-full text-left p-3 flex flex-col gap-1 hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors ${
                          isSelected
                            ? "bg-blue-50/30 border-l-[3px] border-blue-500 dark:bg-blue-950/10"
                            : ""
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold font-mono text-slate-700 dark:text-slate-300">
                            {sc.transaction_id}
                          </span>
                          <span className={`cds-badge ${labelInfo.color}`}>{labelInfo.text}</span>
                        </div>

                        {/* Transaction Metadata preview */}
                        <div className="grid grid-cols-2 gap-x-2 gap-y-1 mt-1 text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                          <div>
                            LSP:{" "}
                            <span className="text-slate-800 dark:text-slate-200">{sc.lsp_id}</span>
                          </div>
                          <div>
                            RE:{" "}
                            <span className="text-slate-800 dark:text-slate-200">{sc.re_id}</span>
                          </div>
                          <div>
                            Amt:{" "}
                            <span className="text-slate-800 dark:text-slate-200">
                              {sc.current_payout_requested_inr > 0
                                ? formatINR(sc.current_payout_requested_inr)
                                : formatINR(sc.current_loan_disbursement_inr)}
                            </span>
                          </div>
                          <div>
                            Type:{" "}
                            <span className="text-slate-800 dark:text-slate-200">
                              {sc.current_payout_requested_inr > 0 ? "Claim" : "Board"}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="p-4 text-center text-xs text-slate-400 italic">
                    No scenarios matching search criteria
                  </div>
                )}
              </div>
            </aside>

            {/* RIGHT PANE: AUDITOR WORKSPACE */}
            <section className="flex-1 bg-slate-50 dark:bg-[#070b13] flex flex-col min-h-0 overflow-y-auto">
              {selectedScenario ? (
                <div className="p-4 space-y-4 flex flex-col flex-1">
                  {/* Scenario Control Toolbar */}
                  <div className="cds-panel p-3 flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-950">
                    <div className="flex items-center gap-2.5">
                      <div className="p-1.5 bg-blue-100 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-xs text-blue-600 dark:text-blue-400">
                        <Cpu className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          Active Auditing Target
                        </h4>
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold font-mono text-slate-800 dark:text-slate-100">
                            {selectedScenario.transaction_id}
                          </span>
                          <span className="text-slate-400 text-xs font-mono">
                            ({selectedScenario.arrangement_id})
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setFinalResult(null);
                          setStreamEvents([]);
                        }}
                        className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 bg-white hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xs cursor-pointer transition-colors"
                      >
                        Reset
                      </button>
                      <button
                        onClick={runVerification}
                        disabled={isStreaming}
                        className="px-4 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800/40 text-white font-bold text-xs uppercase tracking-wider rounded-xs flex items-center gap-1.5 cursor-pointer shadow-xs border border-blue-700 transition-colors"
                      >
                        {isStreaming ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            Streaming...
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5" />
                            Verify Compliances
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Compliance Assessment Banner */}
                  {finalResult && (
                    <div
                      className={`cds-panel p-3 border-l-4 flex items-center justify-between gap-3 ${
                        finalResult.status === "CLEARED"
                          ? "border-l-emerald-500 bg-emerald-50/10 dark:bg-emerald-950/10 border-emerald-500/20"
                          : finalResult.status === "BLOCKED"
                            ? "border-l-red-500 bg-red-50/10 dark:bg-red-950/10 border-red-500/20"
                            : "border-l-amber-500 bg-amber-50/10 dark:bg-amber-950/10 border-amber-500/20"
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <div className="mt-0.5">
                          {finalResult.status === "CLEARED" ? (
                            <ShieldCheck className="w-5 h-5 text-emerald-500" />
                          ) : finalResult.status === "BLOCKED" ? (
                            <ShieldAlert className="w-5 h-5 text-red-500" />
                          ) : (
                            <AlertCircle className="w-5 h-5 text-amber-500" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                              Orchestrator Decision Outcome
                            </h4>
                            <span
                              className={`cds-badge font-mono text-[9px] ${
                                finalResult.status === "CLEARED"
                                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                  : finalResult.status === "BLOCKED"
                                    ? "bg-red-500/10 text-red-400 border-red-500/20"
                                    : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                              }`}
                            >
                              {finalResult.status}
                            </span>
                          </div>
                          <p className="text-xs font-medium mt-0.5 text-slate-800 dark:text-slate-200">
                            {finalResult.message}
                          </p>
                          {finalResult.violation_reasons &&
                            finalResult.violation_reasons.length > 0 && (
                              <ul className="mt-1.5 space-y-0.5 text-[11px] text-red-500 font-mono list-disc list-inside">
                                {finalResult.violation_reasons.map((reason, idx) => (
                                  <li key={idx}>{reason}</li>
                                ))}
                              </ul>
                            )}
                        </div>
                      </div>

                      {finalResult.audit_stamp && (
                        <div className="hidden lg:block text-right font-mono text-[10px] text-slate-400 shrink-0">
                          <div>Audit Stamp (SHA-256)</div>
                          <div className="text-slate-650 dark:text-slate-400 font-bold truncate w-40 text-xs">
                            {finalResult.audit_stamp.slice(0, 8)}...
                            {finalResult.audit_stamp.slice(-8)}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Primary Tab Workspace selectors */}
                  <div className="flex border-b border-slate-200 dark:border-slate-800">
                    <button
                      onClick={() => setActiveWorkspaceTab("story")}
                      className={`px-4 py-1.5 text-xs font-bold uppercase tracking-wider border-b-2 -mb-[2px] transition-all cursor-pointer ${
                        activeWorkspaceTab === "story"
                          ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                          : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                      }`}
                    >
                      Interactive Storyboard
                    </button>
                    <button
                      onClick={() => setActiveWorkspaceTab("inspector")}
                      className={`px-4 py-1.5 text-xs font-bold uppercase tracking-wider border-b-2 -mb-[2px] transition-all cursor-pointer ${
                        activeWorkspaceTab === "inspector"
                          ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                          : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                      }`}
                    >
                      CEL Rules & DLG Stress-Tester
                    </button>
                  </div>

                  {/* TAB CONTENT: STORYBOARD */}
                  {activeWorkspaceTab === "story" && (
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
                      {/* Step 1: Raw Ingestion */}
                      <div className="cds-panel p-3 flex flex-col justify-between min-h-[220px] bg-white dark:bg-slate-950">
                        <div>
                          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-900 pb-1.5 mb-2.5">
                            <span className="text-[10px] font-bold font-mono text-blue-600 dark:text-blue-400">
                              STAGE 01
                            </span>
                            <span className="text-[10px] uppercase font-bold text-slate-400 font-sans">
                              Raw Ingestion
                            </span>
                          </div>
                          <h5 className="text-xs font-bold text-slate-800 dark:text-slate-200 mb-2">
                            LSP Transaction Influx
                          </h5>
                          <div className="space-y-1.5 text-[11px] font-mono leading-relaxed text-slate-650 dark:text-slate-400">
                            <div>
                              Arrangement:{" "}
                              <span className="text-slate-800 dark:text-slate-200">
                                {selectedScenario.arrangement_id}
                              </span>
                            </div>
                            <div>
                              LSP ID:{" "}
                              <span className="text-slate-800 dark:text-slate-200">
                                {selectedScenario.lsp_id}
                              </span>
                            </div>
                            <div>
                              RE ID:{" "}
                              <span className="text-slate-800 dark:text-slate-200">
                                {selectedScenario.re_id}
                              </span>
                            </div>
                            <div className="border-t border-slate-100 dark:border-slate-900 my-1 pt-1">
                              Aadhaar:{" "}
                              <span className="text-amber-600 dark:text-amber-500 font-bold">
                                {selectedScenario.aadhaar_raw}
                              </span>
                            </div>
                            <div>
                              PAN:{" "}
                              <span className="text-amber-600 dark:text-amber-500 font-bold">
                                {selectedScenario.pan_raw}
                              </span>
                            </div>
                            <div>
                              Consent:{" "}
                              <span className="text-emerald-655 dark:text-emerald-500">
                                {selectedScenario.borrower_consent_token ? "Granted" : "None"}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 text-[10px] text-slate-400 font-mono italic">
                          * Unmasked PII at ingestion boundary.
                        </div>
                      </div>

                      {/* Step 2: Cleanse & Masking */}
                      <div className="cds-panel p-3 flex flex-col justify-between min-h-[220px] bg-white dark:bg-slate-950">
                        <div>
                          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-900 pb-1.5 mb-2.5">
                            <span className="text-[10px] font-bold font-mono text-blue-600 dark:text-blue-400">
                              STAGE 02
                            </span>
                            <span className="text-[10px] uppercase font-bold text-slate-400 font-sans">
                              Cleanse & Masking
                            </span>
                          </div>
                          <h5 className="text-xs font-bold text-slate-800 dark:text-slate-200 mb-2 flex items-center gap-1">
                            <Lock className="w-3.5 h-3.5 text-blue-500" />
                            DPDP 2023 Masking
                          </h5>
                          <div className="space-y-1.5 text-[11px] font-mono leading-relaxed text-slate-655 dark:text-slate-400">
                            <div>Consent Token:</div>
                            <div className="text-slate-850 dark:text-slate-200 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-1 rounded-xs truncate text-[9px] mb-2">
                              {selectedScenario.borrower_consent_token}
                            </div>
                            <div className="border-t border-slate-100 dark:border-slate-900 my-1 pt-1" />
                            <div className="flex justify-between items-center bg-blue-500/5 p-1 rounded-xs border border-blue-500/10">
                              <span>Aadhaar Masked:</span>
                              <span className="text-blue-600 dark:text-blue-400 font-bold">
                                XXXXXXXX{selectedScenario.aadhaar_raw.slice(-4)}
                              </span>
                            </div>
                            <div className="flex justify-between items-center bg-blue-500/5 p-1 rounded-xs border border-blue-500/10 mt-1">
                              <span>PAN Masked:</span>
                              <span className="text-blue-600 dark:text-blue-400 font-bold">
                                XXXXX{selectedScenario.pan_raw.slice(5, 9)}X
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center gap-1 text-[10px] text-emerald-600 font-mono font-semibold">
                          <CheckCircle2 className="w-3 h-3" />
                          Ingestion Boundary Secured
                        </div>
                      </div>

                      {/* Step 3: Compliance Assessment */}
                      <div className="cds-panel p-3 flex flex-col justify-between min-h-[220px] bg-white dark:bg-slate-950">
                        <div>
                          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-900 pb-1.5 mb-2.5">
                            <span className="text-[10px] font-bold font-mono text-blue-600 dark:text-blue-400">
                              STAGE 03
                            </span>
                            <span className="text-[10px] uppercase font-bold text-slate-400 font-sans">
                              Guardrails Audit
                            </span>
                          </div>
                          <h5 className="text-xs font-bold text-slate-800 dark:text-slate-200 mb-2">
                            CEL Policies Evaluation
                          </h5>
                          {localCEL ? (
                            <div className="space-y-2 text-[11px] font-mono">
                              <div className="flex items-center justify-between">
                                <span className="text-slate-500">REG_DLG_CAP</span>
                                <span
                                  className={
                                    localCEL.REG_DLG_CAP.passed
                                      ? "text-emerald-500 font-bold"
                                      : "text-red-500 font-bold"
                                  }
                                >
                                  {localCEL.REG_DLG_CAP.passed ? "PASS" : "FAIL"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-slate-500">REG_DPDP_SAFETY</span>
                                <span
                                  className={
                                    localCEL.REG_DPDP_SAFETY.passed
                                      ? "text-emerald-500 font-bold"
                                      : "text-red-500 font-bold"
                                  }
                                >
                                  {localCEL.REG_DPDP_SAFETY.passed ? "PASS" : "FAIL"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-slate-500">REG_DLG_BACKING</span>
                                <span
                                  className={
                                    localCEL.REG_DLG_BACKING.passed
                                      ? "text-emerald-500 font-bold"
                                      : "text-red-500 font-bold"
                                  }
                                >
                                  {localCEL.REG_DLG_BACKING.passed ? "PASS" : "FAIL"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-slate-500">REG_DLG_TENURE</span>
                                <span
                                  className={
                                    localCEL.REG_DLG_TENURE.passed
                                      ? "text-emerald-500 font-bold"
                                      : "text-red-500 font-bold"
                                  }
                                >
                                  {localCEL.REG_DLG_TENURE.passed ? "PASS" : "FAIL"}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400 italic">
                              No audit evaluations loaded
                            </span>
                          )}
                        </div>
                        <div className="mt-3 border-t border-slate-100 dark:border-slate-900 pt-2 flex items-center justify-between">
                          <span className="text-[10px] text-slate-400 uppercase font-mono font-sans">
                            Suggested Status
                          </span>
                          <span
                            className={`cds-badge font-mono text-[9px] ${
                              !localCEL
                                ? "bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400"
                                : Object.values(localCEL).every((r) => r.passed)
                                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                  : "bg-red-500/10 text-red-400 border-red-500/20"
                            }`}
                          >
                            {!localCEL
                              ? "UNKNOWN"
                              : Object.values(localCEL).every((r) => r.passed)
                                ? "CLEARED"
                                : "BLOCKED"}
                          </span>
                        </div>
                      </div>

                      {/* Step 4: Settlement Split */}
                      <div className="cds-panel p-3 flex flex-col justify-between min-h-[220px] bg-white dark:bg-slate-950">
                        <div>
                          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-900 pb-1.5 mb-2.5">
                            <span className="text-[10px] font-bold font-mono text-blue-600 dark:text-blue-400">
                              STAGE 04
                            </span>
                            <span className="text-[10px] uppercase font-bold text-slate-400 font-sans">
                              Ledger Split
                            </span>
                          </div>
                          <h5 className="text-xs font-bold text-slate-800 dark:text-slate-200 mb-2">
                            Co-Lending splits
                          </h5>
                          {finalResult &&
                          finalResult.status === "CLEARED" &&
                          finalResult.escrow_splits ? (
                            <div className="space-y-1.5 text-[11px] font-mono leading-relaxed">
                              {Object.entries(finalResult.escrow_splits).map(([key, val]) => (
                                <div
                                  key={key}
                                  className="flex justify-between items-center border-b border-slate-50 dark:border-slate-900 pb-1"
                                >
                                  <span className="text-slate-500 truncate mr-2">
                                    {key.replace(/_/g, " ")}:
                                  </span>
                                  <span className="text-slate-800 dark:text-slate-200 font-bold">
                                    {formatINR(val)}
                                  </span>
                                </div>
                              ))}
                              <div className="flex justify-between items-center pt-2 font-bold text-slate-800 dark:text-slate-200">
                                <span>Remaining Buffer:</span>
                                <span className="text-blue-600 dark:text-blue-400">
                                  {formatINR(finalResult.remaining_dlg_buffer_inr)}
                                </span>
                              </div>
                            </div>
                          ) : finalResult && finalResult.status !== "CLEARED" ? (
                            <div className="bg-red-500/5 border border-red-500/10 p-2 rounded-xs text-[10px] text-red-500 font-mono leading-normal">
                              ⛔ <strong>Escrow waterfall bypassed.</strong> Transaction rejected
                              due to guardrail violations. Split calculations suspended.
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400 italic">
                              Splits calculation pending evaluation run
                            </span>
                          )}
                        </div>
                        <div className="mt-3 border-t border-slate-100 dark:border-slate-900 pt-2 font-mono text-[9px] text-slate-400 truncate">
                          {finalResult
                            ? `Stamp: ${finalResult.audit_stamp}`
                            : "* Ledger receipt signature is empty."}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* TAB CONTENT: INSPECTOR & STRESS TESTER */}
                  {activeWorkspaceTab === "inspector" && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* CEL Inspector (Left Panel) */}
                      <div className="cds-panel p-4 bg-white dark:bg-slate-950 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2 mb-3">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                              <Terminal className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                              Statutory CEL Rule Inspector
                            </h3>
                          </div>

                          {/* CEL rule selector tabs */}
                          <div className="flex bg-slate-50 dark:bg-slate-900 p-0.5 rounded-xs text-[10px] font-bold font-mono mb-3 border border-slate-200 dark:border-slate-800">
                            {localCEL &&
                              Object.keys(localCEL).map((ruleName) => {
                                const passed = localCEL[ruleName].passed;
                                return (
                                  <button
                                    key={ruleName}
                                    onClick={() => setActiveCELTab(ruleName)}
                                    className={`flex-1 py-1 text-center rounded-xs flex items-center justify-center gap-1 ${
                                      activeCELTab === ruleName
                                        ? "bg-white text-slate-900 dark:bg-slate-800 dark:text-white shadow-xs"
                                        : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                                    }`}
                                  >
                                    <span
                                      className={`w-1.5 h-1.5 rounded-full ${passed ? "bg-emerald-500" : "bg-red-500"}`}
                                    />
                                    {ruleName}
                                  </button>
                                );
                              })}
                          </div>

                          {/* Selected CEL Rule Details */}
                          {localCEL?.[activeCELTab] && (
                            <div className="space-y-4">
                              <div>
                                <div className="flex justify-between items-center text-xs font-bold mb-1.5 text-slate-700 dark:text-slate-300">
                                  <span>Rule: {activeCELTab}</span>
                                  <span
                                    className={`px-2 py-0.5 rounded-xs text-[10px] font-bold ${
                                      localCEL[activeCELTab].passed
                                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                                        : "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300"
                                    }`}
                                  >
                                    {localCEL[activeCELTab].passed ? "CLEARED" : "VIOLATING"}
                                  </span>
                                </div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-3">
                                  {localCEL[activeCELTab].tooltip}
                                </p>

                                {/* Rule AST Code Fenced Block */}
                                <div className="bg-slate-950 text-slate-200 font-mono text-[11px] p-3 rounded-xs border border-slate-800 relative overflow-x-auto select-all">
                                  <div className="absolute top-1 right-2 text-[9px] text-slate-500 font-sans font-semibold uppercase tracking-wider">
                                    CEL Spec
                                  </div>
                                  <code className="block pr-12 text-blue-300 whitespace-pre">
                                    {localCEL[activeCELTab].formula}
                                  </code>
                                </div>
                              </div>

                              {/* AST Variable Value Evaluation Tree */}
                              <div>
                                <h5 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                                  Line-by-Line AST Bindings Value Tree
                                </h5>
                                <div className="cds-panel bg-slate-50 dark:bg-slate-900 p-2 divide-y divide-slate-100 dark:divide-slate-800 text-[11px] font-mono">
                                  {Object.entries(localCEL[activeCELTab].evaluatedValues).map(
                                    ([varName, val]) => (
                                      <div
                                        key={varName}
                                        className="flex justify-between py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800/40 transition-colors px-1"
                                        onMouseEnter={() =>
                                          setHoveredCELVar({ name: varName, val })
                                        }
                                        onMouseLeave={() => setHoveredCELVar(null)}
                                      >
                                        <span className="text-slate-500 cursor-help flex items-center gap-1">
                                          <Info className="w-3 h-3 text-slate-400" />
                                          {varName}:
                                        </span>
                                        <span className="text-slate-800 dark:text-slate-200 font-bold truncate max-w-xs">
                                          {val}
                                        </span>
                                      </div>
                                    ),
                                  )}
                                </div>
                                {hoveredCELVar && (
                                  <div className="mt-2 text-[10px] text-blue-600 dark:text-blue-400 font-mono bg-blue-500/5 p-1 rounded-xs border border-blue-500/10">
                                    Hover Bind: <code>{hoveredCELVar.name}</code> ={" "}
                                    <strong>{hoveredCELVar.val}</strong>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Stress-Tester Chart (Right Panel) */}
                      <div className="cds-panel p-4 bg-white dark:bg-slate-950 flex flex-col justify-between">
                        {/* Title Header */}
                        <div>
                          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2 mb-3">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                              <Activity className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                              DLG Pool Stress-Tester
                            </h3>
                            <span className="text-[10px] font-mono text-slate-400">
                              Exposure vs. Pool Cap Limit
                            </span>
                          </div>

                          {/* Gauge Metrics */}
                          <div className="grid grid-cols-3 gap-2 mb-4 text-center font-mono">
                            <div className="p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xs">
                              <div className="text-[10px] text-slate-400 font-sans">
                                Cap Limit %
                              </div>
                              <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                                {config.dlgCap}%
                              </div>
                            </div>
                            <div className="p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xs">
                              <div className="text-[10px] text-slate-400 font-sans">
                                Pool Limit Value
                              </div>
                              <div className="text-xs font-bold text-blue-600 dark:text-blue-400">
                                {formatINR(capLimitVal)}
                              </div>
                            </div>
                            <div className="p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xs">
                              <div className="text-[10px] text-slate-400 font-sans font-sans">
                                Utilization Rate
                              </div>
                              <div
                                className={`text-xs font-bold ${utilizationPercentage > 100 ? "text-red-500" : "text-emerald-500"}`}
                              >
                                {utilizationPercentage.toFixed(1)}%
                              </div>
                            </div>
                          </div>

                          {/* Horizontal Gauge Bar */}
                          <div className="space-y-1.5 mb-6">
                            <div className="flex justify-between text-[11px] font-mono text-slate-500">
                              <span>Total Pool Exposure Capacity</span>
                              <span
                                className={
                                  utilizationPercentage > 100
                                    ? "text-red-500 font-bold"
                                    : "text-slate-700 dark:text-slate-300 font-bold"
                                }
                              >
                                {utilizationPercentage > 100 ? "⛔ BREACH" : "🟢 COMPLIANT"}
                              </span>
                            </div>
                            <div className="w-full h-4 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xs overflow-hidden relative flex">
                              {/* Historical Portion */}
                              <div
                                style={{
                                  width: `${Math.min(100, (selectedScenario.cumulative_dlg_payout_inr / capLimitVal) * 100)}%`,
                                }}
                                className="h-full bg-slate-500/70"
                                title={`Historical Payouts: ${formatINR(selectedScenario.cumulative_dlg_payout_inr)}`}
                              />
                              {/* Requested Claim Portion */}
                              <div
                                style={{
                                  width: `${Math.min(100, (selectedScenario.current_payout_requested_inr / capLimitVal) * 100)}%`,
                                }}
                                className={`h-full ${isLocalBreach ? "bg-red-500 animate-pulse" : "bg-blue-500"}`}
                                title={`Requested Claim: ${formatINR(selectedScenario.current_payout_requested_inr)}`}
                              />
                            </div>
                            <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                              <span>0%</span>
                              <span>
                                Hist:{" "}
                                {formatPercent(
                                  (selectedScenario.cumulative_dlg_payout_inr / capLimitVal) * 100,
                                )}
                              </span>
                              <span>
                                Req:{" "}
                                {formatPercent(
                                  (selectedScenario.current_payout_requested_inr / capLimitVal) *
                                    100,
                                )}
                              </span>
                              <span className="text-red-500 font-bold">100% (Cap)</span>
                            </div>
                          </div>
                        </div>

                        {/* Recharts Stacked Comparison Bar Chart */}
                        <div className="h-44 w-full text-xs">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={chartData}
                              margin={{ top: 10, right: 10, left: 10, bottom: 5 }}
                            >
                              <CartesianGrid
                                strokeDasharray="3 3"
                                vertical={false}
                                stroke={darkMode ? "#1e293b" : "#e2e8f0"}
                              />
                              <XAxis
                                dataKey="name"
                                tick={{ fill: darkMode ? "#94a3b8" : "#64748b" }}
                              />
                              <YAxis
                                tickFormatter={(v) => `₹${(v / 100000).toFixed(0)}L`}
                                tick={{ fill: darkMode ? "#94a3b8" : "#64748b" }}
                              />
                              <RechartsTooltip
                                formatter={(value: any) => formatINR(value)}
                                contentStyle={{
                                  backgroundColor: darkMode ? "#0f172a" : "#ffffff",
                                  borderColor: darkMode ? "#1e293b" : "#e2e8f0",
                                  color: darkMode ? "#f1f5f9" : "#0f172a",
                                }}
                              />
                              <Legend wrapperStyle={{ fontSize: 11 }} />

                              {/* Stacked comparison bars */}
                              <Bar
                                dataKey="Historical Payouts"
                                stackId="exposure"
                                fill="#64748b"
                                radius={[0, 0, 0, 0]}
                              />
                              <Bar
                                dataKey="Current Request"
                                stackId="exposure"
                                fill={isLocalBreach ? "#ef4444" : "#3b82f6"}
                                radius={[2, 2, 0, 0]}
                              />

                              {/* Target Cap reference line */}
                              <ReferenceLine
                                y={capLimitVal}
                                label={{
                                  value: "Cap Ceiling",
                                  position: "top",
                                  fill: "#ef4444",
                                  fontSize: 10,
                                  fontWeight: "bold",
                                  fontFamily: "monospace",
                                }}
                                stroke="#ef4444"
                                strokeDasharray="4 4"
                              />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* AGENT SSE LIVE CONSOLE PANEL */}
                  <div className="cds-panel bg-slate-900 border-slate-950 flex flex-col flex-1 min-h-[220px] shadow-inner">
                    {/* Console Header */}
                    <div className="flex items-center justify-between px-3 py-2 bg-slate-950 border-b border-slate-800">
                      <div className="flex items-center gap-2">
                        <Terminal className="w-4 h-4 text-emerald-400" />
                        <h4 className="text-xs font-bold font-mono tracking-wide text-slate-200">
                          Multi-Agent Orchestrator Live Stream Console
                        </h4>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setStreamEvents([])}
                          className="text-[10px] font-mono text-slate-500 hover:text-slate-350 bg-transparent border-0 cursor-pointer"
                        >
                          Clear
                        </button>
                        <button
                          onClick={() => setShowConsoleDrawer(!showConsoleDrawer)}
                          className="text-[10px] font-mono text-blue-400 hover:underline bg-transparent border-0 cursor-pointer"
                        >
                          {showConsoleDrawer ? "Minimize" : "Maximize"}
                        </button>
                      </div>
                    </div>

                    {/* Console Body (Terminal output) */}
                    {showConsoleDrawer && (
                      <div className="flex-1 p-3 overflow-y-auto font-mono text-xs leading-relaxed space-y-4 max-h-[300px]">
                        {streamEvents.length > 0 ? (
                          streamEvents.map((evt, idx) => {
                            // Assign colors based on Agent persona
                            let authorColor = "text-slate-300";
                            let borderColor = "border-slate-800";
                            if (evt.author === "IngestionAgent") {
                              authorColor = "text-cyan-450";
                              borderColor = "border-cyan-950 bg-cyan-950/5";
                            } else if (evt.author === "AuditorAgent") {
                              authorColor = "text-emerald-450";
                              borderColor = "border-emerald-950 bg-emerald-950/5";
                            } else if (evt.author === "CheckerAgent") {
                              authorColor = "text-amber-450";
                              borderColor = "border-amber-950 bg-amber-950/5";
                            } else if (evt.author === "SettlementAgent") {
                              authorColor = "text-purple-450";
                              borderColor = "border-purple-950 bg-purple-950/5";
                            } else if (evt.author === "System" || evt.author === "Orchestrator") {
                              authorColor = "text-blue-450";
                              borderColor = "border-blue-950 bg-blue-950/5";
                            }

                            return (
                              <div
                                key={idx}
                                className={`p-2.5 rounded-xs border ${borderColor} space-y-1.5`}
                              >
                                <div className="flex justify-between items-center text-[10px] border-b border-slate-800/60 pb-1 text-slate-500">
                                  <span>
                                    [
                                    <span className={`font-bold ${authorColor}`}>{evt.author}</span>{" "}
                                    · {evt.role}]
                                  </span>
                                  <span>
                                    {evt.latency_ms > 0 ? `${evt.latency_ms.toFixed(1)}ms` : ""} ·{" "}
                                    {new Date(evt.timestamp * 1000).toLocaleTimeString()}
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-300 font-semibold">
                                  Task: {evt.task}
                                </div>

                                {/* Thoughts list */}
                                {evt.thoughts && evt.thoughts.length > 0 && (
                                  <div className="space-y-0.5 pl-2 text-slate-400 text-[11px]">
                                    {evt.thoughts.map((thought, tidx) => (
                                      <div key={tidx} className="flex items-start gap-1">
                                        <span className="text-blue-500/80">❯</span>
                                        <span>{thought}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Results display */}
                                {evt.results && (
                                  <div className="mt-2 text-[10px] bg-slate-950/80 border border-slate-850 p-1.5 rounded-xs text-emerald-450/90 overflow-x-auto select-all max-h-24">
                                    <pre>{JSON.stringify(evt.results, null, 2)}</pre>
                                  </div>
                                )}
                              </div>
                            );
                          })
                        ) : (
                          <div className="h-full flex flex-col items-center justify-center py-8 text-slate-500 italic select-none">
                            <Sparkles className="w-6 h-6 text-slate-600 mb-1 animate-pulse" />
                            <span>Awaiting transaction verification trigger...</span>
                          </div>
                        )}
                        <div ref={terminalEndRef} />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                // Cockpit Empty State
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-50 dark:bg-[#070b13]">
                  <div className="p-4 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xs max-w-md shadow-xs">
                    <ShieldAlert className="w-10 h-10 text-blue-500 mx-auto mb-3" />
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-1">
                      Auditor Console Ready
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-4">
                      Select one of the 30 scenario ledger items in the left panel to load the
                      transaction parameters into the sandbox workspace.
                    </p>
                    <div className="border-t border-slate-200 dark:border-slate-800 pt-3 flex flex-wrap gap-2 justify-center text-[10px] font-mono text-slate-400">
                      <span>✓ Standard Cap checks</span>
                      <span>✓ DPDP PII Masking</span>
                      <span>✓ Co-lending Settlements</span>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
