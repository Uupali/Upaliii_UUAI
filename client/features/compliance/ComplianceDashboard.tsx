import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { HealthClaimTab } from "@/features/compliance/HealthClaimTab";
import type { HealthClaimResult } from "@/utils/json";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, XCircle, Info, Clipboard, Download, Filter, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { fetchComplianceData, fetchComplianceByIngredients } from "@/services/api";
import { ComplianceData, validateComplianceJson } from "@/utils/json";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";

const STATUS = {
  pass: { label: "Pass", color: "success" as const, Icon: CheckCircle2 },
  review: { label: "Needs Review", color: "warning" as const, Icon: AlertTriangle },
  fail: { label: "Fail", color: "destructive" as const, Icon: XCircle },
};

function StatusBadge({ status }: { status: string }) {
  const key = status.toLowerCase() as keyof typeof STATUS;
  const meta = STATUS[key] ?? { label: status, color: "secondary" as const, Icon: Info };
  const { Icon } = meta;
  return (
    <Badge className={cn(
      "px-2.5 py-1 rounded-full border text-xs font-medium",
      meta.color === "success" && "bg-success text-success-foreground border-success/30",
      meta.color === "warning" && "bg-warning text-warning-foreground border-warning/30",
      meta.color === "destructive" && "bg-destructive text-destructive-foreground",
      meta.color === "secondary" && "bg-secondary text-secondary-foreground",
    )}
    >
      <span className="inline-flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" />{meta.label}</span>
    </Badge>
  );
}

function OverallResultBadge({ result }: { result: string }) {
  const r = (result || "").toLowerCase();
  if (r.includes("pass")) return <StatusBadge status="pass" />;
  if (r.includes("fail")) return <StatusBadge status="fail" />;
  // hide the 'Needs Review' badge — return nothing for review/unknown
  return null;
}

function formatDate(iso?: string) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function isUnresolvedRow(row: ComplianceData["ingredient_findings"][number]) {
  return row.canonical == null || row.is_medicine == null || row.novel_food_status == null;
}

function yesNoUnknown(v: boolean | null | undefined) {
  return v == null ? "Unknown" : v ? "Yes" : "No";
}

function isNovelFoodFlagged(value?: string | null) {
  if (!value) return false;
  const lower = value.toLowerCase();
  if (lower.includes("not novel")) return false;
  return lower.includes("novel");
}

function sourcesList(row: ComplianceData["ingredient_findings"][number]) {
  const src: string[] = [];
  const s = row.source_matches as any;
  if (s?.amnesguiden) src.push("Ämnesguiden");
  if (s?.nfc) src.push("EU Novel Food Catalogue");
  return src.length ? src.join(", ") : "—";
}

const HIGHLIGHT_DANGER_CELL = "bg-red-50 dark:bg-red-900/25 text-red-900 dark:text-red-100 font-semibold";

const emptyData: ComplianceData = {
  product_id: "",
  product_name: "",
  product_type: "food",
  result: "",
  checked_at: "",
  reasons: [],
  ingredient_findings: [],
};

