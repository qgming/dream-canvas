import { useEffect, useId } from "react";
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

export function AgentHistoryView({
    threads,
    activeThreadId,
    loading,
    busy,
    error,
    onResumeThread,
    onRenameThread,
    onDeleteThread,
}: {
    threads: AssistantThread[];
    activeThreadId: string;
    loading: boolean;
    busy: boolean;
    error: string;
    onResumeThread: (threadId: string) => void;
    onRenameThread: (thread: AssistantThread) => void;
    onDeleteThread: (thread: AssistantThread) => void;
}) {
    const { i18n, t } = useTranslation();
    return (
        <section aria-label={t("workspace.history")} className="p-2">
            {error ? <p role="alert" className="break-words px-2 pb-2 text-xs text-destructive">{error}</p> : null}
            <div className="thin-scrollbar max-h-72 space-y-0.5 overflow-y-auto">
                {threads.map((thread) => {
                    const active = thread.id === activeThreadId;
                    const name = thread.title || t("agent.history.newThread");
                    const timestamp = thread.updatedAt || thread.createdAt;
                    return <div key={thread.id} className={cn("group flex items-center gap-1 rounded-lg pr-1 hover:bg-accent/60 focus-within:bg-accent/60", active && "bg-accent")}>
                        <button type="button" aria-current={active || undefined} disabled={busy} className="flex min-w-0 flex-1 items-start justify-between gap-2 rounded-lg px-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60" onClick={() => onResumeThread(thread.id)}>
                            <span className="min-w-0 flex-1"><span title={name} className="block truncate text-sm font-medium">{name}</span>{timestamp ? <span className="block truncate text-xs text-muted-foreground">{new Date(timestamp).toLocaleString(i18n.language)}</span> : null}</span>
                        </button>
                        <Menu placement="bottomRight" items={[
                            { key: "rename", label: t("agent.history.rename"), icon: <Pencil />, onClick: () => onRenameThread(thread) },
                            { key: "delete", label: t("common.delete"), icon: <Trash2 />, danger: true, onClick: () => onDeleteThread(thread) },
                        ]}>
                            <Button variant="ghost" size="icon" icon={<Ellipsis />} aria-label={t("agent.history.moreActions", { name })} className="pointer-events-none size-7 bg-transparent opacity-0 hover:bg-accent group-hover:pointer-events-auto group-hover:opacity-100 group-has-[:focus-visible]:pointer-events-auto group-has-[:focus-visible]:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100" />
                        </Menu>
                    </div>;
                })}
                {!threads.length && (loading || !error) ? <div className="flex justify-center px-3 py-6 text-center text-sm text-muted-foreground">{loading ? <Spinner size="small" /> : t("agent.history.noWorkspaceThreads")}</div> : null}
            </div>
        </section>
    );
}

export function AgentThreadRenameDialog({ thread, onClose, onRename }: {
    thread: AssistantThread | null;
    onClose: () => void;
    onRename: (thread: AssistantThread, title: string) => Promise<void>;
}) {
    const { t } = useTranslation();
    const formId = useId();
    const form = useEditorForm<{ title: string }>();
    const saving = form.formState.isSubmitting;
    useEffect(() => { if (thread) form.reset({ title: thread.title }); }, [form, thread]);
    return <Dialog open={Boolean(thread)} title={t("agent.history.renameTitle")} onClose={onClose} width={448} busy={saving} secondaryAction={null} footer={<Button type="submit" variant="default" form={formId} loading={saving}>{t("common.save")}</Button>}>
        <EditorForm id={formId} form={form} onSubmit={async ({ title }) => { if (thread) await onRename(thread, title.trim()); }}>
            <Field name="title" label={t("workspace.name")} schema={z.string().trim().min(1, t("ui.nameRequired"))}><Input autoFocus placeholder={t("agent.history.newThread")} /></Field>
        </EditorForm>
    </Dialog>;
}
