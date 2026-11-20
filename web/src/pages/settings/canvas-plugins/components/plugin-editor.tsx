import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { dequal } from "dequal";
import { z } from "zod";
import { ArrowLeft, FilePlus2, Save, Send, Sparkles, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/display";
import { Choice } from "@/components/ui/choice";
import { Dialog } from "@/components/ui/dialog";
import { EditorForm, Field } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { useEditGuard } from "@/hooks/use-edit-guard";
import { useFeedback } from "@/hooks/use-feedback";
import { useCopyText } from "@/hooks/use-copy-text";
import { useAgentStore } from "@/stores/use-agent-store";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { captureSession } from "@/services/api/client";
import { getCanvasPlugin, getCanvasPluginContract, publishCanvasPlugin, saveCanvasPluginDraft } from "@/services/api/canvas-plugins";

export function PluginEditor({ id }: { id: string }) {
    const { t, i18n } = useTranslation();
    const navigate = useNavigate();
    const client = useQueryClient();
    const { notify, confirm } = useFeedback();
    const copy = useCopyText();
    const theme = useThemeStore((state) => state.theme);
    const query = useQuery({ queryKey: ["canvas-plugin", id], queryFn: () => getCanvasPlugin(id) });
    const contract = useQuery({ queryKey: ["canvas-plugin-contract", i18n.resolvedLanguage], queryFn: () => getCanvasPluginContract(i18n.resolvedLanguage) });
    const [draft, setDraft] = useState<{ revision: number; files: Record<string, string>; base: Record<string, string> } | null>(null);
    const [file, setFile] = useState("index.tsx");
    const [tab, setTab] = useState("code");
    const [versionId, setVersionId] = useState("");
    const [addFile, setAddFile] = useState(false);
    const [busy, setBusy] = useState(false);
    const operation = useRef(false);
    const [error, setError] = useState("");
    const dirty = Boolean(draft && !dequal(draft.files, draft.base));
    const remoteChanged = Boolean(draft && query.data?.draft && draft.revision !== query.data.draft.revision);
    const reset = () => { const saved = query.data?.draft; if (saved) setDraft({ ...saved, base: saved.files }); };
    useEditGuard(dirty, reset);
    useEffect(() => { const saved = query.data?.draft; if (saved) setDraft((current) => current && !dequal(current.files, current.base) ? current : { ...saved, base: saved.files }); }, [query.data]);
    const record = query.data?.plugin;
    const published = query.data?.versions.find((version) => version.id === versionId);
    const files = versionId ? published?.files || {} : draft?.files || {};
    const readOnly = Boolean(record?.builtin || versionId);
    const filename = files[file] === undefined ? Object.keys(files).sort()[0] || file : file;
    const change = (next: Record<string, string>) => { if (draft && !readOnly && !busy) setDraft({ ...draft, files: next }); };
    const run = async (action: () => Promise<unknown>) => { if (operation.current) return; operation.current = true; setBusy(true); setError(""); try { await action(); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); throw failure; } finally { operation.current = false; setBusy(false); } };
    const refresh = () => Promise.all([query.refetch(), client.invalidateQueries({ queryKey: ["canvas-plugins"] }), client.invalidateQueries({ queryKey: ["canvas-plugin-catalog"] })]);
    const save = async () => {
        if (!draft) return;
        const assertSession = captureSession();
        const saved = await saveCanvasPluginDraft(id, draft.revision, draft.files);
        assertSession(); setDraft({ ...saved, base: saved.files }); await refresh(); notify.success(t("nodePlugins.saved"));
    };
    const publish = () => confirm({ title: t("nodePlugins.publish"), content: t("nodePlugins.publishHint"), onConfirm: () => run(async () => { if (!record || !draft) return; const assertSession = captureSession(); await publishCanvasPlugin(id, draft.revision, record.version); assertSession(); await refresh(); notify.success(t("nodePlugins.published")); }) });
    const selectVersion = (next: string) => { const select = () => { reset(); setVersionId(next); }; if (dirty) confirm({ title: t("ui.discardTitle"), content: t("ui.discardDescription"), onConfirm: select }); else select(); };
    const brief = () => t("nodePlugins.aiBrief", { id })+"\n\n"+JSON.stringify({ contract: contract.data, files }, null, 2);
    const askAssistant = () => { const agent = useAgentStore.getState(); const open = () => { useAgentSkillStore.getState().selectSkill(null, t("nodePlugins.assistantPrompt", { id })); useAgentStore.setState({ activeTab: "chat" }); agent.openPanel(); }; if (agent.prompt.trim()) confirm({ title: t("modelScripts.replacePrompt"), content: t("modelScripts.replacePromptHint"), onConfirm: open }); else open(); };

    return <section className="space-y-5" data-canvas-shortcuts-ignore>
        <PageHeader title={record?.builtin ? t(`nodePlugins.builtins.${record.id}`) : record?.name || t("nodePlugins.title")} actions={<Button variant="outline" icon={<ArrowLeft />} disabled={busy} onClick={() => navigate("/settings/canvas-plugins")}>{t("nodePlugins.back")}</Button>} />
        {query.error ? <Notice type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>{t("workspace.retry")}</Button>} /> : null}
        {versionId && query.isSuccess && !published ? <Notice type="error" title={t("nodePlugins.versionUnavailable")} action={<Button onClick={() => selectVersion("")}>{t("modelScripts.draft")}</Button>} /> : null}
        {error ? <Notice type="error" title={error} /> : null}
        {remoteChanged ? <Notice type="warning" title={t("modelScripts.remoteChanged")} action={<Button onClick={() => confirm({ title: t("ui.discardTitle"), content: t("ui.discardDescription"), onConfirm: reset })}>{t("workspace.refresh")}</Button>} /> : null}
        {query.isLoading ? <p role="status" className="py-8 text-sm text-muted-foreground">{t("settings.loading")}</p> : null}
        {record?.builtin ? <><Notice title={t("nodePlugins.builtinHint")} /><DataTableNodes nodes={record.nodes} /><p className="text-sm text-muted-foreground">{t("nodePlugins.builtinSource")}</p></> : record && draft ? <>
            <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 bg-background py-3">
                <div className="flex flex-wrap items-center gap-2"><Badge>{t(record.enabled ? "nodePlugins.enabled" : "nodePlugins.disabled")}</Badge><Choice aria-label={t("nodePlugins.version")} value={versionId} disabled={busy} onChange={selectVersion} options={[{ value: "", label: t("modelScripts.revision", { revision: draft.revision }) }, ...query.data!.versions.map((version) => ({ value: version.id, label: `r${version.revision} · ${new Date(version.createdAt).toLocaleString()}` }))]} /></div>
                <div className="flex flex-wrap gap-2"><Button variant="outline" icon={<Sparkles />} disabled={busy || readOnly || dirty || remoteChanged || query.isError} onClick={askAssistant}>{t("modelScripts.askAssistant")}</Button><Button variant="outline" icon={<Send />} disabled={busy || readOnly || dirty || remoteChanged || query.isError} onClick={publish}>{t("nodePlugins.publish")}</Button><Button variant="default" icon={<Save />} disabled={busy || readOnly || !dirty || remoteChanged || query.isError} loading={busy} onClick={() => { void run(save).catch(() => undefined); }}>{t("modelScripts.saveDraft")}</Button></div>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">{t(readOnly ? "nodePlugins.publishedReadonly" : "nodePlugins.lifecycle")}</p>
            <Tabs value={tab} onValueChange={setTab} items={[
                { key: "code", label: t("modelScripts.code"), children: <div className="space-y-3"><div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" icon={<FilePlus2 />} disabled={busy || readOnly} onClick={() => setAddFile(true)}>{t("modelScripts.addFile")}</Button><Button size="sm" variant="outline" icon={<Trash2 />} data-destructive disabled={busy || readOnly || filename === "plugin.json"} onClick={() => confirm({ title: t("modelScripts.deleteFile"), content: filename, destructive: true, onConfirm: () => { const next = { ...files }; delete next[filename]; change(next); setFile("plugin.json"); } })}>{t("modelScripts.deleteFile")}</Button></div><div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]"><nav className="min-w-0 space-y-1" aria-label={t("modelScripts.files")}>{Object.keys(files).sort().map((name) => <Button key={name} size="sm" variant="ghost" title={name} className={`w-full justify-start truncate font-mono ${filename === name ? "bg-accent" : ""}`} onClick={() => setFile(name)}>{name}</Button>)}</nav><div className="min-w-0 space-y-2"><p className="truncate font-mono text-xs">{filename}</p><div className="overflow-hidden rounded-lg border border-border"><CodeMirror key={filename} value={files[filename] || ""} height="440px" theme={theme} extensions={/\.[jt]sx?$/.test(filename) ? [javascript({ jsx: true, typescript: /\.tsx?$/.test(filename) })] : []} readOnly={readOnly || busy} onChange={(content) => change({ ...files, [filename]: content })} /></div></div></div></div> },
                { key: "guide", label: t("nodePlugins.guide"), children: <div className="space-y-4"><Button disabled={!contract.data} onClick={() => copy(brief())}>{t("modelScripts.copyBrief")}</Button>{contract.error ? <Notice type="error" title={contract.error.message} action={<Button onClick={() => void contract.refetch()}>{t("workspace.retry")}</Button>} /> : null}{Object.entries(contract.data || {}).map(([key, content]) => <div key={key} className="space-y-1"><p className="text-sm font-medium">{t(`nodePlugins.contract.${key}`)}</p><p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{content}</p></div>)}</div> },
            ]} />
        </> : null}
        <Dialog open={addFile} title={t("modelScripts.addFile")} onClose={() => setAddFile(false)} footer={<Button variant="default" icon={<Save />} type="submit" form="canvas-plugin-file">{t("common.save")}</Button>}>
            {addFile ? <EditorForm id="canvas-plugin-file" initialValues={{ path: "lib/helper.ts" }} onSubmit={(values) => { const name = values.path; if (files[name] !== undefined) throw new Error(t("modelScripts.fileExists")); change({ ...files, [name]: name.endsWith(".json") ? "{}\n" : "" }); setFile(name); setAddFile(false); }}><Field name="path" label={t("modelScripts.filePath")} schema={z.string().refine((value) => !value.startsWith("/") && !/[\\:\r\n\0]/.test(value) && value.split("/").every((part) => part && !part.startsWith(".")) && /\.(js|jsx|ts|tsx|json|css)$/.test(value), t("nodePlugins.invalidPath"))}><Input /></Field></EditorForm> : null}
        </Dialog>
    </section>;
}

function DataTableNodes({ nodes }: { nodes: import("@/services/api/canvas-plugins").CanvasNodeSpec[] }) {
    const { t } = useTranslation();
    return <dl className="space-y-3">{nodes.map((node) => <div key={node.type} className="flex flex-wrap items-center gap-3 text-sm"><dt>{t("nodePlugins.nodeTypes")}</dt><dd className="font-mono text-xs text-muted-foreground">{node.type}</dd><dd className="text-xs text-muted-foreground">{node.defaultSize.width} × {node.defaultSize.height}</dd></div>)}</dl>;
}
