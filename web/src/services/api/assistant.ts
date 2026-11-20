import i18n from "@/i18n";
import { apiRequest, jsonRequest } from "./client";
import type { AgentChatItem } from "@/stores/use-agent-store";

export type AssistantThread = { id: string; title: string; version: number; createdAt: string; updatedAt: string };
export type AssistantTurn = { id: string; projectId: string; status: string; error?: string };
export type AssistantSnapshot = { thread: AssistantThread; items: AgentChatItem[]; turns: AssistantTurn[] };
export const listThreads = () => apiRequest<AssistantThread[]>("/assistant/threads");
export const createThread = (title = i18n.t("errors.newThread")) => apiRequest<AssistantThread>("/assistant/threads", jsonRequest("POST", { title }));
export const getThread = (id: string) => apiRequest<AssistantSnapshot>(`/assistant/threads/${encodeURIComponent(id)}`);
export const deleteThread = (id: string) => apiRequest<void>(`/assistant/threads/${encodeURIComponent(id)}`, { method: "DELETE" });
export const startTurn = (id: string, input: { prompt: string; projectId?: string; clientId?: string; channelId: string; modelId: string; parameters?: Record<string, unknown>; version: number; skill?: string; attachments: string[]; references: string[] }) => apiRequest<AssistantTurn>(`/assistant/threads/${encodeURIComponent(id)}/turns`, jsonRequest("POST", input));
export const cancelTurn = (id: string) => apiRequest<void>(`/assistant/turns/${encodeURIComponent(id)}/cancel`, { method: "POST" });
