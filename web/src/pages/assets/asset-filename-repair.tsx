import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/display";
import { useFeedback } from "@/hooks/use-feedback";
import { captureSession } from "@/services/api/client";
import { getAssetFilenameRepair, startAssetFilenameRepair } from "@/services/api/assets";
import { useAuthStore } from "@/stores/use-auth-store";
import { useAssetStore } from "@/stores/use-asset-store";

export function AssetFilenameRepair() {
    const { t } = useTranslation();
    const { confirm, notify } = useFeedback();
    const user = useAuthStore((state) => state.user);
    const query = useQuery({ queryKey: ["asset-filename-repair", user?.id], queryFn: getAssetFilenameRepair, enabled: user?.role === "admin" });
    useEffect(() => {
        if (user?.role !== "admin") return;
        const changed = (event: Event) => {
            const topic = (event as CustomEvent<string>).detail;
            if (!topic || topic === "all" || topic === "assets") void query.refetch();
        };
        window.addEventListener("server-changed", changed);
        return () => window.removeEventListener("server-changed", changed);
    }, [query.refetch, user?.id, user?.role]);
    if (user?.role !== "admin") return null;
    const status = query.data;
    const failures = status?.items.filter((item) => item.error) || [];
    const start = () => {
        const assertSession = captureSession();
        confirm({ title: t("assets.filenameRepair.confirmTitle"), content: t("assets.filenameRepair.confirmContent"), confirmText: t("assets.filenameRepair.start"), onConfirm: async () => {
            assertSession(); await startAssetFilenameRepair(); assertSession();
            await Promise.all([query.refetch(), useAssetStore.getState().loadAssets()]); assertSession();
            notify.success(t("assets.filenameRepair.queued"));
        } });
    };
    return <div className="mt-3 space-y-3">
        <Button variant="ghost" icon={<Wrench className="size-4" />} disabled={query.isLoading} onClick={start}>{t("assets.filenameRepair.action")}</Button>
        {query.error ? <Notice type="error" title={query.error.message} action={<Button variant="ghost" onClick={() => void query.refetch()}>{t("workspace.retry")}</Button>} /> : null}
        {status?.total ? <Notice type={status.failed ? "warning" : status.pending ? "info" : "success"} title={t(status.pending ? "assets.filenameRepair.progress" : "assets.filenameRepair.completed", status)} description={<div className="space-y-1">
            <p>{t("assets.filenameRepair.summary", status)}</p>
            {status.pending ? <p>{t("assets.filenameRepair.waitHint")}</p> : null}
            {failures.length ? <ul className="max-h-40 space-y-1 overflow-y-auto">{failures.map((item) => <li key={item.assetId}>{item.title || t("assets.untitled")}：{item.error}</li>)}</ul> : null}
        </div>} action={status.failed ? <Button variant="ghost" onClick={start}>{t("workspace.retry")}</Button> : undefined} /> : null}
    </div>;
}
