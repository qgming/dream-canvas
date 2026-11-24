import { useEffect, useId, useMemo } from "react";
import dayjs from "dayjs";
import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/display";
import { EditorForm, Field, useEditorForm } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Menu } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { AssistantThread } from "@/services/api/assistant";
import { useAssistantSession } from "./assistant-session";

function groupThreadsByDate(threads: AssistantThread[], today: number) {
    const groups = new Map<string, AssistantThread[]>();
    const startOfToday = dayjs(today);
    for (const thread of threads) {
        const date = dayjs(thread.updatedAt || thread.createdAt);
        const daysAgo = startOfToday.diff(date.startOf("day"), "day");
        const key = !date.isValid() ? "" : daysAgo <= 0 ? "today" : daysAgo === 1 ? "yesterday" : daysAgo <= 7 ? "days7" : daysAgo <= 30 ? "days30" : date.format("YYYY-MM");
        const group = groups.get(key);
        if (group) group.push(thread);
        else groups.set(key, [thread]);
    }
    return groups;
}

export function AgentHistoryView({ fullHeight, onAction }: { fullHeight?: boolean; onAction?: () => void }) {
    const { i18n, t } = useTranslation();
    const { threads, activeId, loading, loadingThreads, busy, uploading, error, openThread, setRenamingThread, deleteThread } = useAssistantSession();
    const today = fullHeight ? dayjs().startOf("day").valueOf() : 0;
    const groups = useMemo(() => fullHeight ? groupThreadsByDate(threads, today) : new Map([["", threads]]), [fullHeight, threads, today]);
    const groupLabels: Record<string, string> = {
        today: t("agent.history.groups.today"),
        yesterday: t("agent.history.groups.yesterday"),
        days7: t("agent.history.groups.days7"),
        days30: t("agent.history.groups.days30"),
    };
    const renderThread = (thread: AssistantThread) => {
        const active = thread.id === activeId;
        const name = thread.title || t("agent.history.newThread");
        const timestamp = thread.updatedAt || thread.createdAt;
        return <div key={thread.id} className={cn("group flex items-center gap-1 rounded-lg pr-1 hover:bg-accent/60 focus-within:bg-accent/60", active && "bg-accent")}>
            <button type="button" aria-current={active || undefined} disabled={busy || loading || uploading} className="flex min-w-0 flex-1 items-start justify-between gap-2 rounded-lg px-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60" onClick={() => { onAction?.(); void openThread(thread.id); }}>
                <span className="min-w-0 flex-1"><span title={name} className="block truncate text-sm font-medium">{name}</span>{!fullHeight && timestamp ? <span className="block truncate text-xs text-muted-foreground">{new Date(timestamp).toLocaleString(i18n.language)}</span> : null}</span>
            </button>
            <Menu placement="bottomRight" items={[
                { key: "rename", label: t("agent.history.rename"), icon: <Pencil />, onClick: () => { onAction?.(); setRenamingThread(thread); } },
                { key: "delete", label: t("common.delete"), icon: <Trash2 />, danger: true, onClick: () => { onAction?.(); deleteThread(thread); } },
            ]}>
                <Button variant="ghost" size="icon" icon={<Ellipsis />} aria-label={t("agent.history.moreActions", { name })} className="pointer-events-none size-7 bg-transparent opacity-0 hover:bg-accent group-hover:pointer-events-auto group-hover:opacity-100 group-has-[:focus-visible]:pointer-events-auto group-has-[:focus-visible]:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100" />
            </Menu>
        </div>;
    };
    return (
        <section aria-label={fullHeight ? undefined : t("agent.history.title")} className={cn("p-2", fullHeight && "thin-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain")}>
            {error && !fullHeight ? <p role="alert" className="break-words px-2 pb-2 text-xs text-destructive">{error}</p> : null}
            <div className={fullHeight ? "space-y-4 pt-2" : "thin-scrollbar max-h-72 space-y-0.5 overflow-y-auto"}>
                {Array.from(groups, ([key, group]) => <div key={key} className="space-y-0.5">
                    {key ? <h2 className="px-2 pb-1 text-xs font-medium text-muted-foreground">{groupLabels[key] ?? key}</h2> : null}
                    {group.map(renderThread)}
                </div>)}
                {!threads.length && (loadingThreads || !error) ? <div className="flex justify-center px-3 py-6 text-center text-sm text-muted-foreground">{loadingThreads ? <Spinner size="small" /> : t("agent.history.noWorkspaceThreads")}</div> : null}
            </div>
        </section>
    );
}

export function AgentThreadRenameDialog() {
    const { t } = useTranslation();
    const { renamingThread: thread, setRenamingThread, renameThread } = useAssistantSession();
    const formId = useId();
    const form = useEditorForm<{ title: string }>();
    const saving = form.formState.isSubmitting;
    useEffect(() => { if (thread) form.reset({ title: thread.title }); }, [form, thread]);
    return <Dialog open={Boolean(thread)} title={t("agent.history.renameTitle")} onClose={() => setRenamingThread(null)} width={448} busy={saving} secondaryAction={null} footer={<Button type="submit" variant="default" form={formId} loading={saving}>{t("common.save")}</Button>}>
        <EditorForm id={formId} form={form} onSubmit={async ({ title }) => { if (thread) await renameThread(thread, title.trim()); }}>
            <Field name="title" label={t("workspace.name")} schema={z.string().trim().min(1, t("ui.nameRequired"))}><Input autoFocus placeholder={t("agent.history.newThread")} /></Field>
        </EditorForm>
    </Dialog>;
}
