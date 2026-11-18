import { apiRequest, jsonRequest } from "./client";

export type QuoteInput = { channelId: string; modelId: string; parameters: Record<string, unknown>; prompt?: string; messages?: unknown[]; requests?: number };
export type PointsQuote = { pointsMilli: string | null; state: "estimated" | "unknown"; quantity?: Record<string, string> };
export const quoteUsage = (input: QuoteInput, signal?: AbortSignal) => apiRequest<PointsQuote>("/usage/quote", { ...jsonRequest("POST", input), signal });
