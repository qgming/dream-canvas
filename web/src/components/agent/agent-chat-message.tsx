import appI18n from "@/i18n";
import { useEffect, useState, type ReactNode } from "react";
import { Collapsible } from "@animate-ui/react/primitives/radix-ui";
import { motionTokens, toCssTiming, useShouldReduceMotion } from "@animate-ui/react/utils/motion";
import { useFeedback } from "@/hooks/use-feedback";
import { Button } from "@/components/ui/button";
import { MediaPreview } from "@/components/ui/media-preview";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Popover, Tooltip } from "@/components/ui/popover";
import { Brain, CheckCircle2, ChevronDown, ChevronRight, Circle, CircleAlert, Copy, FilePenLine, FileText, ListChecks, LoaderCircle, Search, TerminalSquare, Wrench, XCircle } from "lucide-react";
import { Streamdown, type LinkSafetyModalProps } from "streamdown";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { useCopyText } from "@/hooks/use-copy-text";
import { canvasThemes } from "@/lib/canvas-theme";
import { useAgentStore, type AgentCanvasReference, type AgentChatItem, type AgentSkillReference } from "@/stores/use-agent-store";
import { resolveAgentMessageAssetUrl } from "@/services/api/assistant-skills";
import { AgentCanvasReferencePreview, canvasReferenceIcon, canvasReferenceKindLabel } from "./agent-canvas-reference-preview";
import { agentInlineTokenClass, agentInlineTokenIconClass, agentInlineTokenMediaClass, agentReferenceMarker, parseAgentInlineTokens } from "./agent-chat-inline-tokens";

const streamdownProps = () => ({
    className: "agent-streamdown",
    controls: { code: { copy: true, download: false }, table: { copy: true, download: false, fullscreen: false } },
    linkSafety: { enabled: true, renderModal: (props: LinkSafetyModalProps) => <AgentLinkModal {...props} /> },
    lineNumbers: false,
    translations: {
        close: tr("close"), copied: tr("copied"), copyCode: tr("copyCode"), copyLink: tr("copyLink"), externalLinkWarning: tr("externalWarning"), openExternalLink: tr("openExternal"), openLink: tr("continueOpen"),
    },
} as const);
const streamdownAnimation = { ...toCssTiming(motionTokens.transition.fade), stagger: 0, sep: "word" } as const;

function AgentLinkModal({ isOpen, onClose, onConfirm, url }: LinkSafetyModalProps) {
    const { t } = useTranslation();
    const copyText = useCopyText();
    const localPath = localFilePath(url);
    return (
        <AlertDialog open={isOpen} onClose={onClose} title={t(localPath ? "agent.notify.openLocal" : "agent.notify.openExternal")} description={t(localPath ? "agent.notify.localDescription" : "agent.notify.externalDescription")} confirmDisabled={Boolean(localPath)} confirmText={localPath ? appI18n.t("workspace.localPath") : t("agent.notify.continueOpen")} onConfirm={() => { onConfirm(); onClose(); }} actions={
                <Button variant="outline" icon={<Copy className="size-4" />} onClick={() => copyText(localPath || url, t(localPath ? "agent.notify.pathCopied" : "agent.notify.linkCopied"))}>
                    {t(localPath ? "agent.notify.copyPath" : "agent.notify.copyLink")}
                </Button>
        }>
            <div className="mt-3 max-h-32 overflow-auto break-all rounded-lg bg-muted px-3 py-2.5 font-mono text-xs leading-5">{localPath || url}</div>
        </AlertDialog>
    );
}

function localFilePath(value: string) {
    let decoded = value;
    try {
        decoded = decodeURI(value);
    } catch {}
    if (decoded.startsWith("file://")) {
        try {
            return decodeURIComponent(new URL(decoded).pathname);
        } catch {
            return "";
        }
    }
    if (/^[A-Za-z]:[\\/]/.test(decoded)) return decoded;
    let pathname = decoded;
    if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
        try {
            const parsed = new URL(decoded);
            if (!["localhost", "127.0.0.1"].includes(parsed.hostname)) return "";
            pathname = parsed.pathname;
        } catch {
            return "";
        }
    }
    return /^\/(?:Users|home|private|tmp|Volumes|var\/folders)\//.test(pathname) ? decodeURIComponent(pathname) : "";
}

