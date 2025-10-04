export interface ApiError extends Error {
  status?: number;
}

// Placeholder API function. Replace the endpoint with your real API.
export async function fetchComplianceData<T = unknown>(): Promise<T> {
  const res = await fetch("/api/compliance", { headers: { "Content-Type": "application/json" } });
  if (!res.ok) {
    const err: ApiError = new Error(`Failed to fetch compliance data (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

export interface IngredientsRequest {
  ingredients: string[];
}

// Placeholder POST by-ingredients endpoint. Replace with your real API endpoint.
export async function fetchComplianceByIngredients<T = unknown>(payload: IngredientsRequest): Promise<T> {
  const res = await fetch("/api/compliance/by-ingredients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err: ApiError = new Error(`Failed to fetch by ingredients (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}
