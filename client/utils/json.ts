import { z } from "zod";

// Flexible schema that accepts unknown extra fields while validating core structure
export const StageSchema = z
  .object({
    stage: z.string(),
    status: z.string(),
    details: z.string().optional(),
    evidence: z.unknown().optional(),
  })
  .passthrough();

export const IngredientFindingSchema = z
  .object({
    raw: z.string(),
    canonical: z.string().nullable().optional(),
    latin_name: z.string().nullable().optional(),
    source_matches: z
      .object({
        amnesguiden: z.unknown().nullable().optional(),
        nfc: z.unknown().nullable().optional(),
      })
      .partial()
      .passthrough()
      .optional(),
    is_medicine: z.boolean().nullable().optional(),
    novel_food_status: z.string().nullable().optional(),
    notes: z.unknown().nullable().optional(),
  })
  .passthrough();

export const ComplianceSchema = z
  .object({
    product_id: z.string(),
    product_name: z.string(),
    product_type: z.string(),
    result: z.string(),
    checked_at: z.string(),
    reasons: z.array(StageSchema),
    ingredient_findings: z.array(IngredientFindingSchema),
  })
  .passthrough();

export const HealthClaimAuthorisedClaimSchema = z
  .object({
    claim_text: z.string(),
    condition_of_use: z.string().optional(),
    legislation_reference: z.string().optional(),
    efsa_question: z.string().optional(),
  })
  .passthrough();

export const HealthClaimTraceSchema = z
  .object({
    model: z.string(),
    request: z
      .object({
        system_prompt: z.string(),
        payload: z.record(z.unknown()),
      })
      .passthrough(),
    response_text: z.string(),
  })
  .passthrough();

export const HealthClaimEvaluationSchema = z
  .object({
    result: z.string(),
    reason: z.string().optional(),
  })
  .passthrough();

export const HealthClaimResultSchema = z
  .object({
    ingredient: z.string(),
    product_claim: z.string(),
    claims_summary: z.string().optional(),
    authorised_summary: z.string().optional(),
    authorised_claims: z.array(HealthClaimAuthorisedClaimSchema).optional(),
    evaluation: HealthClaimEvaluationSchema.optional(),
    llm_trace: HealthClaimTraceSchema.optional(),
  })
  .passthrough();

export type ComplianceData = z.infer<typeof ComplianceSchema>;
export type IngredientFinding = z.infer<typeof IngredientFindingSchema>;
export type Stage = z.infer<typeof StageSchema>;
export type HealthClaimResult = z.infer<typeof HealthClaimResultSchema>;

export function parseComplianceJson(input: string): unknown {
  return JSON.parse(input);
}

export function validateComplianceJson(input: string): {
  ok: true;
  data: ComplianceData;
} | { ok: false; error: string } {
  try {
    const parsed = parseComplianceJson(input);
    const data = ComplianceSchema.parse(parsed);
    return { ok: true, data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid JSON";
    return { ok: false, error: msg };
  }
}
