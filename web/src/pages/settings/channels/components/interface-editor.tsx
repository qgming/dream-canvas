import { useTranslation } from "react-i18next";
import appI18n from "@/i18n";
import { PageHeader } from "@/components/layout/page-header";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Notice as Alert } from "@/components/ui/display";
import { useFeedback } from "@/hooks/use-feedback";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";

import { Tabs } from "@/components/ui/tabs";
import { Badge as Tag } from "@/components/ui/display";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { useCallback, useRef, useState } from "react";
import { useEditGuard } from "@/hooks/use-edit-guard";

import { getInterface, publishInterface, saveInterface, type InterfaceDraft, type InterfaceScripts, type ServerModel } from "@/services/api/channels";
import { useThemeStore } from "@/stores/use-theme-store";
import { captureSession } from "@/services/api/client";


export function InterfaceEditor({ model, onClose, onPublished }: { model: ServerModel; onClose: () => void; onPublished: () => Promise<void> }) {
    useTranslation();
    const { notify, confirm } = useFeedback();

    const labels: Record<keyof InterfaceScripts, string> = { submit: appI18n.t("workspace.submit"), query: appI18n.t("workspace.query"), result: appI18n.t("workspace.parseResult"), usage: appI18n.t("workspace.parseUsage"), cancel: appI18n.t("workspace.cancel") };
    const queryClient = useQueryClient();
    const theme = useThemeStore((state) => state.theme);
    const query = useQuery({ queryKey: ["interface", model.id], queryFn: () => getInterface(model.id) });
    const [edited, setEdited] = useState<InterfaceDraft | null>(null);
    const [parameters, setParameters] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const savingRef = useRef(false);
    const [parameterError, setParameterError] = useState("");
    const [saveError, setSaveError] = useState("");
    const parameterInput = useRef<HTMLTextAreaElement>(null);
    const [tab, setTab] = useState("submit");
    const draft = edited || query.data?.draft;
    const dirty = Boolean(edited || parameters !== null);
    const reset = useCallback(() => { setEdited(null); setParameters(null); }, []);
    useEditGuard(dirty, reset);
    const save = async () => {
        if (!draft || savingRef.current) return;
        let parsedParameters = draft.parameters;
        if (parameters !== null) {
            try { parsedParameters = JSON.parse(parameters); if (!Array.isArray(parsedParameters)) throw new Error(); }
            catch { setParameterError(appI18n.t("ui.arrayRequired")); setTab("parameters"); requestAnimationFrame(() => parameterInput.current?.focus()); return; }
        }
        const assertSession = captureSession();
        savingRef.current = true; setBusy(true); setParameterError(""); setSaveError("");
        try {
            const saved = await saveInterface(model.id, { ...draft, parameters: parsedParameters });
            assertSession();
            queryClient.setQueryData(["interface", model.id], { ...query.data, draft: saved });
            setEdited(null); setParameters(null); notify.success(appI18n.t("workspace.interfaceSaved"));
        } catch (error) { const text = error instanceof Error ? error.message : appI18n.t("workspace.saveFileFailed"); setSaveError(text); notify.error(text); }
        finally { savingRef.current = false; setBusy(false); }
    };
    const publish = () => {
        if (!draft) return;
        const assertSession = captureSession();
        confirm({ title: appI18n.t("workspace.publishTitle"), content: appI18n.t("workspace.publishDescription"), confirmText: appI18n.t("workspace.publishUnverified"), cancelText: appI18n.t("workspace.cancel"), onConfirm: async () => {
            try { setBusy(true); assertSession(); await publishInterface(model.id, draft.revision, model.version); assertSession(); await Promise.all([onPublished(), query.refetch()]); notify.success(appI18n.t("workspace.interfacePublished")); }
            catch (error) { notify.error(error instanceof Error ? error.message : appI18n.t("workspace.publishFailed")); throw error; }
            finally { setBusy(false); }
        } });
    };
    const close = () => dirty ? confirm({ title: appI18n.t("workspace.discardInterface"), confirmText: appI18n.t("workspace.discard"), cancelText: appI18n.t("workspace.keepEditing"), onConfirm: onClose }) : onClose();
    return (
        <section className="space-y-6" data-canvas-shortcuts-ignore>
            <PageHeader title={appI18n.t("workspace.interfaceScripts")} description={<>{model.name} · {appI18n.t("workspace.interfaceSubtitle")}</>} actions={<>
                <Button variant="ghost" disabled={busy} onClick={close}>{appI18n.t("workspace.backToChannels")}</Button>
                <Button onClick={() => void save()} disabled={!draft || !dirty} loading={busy}>{appI18n.t("workspace.saveDraft")}</Button>
                <Button variant="default" disabled={!draft?.revision || dirty || busy} onClick={publish}>{appI18n.t("workspace.publishVersion")}</Button>
            </>} />
            <Alert type="info" title={appI18n.t("workspace.noProviderFees")} description={appI18n.t("workspace.interfaceBoundary")} />
            {query.error ? <Alert type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>{appI18n.t("workspace.retry")}</Button>} /> : null}
            {saveError ? <Alert type="error" title={saveError} /> : null}
            {query.isLoading ? <p role="status" className="py-8 text-sm text-muted-foreground">{appI18n.t("workspace.interfaceLoading")}</p> : null}
            {draft ? <Tabs value={tab} onValueChange={setTab} items={[
                ...Object.entries(labels).map(([key, label]) => ({ key, label, children: <div className="overflow-hidden rounded-lg border border-border"><CodeMirror value={draft.scripts[key as keyof InterfaceScripts] || ""} height="420px" extensions={[javascript()]} theme={theme} readOnly={busy} onChange={(value) => setEdited({ ...draft, scripts: { ...draft.scripts, [key]: value } })} /></div> })),
                { key: "parameters", label: appI18n.t("workspace.parameters"), children: <div className="space-y-2"><Textarea className="font-mono text-xs leading-5" ref={parameterInput} aria-label={appI18n.t("workspace.parameters")} rows={18} spellCheck={false} disabled={busy} aria-invalid={Boolean(parameterError)} aria-describedby={parameterError ? "interface-parameter-error" : undefined} value={parameters ?? JSON.stringify(draft.parameters, null, 2)} onChange={(event) => { setParameters(event.target.value); setParameterError(""); }} />{parameterError ? <p id="interface-parameter-error" role="alert" className="text-xs text-destructive">{parameterError}</p> : null}</div> },
                { key: "versions", label: appI18n.t("workspace.versions"), children: <div className="space-y-3">{query.data?.versions.length ? query.data.versions.map((version) => <details key={version.id} className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm">{appI18n.t("workspace.draftVersion")} {version.draftRevision} · {new Date(version.createdAt).toLocaleString(appI18n.resolvedLanguage)} <Tag>{version.verified ? appI18n.t("workspace.verified") : appI18n.t("workspace.unverified")}</Tag></summary><pre className="mt-3 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ scripts: version.scripts, parameters: version.parameters }, null, 2)}</pre></details>) : <p className="py-8 text-sm text-muted-foreground">{appI18n.t("workspace.noVersions")}</p>}</div> },
            ]} /> : null}
        </section>
    );
}
