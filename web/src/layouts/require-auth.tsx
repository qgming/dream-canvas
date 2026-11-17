import { useTranslation } from "react-i18next";
import appI18n from "@/i18n";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Notice as Alert } from "@/components/ui/display";
import { Button } from "@/components/ui/button";
import { Spinner as Spin } from "@/components/ui/display";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuthStore } from "@/stores/use-auth-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";
import { cleanupUnusedImages } from "@/services/image-storage";
import { useConfigStore } from "@/stores/use-config-store";
import { modelCatalog } from "@/services/api/channels";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";
import { usePromptSourceStore } from "@/stores/use-prompt-source-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";

export default function RequireAuth() {
    useTranslation();
    const { pathname, search } = useLocation();
    const user = useAuthStore((state) => state.user);
    const ready = useAuthStore((state) => state.ready);
    const error = useAuthStore((state) => state.error);
    const refresh = useAuthStore((state) => state.refresh);
    const queryClient = useQueryClient();
    const [scope, setScope] = useState<string | null>(null);
    const catalog = useQuery({ queryKey: ["model-catalog", user?.id], queryFn: modelCatalog, enabled: Boolean(user && scope === user.id) });
    usePromptSourceScheduler();

    useEffect(() => { void refresh(); }, [refresh]);
    useEffect(() => {
        const clear = () => useAuthStore.getState().clear();
        window.addEventListener("session-expired", clear);
        return () => window.removeEventListener("session-expired", clear);
    }, []);
    useEffect(() => {
        queryClient.clear();
        useCanvasStore.getState().reset();
        useAssetStore.getState().reset();
        useConfigStore.getState().reset();
        usePromptSourceStore.getState().reset();
        useCanvasUiStore.setState({ activeProjectId: null, editingProjectId: null, editingProjectTitle: "", selectedProjectIds: [], deleteProjectIds: [] });
        useWorkbenchAgentStore.setState({ imageCommand: null, videoCommand: null, tasks: [] });
        useAgentStore.getState().disconnectAgent({ messages: [], attachments: [], canvasReferences: [], threads: [], activeThreadId: "", activeTurnId: "", pendingApprovals: [], pendingTool: null, prompt: "" });
        useAgentSkillStore.getState().reset();
        void cleanupUnusedImages(null);
        setScope(user?.id || null);
        if (user) { void useCanvasStore.getState().loadProjects(); void useAssetStore.getState().loadAssets(); void useConfigStore.getState().load(); void usePromptSourceStore.getState().load(); }
    }, [queryClient, user?.id]);
    useEffect(() => { if (catalog.data && scope === user?.id) useConfigStore.getState().setCatalog(catalog.data); }, [catalog.data, scope, user?.id]);
    useEffect(() => {
        const refresh = () => { void useAssetStore.getState().loadAssets(); };
        window.addEventListener("assets-changed", refresh);
        return () => window.removeEventListener("assets-changed", refresh);
    }, []);
    useEffect(() => {
        if (!user || scope !== user.id) return;
        let source: EventSource | undefined;
        let refreshing = false;
        const refresh = () => {
            if (refreshing || useAuthStore.getState().user?.id !== user.id) return;
            refreshing = true;
            void Promise.allSettled([useCanvasStore.getState().refreshProjects(), useAssetStore.getState().loadAssets(), queryClient.invalidateQueries({ queryKey: ["model-catalog"] })]).finally(() => { refreshing = false; });
            window.dispatchEvent(new Event("server-changed"));
        };
        const connect = () => {
            if (source || useAuthStore.getState().user?.id !== user.id) return;
            source = new EventSource("/api/events");
            source.addEventListener("changed", refresh);
            source.onerror = () => { source?.close(); source = undefined; };
        };
        const focused = () => { connect(); refresh(); };
        connect();
        window.addEventListener("focus", focused);
        return () => { source?.close(); source = undefined; window.removeEventListener("focus", focused); };
    }, [user?.id, scope, queryClient]);

    if (!ready) return <div className="flex h-dvh items-center justify-center bg-background"><Spin label={appI18n.t("workspace.readingSession")} /></div>;
    if (error) return <div className="flex h-dvh items-center justify-center bg-background p-6"><Alert type="error" title={appI18n.t("workspace.serviceUnavailable")} description={error} action={<Button onClick={() => void refresh()}>{appI18n.t("workspace.retry")}</Button>} /></div>;
    if (!user) return <Navigate to="/login" state={{ from: `${pathname}${search}` }} replace />;
    if (scope !== user.id) return <div className="flex h-dvh items-center justify-center bg-background"><Spin /></div>;
    return <Outlet key={user.id} />;
}

export function RequireAdmin() {
    useTranslation();
    const user = useAuthStore((state) => state.user);
    return user?.role === "admin" ? <Outlet /> : <Navigate to="/settings" replace />;
}
