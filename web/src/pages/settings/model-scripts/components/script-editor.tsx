import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { dequal } from "dequal";
import { z } from "zod";
import { ArrowLeft, BookOpen, CheckCheck, ChevronDown, ClipboardList, Code2, Copy, Eye, FilePlus2, FlaskConical, History, RefreshCw, Save, Send, Settings2, SlidersHorizontal, Sparkles } from "lucide-react";
import { Collapsible, Tabs } from "@animate-ui/react/primitives/radix-ui";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Notice, Badge } from "@/components/ui/display";
import { Dialog } from "@/components/ui/dialog";
import { EditorForm, Field, useEditorForm, useWatch, validateForm } from "@/components/ui/form";
import { Input, Textarea } from "@/components/ui/input";
import { Choice } from "@/components/ui/choice";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/controls";
import { ModelInputFields } from "@/components/model-parameters";
import { ModelScriptTestDialog } from "@/components/model-script-test-dialog";
import { checkModelScript, getModelScript, getScriptContract, getScriptEvidence, publishModelScript, saveScriptDraft, type ModelScript, type ParameterControl, type ScriptCheck, type ScriptVersion } from "@/services/api/channels";
import { captureSession } from "@/services/api/client";
import { useFeedback } from "@/hooks/use-feedback";
import { useCopyText } from "@/hooks/use-copy-text";
import { useEditGuard } from "@/hooks/use-edit-guard";
import { useAgentStore } from "@/stores/use-agent-store";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { InputDefinitionEditor } from "./input-editor";
import { importScriptPackage, scriptManifest, validScriptFile } from "./script-package";

const editorTabs = [
    { key: "inputs", label: "modelScripts.inputs", icon: SlidersHorizontal },
    { key: "code", label: "modelScripts.code", icon: Code2 },
    { key: "metadata", label: "modelScripts.metadata", icon: Settings2 },
    { key: "preview", label: "modelScripts.preview", icon: FlaskConical },
    { key: "evidence", label: "modelScripts.evidence", icon: ClipboardList },
    { key: "versions", label: "modelScripts.versionHistory", icon: History },
    { key: "guide", label: "modelScripts.guide", icon: BookOpen },
];

