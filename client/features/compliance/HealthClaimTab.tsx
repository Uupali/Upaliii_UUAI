import React, { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { HealthClaimResultSchema, type HealthClaimResult } from "@/utils/json";
import { toast } from "sonner";

interface HealthClaimTabProps {
  data: HealthClaimResult;
}

function getEvaluationBadge(result?: string) {
  if (!result) {
    return {
      label: "Unknown",
      className: "bg-muted text-muted-foreground border-muted/40",
    };
  }
  const normalized = result.trim().toLowerCase();
  if (normalized.includes("包含") || normalized.includes("include")) {
    return {
      label: result,
      // stronger background and border for better contrast
      className: "bg-success text-success-foreground border-success/70",
    };
  }
  if (normalized.includes("不包含") || normalized.includes("not include")) {
    return {
      label: result,
      className: "bg-destructive/10 text-destructive-foreground border-destructive/30",
    };
  }
  return {
    label: result,
    className: "bg-warning/10 text-warning-foreground border-warning/30",
  };
}

function parseTraceResponse(traceText?: string) {
  if (!traceText) return null;
  let s = traceText.trim();

  // If content is wrapped in a triple-backtick code fence (``` or ```json), extract inner content
  const tripleMatch = s.match(/```(?:json)?\n([\s\S]*?)\n```/i);
  if (tripleMatch && tripleMatch[1]) {
    s = tripleMatch[1];
  }

  // If content is wrapped in single backticks, extract inner
  const singleMatch = s.match(/`([^`]+)`/);
  if (singleMatch && singleMatch[1] && singleMatch[1].trim().startsWith("{")) {
    s = singleMatch[1];
  }

  // As a fallback, try to extract the first JSON object by finding the first '{' and last '}'
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    s = s.slice(first, last + 1);
  }

  try {
    return JSON.parse(s);
  } catch (e) {
    // Try to decode common HTML entities that may appear (e.g. &amp;)
    try {
      const decoded = s.replace(/&amp;/g, "&");
      return JSON.parse(decoded);
    } catch {
      return null;
    }
  }
}

export function HealthClaimTab({ data }: HealthClaimTabProps) {
  const [promptOpen, setPromptOpen] = useState(false);

  // localData is the single-card data that can be overwritten by the textarea apply
  const [localData, setLocalData] = useState<HealthClaimResult>(data);
  const [text, setText] = useState<string>(() => JSON.stringify(data, null, 2));

  // Keep localData in sync when the incoming prop changes
  useMemo(() => {
    setLocalData(data);
    setText(JSON.stringify(data, null, 2));
  }, [data]);

  const parsedTrace = useMemo(() => parseTraceResponse(localData.llm_trace?.response_text), [
    localData.llm_trace?.response_text,
  ]);

  const evaluation = localData.evaluation ?? parsedTrace?.evaluation ?? null;

  const claimsSummary =
    localData.claims_summary ?? parsedTrace?.claims_summary ?? localData.authorised_summary ?? "No claims summary provided.";

  const badgeMeta = getEvaluationBadge(evaluation?.result);

  const payloadJson = useMemo(() => {
    if (!localData.llm_trace?.request?.payload) return null;
    try {
      return JSON.stringify(localData.llm_trace.request.payload, null, 2);
    } catch {
      return null;
    }
  }, [localData.llm_trace?.request?.payload]);

  function applyText() {
    try {
      const parsed = JSON.parse(text);

      // Normalize llm_trace variants coming from different sources
      if (parsed.llm_trace && !parsed.llm_trace.response_text) {
        if (typeof parsed.llm_trace.response_text_raw === "string" && parsed.llm_trace.response_text_raw.trim()) {
          parsed.llm_trace.response_text = parsed.llm_trace.response_text_raw;
        } else if (typeof parsed.llm_trace.response_json === "string" && parsed.llm_trace.response_json.trim()) {
          parsed.llm_trace.response_text = parsed.llm_trace.response_json;
        }
      }

      // If system_prompt or payload are encoded with HTML entities, decode a few common ones
      if (parsed.llm_trace?.request?.system_prompt && typeof parsed.llm_trace.request.system_prompt === "string") {
        parsed.llm_trace.request.system_prompt = parsed.llm_trace.request.system_prompt.replace(/&amp;/g, "&");
      }

      // validate against schema
      const validated = HealthClaimResultSchema.parse(parsed);
      setLocalData(validated as HealthClaimResult);
      setText(JSON.stringify(validated, null, 2));
      toast.success("Health claim updated");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid JSON";
      toast.error(msg);
    }
  }

  function resetToSource() {
    setLocalData(data);
    setText(JSON.stringify(data, null, 2));
    toast.success("Reset to original health claim data");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl font-semibold">{localData.ingredient}</CardTitle>
        <CardDescription>Health claim evaluation</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* JSON textarea for single HealthClaim JSON - updates only this card */}
        <section className="rounded-md border p-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-medium">Paste single HealthClaim JSON</h4>
              <p className="text-xs text-muted-foreground">This will only update the Check Health Claim card.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={resetToSource}>Reset</Button>
              <Button size="sm" onClick={applyText}>Apply</Button>
            </div>
          </div>
          <div className="mt-3">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs min-h-[160px] text-foreground" />
          </div>
        </section>

        <section className="rounded-lg border border-primary/20 bg-primary/5 p-4">
          <h3 className="text-sm font-medium text-primary uppercase tracking-wide">Product claim</h3>
          <p className="mt-2 text-base font-semibold text-foreground">
            {localData.product_claim}
          </p>
        </section>

        <section className="rounded-lg border p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge className={cn("px-3 py-1 text-sm font-semibold", badgeMeta.className)}>{badgeMeta.label}</Badge>
            {evaluation?.result && <span className="text-sm text-muted-foreground">Evaluation result</span>}
          </div>

          {evaluation?.reason ? (
            <p className="mt-3 text-sm leading-relaxed text-foreground">{evaluation.reason}</p>
          ) : (
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">No evaluation reasoning provided.</p>
          )}
        </section>

        <Accordion type="multiple" className="divide-y rounded-lg border">
          <AccordionItem value="claims" className="border-b">
            <AccordionTrigger className="px-4 text-left text-base font-semibold">Claims summary</AccordionTrigger>
            <AccordionContent className="px-4 text-sm leading-relaxed text-muted-foreground">
              <p className="whitespace-pre-wrap text-foreground">{claimsSummary}</p>
              {localData.authorised_claims && localData.authorised_claims.length > 0 && (
                <div className="mt-4 space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Authorised claims</h4>
                  <ul className="space-y-2">
                    {localData.authorised_claims.map((claim, idx) => (
                      <li key={`${claim.claim_text}-${idx}`} className="rounded-md border bg-muted/30 p-3">
                        <p className="text-sm font-medium text-foreground">{claim.claim_text}</p>
                        {claim.condition_of_use && (
                          <p className="mt-1 text-xs text-muted-foreground">Condition: {claim.condition_of_use}</p>
                        )}
                        <div className="mt-1 space-y-1 text-[11px] text-muted-foreground">
                          {claim.legislation_reference && <p>Legislation: {claim.legislation_reference}</p>}
                          {claim.efsa_question && <p>EFSA Question: {claim.efsa_question}</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="llm" className="border-b">
            <AccordionTrigger className="px-4 text-left text-base font-semibold">Show LLM Conversation</AccordionTrigger>
            <AccordionContent className="px-4">
              {localData.llm_trace ? (
                <div className="space-y-5 text-sm">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Model</h4>
                    <p className="mt-1 font-mono text-sm text-foreground">{localData.llm_trace.model}</p>
                  </div>

                  <Collapsible open={promptOpen} onOpenChange={setPromptOpen}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">System prompt</h4>
                        <p className="text-xs text-muted-foreground">Prompt sent to the LLM</p>
                      </div>
                      <CollapsibleTrigger asChild>
                        <Button variant="outline" size="sm">{promptOpen ? "Hide prompt" : "Show prompt"}</Button>
                      </CollapsibleTrigger>
                    </div>
                    <CollapsibleContent>
                      <pre className="mt-3 max-h-[300px] overflow-auto whitespace-pre-wrap rounded-md bg-card/50 p-3 text-xs text-foreground">
                        {localData.llm_trace.request.system_prompt}
                      </pre>
                    </CollapsibleContent>
                  </Collapsible>

                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payload</h4>
                    {payloadJson ? (
                      <pre className="mt-2 max-h-[260px] overflow-auto rounded-md bg-card/50 p-3 text-xs text-foreground">{payloadJson}</pre>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">No payload available.</p>
                    )}
                  </div>

                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Raw response</h4>
                    <pre className="mt-2 max-h-[320px] overflow-auto rounded-md bg-card/50 p-3 text-xs text-foreground">
                      {localData.llm_trace.response_text}
                    </pre>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No LLM trace available.</p>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}
