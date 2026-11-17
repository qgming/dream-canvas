import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Bot, CircleAlert, LoaderCircle, MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AssistantPanelContent } from "./assistant-panel-content";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/use-agent-store";
import { useAuthStore } from "@/stores/use-auth-store";

export function AgentPanel() {
    const { t } = useTranslation();
    const owner = useAuthStore((state) => state.user?.id);
    const width = useAgentStore((state) => state.width);
    const open = useAgentStore((state) => state.panelOpen);
    const sending = useAgentStore((state) => state.sending);
    const waiting = useAgentStore((state) => state.waiting);
    const approvals = useAgentStore((state) => state.pendingApprovals.length);
    const error = useAgentStore((state) => state.connectError);
    const launcher = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLElement>(null);
    const cleanup = useRef<(() => void) | null>(null);
    const previousOpen = useRef(false);
    const [resizing, setResizing] = useState(false);
    useEffect(() => () => cleanup.current?.(), []);
    useEffect(() => {
        const wasOpen = previousOpen.current;
        previousOpen.current = open;
        const frame = requestAnimationFrame(() => {
            if (open) panel.current?.focus({ preventScroll: true });
            else if (wasOpen) launcher.current?.focus({ preventScroll: true });
        });
        return () => cancelAnimationFrame(frame);
    }, [open]);
    const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.currentTarget.focus();
        cleanup.current?.();
        const startX = event.clientX;
        const startWidth = width;
        let nextWidth = startWidth;
        const onMove = (moveEvent: PointerEvent) => {
            nextWidth = Math.min(760, Math.max(360, startWidth + startX - moveEvent.clientX));
            useAgentStore.setState({ width: nextWidth });
        };
        const stop = () => {
            localStorage.setItem("canvas-agent-panel-width", String(nextWidth));
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", stop);
            window.removeEventListener("pointercancel", stop);
            setResizing(false);
            cleanup.current = null;
        };
        cleanup.current = stop;
        setResizing(true);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", stop);
        window.addEventListener("pointercancel", stop);
    };
    const status = error ? t("ui.assistantError") : approvals ? t("ui.assistantApproval") : sending || waiting ? t("ui.assistantRunning") : t("ui.assistantReady");
    return <>
        <aside ref={panel} id="global-assistant" role="dialog" aria-modal="false" aria-label={t("ui.assistant")} aria-hidden={!open} inert={!open} tabIndex={-1} data-ui-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore className={cn("fixed bottom-20 right-4 z-[100] flex h-[calc(100dvh-96px)] max-h-[800px] max-w-[calc(100vw-32px)] flex-col rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl outline-none transition-[opacity,transform,visibility] duration-200 motion-reduce:transition-none", open ? "visible translate-y-0 opacity-100" : "invisible pointer-events-none translate-y-3 opacity-0", resizing && "select-none transition-none")} style={{ width }} onKeyDown={(event) => {
            if (event.key !== "Escape" || event.defaultPrevented || !panel.current?.contains(event.target as Node)) return;
            if (document.querySelector('[data-state="open"][data-ui-overlay]:not(#global-assistant)')) return;
            event.stopPropagation();
            useAgentStore.getState().closePanel();
        }}>
            <button type="button" className="absolute inset-y-4 -left-2 z-10 w-3 cursor-col-resize rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring" onPointerDown={startResize} aria-label={t("agent.panel.resize")} onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
                event.preventDefault();
                const next = Math.min(760, Math.max(360, width + (event.key === "ArrowLeft" ? 16 : -16)));
                useAgentStore.setState({ width: next });
                localStorage.setItem("canvas-agent-panel-width", String(next));
            }} />
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">{owner ? <AssistantPanelContent key={owner} /> : null}</div>
        </aside>
        <Button ref={launcher} variant="default" size="icon" className="fixed bottom-4 right-4 z-[110] size-12 rounded-2xl shadow-lg" aria-label={`${t(open ? "ui.collapseAssistant" : "ui.openAssistant")} · ${status}`} title={status} aria-expanded={open} aria-controls="global-assistant" data-canvas-shortcuts-ignore onClick={() => useAgentStore.getState().togglePanel()}>
            {sending || waiting ? <LoaderCircle className="size-5 animate-spin" /> : error || approvals ? <CircleAlert className="size-5" /> : open ? <MessageSquare className="size-5" /> : <Bot className="size-5" />}
        </Button>
    </>;
}
