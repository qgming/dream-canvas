import { useEffect, type ReactNode } from "react";
import { useMatch } from "react-router-dom";

import { AgentThreadRenameDialog } from "@/components/agent/agent-history-view";
import { AgentPanel } from "@/components/agent/agent-panel";
import { AssistantSessionProvider } from "@/components/agent/assistant-session";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { EditGuard } from "@/components/layout/edit-guard";
import { useAgentStore } from "@/stores/use-agent-store";

export default function UserLayout({ children }: { children: ReactNode }) {
    const conversations = Boolean(useMatch("/conversations"));
    useEffect(() => { if (conversations) useAgentStore.getState().closePanel(); }, [conversations]);
    return (
        <AssistantSessionProvider page={conversations}>
            <div className="flex h-dvh overflow-hidden bg-background text-foreground">
                <EditGuard>
                    <AppSidebar />
                    <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
                </EditGuard>
                {!conversations ? <AgentPanel /> : null}
                <AgentThreadRenameDialog />
            </div>
        </AssistantSessionProvider>
    );
}
