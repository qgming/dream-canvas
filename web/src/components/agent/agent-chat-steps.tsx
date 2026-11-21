import type { ReactNode } from "react";
import { Collapsible } from "@animate-ui/react/primitives/radix-ui";
import { Check, ChevronRight, CircleAlert, Clock, Layers, LoaderCircle, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { AgentChatItem } from "@/stores/use-agent-store";
import { agentMessageId, objectField, stringText, toolName } from "./agent-event-formatters";

const rowClass = "flex min-h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] leading-5 text-muted-foreground [&>svg]:size-4 [&>svg]:shrink-0";
export const agentStepBodyClass = "mb-1 ml-4 border-l border-border pl-3 pr-2";

export function AgentStep({ icon, label, status, children, open, onOpenChange }: {
    icon: ReactNode;
    label: string;
    status?: ReactNode;
    children?: ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}) {
    const heading = <>{icon}<span className="min-w-0 flex-1 truncate" title={label}>{label}</span>{status}</>;
    if (!children) return <div className={rowClass}>{heading}</div>;
    return (
        <Collapsible.Root open={open} onOpenChange={onOpenChange} className="min-w-0">
            <Collapsible.Trigger className={cn(rowClass, "group/step outline-none transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring")}>
                {heading}<ChevronRight aria-hidden className="transition-transform group-data-[state=open]/step:rotate-90 motion-reduce:transition-none" />
            </Collapsible.Trigger>
            <Collapsible.Content>{children}</Collapsible.Content>
        </Collapsible.Root>
    );
}

export function isRunningAgentTool(item: AgentChatItem | undefined) {
    return item?.role === "tool" && objectField(item.detail, "status") === "running";
}

export function AgentToolSteps({ items }: { items: AgentChatItem[] }) {
    const { t } = useTranslation();
    if (items.length === 1) return <AgentToolStep item={items[0]} />;
    const live = items.some(isRunningAgentTool);
    const statuses = items.map((item) => objectField(item.detail, "status"));
    const issues = statuses.filter((status) => status === "failed" || status === "interrupted" || status === "confirmation_required").length;
    const pending = statuses.filter((status) => status === "pending").length;
    return <AgentStep icon={live ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Layers aria-hidden />} label={t("agent.steps.tools", { count: items.length })}
        status={issues ? <span className="shrink-0 text-xs text-destructive">{t("agent.steps.issues", { count: issues })}</span>
            : live ? <span className="shrink-0 text-xs">{t("agent.steps.running")}</span>
            : pending ? <span className="shrink-0 text-xs">{t("agent.steps.pendingCount", { count: pending })}</span> : null}>
        <div className={cn(agentStepBodyClass, "mt-0.5 space-y-0.5 pl-2")}>
            {items.map((item) => <AgentToolStep key={agentMessageId(item.threadId || "", item.turnId || "", item.itemId || item.id)} item={item} />)}
        </div>
    </AgentStep>;
}

const taskStates: Record<string, string> = {
    queued: "queued", waiting_assets: "waitingAssets", submitting: "submitting", running: "running", saving: "saving",
    succeeded: "succeeded", failed: "failed", cancelled: "cancelled", interrupted: "interrupted", confirmation_required: "confirmationRequired",
};

const toolErrors = new Set(["tool_not_allowed", "invalid_tool_arguments", "invalid_script_runtime", "forbidden", "version_conflict", "target_project_fixed", "target_project_required", "client_offline"]);

function AgentToolStep({ item }: { item: AgentChatItem }) {
    const { t } = useTranslation();
    const name = stringText(objectField(item.detail, "name"));
    const status = objectField(item.detail, "status");
    const state = status === "confirmation_required" ? "interrupted"
        : status === "running" || status === "pending" || status === "completed" || status === "failed" || status === "interrupted" ? status : "recorded";
    const Icon = { running: LoaderCircle, pending: Clock, completed: Check, failed: CircleAlert, interrupted: CircleAlert, recorded: Wrench }[state];
    const taskRows = objectField(item.detail, "tasks");
    const taskIds = objectField(item.detail, "taskIds");
    const tasks = (Array.isArray(taskRows) ? taskRows.map((row) => ({ id: stringText(objectField(row, "id")), state: taskStates[stringText(objectField(row, "status"))] }))
        : Array.isArray(taskIds) ? taskIds.map((id) => ({ id: stringText(id), state: undefined })) : []).filter(({ id }) => /^[a-f0-9]{64}$/.test(id));
    const taskState = taskStates[stringText(objectField(item.detail, "taskStatus"))];
    const count = objectField(item.detail, "resultCount");
    const resultPreview = objectField(item.detail, "resultPreview");
    const previews = Array.isArray(resultPreview) ? resultPreview.filter((label): label is string => typeof label === "string" && Boolean(label.trim())) : [];
    const nodes = objectField(item.detail, "nodeCount");
    const connections = objectField(item.detail, "connectionCount");
    const canvasSummary = typeof nodes === "number" && typeof connections === "number" ? t("canvas.project.stats", { nodes, connections }) : "";
    const remaining = typeof count === "number" ? count - (previews.length || tasks.length) : 0;
    const code = stringText(objectField(item.detail, "errorCode"));
    const note = state === "failed" ? t(`agent.steps.errors.${toolErrors.has(code) ? code : "fallback"}`)
        : status === "interrupted" ? t("agent.steps.uncertain") : null;
    return (
        <AgentStep label={name ? toolName(name) : t("agent.eventExtra.toolOperation")} icon={<Icon aria-hidden className={cn(state === "running" && "animate-spin motion-reduce:animate-none", state === "failed" && "text-destructive", state === "interrupted" && "text-warning")} />}
            status={<span className={cn("shrink-0 text-xs", state === "failed" && "text-destructive", state === "interrupted" && "text-warning")}>{t(`agent.steps.${state}`)}</span>}>
            {note || typeof count === "number" || taskState || tasks.length || previews.length || canvasSummary ? <div className={cn(agentStepBodyClass, "space-y-1 break-words py-1 text-xs leading-5 text-muted-foreground")}>
                {note ? <p>{note}</p> : null}
                {typeof count === "number" ? <p>{t("agent.steps.results", { count })}</p> : null}
                {previews.length ? <ul className="list-disc space-y-0.5 pl-4 text-foreground">{previews.map((label, index) => <li key={index}>{label}</li>)}</ul> : null}
                {canvasSummary ? <p>{canvasSummary}</p> : null}
                {taskState ? <p>{t("agent.steps.taskState", { status: t(`workspace.${taskState}`) })}</p> : null}
                {tasks.length ? <ul>
                    {tasks.map(({ id, state }) => <li key={id} className="flex flex-wrap items-baseline gap-x-2">
                        <Link className="rounded-sm text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" to={`/settings/tasks?taskId=${encodeURIComponent(id)}`}>
                            {t("workspace.taskDetails")}{tasks.length > 1 ? ` · ${id.slice(0, 8)}` : ""}
                        </Link>
                        {state ? <span>{t(`workspace.${state}`)}</span> : null}
                    </li>)}
                </ul> : null}
                {remaining > 0 && (previews.length || tasks.length) ? <p>{t("agent.steps.moreResults", { count: remaining })}</p> : null}
            </div> : null}
        </AgentStep>
    );
}