function IngredientsForm({ onSubmit, currentIngredients }: { onSubmit: (list: string[]) => void | Promise<void>; currentIngredients?: string[] }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  function parseLines(value: string) {
    return value
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  function useCurrentExamples() {
    setText((currentIngredients || []).join("\n"));
  }
  async function handleSubmit() {
    const list = parseLines(text);
    if (list.length === 0) {
      toast.error("Please enter at least one ingredient");
      return;
    }
    try {
      setLoading(true);
      await onSubmit(list);
    } finally {
      setLoading(false);
    }
  }
  return (
    <div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g.\nCurcuma longa\nTaraxacum officinale\nChlorella pyrenoidosa"
        className="font-mono text-sm min-h-[200px]"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" onClick={useCurrentExamples}>Use current ingredients</Button>
        <Button onClick={handleSubmit} disabled={loading}>{loading ? "Checking..." : "Run check"}</Button>
      </div>
    </div>
  );
}

export default function ComplianceDashboard() {
  const [data, setData] = useState<ComplianceData>(emptyData);
  const emptyHealthClaim: HealthClaimResult = {
    ingredient: "",
    product_claim: "",
    authorised_claims: [],
    authorised_summary: "",
    llm_trace: undefined,
  };
  const [activeTab, setActiveTab] = useState("dashboard");
  const [activeStep, setActiveStep] = useState<number>(1);
  const [productType, setProductType] = useState<string>(data.product_type ?? "supplement");
  const [ingredientsText, setIngredientsText] = useState<string>((data.ingredient_findings || []).map((i) => i.raw).join("\n"));
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [apiLoading, setApiLoading] = useState(false);
  const [lastCheckedText, setLastCheckedText] = useState<string | null>(null);
  const [lastCheckedProductType, setLastCheckedProductType] = useState<string | null>(null);

  const inputUnchangedSinceLastCheck = lastCheckedText !== null && lastCheckedText === ingredientsText && lastCheckedProductType === productType;

  function parseLines(value: string) {
    return value
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const parsedIngredients = useMemo(() => parseLines(ingredientsText), [ingredientsText]);

  // when user edits inputs, mark as modified so Run check can be re-enabled
  useEffect(() => {
    if (lastCheckedText === null) return;
    if (ingredientsText !== lastCheckedText || productType !== lastCheckedProductType) {
      // nothing else needed; inputUnchangedSinceLastCheck will compute false
    }
  }, [ingredientsText, productType, lastCheckedText, lastCheckedProductType]);

  const displayRows = useMemo(() => {
    const findings = data.ingredient_findings || [];
    return parsedIngredients.map((ing) => {
      const found = findings.find((f) => (f.raw || "").toLowerCase() === ing.toLowerCase());
      if (found) return found;
      return {
        raw: ing,
        canonical: null,
        source_matches: {},
        is_medicine: null,
        novel_food_status: null,
        notes: null,
        latin_name: null,
      } as ComplianceData["ingredient_findings"][number];
    });
  }, [data, parsedIngredients]);

  const hasRedFlag = displayRows.some((r) => r.is_medicine === true || isNovelFoodFlagged(r.novel_food_status));

  async function handleRunCheck() {
    if (apiLoading) return; // prevent concurrent calls
    setInlineError(null);
    if (parsedIngredients.length === 0) {
      setInlineError("Please enter at least one ingredient");
      return;
    }
    setApiLoading(true);
    try {
      const url = "/api/check";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_type: productType, ingredients: parsedIngredients, health_claims: [] }),
      });
      if (!res.ok) {
        let text = "";
        try {
          text = await res.clone().text();
        } catch (cloneErr) {
          try {
            // last resort: try json
            const j = await res.clone().json();
            text = JSON.stringify(j);
          } catch (e) {
            text = res.statusText || "";
          }
        }
        setInlineError(`API 錯誤: ${res.status} ${text}`);
        toast.error(`API 錯誤: ${res.status}`);
        return;
      }
      let json: any;
      try {
        json = await res.clone().json();
      } catch (e) {
        try {
          const txt = await res.clone().text();
          json = txt ? JSON.parse(txt) : {};
        } catch (_) {
          json = {};
        }
      }
      setData(json);
      setJsonInput(JSON.stringify(json, null, 2));
      toast.success("Check completed");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to fetch";
      setInlineError(msg);
      toast.error(msg);
    } finally {
      // mark inputs as checked so Run check remains disabled until user modifies inputs
      setLastCheckedText(ingredientsText);
      setLastCheckedProductType(productType);
      setApiLoading(false);
    }
  }
  const [jsonInput, setJsonInput] = useState<string>(JSON.stringify(emptyData, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Step 2: claim rows state
  type ClaimRow = {
    id: string;
    ingredientRaw?: string | null;
    latin_name?: string | null;
    claim: string;
    error?: string | null;
    loading?: boolean;
    result?: any;
    status?: "pending" | "checking" | "done" | "failed";
  };

  const [claimRows, setClaimRows] = useState<ClaimRow[]>([]);

  // available ingredients to select (raw -> latin)
  const availableIngredients = useMemo(() => {
    const used = new Set(claimRows.map((r) => r.ingredientRaw));
    return displayRows
      .filter((r) => !used.has(r.raw))
      .map((r) => ({ raw: r.raw, latin: r.latin_name ?? null }));
  }, [displayRows, claimRows]);

  function addClaimRow() {
    if (availableIngredients.length === 0) return;
    setClaimRows((s) => [...s, { id: `${Date.now()}-${Math.random()}`, ingredientRaw: undefined, latin_name: undefined, claim: "", error: null }]);
  }

  function removeClaimRow(id: string) {
    setClaimRows((s) => s.filter((r) => r.id !== id));
  }

  function updateClaimRow(id: string, patch: Partial<ClaimRow>) {
    setClaimRows((s) => s.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function isValidClaimText(text: string) {
    const t = text.trim();
    if (!t) return false;
    if (t.length > 300) return false;
    // remove html tags
    const noTags = t.replace(/<[^>]*>/g, "").trim();
    if (!noTags) return false;
    // remove punctuation and whitespace, check alphanumeric remains
    const alnum = noTags.replace(/[^\p{L}\p{N}]/gu, "");
    return alnum.length > 0;
  }

  function hasValidClaimRows() {
    return claimRows.some((r) => r.ingredientRaw && isValidClaimText(r.claim));
  }

  // Modal & concurrency-driven health claim runner
  const [hcModalOpen, setHcModalOpen] = useState(false);
  const [hcCompleted, setHcCompleted] = useState(0);
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  const [hcCanceled, setHcCanceled] = useState(false);
  const CONCURRENCY = 3;

  async function runHealthClaims() {
    if (!hasValidClaimRows()) return;

    const validRows = claimRows.filter((r) => r.ingredientRaw && isValidClaimText(r.claim));
    // initialize statuses
    setClaimRows((s) => s.map((r) => (validRows.some((v) => v.id === r.id) ? { ...r, status: "pending", loading: false, error: null } : r)));

    setHcCanceled(false);
    setHcCompleted(0);
    setHcModalOpen(true);

    let active = 0;
    const queue = [...validRows];

    await new Promise<void>((resolve) => {
      const launchNext = () => {
        if (hcCanceled) {
          // mark remaining as failed/cancelled
          while (queue.length > 0) {
            const rem = queue.shift()!;
            updateClaimRow(rem.id, { status: "failed", loading: false, error: "Cancelled" });
            setHcCompleted((c) => c + 1);
          }
          resolve();
          return;
        }

        if (queue.length === 0 && active === 0) {
          resolve();
          return;
        }

        while (active < CONCURRENCY && queue.length > 0) {
          const row = queue.shift()!;
          active++;
          updateClaimRow(row.id, { status: "checking", loading: true, error: null });
          const controller = new AbortController();
          controllersRef.current.set(row.id, controller);

          (async () => {
            try {
              const found = displayRows.find((d) => d.raw === row.ingredientRaw);
              const latinToSend = row.latin_name ?? found?.latin_name ?? found?.canonical ?? row.ingredientRaw ?? "";
              const res = await fetch("/api/health-claim/check", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ingredient: latinToSend, product_claim: row.claim, use_gemini: true }),
                signal: controller.signal,
              });

              if (!res.ok) {
                let txt = "";
                try {
                  txt = await res.clone().text();
                } catch {
                  try {
                    const j = await res.clone().json();
                    txt = JSON.stringify(j);
                  } catch {
                    txt = res.statusText || "";
                  }
                }
                updateClaimRow(row.id, { status: "failed", loading: false, error: `API ${res.status}: ${txt}` });
                toast.error(`API ${res.status}`);
                return;
              }

              let json: any;
              try {
                json = await res.clone().json();
              } catch {
                try {
                  const txt = await res.clone().text();
                  json = txt ? JSON.parse(txt) : {};
                } catch {
                  json = {};
                }
              }

              updateClaimRow(row.id, { status: "done", loading: false, result: json });
              toast.success("Health claim checked");
            } catch (e: any) {
              const msg = e?.name === "AbortError" ? "Cancelled" : e?.message ?? String(e);
              updateClaimRow(row.id, { status: "failed", loading: false, error: msg });
            } finally {
              controllersRef.current.delete(row.id);
              active--;
              setHcCompleted((c) => c + 1);
              // schedule next in queue
              setTimeout(launchNext, 0);
            }
          })();
        }
      };

      // start initial batch
      launchNext();
    });

    setHcModalOpen(false);
    controllersRef.current.clear();

    if (!hcCanceled) {
      // advance to step 3 with results
      setActiveStep(3);
    }
  }

  function cancelHealthClaims() {
    setHcCanceled(true);
    for (const c of controllersRef.current.values()) {
      try {
        c.abort();
      } catch {}
    }
    controllersRef.current.clear();
  }

  // component to render claim rows with local input state to avoid focus loss
  function ClaimRowItem({ row }: { row: ClaimRow }) {
    const [localClaim, setLocalClaim] = useState(row.claim || "");

    // sync when external value changes (e.g., after API result)
    useEffect(() => {
      if (row.claim !== localClaim) {
        setLocalClaim(row.claim || "");
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [row.claim]);

    return (
      <div key={row.id} className="flex items-start gap-2">
        <div className="w-44">
          <label className="text-xs text-muted-foreground">Ingredient</label>
          <select
            className="w-full rounded-md border p-2 bg-card text-sm"
            value={row.ingredientRaw ?? ""}
            onChange={(e) => {
              const raw = e.target.value || undefined;
              const found = displayRows.find((d) => d.raw === raw);
              updateClaimRow(row.id, { ingredientRaw: raw, latin_name: found?.latin_name ?? null });
            }}
          >
            <option value="">Select ingredient</option>
            {displayRows
              .filter((d) => !claimRows.some((cr) => cr.ingredientRaw === d.raw) || crMatches(row.id, d.raw))
              .map((d) => (
                <option key={d.raw} value={d.raw}>{`${d.raw}${d.latin_name ? ` (${d.latin_name})` : ""}`}</option>
              ))}
          </select>
        </div>

        <div className="flex-1">
          <label className="text-xs text-muted-foreground">Claim</label>
          <Input
            value={localClaim}
            onChange={(e) => setLocalClaim(e.target.value)}
            onBlur={() => updateClaimRow(row.id, { claim: localClaim })}
            maxLength={300}
          />
          {row.error && <p className="text-xs text-destructive mt-1">{row.error}</p>}
        </div>

        <div className="mt-5">
          <button aria-label="Remove" onClick={() => removeClaimRow(row.id)} className="text-muted-foreground hover:text-destructive">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>
    );
  }

  function ClaimRows() {
    return (
      <div className="space-y-3">
        {claimRows.map((row) => (
          <ClaimRowItem key={row.id} row={row} />
        ))}
      </div>
    );
  }

  function crMatches(rowId: string, raw: string) {
    const row = claimRows.find((r) => r.id === rowId);
    return row?.ingredientRaw === raw;
  }

  const stageMap = useMemo(() => {
    const map = new Map<string, { status: string; details?: string }>();
    for (const r of data.reasons || []) map.set(r.stage, { status: r.status, details: r.details });
    return map;
  }, [data]);

  const totalIngredients = data.ingredient_findings?.length ?? 0;
  const unresolvedIngredients = useMemo(() => {
    return (data.ingredient_findings || []).filter(isUnresolvedRow).length;
  }, [data]);

  const medicineStatus = stageMap.get("medicine")?.status ?? "review";
  const novelFoodStatus = stageMap.get("novel_food")?.status ?? "review";

  const [search, setSearch] = useState("");
  const [onlyUnresolved, setOnlyUnresolved] = useState(false);
  const [onlyMissingCanonical, setOnlyMissingCanonical] = useState(false);
  const [verified, setVerified] = useState<Record<string, boolean>>({});

  // Step 3 UI toggles
  const [summaryOpenMap, setSummaryOpenMap] = useState<Record<string, boolean>>({});
  const [traceOpenMap, setTraceOpenMap] = useState<Record<string, boolean>>({});

  function toggleSummary(id: string) {
    setSummaryOpenMap((s) => ({ ...s, [id]: !s[id] }));
  }
  function toggleTrace(id: string) {
    setTraceOpenMap((s) => ({ ...s, [id]: !s[id] }));
  }

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data.ingredient_findings || []).filter((row) => {
      if (onlyUnresolved && !isUnresolvedRow(row)) return false;
      if (onlyMissingCanonical && row.canonical != null) return false;
      if (!q) return true;
      const hay = [row.raw, row.canonical ?? "", row.latin_name ?? "", yesNoUnknown(row.is_medicine), row.novel_food_status ?? ""].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [data, search, onlyUnresolved, onlyMissingCanonical]);

  function keyForRow(row: ComplianceData["ingredient_findings"][number], idx: number) {
    return `${row.raw}|${idx}`;
  }
  function hasUnknown(row: ComplianceData["ingredient_findings"][number]) {
    const medUnknown = row.is_medicine == null;
    const novelUnknown = row.novel_food_status == null;
    return medUnknown || novelUnknown;
  }

  function copyJson() {
    const text = JSON.stringify(data, null, 2);
    navigator.clipboard.writeText(text).then(() => toast.success("JSON copied"));
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.product_id || "compliance"}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function loadFromApi() {
    try {
      const remote = await fetchComplianceData<ComplianceData>();
      setData(remote);
      setJsonInput(JSON.stringify(remote, null, 2));
      setActiveTab("dashboard");
      toast.success("Loaded from API");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to fetch";
      toast.error(msg);
    }
  }

  function applyJson() {
    const result = validateComplianceJson(jsonInput);
    if (result.ok) {
      setData(result.data);
      setJsonError(null);
      setActiveTab("dashboard");
      toast.success("Dashboard updated");
    } else {
      setJsonError(String((result as any).error));
      toast.error("Invalid JSON");
    }
  }

  useEffect(() => {
    // Ensure we start at dashboard view when component mounts
    setActiveTab("dashboard");
  }, []);


  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/40 px-4 py-12">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center text-primary font-bold hidden">C</div>
              <h1 className="text-2xl font-bold hidden">{activeStep === 1 ? "Step 1: Enter Ingredient" : activeStep === 2 ? "Step 2: Enter Product Claim" : "Step 3: Result"}</h1>
            </div>
            <OverallResultBadge result={data.result} />
          </div>
        </div>

        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <div className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-full text-sm font-medium",
                activeStep === 1 ? "bg-primary/10 text-primary" : "bg-card/50 text-muted-foreground"
              )}>Step 1</div>
              <div className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-full text-sm font-medium",
                activeStep === 2 ? "bg-primary/10 text-primary" : "bg-card/50 text-muted-foreground"
              )}>Step 2</div>
              <div className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-full text-sm font-medium",
                activeStep === 3 ? "bg-primary/10 text-primary" : "bg-card/50 text-muted-foreground"
              )}>Step 3</div>
            </div>
          </div>
        </div>

        <div className="mx-auto">
          {activeStep === 1 ? (
            <Card className="rounded-lg shadow-lg">
              <CardHeader>
                <CardTitle>Step 1: Enter Ingredient</CardTitle>
                <CardDescription>Provide product type and ingredients. You can separate ingredients with commas or new lines.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Product Type</label>
                    <select className="w-full rounded-md border p-2 bg-card" value={productType} onChange={(e) => setProductType(e.target.value)}>
                      <option value="food">Food</option>
                      <option value="supplement">Supplement</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">Ingredients</label>
                    <Textarea
                      value={ingredientsText}
                      onChange={(e) => setIngredientsText(e.target.value)}
                      placeholder={"e.g. Curcuma longa, Taraxacum officinale\nChlorella pyrenoidosa"}
                      className="font-mono text-sm min-h-[120px]"
                    />
                    {inlineError && <p className="text-sm text-destructive mt-2">{inlineError}</p>}
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      {hasRedFlag && (
                        <p className="text-sm text-destructive">This product contains a non-approved ingredient.</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" onClick={handleRunCheck} disabled={apiLoading || inputUnchangedSinceLastCheck}>
                        {apiLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Run check"}
                      </Button>
                      <Button onClick={() => setActiveStep(2)} disabled={parsedIngredients.length === 0 || hasRedFlag || apiLoading}>Next</Button>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium mb-2">Results</h3>
                    <div className="overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Ingredient</TableHead>
                            <TableHead>Latin name</TableHead>
                            <TableHead>Medicine</TableHead>
                            <TableHead>Novel Food</TableHead>
                            <TableHead className="min-w-[140px]">Notes</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {displayRows.map((row, idx) => {
                            const med = row.is_medicine;
                            const novel = row.novel_food_status;
                            const novelIsNot = novel === "Not novel in food" || novel === "Not novel in food supplements";
                            return (
                              <TableRow key={idx} className={cn(med === true && "bg-red-50 dark:bg-red-900/25", isNovelFoodFlagged(novel) && "bg-red-50 dark:bg-red-900/25")}>
                                <TableCell className="font-medium">{row.raw}</TableCell>
                                <TableCell className="italic text-muted-foreground">{row.latin_name ?? "—"}</TableCell>
                                <TableCell>
                                  {med === true ? (
                                    <span className="text-destructive font-semibold">Yes</span>
                                  ) : med === false ? (
                                    <span className="text-green-700 font-semibold">No</span>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {novel ? (
                                    novelIsNot ? (
                                      <span className="text-green-800 font-semibold">{novel}</span>
                                    ) : isNovelFoodFlagged(novel) ? (
                                      <span className="text-destructive font-semibold">{novel}</span>
                                    ) : (
                                      <span className="text-green-700">{novel}</span>
                                    )
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                                <TableCell>{String(row.notes ?? "—")}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                      {displayRows.length === 0 && <p className="text-sm text-muted-foreground mt-3">No results yet. Click Run check.</p>}
                    </div>
                  </div>

                </div>
              </CardContent>
            </Card>
          ) : (
            // Step 2 UI
            <Card className="rounded-lg shadow-lg">
              <CardHeader>
                <CardTitle>Step 2: Enter Product Claim</CardTitle>
                <CardDescription>Add product-level claims for ingredients.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <ClaimRows />

                  <div className="flex items-center justify-between">
                    <Button variant="ghost" onClick={() => setActiveStep(1)}>← Back</Button>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" onClick={() => addClaimRow()} disabled={availableIngredients.length === 0}>+ Add claim row</Button>
                      <Button onClick={runHealthClaims} disabled={!hasValidClaimRows()}>Run Health Claim Check</Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

        {/* Step 3: Result (compact) */}
        {activeStep === 3 && (
          <div className="flex justify-center mb-6">
            <Card className="w-full max-w-3xl rounded-lg shadow-lg bg-white">
              <CardHeader>
                <CardTitle>Step 3: Result</CardTitle>
                <CardDescription>Summary of checks</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {/* Ingredient Checks */}
                  <Accordion type="single" collapsible>
                    <AccordionItem value="ingredient_checks">
                      <AccordionTrigger>Show ingredient checks</AccordionTrigger>
                      <AccordionContent>
                        {data.ingredient_findings && data.ingredient_findings.length > 0 ? (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Ingredient (Latin)</TableHead>
                                <TableHead>Medicine</TableHead>
                                <TableHead>Novel Food</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {(data.ingredient_findings || []).map((row, idx) => (
                                <TableRow key={keyForRow(row, idx)}>
                                  <TableCell>{row.latin_name ?? row.raw}</TableCell>
                                  <TableCell>{row.is_medicine === true ? <span className="text-destructive font-semibold">Yes</span> : row.is_medicine === false ? <span className="text-green-700 font-semibold">No</span> : <span className="text-muted-foreground">—</span>}</TableCell>
                                  <TableCell>{row.novel_food_status ? (isNovelFoodFlagged(row.novel_food_status) ? <span className="text-destructive font-semibold">Novel food</span> : <span className="text-green-700 font-semibold">Not Novel food</span>) : <span className="text-muted-foreground">—</span>}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        ) : (
                          <p className="text-sm text-muted-foreground">No ingredient checks performed.</p>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>

                  {/* Health Claim Checks */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Health Claim Checks</h3>
                    {claimRows.filter((r) => r.ingredientRaw && (r.status === 'done' || r.status === 'failed')).length === 0 ? (
                      <p className="text-sm text-muted-foreground">No health claim checks performed.</p>
                    ) : (
                      <div className="space-y-3">
                        {claimRows.filter((r) => r.ingredientRaw).map((r) => {
                          const id = r.id;
                          const res = r.result as HealthClaimResult | undefined;
                          const isError = r.status === 'failed' || !!r.error;
                          const evalText: string = (res?.evaluation?.result ?? res?.claims_summary ?? res?.authorised_summary ?? "").toString();
                          const notIncludeRegex = /\b(?:不包含|not include|not included|does not include)\b/i;
                          const includeRegex = /\b(?:包含|include|included)\b/i;
                          const isNotInclude = notIncludeRegex.test(evalText);
                          const isInclude = includeRegex.test(evalText) && !isNotInclude;

                          return (
                            <div key={id} className="rounded-md border p-3 bg-card/50">
                              <div className="flex items-start justify-between">
                                <div>
                                  <div className="text-sm font-medium">{r.latin_name ?? r.ingredientRaw} — "{r.claim}"</div>
                                  <div className="text-xs text-muted-foreground mt-1">{isError ? <span className="text-destructive">Error: {r.error}</span> : (res?.evaluation?.reason ?? res?.claims_summary ?? "—")}</div>
                                </div>
                                <div className="flex items-center gap-3">
                                  {isError ? (
                                    <span className="text-muted-foreground">—</span>
                                  ) : isInclude ? (
                                    <span className="text-green-700 font-semibold">Include</span>
                                  ) : isNotInclude ? (
                                    <span className="text-destructive font-semibold">Not include</span>
                                  ) : (
                                    <span className="text-yellow-600 font-semibold">Needs Review</span>
                                  )}
                                  <div className="flex flex-col items-end gap-1">
                                    <button className="text-xs text-primary underline" onClick={() => toggleSummary(id)}>{summaryOpenMap[id] ? "Hide summary" : "View summary"}</button>
                                    <button className="text-xs text-muted-foreground underline" onClick={() => toggleTrace(id)}>{traceOpenMap[id] ? "Hide LLM Trace" : "Show LLM Trace"}</button>
                                  </div>
                                </div>
                              </div>

                              {summaryOpenMap[id] && (
                                <div className="mt-3 text-sm text-muted-foreground">
                                  <pre className="whitespace-pre-wrap">{res?.claims_summary ?? res?.authorised_summary ?? "No summary available."}</pre>
                                </div>
                              )}

                              {traceOpenMap[id] && (
                                <div className="mt-3 text-sm">
                                  {res?.llm_trace ? (
                                    <pre className="max-h-64 overflow-auto rounded-md bg-card/50 p-3 text-xs">{JSON.stringify(res.llm_trace, null, 2)}</pre>
                                  ) : (
                                    <p className="text-sm text-muted-foreground">(no trace available)</p>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="text-xs text-muted-foreground">Click "Show LLM Trace" to view model, request and response JSON for a specific claim.</div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Health Claim progress modal */}
        <Dialog open={hcModalOpen} onOpenChange={(v) => { /* prevent manual close while running */ }}>
          <DialogContent className="w-full max-w-xl">
            <DialogHeader>
              <DialogTitle>Running Health Claim Check</DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">Running checks for health claims. This may take a few moments.</DialogDescription>
            </DialogHeader>

            <div className="mt-4">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <div>Progress</div>
                <div>{hcCompleted} / {claimRows.filter((r) => r.ingredientRaw && isValidClaimText(r.claim)).length}</div>
              </div>
              <div className="mt-2">
                <Progress value={Math.round((hcCompleted / Math.max(1, claimRows.filter((r) => r.ingredientRaw && isValidClaimText(r.claim)).length)) * 100)} />
              </div>

              <div className="mt-4 max-h-56 overflow-auto space-y-2">
                {claimRows.filter((r) => r.ingredientRaw && isValidClaimText(r.claim)).map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-4 p-2 rounded-md border bg-card/30">
                    <div className="flex-1">
                      <div className="text-sm font-medium">{r.latin_name ?? r.ingredientRaw}</div>
                      <div className="text-xs text-muted-foreground mt-1">{r.claim}</div>
                    </div>
                    <div className="w-40 text-right">
                      {r.status === "checking" && <span>⏳ Checking</span>}
                      {r.status === "done" && <span className="text-green-700">✅ Done</span>}
                      {r.status === "failed" && <span className="text-destructive">❌ Failed</span>}
                      {(!r.status || r.status === "pending") && <span className="text-muted-foreground">—</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <DialogFooter>
              <div className="w-full flex justify-end gap-2">
                <Button variant="outline" onClick={() => { cancelHealthClaims(); setHcModalOpen(false); }}>Cancel</Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        </div>
      </div>
    </div>
  );
}