export type AgentChatAttachment = { id: string; name: string; url: string };
export type AgentChatMessageItem = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    attachments?: AgentChatAttachment[];
    canvasReferences?: AgentCanvasReference[];
    skill?: AgentSkillReference;
    /** Present while the message is actively streaming; cleared on completion. */
    streamId?: string;
};

export function AgentChatMessage({ item, theme }: { item: AgentChatMessageItem; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    useTranslation();
    const reducedMotion = useShouldReduceMotion();
    const isUser = item.role === "user";
    const isSystem = item.role === "system";
    const color = item.role === "error" ? "var(--destructive)" : item.role === "tool" ? "var(--info)" : theme.node.text;
    if (isSystem) {
        return (
            <div className="flex justify-center text-xs">
                <div className="max-w-[88%] px-3 py-1.5 text-center" style={{ color: theme.node.muted }}>
                    {item.text}
                    {item.meta ? <span className="ml-2 opacity-60">{item.meta}</span> : null}
                </div>
            </div>
        );
    }
    if (item.role === "tool") {
        return <AgentToolCard title={item.title || tr("toolCall")} text={item.text} detail={item.detail} theme={theme} />;
    }
    return (
        <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
            <div
                className={isUser ? "min-w-0 max-w-[82%] py-1 text-right text-sm leading-6" : "min-w-0 w-full text-left text-sm leading-6"}
                style={{ color }}
            >
                {isUser ? (
                    <AgentUserMessageContent text={item.text} references={item.canvasReferences || []} skill={item.skill} theme={theme} />
                ) : (
                    <Streamdown {...streamdownProps()} animated={reducedMotion ? false : streamdownAnimation} isAnimating={!!item.streamId}>{item.text}</Streamdown>
                )}
                {item.attachments?.length ? <AgentMessageAttachments attachments={item.attachments} alignRight={isUser} /> : null}
                {item.meta ? <div className={`mt-1 text-xs tabular-nums opacity-55 ${isUser ? "text-right" : ""}`}>{item.meta}</div> : null}
            </div>
        </div>
    );
}

function AgentUserMessageContent({ text, references, skill, theme }: { text: string; references: AgentCanvasReference[]; skill?: AgentSkillReference; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    useTranslation();
    const tokens = parseAgentInlineTokens(text, references, skill);
    return (
        <div className="whitespace-pre-wrap break-words">
            {tokens.map((token, index) => token.type === "text"
                ? token.value
                : token.type === "skill"
                    ? <AgentSkillMention key={`skill:${index}`} skill={token.skill} theme={theme} />
                    : <AgentCanvasMention key={`${token.reference.nodeId}:${index}`} reference={token.reference} theme={theme} />)}
        </div>
    );
}

function AgentSkillMention({ skill, theme }: { skill: AgentSkillReference; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    useTranslation();
    return <Tooltip title={skill.path}><span tabIndex={0} className={agentInlineTokenClass} style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text }}>/{skill.displayName || skill.name}</span></Tooltip>;
}

function AgentCanvasMention({ reference, theme }: { reference: AgentCanvasReference; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    useTranslation();
    const node = useAgentStore((state) => state.canvasContext?.snapshot.nodes.find((item) => item.id === reference.nodeId));
    const previewUrl = resolveAgentMessageAssetUrl(reference.previewUrl || node?.metadata?.content || "");
    const previewText = reference.text || node?.metadata?.content || node?.metadata?.prompt;
    const Icon = canvasReferenceIcon(reference.kind);
    return (
        <Popover
            trigger={["hover", "focus"]}
            placement="top"
           
            content={<AgentCanvasReferencePreview reference={reference} previewUrl={previewUrl} previewText={previewText} theme={theme} />}
        >
            <span
                tabIndex={0}
                className={`${agentInlineTokenClass} max-w-56 cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 dark:focus-visible:ring-white/15`}
                style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text }}
                aria-label={i18n.t("agent.composer.mentions.referenceLabel", { kind: canvasReferenceKindLabel(reference.kind), title: reference.title })}
            >
                {reference.kind === "image" && previewUrl
                    ? <img src={previewUrl} alt="" className={agentInlineTokenMediaClass} />
                    : <Icon className={agentInlineTokenIconClass} />}
                <span>{agentReferenceMarker(reference)}</span>
            </span>
        </Popover>
    );
}

