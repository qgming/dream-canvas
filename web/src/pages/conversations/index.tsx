import { useRef, useState } from "react";
import { MessageSquarePlus, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AgentHistoryView } from "@/components/agent/agent-history-view";
import { AssistantChatView } from "@/components/agent/assistant-chat-view";
import { useAssistantSession } from "@/components/agent/assistant-session";
import { AnimatedSidePanel } from "@/components/ui/animated-side-panel";
import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

export default function ConversationsPage() {
    const { t } = useTranslation();
    const desktop = useMediaQuery("(min-width: 768px)");
    const [desktopHistoryOpen, setDesktopHistoryOpen] = useState(true);
    const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
    const historyToggle = useRef<HTMLButtonElement>(null);
    const historyClose = useRef<HTMLButtonElement>(null);
    const { title, busy, loading, uploading, newThread } = useAssistantSession();
    const historyOpen = desktop ? desktopHistoryOpen : mobileHistoryOpen;
    const overlayOpen = !desktop && mobileHistoryOpen;
    const toggleHistory = () => {
        if (desktop) setDesktopHistoryOpen(!historyOpen);
        else {
            setMobileHistoryOpen(true);
            requestAnimationFrame(() => historyClose.current?.focus());
        }
    };
    const toggleLabel = t(historyOpen ? "agent.history.collapse" : "agent.history.expand");
    const closeOverlay = () => {
        if (!overlayOpen) return;
        setMobileHistoryOpen(false);
        requestAnimationFrame(() => {
            if (document.activeElement === document.body || document.activeElement === historyClose.current) historyToggle.current?.focus();
        });
    };
    const createConversation = () => { closeOverlay(); void newThread(); };
    const newDisabled = busy || loading || uploading;

    return <main className="relative flex h-full min-w-0 overflow-hidden" onKeyDown={(event) => {
        if (overlayOpen && event.key === "Escape" && !event.defaultPrevented && event.target instanceof Node && event.currentTarget.contains(event.target)) {
            event.preventDefault();
            closeOverlay();
        }
    }}>
        {overlayOpen ? <button type="button" tabIndex={-1} className="absolute inset-0 z-10 bg-background/70" aria-label={toggleLabel} onClick={closeOverlay} /> : null}
        <AnimatedSidePanel id="conversation-history" aria-label={t("agent.history.title")} width="min(var(--secondary-sidebar-width),calc(100vw - 88px))" open={historyOpen}
            className={cn(!desktop && "absolute inset-y-0 left-0 z-20")} panelClassName="flex flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
            <div className="shrink-0 px-3 pt-3">
                <div className="flex items-center gap-1.5">
                    <Button variant="outline" size="lg" icon={<MessageSquarePlus />} className="min-w-0 flex-1 justify-start rounded-lg" disabled={newDisabled} onClick={createConversation}><span className="truncate">{t("agent.history.newThread")}</span></Button>
                    {!desktop ? <Button ref={historyClose} variant="ghost" size="icon" icon={<PanelLeftClose />} title={t("agent.history.collapse")} aria-label={t("agent.history.collapse")} onClick={closeOverlay} /> : null}
                </div>
            </div>
            <AgentHistoryView fullHeight onAction={closeOverlay} />
        </AnimatedSidePanel>
        <section aria-label={t("navigation.conversations")} inert={overlayOpen} className="isolate flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <header className="flex h-14 shrink-0 items-center gap-2 px-3 sm:px-4">
                <Button ref={historyToggle} variant="ghost" size="icon" className="bg-transparent" icon={historyOpen ? <PanelLeftClose /> : <PanelLeftOpen />} title={toggleLabel} aria-label={toggleLabel} aria-expanded={historyOpen} aria-controls="conversation-history" onClick={toggleHistory} />
                <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h1>
                {!historyOpen ? <Button variant="ghost" size="icon" className="bg-transparent" icon={<MessageSquarePlus />} title={t("agent.history.newThread")} aria-label={t("agent.history.newThread")} disabled={newDisabled} onClick={createConversation} /> : null}
            </header>
            <AssistantChatView wide />
        </section>
    </main>;
}
