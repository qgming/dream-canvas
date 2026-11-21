import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Bot, CircleAlert, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Drawer } from "@animate-ui/react/primitives/base-ui/drawer";
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
    const error = useAgentStore((state) => state.connectError);
    const launcher = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const cleanup = useRef<(() => void) | null>(null);
    const [resizing, setResizing] = useState(false);
    useEffect(() => () => cleanup.current?.(), []);
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
    const status = error ? t("ui.assistantError") : sending || waiting ? t("ui.assistantRunning") : t("ui.assistantReady");
    return <Drawer.Root open={open} swipeDirection="right" modal={false} disablePointerDismissal onOpenChange={(next, details) => {
        if (details.reason === "escape-key" && (details.event.defaultPrevented || !(details.event.target instanceof Node && panel.current?.contains(details.event.target)))) {
            details.cancel();
            details.allowPropagation();
            return;
        }
        if (next) useAgentStore.getState().openPanel();
        else useAgentStore.getState().closePanel();
    }}>
        <Drawer.Trigger ref={launcher} render={<Button variant="default" size="icon" className={cn("fixed bottom-4 right-4 z-[110] size-12 rounded-2xl shadow-lg", open && "hidden")} aria-label={`${t("ui.openAssistant")} · ${status}`} title={status} data-canvas-shortcuts-ignore
            icon={sending || waiting ? <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" /> : error ? <CircleAlert className="size-5" /> : <Bot className="size-5" />} />} />
        <Drawer.Portal keepMounted>
            <Drawer.Viewport className="pointer-events-none fixed inset-0 z-[100] flex justify-end overflow-clip [&[hidden]]:hidden">
                <Drawer.Popup ref={panel} initialFocus={panel} finalFocus={launcher} inert={!open} data-ui-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore className={cn("pointer-events-auto relative flex h-dvh max-w-full flex-col border-l border-border bg-popover text-popover-foreground shadow-xl outline-none sm:rounded-l-2xl [&[hidden]]:hidden", resizing && "select-none")} style={{ width }}>
                    <Drawer.Title className="sr-only">{t("ui.assistant")}</Drawer.Title>
                    <Drawer.Description className="sr-only">{t("agent.drawer.description")}</Drawer.Description>
                    <button type="button" data-base-ui-swipe-ignore className="absolute inset-y-4 left-0 z-10 hidden w-2 cursor-col-resize rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring sm:block" onPointerDown={startResize} aria-label={t("agent.panel.resize")} onKeyDown={(event) => {
                        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
                        event.preventDefault();
                        const next = Math.min(760, Math.max(360, width + (event.key === "ArrowLeft" ? 16 : -16)));
                        useAgentStore.setState({ width: next });
                        localStorage.setItem("canvas-agent-panel-width", String(next));
                    }} />
                    <Drawer.Content className="flex min-h-0 flex-1 flex-col overflow-hidden sm:rounded-l-2xl">{owner ? <AssistantPanelContent key={owner} /> : null}</Drawer.Content>
                </Drawer.Popup>
            </Drawer.Viewport>
        </Drawer.Portal>
    </Drawer.Root>;
}