export function AgentToolCard({ title, text, detail, theme }: { title: string; text: string; detail?: unknown; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    useTranslation();
    const plan = planDetail(detail);
    if (plan) return <AgentPlanCard title={title} plan={plan} theme={theme} />;
    const kind = String(objectField(detail, "kind") || "");
    if (kind === "reasoning") return <AgentReasoningSummary text={text} detail={detail} theme={theme} />;
    if (kind === "command") return <AgentCommandGroup items={[{ id: title, text, detail }]} theme={theme} />;
    const state = toolCardState(title, text, detail);
    const view = userDetail(detail);
    const showText = title !== "读取画布" || text !== "已读取当前画布内容";
    const className = "group min-w-0 rounded-xl border px-3 py-2.5 text-left";
    const style = { borderColor: theme.node.stroke, background: "transparent", color: theme.node.text };
    const content = (
        <>
            <div className="flex min-w-0 items-center gap-2 text-sm leading-5">
                <span className="shrink-0" style={{ color: state.color }}>{toolIcon(kind, state.icon)}</span>
                <span className="min-w-0 truncate font-medium">{title}</span>
                <span className="shrink-0 text-xs" style={{ color: state.color }}>{state.label}</span>
                {view ? <ChevronDown className="ml-auto size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180" style={{ color: theme.node.muted }} /> : null}
            </div>
            {showText ? (
                <div className={`mt-1 whitespace-pre-wrap break-words pl-6 text-sm leading-5 ${kind === "command" ? "font-mono text-xs" : ""}`} style={{ color: state.isError ? state.color : theme.node.muted }}>
                    {text}
                </div>
            ) : null}
        </>
    );
    if (!view) return <div className={className} style={style}>{content}</div>;
    return <Collapsible.Root className={className} style={style}>
        <Collapsible.Trigger asChild>
            <button type="button" className="block w-full rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{content}</button>
        </Collapsible.Trigger>
        <Collapsible.Content><div className="ml-6"><AgentDetailBlock detail={view} theme={theme} /></div></Collapsible.Content>
    </Collapsible.Root>;
}

function AgentReasoningSummary({ text, detail, theme }: { text: string; detail?: unknown; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const { t } = useTranslation();
    const reducedMotion = useShouldReduceMotion();
    const status = String(objectField(detail, "status") || "");
    const running = ["inProgress", "in_progress", "running", "started", "pending"].includes(status);
    const expandable = Boolean(text.trim());
    const heading = <div className="flex min-w-0 items-center gap-2">
        {running ? <LoaderCircle className="size-4 shrink-0 animate-spin" /> : <Brain className="size-4 shrink-0" />}
        <span>{t(running ? "agent.notify.thinking" : "agent.events.reasoning")}</span>
        {expandable ? <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" /> : null}
    </div>;
    if (!expandable) return <div className="min-w-0 py-1 text-sm" style={{ color: theme.node.muted }}>{heading}</div>;
    return <Collapsible.Root className="group min-w-0 text-left">
        <Collapsible.Trigger asChild>
            <button type="button" className="block w-full rounded-sm py-1 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ color: theme.node.muted }}>{heading}</button>
        </Collapsible.Trigger>
        <Collapsible.Content>
            <div className="break-words pb-1 pl-6 pr-2 text-xs leading-5 [&_code]:rounded [&_code]:px-1 [&_p]:my-1 [&_pre]:my-2" style={{ color: theme.node.muted }}>
                <Streamdown {...streamdownProps()} animated={reducedMotion ? false : streamdownAnimation} isAnimating={running}>{text}</Streamdown>
            </div>
        </Collapsible.Content>
    </Collapsible.Root>;
}

type AgentCommandItem = Pick<AgentChatItem, "id" | "text" | "detail" | "threadId" | "turnId" | "itemId">;

export function AgentCommandGroup({ items, theme }: { items: AgentCommandItem[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const { t } = useTranslation();
    const states = items.map((item) => commandViewState(item.detail));
    const running = states.some((state) => state.running);
    const failed = states.filter((state) => state.failed).length;
    const expandable = items.some((item) => Boolean(item.text.trim() || userDetail(item.detail)));
    const color = running ? "var(--warning)" : failed ? "var(--destructive)" : theme.node.muted;
    const label = running ? t(items.length > 1 ? "agent.notify.commandsRunning" : "agent.notify.commandRunning", { count: items.length }) : t("agent.notify.commandsCompleted", { count: items.length, failed: failed ? t("agent.notify.commandsFailed", { count: failed }) : "" });
    const header = (
        <div className="flex min-w-0 items-center gap-2 text-sm" style={{ color }}>
            {running ? <LoaderCircle className="size-4 shrink-0 animate-spin" /> : <TerminalSquare className="size-4 shrink-0" />}
            <span className="font-medium">{label}</span>
            {expandable ? <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" /> : null}
        </div>
    );
    if (!expandable) return <div className="min-w-0 py-1 text-left">{header}</div>;
    return <Collapsible.Root className="group min-w-0 text-left">
        <Collapsible.Trigger asChild>
            <button type="button" className="block w-full rounded-sm py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{header}</button>
        </Collapsible.Trigger>
        <Collapsible.Content>
            {items.length === 1
                ? <AgentSingleCommand item={items[0]} theme={theme} />
                : <div className="ml-6 mt-1">{items.map((item, index) => <AgentCommandEntry key={`${item.threadId}:${item.turnId}:${item.itemId || item.id}`} item={item} index={index} theme={theme} />)}</div>
            }
        </Collapsible.Content>
    </Collapsible.Root>;
}

function AgentSingleCommand({ item, theme }: { item: AgentCommandItem; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    useTranslation();
    const view = userDetail(item.detail);
    return (
        <div className="ml-6 pb-1">
            {item.text ? <div className="mt-1.5 whitespace-pre-wrap break-all font-mono text-xs leading-5" style={{ color: theme.node.text }}>{item.text}</div> : null}
            {view ? <AgentDetailBlock detail={view} theme={theme} /> : null}
        </div>
    );
}

function AgentCommandEntry({ item, index, theme }: { item: AgentCommandItem; index: number; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const view = userDetail(item.detail);
    const state = commandViewState(item.detail);
    const status = t(state.failed ? "agent.notify.failed" : state.running ? "agent.notify.running" : "agent.notify.completed");
    const color = state.failed ? "var(--destructive)" : state.running ? "var(--warning)" : "var(--success)";
    const content = (
        <>
            <span className="w-4 shrink-0 text-center text-xs tabular-nums opacity-50" style={{ color: theme.node.muted }}>{index + 1}</span>
            <Tooltip title={item.text}><code className="min-w-0 flex-1 truncate text-xs leading-5" style={{ color: theme.node.text }}>{item.text || t("agent.notify.command")}</code></Tooltip>
            <Tooltip title={status}><span className="shrink-0" style={{ color }} aria-label={status}>
                {state.running ? <LoaderCircle className="size-3.5 animate-spin" /> : state.failed ? <XCircle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
            </span></Tooltip>
            {view ? <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" style={{ color: theme.node.muted }} /> : null}
        </>
    );
    if (!view) return <div className={index ? "border-t" : ""} style={{ borderColor: theme.node.stroke }}><div className="flex min-w-0 items-center gap-2 py-2 text-left">{content}</div></div>;
    return <Collapsible.Root open={open} onOpenChange={setOpen} className={`group ${index ? "border-t" : ""}`} style={{ borderColor: theme.node.stroke }}>
        <Collapsible.Trigger asChild>
            <button type="button" className="flex w-full min-w-0 items-center gap-2 rounded-sm py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{content}</button>
        </Collapsible.Trigger>
        <Collapsible.Content><div className="pb-2 pl-6"><AgentDetailBlock detail={view} theme={theme} /></div></Collapsible.Content>
    </Collapsible.Root>;
}

function commandViewState(detail: unknown) {
    const status = String(objectField(detail, "status") || "").toLowerCase();
    return {
        running: ["inprogress", "in_progress", "running", "started", "pending"].includes(status),
        failed: ["failed", "error"].includes(status),
    };
}

function AgentPlanCard({ title, plan, theme }: { title: string; plan: PlanDetail; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    useTranslation();
    const [open, setOpen] = useState(true);
    const completed = plan.tasks.filter((item) => item.status === "completed").length;
    const state = planCardState(plan, completed);
    return <Collapsible.Root open={open} onOpenChange={setOpen} className="group min-w-0 flex-1 rounded-xl border px-3 py-2.5 text-left" style={{ borderColor: theme.node.stroke, background: "transparent", color: theme.node.text }}>
        <Collapsible.Trigger asChild>
            <button type="button" className="flex w-full min-w-0 rounded-sm items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <ListChecks className="size-4 shrink-0" style={{ color: state.color }} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
                <span className="shrink-0 text-xs" style={{ color: state.color }}>{state.label}</span>
                <span aria-live="polite" className="shrink-0 text-xs tabular-nums" style={{ color: theme.node.muted }}>{completed}/{plan.tasks.length}</span>
                <ChevronDown className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180" style={{ color: theme.node.muted }} />
            </button>
        </Collapsible.Trigger>
        <Collapsible.Content>
            <div>
                {plan.explanation ? <div className="mt-1.5 text-xs leading-5" style={{ color: theme.node.muted }}>{plan.explanation}</div> : null}
                <div className="mt-2.5 space-y-2 border-t pt-2.5" style={{ borderColor: theme.node.stroke }}>
                    {plan.tasks.map((item, index) => {
                        const task = planTaskState(item.status, theme.node.muted);
                        return (
                            <div key={`${index}-${item.step}`} className="flex items-start gap-2 text-sm leading-5">
                                <span className="mt-0.5 shrink-0" style={{ color: task.color }}>{task.icon}</span>
                                <span className={`min-w-0 flex-1 ${item.status === "completed" ? "opacity-55" : item.status === "inProgress" ? "font-medium" : ""}`} style={{ color: item.status === "inProgress" ? theme.node.text : theme.node.muted }}>{item.step}</span>
                                <span className="shrink-0 text-xs" style={{ color: task.color }}>{task.label}</span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </Collapsible.Content>
    </Collapsible.Root>;
}

export function AgentWorkingMessage({ text, detail, status = "running", mcpStatuses = [], activityKey, theme }: { text: string; detail?: string; status?: "running" | "ready" | "error"; mcpStatuses?: Array<{ name: string; status: "running" | "ready" | "error"; detail: string }>; activityKey: string; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const { t } = useTranslation();
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        const startedAt = Date.now();
        setElapsed(0);
        const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
        return () => window.clearInterval(timer);
    }, [activityKey]);
    return (
        <div className="min-w-0 py-1" aria-live="polite">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" style={{ color: theme.node.muted }}>
                {status === "running" ? <LoaderCircle className="size-3.5 shrink-0 animate-spin" /> : status === "ready" ? <CheckCircle2 className="size-3.5 shrink-0 text-success" /> : <XCircle className="size-3.5 shrink-0 text-destructive" />}
                <span className="min-w-0">{text}</span>
                {status === "running" && elapsed >= 5 ? <span className="shrink-0 text-xs tabular-nums opacity-60">{waitingTime(elapsed)}</span> : null}
            </div>
            {detail ? <div className="ml-5.5 mt-1 text-xs leading-5 opacity-65" style={{ color: theme.node.muted }}>{detail}</div> : null}
            {mcpStatuses.length ? (
                <div className="ml-5.5 mt-3 space-y-2">
                    {mcpStatuses.map((item) => (
                        <div key={item.name} className="flex min-w-0 items-start gap-2 text-xs leading-5" style={{ color: theme.node.muted }}>
                            {item.status === "running" ? <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin" /> : item.status === "ready" ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" /> : <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />}
                            <div className="min-w-0">
                                <div className="font-medium" style={{ color: theme.node.text }}>{item.name}</div>
                                <div className="opacity-65">{item.detail}</div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : null}
            {status === "running" && elapsed >= 30 ? <div className="mt-1 text-xs leading-5 opacity-65" style={{ color: theme.node.muted }}>{t("agent.notify.slowResponse")}</div> : null}
        </div>
    );
}

function waitingTime(seconds: number) {
    if (seconds < 60) return tr("waitingSeconds", { seconds });
    const minutes = Math.floor(seconds / 60);
    return tr("waitingMinutes", { minutes, seconds: seconds % 60 });
}

type PlanTask = { step: string; status: string };
type PlanDetail = { status: string; tasks: PlanTask[]; explanation?: string };
type UserDetail = { kind?: string; status?: string; rows?: Array<{ label: string; value: string }>; output?: string; files?: Array<{ path: string; action?: string }> };

function AgentDetailBlock({ detail, theme }: { detail: UserDetail; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const { t } = useTranslation();
    return (
        <div className="mt-3 space-y-2.5 border-t pt-3 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
            {detail.rows?.length ? (
                <dl className="space-y-1.5">
                    {detail.rows.map((row) => (
                        <div key={`${row.label}-${row.value}`} className="grid grid-cols-[64px_minmax(0,1fr)] gap-2">
                            <dt className="opacity-60">{row.label}</dt>
                            <dd className="min-w-0 break-words" style={{ color: theme.node.text }}>{row.value}</dd>
                        </div>
                    ))}
                </dl>
            ) : null}
            {detail.files?.length ? (
                <div className="space-y-1.5">
                    <div className="opacity-60">{t("agent.notify.files")}</div>
                    {detail.files.map((file) => (
                        <div key={`${file.action}-${file.path}`} className="flex items-start gap-2">
                            <FileText className="mt-0.5 size-3.5 shrink-0" />
                            <span className="min-w-0 flex-1 break-all" style={{ color: theme.node.text }}>{file.path}</span>
                            {file.action ? <span className="shrink-0 opacity-60">{file.action}</span> : null}
                        </div>
                    ))}
                </div>
            ) : null}
            {detail.output ? (
                <div className="space-y-1.5">
                    <div className="opacity-60">{t(detail.status === "failed" || detail.status === "error" ? "agent.notify.errorInfo" : "agent.notify.output")}</div>
                    <pre className="thin-scrollbar max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg px-3 py-2 font-mono text-xs leading-4" style={{ background: theme.toolbar.panel, color: theme.node.text }}>{detail.output}</pre>
                </div>
            ) : null}
        </div>
    );
}

function AgentMessageAttachments({ attachments, alignRight }: { attachments: AgentChatAttachment[]; alignRight?: boolean }) {
    const { t } = useTranslation();
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    return (
        <>
            <div className={`mt-1.5 flex flex-wrap gap-1.5 ${alignRight ? "justify-end" : "justify-start"}`}>
                {attachments.map((item) => (
                    <Tooltip key={item.id} title={t("agent.notify.viewLarge")}><img
                        src={item.url}
                        alt={item.name}
                        className="size-10 cursor-zoom-in rounded-lg object-cover"
                        draggable={false}
                        onClick={() => setPreviewUrl(item.url)}
                    /></Tooltip>
                ))}
            </div>
            {previewUrl ? (
                <div className="hidden">
                    <MediaPreview src={previewUrl} alt={t("agent.notify.attachmentPreview")} open onOpenChange={(visible) => !visible && setPreviewUrl(null)} />
                </div>
            ) : null}
        </>
    );
}

function toolCardState(title: string, text: string, detail?: unknown) {
    const raw = `${title} ${text} ${normalizeText(objectField(detail, "error"))}`;
    const lower = raw.toLowerCase();
    const status = String(objectField(detail, "status") || "").toLowerCase();
    if (status === "noop" || /未生效|无需|没有找到|没有.*可|已存在/.test(raw)) return { label: tr("noEffect"), color: "var(--warning)", icon: <CircleAlert className="size-4" />, isError: false };
    if (["declined", "rejected", "cancelled", "canceled"].includes(status) || /拒绝|取消/.test(raw)) return { label: tr("canceled"), color: "var(--destructive)", icon: <XCircle className="size-4" />, isError: true };
    if (["failed", "error"].includes(status) || /失败|错误/.test(raw) || lower.includes("failed") || lower.includes("error")) return { label: tr("failed"), color: "var(--destructive)", icon: <XCircle className="size-4" />, isError: true };
    if (["inprogress", "in_progress", "running", "started", "pending"].includes(status)) return { label: tr("running"), color: "var(--warning)", icon: <LoaderCircle className="size-4 animate-spin" />, isError: false };
    if (["completed", "succeeded", "success"].includes(status) || /完成|成功/.test(raw)) return { label: tr("completed"), color: "var(--success)", icon: <CheckCircle2 className="size-4" />, isError: false };
    return { label: tr("recorded"), color: "var(--info)", icon: <Wrench className="size-4" />, isError: false };
}

function toolIcon(kind: string | undefined, fallback: ReactNode) {
    if (kind === "search") return <Search className="size-4" />;
    if (kind === "file") return <FilePenLine className="size-4" />;
    if (kind === "plan") return <ListChecks className="size-4" />;
    return fallback;
}

function planCardState(plan: PlanDetail, completed: number) {
    if (plan.status === "failed") return { label: tr("failed"), color: "var(--destructive)" };
    if (["interrupted", "cancelled", "canceled"].includes(plan.status)) return { label: tr("stopped"), color: "var(--warning)" };
    if (completed === plan.tasks.length) return { label: tr("completed"), color: "var(--success)" };
    if (plan.status === "finished") return { label: tr("finished"), color: "var(--info)" };
    return { label: tr("running"), color: "var(--warning)" };
}

function planTaskState(status: string, muted: string) {
    if (status === "completed") return { label: tr("completed"), color: "var(--success)", icon: <CheckCircle2 className="size-3.5" /> };
    if (status === "inProgress") return { label: tr("running"), color: "var(--warning)", icon: <LoaderCircle className="size-3.5 animate-spin" /> };
    return { label: tr("pending"), color: muted, icon: <Circle className="size-3.5" /> };
}

function planDetail(value: unknown): PlanDetail | null {
    if (!value || typeof value !== "object" || objectField(value, "kind") !== "todo") return null;
    const tasks = Array.isArray(objectField(value, "tasks"))
        ? (objectField(value, "tasks") as unknown[]).flatMap((item) => {
              const step = String(objectField(item, "step") || "").trim();
              return step ? [{ step, status: String(objectField(item, "status") || "pending") }] : [];
          })
        : [];
    if (!tasks.length) return null;
    const explanation = String(objectField(value, "explanation") || "").trim();
    return { status: String(objectField(value, "status") || "inProgress"), tasks, ...(explanation ? { explanation } : {}) };
}

function userDetail(value: unknown): UserDetail | null {
    if (!value || typeof value !== "object") return null;
    const detail = value as Record<string, unknown>;
    const rows = Array.isArray(detail.rows)
        ? detail.rows.flatMap((row) => {
              if (!row || typeof row !== "object") return [];
              const label = String((row as Record<string, unknown>).label || "");
              const value = String((row as Record<string, unknown>).value || "");
              return label && value ? [{ label, value }] : [];
          })
        : [];
    const files = Array.isArray(detail.files)
        ? detail.files.flatMap((file) => {
              if (!file || typeof file !== "object") return [];
              const path = String((file as Record<string, unknown>).path || "");
              return path ? [{ path, action: String((file as Record<string, unknown>).action || "") || undefined }] : [];
          })
        : [];
    const error = objectField(detail.error, "message");
    const output = typeof detail.output === "string" ? detail.output.trim() : typeof error === "string" ? error : "";
    if (!rows.length && !files.length && !output) return null;
    return { kind: typeof detail.kind === "string" ? detail.kind : undefined, status: typeof detail.status === "string" ? detail.status : undefined, rows, files, output };
}

function normalizeText(value: unknown) {
    if (typeof value === "string") return value.trim();
    if (value instanceof Error) return value.message;
    if (value == null) return "";
    return String(objectField(value, "message") || "");
}

function objectField(value: unknown, key: string) {
    return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function tr(key: string, options?: Record<string, unknown>) {
    return i18n.t(`agent.notify.${key}`, options);
}
