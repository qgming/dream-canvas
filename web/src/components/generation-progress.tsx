import { AlertCircle, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Progress } from "@/components/ui/display";
import type { GenerationTask } from "@/services/api/tasks";
import { cn } from "@/lib/utils";

type TaskProgress = Pick<GenerationTask, "status" | "providerStatus" | "progress" | "error">;
export function GenerationProgress({ task, className }: { task?: TaskProgress; className?: string }) {
    const { t } = useTranslation();
    const providerActive = task && ["submitting", "running"].includes(task.status);
    const status = providerActive && task?.providerStatus === "queued" ? "providerQueued" : providerActive && task?.providerStatus === "running" ? "running" : task?.status || "submitting";
    const paused = ["confirmation_required", "interrupted", "failed", "cancelled", "disconnected"].includes(status);
    const key: Record<string, string> = { queued: "queued", waiting_assets: "waitingAssets", submitting: "submitting", providerQueued: "providerQueued", running: "running", saving: "savingFile", succeeded: "succeeded", failed: "failed", cancelled: "cancelled", interrupted: "interrupted", confirmation_required: "confirmationRequired", disconnected: "progressDisconnected" };
    const percent = typeof task?.progress === "number" && Number.isFinite(task.progress) ? task.progress : undefined;
    return <div role="status" className={cn("flex min-w-0 flex-col items-center gap-2 text-center text-xs text-muted-foreground", className)}>
        {paused ? <AlertCircle aria-hidden className="size-5 text-warning" /> : status !== "succeeded" ? <LoaderCircle aria-hidden className="size-5 animate-spin motion-reduce:animate-none" /> : null}
        <span>{t(`workspace.${key[status] || "running"}`)}{percent !== undefined && ["running", "providerQueued", "submitting"].includes(status) ? ` · ${percent}%` : ""}</span>
        {percent !== undefined && !paused ? <div className="w-36 max-w-full space-y-1"><Progress percent={percent} />{status === "saving" ? <span>{t("workspace.providerProgress", { percent })}</span> : null}</div> : null}
        {task?.error ? <span className="max-w-sm break-words leading-5">{task.error}</span> : null}
    </div>;
}
