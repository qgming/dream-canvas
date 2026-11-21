import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CountingNumber } from "@animate-ui/react/primitives/texts/counting-number";
import { useShouldReduceMotion } from "@animate-ui/react/utils/motion";
import { useTranslation } from "react-i18next";
import { Clock } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useAgentStore, type AgentChatItem, type AgentTokenUsage } from "@/stores/use-agent-store";
import { AgentChatMessage, AgentWorkingMessage } from "./agent-chat-message";
import { AgentToolSteps, isRunningAgentTool } from "./agent-chat-steps";
import { agentMessageId, agentMessageToChatMessage, agentReasoning, groupTimelineMessages } from "./agent-event-formatters";
import { AgentScrollToBottom } from "./agent-scroll-to-bottom";

const SCROLL_BOTTOM_THRESHOLD = 48;
const historyMessageStyle = { contentVisibility: "auto", containIntrinsicSize: "0 80px" } as const;

export function AgentChatTimeline({
    visible = true,
    theme,
    sending,
    turnStatus,
    turnId,
    empty,
}: {
    visible?: boolean;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    sending: boolean;
    turnStatus?: string;
    turnId?: string;
    empty?: ReactNode;
}) {
    const { t } = useTranslation();
    const reduceMotion = useShouldReduceMotion();
    const messages = useAgentStore((state) => state.messages);
    const activeThreadId = useAgentStore((state) => state.activeThreadId);
    const timeline = useMemo(() => groupTimelineMessages(messages), [messages]);
    const listRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const followMessagesRef = useRef(true);
    const positions = useRef(new Map<string, { top: number; follow: boolean }>());
    const [showScrollToBottom, setShowScrollToBottom] = useState(false);
    const activeItem = turnId ? messages.findLast((item) => item.turnId === turnId) : undefined;
    const liveOutput = activeItem?.streamId && (activeItem.text.trim() || agentReasoning(activeItem));
    const showEmpty = Boolean(empty && !timeline.length && !sending && !turnStatus);
    const showWorking = (sending || turnStatus === "queued" || turnStatus === "running") && !liveOutput && !isRunningAgentTool(activeItem);
    const updateScrollState = useCallback(() => {
        const list = listRef.current;
        if (!list || !list.clientHeight) return;
        const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight <= SCROLL_BOTTOM_THRESHOLD;
        followMessagesRef.current = atBottom;
        positions.current.set(activeThreadId, { top: list.scrollTop, follow: atBottom });
        setShowScrollToBottom(!atBottom);
    }, [activeThreadId]);
    const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
        const list = listRef.current;
        if (!list || !list.clientHeight) return;
        followMessagesRef.current = true;
        list.scrollTo({ top: list.scrollHeight, behavior: reduceMotion ? "instant" : behavior });
        setShowScrollToBottom(false);
    }, [reduceMotion]);
    useLayoutEffect(() => {
        const list = listRef.current;
        if (!visible || !list) return;
        const saved = positions.current.get(activeThreadId);
        followMessagesRef.current = saved?.follow ?? true;
        list.scrollTop = saved && !saved.follow ? saved.top : list.scrollHeight;
        setShowScrollToBottom(!followMessagesRef.current);
    }, [activeThreadId, visible]);
    useEffect(() => {
        const frame = requestAnimationFrame(() => (followMessagesRef.current ? scrollToBottom("auto") : updateScrollState()));
        return () => cancelAnimationFrame(frame);
    }, [messages, scrollToBottom, updateScrollState, turnStatus, sending]);
    useEffect(() => {
        const content = contentRef.current;
        if (!content) return;
        let frame = 0;
        const observer = new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => (followMessagesRef.current ? scrollToBottom("auto") : updateScrollState()));
        });
        observer.observe(content);
        return () => {
            observer.disconnect();
            cancelAnimationFrame(frame);
        };
    }, [scrollToBottom, updateScrollState]);
    return (
        <div className="relative min-h-0 flex-1">
            <div ref={listRef} className="thin-scrollbar h-full select-text overflow-y-auto overscroll-contain" onScroll={updateScrollState}>
                <div ref={contentRef} className={showEmpty ? "grid min-h-full place-items-center px-6 py-8" : "space-y-4 p-4"}>
                    {showEmpty ? empty : <>
                        {timeline.map((entry) => {
                            const item = entry.type === "tools" ? entry.items[0] : entry.item;
                            const key = agentMessageId(item.threadId || "", item.turnId || "", item.itemId || item.id);
                            return entry.type === "tools"
                                ? <AgentToolSteps key={key} items={entry.items} />
                                : <AgentChatMessageRow key={key} item={item} theme={theme} />;
                        })}
                        {turnStatus === "waiting_tasks" ? <p role="status" className="flex items-start gap-2 px-2 text-xs leading-5 text-muted-foreground"><Clock aria-hidden className="mt-0.5 size-4 shrink-0" />{t("workspace.assistantWaitingTasks")}</p>
                            : showWorking ? <AgentWorkingMessage key={`working:${activeThreadId}:${turnId || ""}:${activeItem?.id || ""}`} text={t(sending && !turnId ? "agent.steps.sending" : turnStatus === "queued" ? "workspace.queued" : activeItem?.streamId ? "agent.steps.waitingResponse" : "agent.steps.processing")} /> : null}
                    </>}
                </div>
            </div>
            {showScrollToBottom ? (
                <AgentScrollToBottom theme={theme} title={t("agent.chat.latestMessages")} onClick={() => scrollToBottom()} />
            ) : null}
        </div>
    );
}

const AgentChatMessageRow = memo(function AgentChatMessageRow({ item, theme }: { item: AgentChatItem; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    return (
        <div style={item.streamId ? undefined : historyMessageStyle}>
            <AgentChatMessage item={agentMessageToChatMessage(item)} theme={theme} />
        </div>
    );
});

export function AgentUsageBar({ usage, theme }: { usage: AgentTokenUsage; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const { t } = useTranslation();
    return (
        <div className="flex items-center justify-center gap-4 px-4 pt-1 text-xs tabular-nums" style={{ color: theme.node.muted }}>
            <span className="opacity-70">{t("agent.chat.latestCall")}</span>
            <UsageNumber label={t("agent.chat.input")} value={usage.input} color={theme.node.text} />
            <UsageNumber label={t("agent.chat.cached")} value={usage.cached} color={theme.node.text} />
            <UsageNumber label={t("agent.chat.output")} value={usage.output} color={theme.node.text} />
        </div>
    );
}

function UsageNumber({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <span className="inline-flex items-baseline gap-1" aria-label={`${label} ${value.toLocaleString()}`}>
            <span>{label}</span>
            <CountingNumber aria-hidden className="font-medium" number={value} thousandSeparator="," initiallyStable style={{ color }} />
        </span>
    );
}
