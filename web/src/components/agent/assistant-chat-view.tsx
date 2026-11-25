import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Choice } from "@/components/ui/choice";
import { Notice, Spinner } from "@/components/ui/display";
import { ModelPicker } from "@/components/model-picker";
import { ModelParameters } from "@/components/model-parameters";
import { canvasThemes } from "@/lib/canvas-theme";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/use-agent-store";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { AgentChatTimeline } from "./agent-chat";
import { AgentChatComposer } from "./agent-chat-composer";
import { useAssistantSession } from "./assistant-session";

const conversationColumn = "mx-auto w-full max-w-3xl";

export function AssistantChatView({ visible = true, wide = false }: { visible?: boolean; wide?: boolean }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const projects = useCanvasStore((state) => state.projects);
    const prompt = useAgentStore((state) => state.prompt);
    const attachments = useAgentStore((state) => state.attachments);
    const skills = useAgentSkillStore((state) => state.skills);
    const selectedSkillName = useAgentSkillStore((state) => state.selectedSkill?.name);
    const { activeId, snapshot, running, reportedTurn, busy, editingDisabled, error, loading, loadingThreads, submitting, uploading, stopping, questionReply, target, selectTarget, config, selectedModel, modelParameters, showReasoning, reload, dismissError, send, stop, addFiles } = useAssistantSession();
    const disabled = !visible || editingDisabled;
    const column = wide ? conversationColumn : undefined;

    return <>
        {error || (loading && !snapshot) || reportedTurn?.error ? <div className={cn("thin-scrollbar max-h-[30%] shrink-0 space-y-2 overflow-y-auto px-4 pt-2", column)}>
            {error ? <Notice type="error" title={error} className="break-words" action={<Button size="sm" disabled={loading || loadingThreads} onClick={reload}>{t("workspace.retry")}</Button>} onClose={dismissError} /> : null}
            {loading && !snapshot ? <div className="flex justify-center pt-1"><Spinner size="small" /></div> : null}
            {reportedTurn?.error ? <Notice type={reportedTurn.status === "failed" || reportedTurn.status === "interrupted" ? "error" : "warning"} title={reportedTurn.status === "partial" ? t("agent.steps.partialReply") : reportedTurn.error} description={reportedTurn.status === "partial" ? reportedTurn.error : undefined} /> : null}
        </div> : null}
        <AgentChatTimeline visible={visible} contentClassName={column} theme={theme} sending={submitting} turnStatus={running?.status} turnId={running?.id} questionReply={questionReply} stopping={stopping} empty={!error && (!activeId || snapshot) ? <div className="flex flex-wrap items-center justify-center gap-2 text-center">
            <h2 className={cn("mb-1 w-full text-xl font-medium tracking-tight", wide && "sm:text-2xl")}>{t("agent.drawer.emptyTitle")}</h2>
            {skills.filter((skill) => skill.enabled).slice(0, 5).map((skill) => <Button key={skill.path} size="sm" className="max-w-full rounded-full" disabled={disabled} aria-pressed={selectedSkillName === skill.name} onClick={() => useAgentSkillStore.getState().selectSkill(skill)}><span aria-hidden className="text-muted-foreground">/</span><span className="truncate">{skill.interface?.displayName || skill.name}</span></Button>)}
        </div> : null} />
        <div className={cn("min-w-0 shrink-0", column)}>
            <div className="flex items-center gap-1.5 px-4 text-xs" data-base-ui-swipe-ignore>
                <span className="shrink-0 text-muted-foreground">{t("workspace.targetProject")}</span>
                <Choice compact borderless aria-label={t("workspace.targetProject")} className="w-fit min-w-0 max-w-full px-2" value={running ? running.projectId || "" : target} disabled={disabled} onChange={selectTarget} options={[{ value: "", label: t("workspace.noProject") }, ...projects.map((project) => ({ value: project.id, label: project.title }))]} />
            </div>
            <AgentChatComposer wide={wide} visible={visible} theme={theme} prompt={prompt} attachments={attachments} sending={busy} stopping={stopping} disabled={disabled} uploading={uploading} targetProjectId={target}
                placeholder={t("agent.drawer.placeholder")} onPromptChange={(prompt) => useAgentStore.setState({ prompt })} onSubmit={() => void send()} onStop={running ? () => void stop() : undefined}
                onAddFiles={addFiles} onRemoveAttachment={(id) => useAgentStore.setState((state) => ({ attachments: state.attachments.filter((item) => item.id !== id) }))}
                model={<ModelPicker config={config} value={selectedModel} capability="text" toolsOnly disabled={disabled} className="min-w-0 gap-1 rounded-lg px-2 text-xs" onChange={(model) => useAgentStore.setState({ model })} />}
                reasoning={showReasoning ? <ModelParameters key={selectedModel} config={config} model={selectedModel} value={modelParameters[selectedModel]} compact inline filterControls={(control) => control.key === "reasoning_effort"} disabled={disabled} onChange={(value) => useAgentStore.setState((state) => ({ modelParameters: { ...state.modelParameters, [selectedModel]: value } }))} /> : null} />
        </div>
    </>;
}