export function ScriptEditor({ script, initialVersionId = "", initialTaskId = "", onPublished, onBusyChange, onAssistantOpen, onBack, modelContext }: { script: ModelScript; initialVersionId?: string; initialTaskId?: string; onPublished?: (version: ScriptVersion) => void | Promise<void>; onBusyChange?: (busy: boolean) => void; onAssistantOpen?: () => void; onBack?: () => void; modelContext?: { model: string; name: string; baseUrl: string } }) {
    const { t, i18n } = useTranslation();
    const { notify, confirm } = useFeedback();
    const copy = useCopyText();
    const client = useQueryClient();
    const theme = useThemeStore((state) => state.theme);
    const query = useQuery({ queryKey: ["model-script", script.id], queryFn: () => getModelScript(script.id) });
    const contract = useQuery({ queryKey: ["model-script-contract", i18n.resolvedLanguage], queryFn: () => getScriptContract(i18n.resolvedLanguage || "zh-CN") });
    const [files, setFiles] = useState<Record<string, string> | null>(null);
    const [revision, setRevision] = useState(0);
    const [versionId, setVersionId] = useState(initialVersionId);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [tab, setTab] = useState(initialTaskId ? "evidence" : "inputs");
    const [file, setFile] = useState("adapter.js");
    const [fileAction, setFileAction] = useState<{ source?: string } | null>(null);
    const [test, setTest] = useState(false);
    const [preview, setPreview] = useState(false);
    const [previewResult, setPreviewResult] = useState<ScriptCheck | null>(null);
    const [inputEditing, setInputEditing] = useState(false);
    const [taskId, setTaskId] = useState(initialTaskId);
    const importInput = useRef<HTMLInputElement>(null);
    const sample = useEditorForm(), metadata = useEditorForm();
    const authType = useWatch({ control: metadata.control, name: "authType" });
    const operation = useRef(false);
    const assets = useAssetStore((state) => state.assets);
    const published = query.data?.versions.find((version) => version.id === versionId);
    const remoteDraft = versionId ? published && { files: published.files, revision: published.draftRevision } : query.data?.draft;
    const readOnly = script.builtin || Boolean(versionId);
    const currentFiles = files || remoteDraft?.files;
    let manifest: ReturnType<typeof scriptManifest> | undefined, inputs: ParameterControl[] = [], packageError = "";
    if (currentFiles) try { manifest = scriptManifest(currentFiles); inputs = JSON.parse(currentFiles[manifest.inputs]); } catch (failure) { packageError = failure instanceof Error ? failure.message : String(failure); }
    const activeFile = currentFiles?.[file] !== undefined ? file : manifest?.entry || file;
    const latest = query.data?.versions.find((version) => version.id === query.data?.script.adapterVersionId);
    const description = manifest ? manifest.description : script.description;
    const fileDirty = Boolean(files && !dequal(files, remoteDraft?.files));
    const dirty = fileDirty || metadata.formState.isDirty;
    useEffect(() => { if (!readOnly && metadata.formState.isDirty && !files && remoteDraft) { setFiles({ ...remoteDraft.files }); setRevision(remoteDraft.revision); } }, [metadata.formState.isDirty, files, readOnly, remoteDraft]);
    const reset = useCallback(() => { setFiles(null); setRevision(0); metadata.reset(); }, [metadata]);
    useEditGuard(dirty, reset);
    useEffect(() => { onBusyChange?.(busy || inputEditing); return () => onBusyChange?.(false); }, [busy, inputEditing, onBusyChange]);
    const evidence = useQuery({ queryKey: ["script-evidence", script.id, taskId], queryFn: () => getScriptEvidence(script.id, taskId), enabled: tab === "evidence" });
    useEffect(() => { const refresh = (event: Event) => { const topic = (event as CustomEvent<string>).detail; if (!topic || topic === "all") void query.refetch(); if (!topic || topic === "all" || topic === "tasks") void client.invalidateQueries({ queryKey: ["script-evidence", script.id] }); }; window.addEventListener("server-changed", refresh); return () => window.removeEventListener("server-changed", refresh); }, [script.id]);
    const change = (next: Record<string, string>) => { if (readOnly || busy) return; if (!files) setRevision(remoteDraft?.revision || 0); setFiles(next); setPreviewResult(null); };
    const busyForm = busy || inputEditing;
    const applyMetadata = (values: Record<string, any>) => ({ ...manifest, name: values.name, description: values.description, phases: values.phases, features: { tools: values.tools, streaming: values.streaming }, auth: { type: values.authType, ...(values.authType === "header" ? { header: values.authHeader, prefix: values.authPrefix } : {}) } });
    const workingFiles = async () => { if (inputEditing) throw new Error(t("modelScripts.finishInput")); if (!currentFiles) throw new Error(t("modelScripts.notFound")); if (!metadata.formState.isDirty) return currentFiles; let values; try { values = await validateForm(metadata); } catch { setTab("metadata"); throw new Error(t("modelScripts.metadataInvalid")); } return { ...currentFiles, "script.json": JSON.stringify(applyMetadata(values), null, 2)+"\n" }; };
    const run = async (action: () => Promise<void>) => { if (operation.current) return; operation.current = true; setBusy(true); setError(""); const assertSession = captureSession(); try { await action(); assertSession(); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); throw failure; } finally { operation.current = false; setBusy(false); } };
    const save = () => run(async () => { const nextFiles = await workingFiles(); const saved = await saveScriptDraft(script.id, { adapterId: script.id, revision: files ? revision : query.data!.draft.revision, files: nextFiles, parameters: inputs }); client.setQueryData(["model-script", script.id], { ...query.data, draft: saved }); reset(); await query.refetch(); await client.invalidateQueries({ queryKey: ["model-scripts"] }); notify.success(t("modelScripts.saved")); });
    const safe = (action: () => Promise<unknown>) => { void action().catch((failure) => notify.error(failure instanceof Error ? failure.message : String(failure))); };
    const publish = () => confirm({ title: t("modelScripts.publish"), content: t("modelScripts.publishHint"), onConfirm: () => run(async () => { const version = await publishModelScript(script.id, query.data!.draft.revision, query.data!.script.version); await query.refetch(); await client.invalidateQueries({ queryKey: ["model-scripts"] }); await onPublished?.(version); notify.success(t("modelScripts.published")); }) });
    const importFile = async (selected?: File) => { if (!selected || readOnly || busyForm) return; const assertSession = captureSession(); try { const next = await importScriptPackage(selected); assertSession(); if (scriptManifest(next).capability !== script.capability) throw new Error(t("modelScripts.capabilityFixed")); const replace = () => { assertSession(); metadata.reset(); change(next); setTab("code"); setFile(scriptManifest(next).entry); }; if (dirty) confirm({ title: t("ui.discardTitle"), content: t("ui.discardDescription"), onConfirm: replace }); else replace(); } catch (failure) { notify.error(failure instanceof Error ? failure.message : String(failure)); } };
    const brief = async () => `${t("modelScripts.aiBrief", { capability: script.capability, id: script.id, model: modelContext?.model || "—", baseUrl: modelContext?.baseUrl || "—" })}\n\n${JSON.stringify({ contract: contract.data, files: await workingFiles() }, null, 2)}`;
    const selectVersion = (next: string) => { if (next === versionId) return; const select = () => { reset(); setVersionId(next); setPreviewResult(null); }; if (dirty) confirm({ title: t("ui.discardTitle"), content: t("ui.discardDescription"), onConfirm: select }); else select(); };
    const askAssistant = async () => { await useAgentSkillStore.getState().loadSkills(); const skill = useAgentSkillStore.getState().skills.find((entry) => entry.name === "model-api-adapter"); if (!skill) throw new Error(t("modelScripts.skillMissing")); const agent = useAgentStore.getState(); const select = () => { useAgentSkillStore.getState().selectSkill(skill, t("modelScripts.assistantPrompt", { id: script.id, model: modelContext?.model || "—" })); useAgentStore.setState({ activeTab: "chat" }); agent.openPanel(); onAssistantOpen?.(); }; if (agent.prompt.trim()) confirm({ title: t("modelScripts.replacePrompt"), content: t("modelScripts.replacePromptHint"), onConfirm: select }); else select(); };
    const actions = <><Button variant="outline" size="icon" title={t("workspace.refresh")} aria-label={t("workspace.refresh")} loading={query.isFetching} disabled={busyForm} onClick={() => void query.refetch()}><RefreshCw /></Button>{!readOnly ? <><Button variant="default" icon={<Save />} disabled={inputEditing || !dirty || Boolean(packageError)} loading={busy} onClick={() => safe(save)}>{t("modelScripts.saveDraft")}</Button><Button variant="default" icon={<Send />} disabled={busyForm || dirty || !query.data || Boolean(packageError)} title={dirty ? t("modelScripts.saveBeforePublish") : undefined} onClick={publish}>{t("modelScripts.publish")}</Button></> : null}</>;
    return <section className="min-w-0 space-y-4" data-canvas-shortcuts-ignore>
        {onBack ? <PageHeader title={<span className="flex min-w-0 items-center gap-3"><Button variant="outline" size="icon" disabled={busyForm} title={t("modelScripts.back")} aria-label={t("modelScripts.back")} onClick={onBack}><ArrowLeft /></Button><span className="min-w-0 break-words">{script.name}</span></span>} actions={actions} /> : null}
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2"><Badge>{t(script.capability === "audio" ? "modelScripts.tts" : `workspace.${script.capability}`)}</Badge><Badge>{t(script.builtin ? "modelScripts.builtin" : "modelScripts.custom")}</Badge>{readOnly ? <Badge>{t("modelScripts.readOnlyLabel")}</Badge> : null}</div>
                {!onBack ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
            </div>
            {description ? <p className="max-w-3xl break-words text-sm leading-6 text-muted-foreground">{description}</p> : null}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="text-sm font-medium">{t("modelScripts.version")}</span>
                <Select value={versionId || "draft"} disabled={busyForm || !query.data || query.isError} onValueChange={(next) => selectVersion(next === "draft" ? "" : next)}><SelectTrigger className="w-full sm:w-72" aria-label={t("modelScripts.version")}><SelectValue /></SelectTrigger><SelectContent>
                    <SelectItem value="draft">{script.builtin ? latest ? t("modelScripts.latestRevision", { revision: latest.draftRevision }) : t("modelScripts.latest") : query.data ? t("modelScripts.revision", { revision: files && !versionId ? revision : query.data.draft.revision }) : t("modelScripts.draft")}</SelectItem>
                    {(query.data?.versions || []).map((version) => <SelectItem key={version.id} value={version.id}>{t("modelScripts.publishedRevision", { revision: version.draftRevision })} · {new Date(version.createdAt).toLocaleString(i18n.resolvedLanguage)}{version.id === latest?.id ? ` · ${t("modelScripts.latest")}` : ""}</SelectItem>)}
                    {versionId && !published ? <SelectItem value={versionId} disabled>{t("modelScripts.versionMissing")}</SelectItem> : null}
                </SelectContent></Select>
                <p className="min-w-0 basis-full text-xs leading-5 text-muted-foreground xl:flex-1 xl:basis-0">{t(versionId ? "modelScripts.publishedReadonly" : script.builtin ? "modelScripts.readonly" : "modelScripts.lifecycle")}</p>
            </div>
        </div>
        {query.error ? <Notice type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>{t("workspace.retry")}</Button>} /> : null}
        {error || packageError ? <Notice type="error" title={error || packageError} /> : null}
        {dirty && revision !== remoteDraft?.revision ? <Notice type="warning" title={t("modelScripts.remoteChanged")} action={<Button onClick={() => confirm({ title: t("ui.discardTitle"), content: t("ui.discardDescription"), onConfirm: async () => { const result = await query.refetch(); if (result.error) throw result.error; reset(); } })}>{t("workspace.reload")}</Button>} /> : null}
        {versionId && !query.isLoading && !query.error && !published ? <Notice type="error" title={t("modelScripts.versionMissing")} /> : null}
        {currentFiles ? <Tabs.Root key={versionId || "draft"} value={tab} onValueChange={setTab} className="min-w-0">
            <div className="thin-scrollbar mb-4 min-w-0 overflow-x-auto overflow-y-hidden pb-2"><Tabs.List aria-label={t("modelScripts.title")} className="inline-flex w-max items-center gap-1 rounded-xl border border-border bg-card p-1">
                {editorTabs.map(({ key, label, icon: Icon }) => <Tabs.Trigger key={key} value={key} disabled={busyForm && key !== tab} className="inline-flex h-8 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-accent data-[state=active]:text-card-foreground data-[state=active]:shadow-sm disabled:pointer-events-none disabled:opacity-50"><Icon className="size-4 text-foreground" />{t(label)}</Tabs.Trigger>)}
            </Tabs.List></div>
            <Tabs.Content value="inputs" forceMount className="outline-none focus-visible:ring-2 focus-visible:ring-ring">{manifest ? <InputDefinitionEditor onEditorChange={setInputEditing} value={inputs} readOnly={readOnly || busy} onChange={(next) => change({ ...currentFiles, [manifest!.inputs]: JSON.stringify(next, null, 2)+"\n" })} /> : null}</Tabs.Content>
            <Tabs.Content value="code" className="space-y-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <div className="flex flex-wrap items-start justify-between gap-3"><p className="max-w-3xl text-xs leading-5 text-muted-foreground">{t("modelScripts.packageHint")}</p>{!readOnly ? <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={busyForm} onClick={() => importInput.current?.click()}>{t("modelScripts.importFiles")}</Button><Button variant="default" size="sm" icon={<FilePlus2 />} disabled={busyForm} onClick={() => setFileAction({})}>{t("modelScripts.addFile")}</Button><input ref={importInput} hidden type="file" accept=".zip" onChange={(event) => { void importFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></div> : null}</div>
                <div className="grid min-w-0 gap-4 md:grid-cols-[180px_minmax(0,1fr)]"><nav className="thin-scrollbar max-h-[420px] min-w-0 space-y-1 overflow-x-hidden overflow-y-auto" aria-label={t("modelScripts.files")}><p className="px-2 pb-1 text-xs font-medium text-muted-foreground">{t("modelScripts.files")}</p>{Object.keys(currentFiles).sort().map((name) => <Button key={name} variant="ghost" size="sm" className={`w-full justify-start truncate font-mono ${activeFile === name ? "bg-accent" : ""}`} title={name} onClick={() => setFile(name)}>{name}</Button>)}</nav><div className="min-w-0 space-y-2"><div className="flex min-h-7 flex-wrap items-center justify-between gap-2"><span className="min-w-0 truncate font-mono text-xs">{activeFile}</span>{!readOnly && activeFile !== "script.json" && activeFile !== manifest?.entry && activeFile !== manifest?.inputs && currentFiles[activeFile] !== undefined ? <div className="flex gap-2"><Button size="sm" variant="outline" disabled={busyForm} onClick={() => setFileAction({ source: activeFile })}>{t("workspace.rename")}</Button><Button size="sm" variant="outline" disabled={busyForm} data-destructive onClick={() => confirm({ title: t("modelScripts.deleteFile"), content: activeFile, destructive: true, onConfirm: () => { const next = { ...currentFiles }; delete next[activeFile]; change(next); setFile(manifest?.entry || "adapter.js"); } })}>{t("common.delete")}</Button></div> : null}</div><div className="overflow-hidden rounded-lg border border-border"><CodeMirror key={activeFile} value={currentFiles[activeFile] || ""} height="420px" extensions={activeFile.endsWith(".js") ? [javascript()] : []} theme={theme} readOnly={readOnly || busy || currentFiles[activeFile] === undefined || activeFile === "script.json" && metadata.formState.isDirty} onChange={(content) => change({ ...currentFiles, [activeFile]: content })} /></div></div></div>
            </Tabs.Content>
            <Tabs.Content value="metadata" forceMount className="outline-none focus-visible:ring-2 focus-visible:ring-ring">{manifest ? <EditorForm className="max-w-3xl" form={metadata} key={`${versionId}:${currentFiles["script.json"]}`} initialValues={{ ...manifest, tools: manifest.features?.tools || false, streaming: manifest.features?.streaming || false, authType: manifest.auth?.type || "bearer", authHeader: manifest.auth?.header || "", authPrefix: manifest.auth?.prefix || "" }} disabled={readOnly || busy} onSubmit={(values) => { change({ ...currentFiles, "script.json": JSON.stringify(applyMetadata(values), null, 2)+"\n" }); metadata.reset(values); }}>
                <div className="grid gap-4 sm:grid-cols-2"><Field name="name" label={t("workspace.name")} schema={z.string().trim().min(1)}><Input /></Field><Field name="authType" label={t("modelScripts.auth")}><Choice options={["bearer", "header", "none"].map((value) => ({ value, label: t(`modelScripts.authTypes.${value}`) }))} /></Field><Field className="sm:col-span-2" name="description" label={t("modelScripts.scriptDescription")}><Textarea /></Field><Field className="sm:col-span-2" name="phases" label={t("modelScripts.phases")}><Choice multiple options={["validate", "submit", "query", "stream", "result", "usage", "cancel"].map((value) => ({ value, label: value }))} /></Field>{authType === "header" ? <><Field name="authHeader" label={t("modelScripts.authHeader")}><Input /></Field><Field name="authPrefix" label={t("modelScripts.authPrefix")}><Input /></Field></> : null}</div>
                <div className="grid gap-4 sm:grid-cols-2">{script.capability === "text" ? <Field className="flex items-center justify-between gap-4 space-y-0" name="tools" label={t("modelScripts.tools")} checked><Switch /></Field> : null}<Field className="flex items-center justify-between gap-4 space-y-0" name="streaming" label={t("modelScripts.streaming")} checked><Switch /></Field></div>
                {!readOnly ? <div className="flex justify-end"><Button variant="default" type="submit">{t("modelScripts.applyMetadata")}</Button></div> : null}
            </EditorForm> : null}</Tabs.Content>
            <Tabs.Content value="preview" className="space-y-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("modelScripts.previewHint")}</p><div className="flex flex-wrap gap-2"><Button variant="outline" icon={<CheckCheck />} disabled={busyForm || Boolean(packageError)} onClick={() => safe(() => run(async () => { const result = await checkModelScript(await workingFiles()); setPreviewResult(result); notify.success(t("modelScripts.checked")); }))}>{t("modelScripts.check")}</Button><Button variant="outline" icon={<Eye />} disabled={busyForm || Boolean(packageError)} onClick={() => { sample.reset({ model: modelContext?.model || "", baseUrl: modelContext?.baseUrl || "", prompt: "", params: {}, references: [] }); setPreview(true); }}>{t("modelScripts.previewRequest")}</Button><Button variant="default" icon={<FlaskConical />} disabled={busyForm || dirty || Boolean(packageError)} title={dirty ? t("modelScripts.saveBeforeTest") : undefined} onClick={() => setTest(true)}>{t("modelScripts.test")}</Button></div>{previewResult ? <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border p-3 text-xs leading-6">{JSON.stringify(previewResult, null, 2)}</pre> : null}
            </Tabs.Content>
            <Tabs.Content value="guide" className="space-y-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"><p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("modelScripts.guideHint")}</p><div className="flex flex-wrap gap-2">{!readOnly ? <Button variant="default" icon={<Sparkles />} disabled={dirty || busyForm} onClick={() => safe(askAssistant)}>{t("modelScripts.askAssistant")}</Button> : null}<Button variant="outline" icon={<Copy />} disabled={!contract.data || busyForm} onClick={() => safe(async () => copy(await brief()))}>{t("modelScripts.copyBrief")}</Button></div>{contract.error ? <Notice type="error" title={contract.error.message} action={<Button onClick={() => void contract.refetch()}>{t("workspace.retry")}</Button>} /> : null}{contract.data ? <div className="space-y-3">{Object.entries(contract.data).map(([key, content]) => content == null || typeof content === "string" && !content.trim() ? <div key={key} className="rounded-lg border border-border px-3 py-2 text-sm font-medium">{key}</div> : <Collapsible.Root key={key} className="group rounded-lg border border-border px-3 py-2">
                <Collapsible.Trigger asChild>
                    <button type="button" className="flex w-full items-center justify-between gap-3 rounded-sm text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{key}<ChevronDown className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" /></button>
                </Collapsible.Trigger>
                <Collapsible.Content><pre className="mt-2 overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-muted-foreground">{typeof content === "string" ? content : JSON.stringify(content, null, 2)}</pre></Collapsible.Content>
            </Collapsible.Root>)}</div> : null}</Tabs.Content>
            <Tabs.Content value="versions" className="space-y-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"><p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("modelScripts.versionHint")}</p><div className="space-y-3">{query.data?.versions.map((version) => <Collapsible.Root key={version.id} defaultOpen={version.id === versionId} className="group rounded-lg border border-border p-3">
                <div className="flex items-center gap-3">
                <Collapsible.Trigger asChild>
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="min-w-0 flex-1"><span className="block font-medium">{t("modelScripts.publishedRevision", { revision: version.draftRevision })}</span><span className="text-xs text-muted-foreground">{new Date(version.createdAt).toLocaleString(i18n.resolvedLanguage)}</span></span>{version.id === latest?.id ? <Badge>{t("modelScripts.latest")}</Badge> : null}<ChevronDown className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" /></button>
                </Collapsible.Trigger>
                <Button variant="outline" size="sm" disabled={busyForm || versionId === version.id} onClick={() => selectVersion(version.id)}>{t("modelScripts.view")}</Button>
                </div>
                <Collapsible.Content><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(version.files, null, 2)}</pre></Collapsible.Content>
            </Collapsible.Root>)}</div>{query.data && !query.data.versions.length ? <p className="py-4 text-sm text-muted-foreground">{t("modelScripts.noVersions")}</p> : null}<div className="space-y-2"><h3 className="text-sm font-medium">{t("modelScripts.linkedModels")}</h3>{query.data?.models.map((model) => {
                const version = query.data?.versions.find((entry) => entry.id === model.adapterVersionId);
                return <div key={model.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span className="min-w-0 break-words">{model.name}<span className="ml-2 text-xs text-muted-foreground">{model.model}</span></span><span className="text-xs text-muted-foreground">{version ? t("modelScripts.publishedRevision", { revision: version.draftRevision }) : model.adapterVersionId}</span></div>;
            })}{query.data && !query.data.models.length ? <p className="text-sm text-muted-foreground">{t("modelScripts.noLinkedModels")}</p> : null}</div></Tabs.Content>
            <Tabs.Content value="evidence" className="space-y-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"><p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("modelScripts.evidenceHint")}</p><div className="flex flex-wrap items-center gap-2"><Choice className="w-full sm:w-96" aria-label={t("modelScripts.evidence")} placeholder={t("modelScripts.response.none")} value={taskId || evidence.data?.task?.id} options={evidence.data?.tasks.map((task) => ({ value: task.id, label: `r${task.debugRevision} · ${new Date(task.createdAt).toLocaleString(i18n.resolvedLanguage)} · ${task.status}` }))} onChange={setTaskId} /><Button variant="outline" size="icon" title={t("workspace.refresh")} aria-label={t("workspace.refresh")} loading={evidence.isFetching} onClick={() => void evidence.refetch()}><RefreshCw /></Button></div>{evidence.error ? <Notice type="error" title={evidence.error.message} action={<Button onClick={() => void evidence.refetch()}>{t("workspace.retry")}</Button>} /> : null}{evidence.data ? <><p className="text-xs text-muted-foreground">{t(`modelScripts.response.${evidence.data.responseState}`)}</p>{evidence.data.task ? <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border p-3 text-xs leading-6">{JSON.stringify(evidence.data, null, 2)}</pre> : null}</> : null}</Tabs.Content>
        </Tabs.Root> : !query.error && !(versionId && !published && !query.isLoading) ? <p role="status" className="py-8 text-sm text-muted-foreground">{t("settings.loading")}</p> : null}
        <Dialog title={t(fileAction?.source ? "modelScripts.renameFile" : "modelScripts.addFile")} open={Boolean(fileAction)} onClose={() => setFileAction(null)} footer={<Button variant="default" icon={<Save />} type="submit" form="script-file">{t("common.save")}</Button>}>{fileAction ? <EditorForm id="script-file" initialValues={{ path: fileAction.source || "lib/helper.js" }} onSubmit={(values) => { const name = values.path, source = fileAction.source; if (!currentFiles) return; if (name !== source && currentFiles[name] !== undefined) throw new Error(t("modelScripts.fileExists")); const next = { ...currentFiles, [name]: source ? currentFiles[source] : name.endsWith(".js") ? "export const helper = value => value;\n" : "{}\n" }; if (source && source !== name) delete next[source]; change(next); setFile(name); setFileAction(null); }}><Field name="path" label={t("modelScripts.filePath")} description={t("modelScripts.renameHint")} schema={z.string().refine(validScriptFile, t("modelScripts.invalidFilePath"))}><Input /></Field></EditorForm> : null}</Dialog>
        <Dialog title={t("modelScripts.previewRequest")} open={preview} busy={busy} onClose={() => setPreview(false)} width={720} footer={<Button variant="default" icon={<Eye />} type="submit" form="script-preview" loading={busy}>{t("modelScripts.previewRequest")}</Button>}>
            <EditorForm id="script-preview" form={sample} onSubmit={(values) => run(async () => { const media = (values.references as string[]).map((id) => { const asset = assets.find((entry) => entry.id === id); if (!asset) throw new Error(t("errors.assetMissing")); return { assetId: id, role: asset.kind }; }); const result = await checkModelScript(await workingFiles(), { model: values.model, prompt: values.prompt, params: values.params, images: media.filter((asset) => asset.role === "image"), videos: media.filter((asset) => asset.role === "video"), audios: media.filter((asset) => asset.role === "audio"), messages: [], tools: [], upstreamId: "" }, values.baseUrl); setPreviewResult(result); sample.reset(values); setPreview(false); })}>
                <Field name="model" label={t("workspace.providerModelId")} schema={z.string().min(1)}><Input /></Field><Field name="baseUrl" label={t("workspace.httpsEndpoint")}><Input placeholder="https://api.example.com/v1" /></Field><Field name="prompt" label={t("modelScripts.testPrompt")}><Textarea /></Field><Field name="params"><ModelInputFields controls={inputs} assetPrefix={false} onChange={() => undefined} /></Field><Field name="references" label={t("modelScripts.referenceAssets")}><Choice multiple options={assets.filter((asset) => asset.kind !== "text" && asset.saveState === "saved").map((asset) => ({ label: asset.title, value: asset.id }))} /></Field><p className="text-xs text-muted-foreground">{t("modelScripts.previewAssetsHint")}</p>
            </EditorForm>
        </Dialog>
        {test ? <ModelScriptTestDialog script={query.data?.script || script} controls={inputs} revision={readOnly ? 0 : query.data?.draft.revision} versionId={versionId} onClose={() => setTest(false)} onQueued={(id) => { setTaskId(id); setTab("evidence"); }} /> : null}
    </section>;
}
