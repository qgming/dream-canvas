import { useEffect, useState } from "react";
import { motionTokens, toCssTiming, useShouldReduceMotion } from "@animate-ui/react/utils/motion";
import { Button } from "@/components/ui/button";
import { MediaPreview } from "@/components/ui/media-preview";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Popover, Tooltip } from "@/components/ui/popover";
import { Brain, Copy, LoaderCircle } from "lucide-react";
import { Streamdown, type LinkSafetyModalProps } from "streamdown";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { useCopyText } from "@/hooks/use-copy-text";
import { canvasThemes } from "@/lib/canvas-theme";
import { useAgentStore, type AgentCanvasReference, type AgentSkillReference } from "@/stores/use-agent-store";
import { resolveAgentMessageAssetUrl } from "@/services/api/assistant-skills";
import { AgentCanvasReferencePreview, canvasReferenceIcon, canvasReferenceKindLabel } from "./agent-canvas-reference-preview";
import { agentInlineTokenClass, agentInlineTokenIconClass, agentInlineTokenMediaClass, agentReferenceMarker, parseAgentInlineTokens } from "./agent-chat-inline-tokens";
import { AgentStep, agentStepBodyClass } from "./agent-chat-steps";

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
        <AlertDialog open={isOpen} onClose={onClose} title={t(localPath ? "agent.message.openLocal" : "agent.message.openExternal")} description={t(localPath ? "agent.message.localDescription" : "agent.message.externalDescription")} confirmDisabled={Boolean(localPath)} confirmText={t(localPath ? "workspace.localPath" : "agent.message.continueOpen")} onConfirm={() => { onConfirm(); onClose(); }} actions={
                <Button variant="outline" icon={<Copy className="size-4" />} onClick={() => copyText(localPath || url, t(localPath ? "agent.message.pathCopied" : "agent.message.linkCopied"))}>
                    {t(localPath ? "agent.message.copyPath" : "agent.message.copyLink")}
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
    text: string;
    reasoning?: string;
    meta?: string;
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
    const color = item.role === "error" ? "var(--destructive)" : theme.node.text;
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
    if (item.role === "tool") return null;
    return (
        <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
            <div
                className={isUser ? "min-w-0 max-w-[82%] py-1 text-right text-sm leading-6" : "min-w-0 w-full text-left text-sm leading-6"}
                style={{ color }}
            >
                {item.reasoning ? <AgentReasoningSummary text={item.reasoning} running={!!item.streamId && !item.text.trim()} /> : null}
                {isUser ? (
                    <AgentUserMessageContent text={item.text} references={item.canvasReferences || []} skill={item.skill} theme={theme} />
                ) : item.text.trim() ? (
                    <div className={item.reasoning ? "mt-2" : undefined}>
                        <Streamdown {...streamdownProps()} animated={reducedMotion ? false : streamdownAnimation} isAnimating={!!item.streamId}>{item.text}</Streamdown>
                    </div>
                ) : null}
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

function AgentReasoningSummary({ text, running }: { text: string; running: boolean }) {
    const { t } = useTranslation();
    const reducedMotion = useShouldReduceMotion();
    const [expanded, setExpanded] = useState<boolean>();
    return <AgentStep label={t(running ? "agent.steps.thinking" : "agent.steps.reasoning")} icon={running ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Brain aria-hidden />}
        open={expanded ?? running} onOpenChange={setExpanded}>
        <div className={`${agentStepBodyClass} py-1 text-xs leading-5 text-muted-foreground`}>
            <Streamdown {...streamdownProps()} skipHtml disallowedElements={["img"]} controls={false} animated={reducedMotion ? false : streamdownAnimation} isAnimating={running}>{text}</Streamdown>
        </div>
    </AgentStep>;
}

export function AgentWorkingMessage({ text }: { text: string }) {
    const { t } = useTranslation();
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        const startedAt = Date.now();
        setElapsed(0);
        const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
        return () => window.clearInterval(timer);
    }, []);
    return (
        <div className="min-w-0 px-2 py-1 text-muted-foreground">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-5">
                <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
                <span role="status">{text}</span>
                {elapsed >= 5 ? <span className="shrink-0 text-xs tabular-nums opacity-70">{waitingTime(elapsed)}</span> : null}
            </div>
            {elapsed >= 30 ? <p className="ml-6 mt-1 text-xs leading-5">{t("agent.message.slowResponse")}</p> : null}
        </div>
    );
}

function waitingTime(seconds: number) {
    if (seconds < 60) return tr("waitingSeconds", { seconds });
    const minutes = Math.floor(seconds / 60);
    return tr("waitingMinutes", { minutes, seconds: seconds % 60 });
}

function AgentMessageAttachments({ attachments, alignRight }: { attachments: AgentChatAttachment[]; alignRight?: boolean }) {
    const { t } = useTranslation();
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    return (
        <>
            <div className={`mt-1.5 flex flex-wrap gap-1.5 ${alignRight ? "justify-end" : "justify-start"}`}>
                {attachments.map((item) => (
                    <Tooltip key={item.id} title={t("agent.message.viewLarge")}><img
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
                    <MediaPreview src={previewUrl} alt={t("agent.message.attachmentPreview")} open onOpenChange={(visible) => !visible && setPreviewUrl(null)} />
                </div>
            ) : null}
        </>
    );
}

function tr(key: string, options?: Record<string, unknown>) {
    return i18n.t(`agent.message.${key}`, options);
}
