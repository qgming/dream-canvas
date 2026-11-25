import { apiRequest, jsonRequest } from "./client";
import type { AgentChatItem } from "@/stores/use-agent-store";

export type AssistantThread = { id: string; title: string; version: number; createdAt: string; updatedAt: string };
export type AssistantTurn = { id: string; projectId: string; status: string; error?: string };
export type AssistantSnapshot = { thread: AssistantThread; items: AgentChatItem[]; turns: AssistantTurn[] };
export type AssistantTodo = { id: string; text: string; status: "pending" | "in_progress" | "completed" };
export type AssistantInteraction =
    | { kind: "question"; status: "waiting" | "answered" | "closed"; question: string; options?: string[]; answer?: string }
    | { kind: "todo"; todos: AssistantTodo[] }
    | { kind: "context"; status: "running" | "completed" | "failed" };

export function assistantInteraction(item: AgentChatItem) {
    const detail = item.detail as AssistantInteraction | undefined;
    return item.role === "tool" && (detail?.kind === "question" || detail?.kind === "todo" || detail?.kind === "context") ? detail : undefined;
}

export const listThreads = () => apiRequest<AssistantThread[]>("/assistant/threads");
export const createThread = () => apiRequest<AssistantThread>("/assistant/threads", jsonRequest("POST", {}));
export const getThread = (id: string) => apiRequest<AssistantSnapshot>(`/assistant/threads/${encodeURIComponent(id)}`);
export const renameThread = (id: string, title: string, version: number) => apiRequest<AssistantThread>(`/assistant/threads/${encodeURIComponent(id)}`, jsonRequest("PATCH", { title, version }));
export const deleteThread = (id: string) => apiRequest<void>(`/assistant/threads/${encodeURIComponent(id)}`, { method: "DELETE" });
export const startTurn = (id: string, input: { prompt: string; projectId?: string; clientId?: string; channelId: string; modelId: string; parameters?: Record<string, unknown>; version: number; skill?: string; attachments: string[]; references: string[] }) => apiRequest<AssistantTurn>(`/assistant/threads/${encodeURIComponent(id)}/turns`, jsonRequest("POST", input));
export const answerTurn = (id: string, questionId: string, answer: string) => apiRequest<AssistantTurn>(`/assistant/turns/${encodeURIComponent(id)}/answer`, jsonRequest("POST", { questionId, answer }));
export const cancelTurn = (id: string) => apiRequest<void>(`/assistant/turns/${encodeURIComponent(id)}/cancel`, { method: "POST" });
