import { useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/popover";
import { ArrowUp, ImagePlus, LoaderCircle, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useAgentStore } from "@/stores/use-agent-store";
import type { AgentChatAttachment } from "./agent-chat-message";
import { AgentChatPromptInput } from "./agent-chat-prompt-input";

export function AgentChatComposer({
    prompt,
    attachments = [],
    disabled,
    sending,
    stopping,
    placeholder,
    theme,
    onPromptChange,
    onSubmit,
    onStop,
    onAddFiles,
    onRemoveAttachment,
    left,
    model,
}: {
    prompt: string;
    attachments?: AgentChatAttachment[];
    disabled?: boolean;
    sending?: boolean;
    stopping?: boolean;
    placeholder: string;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onPromptChange: (value: string) => void;
    onSubmit: () => void;
    onStop?: () => void;
    onAddFiles?: (files: FileList | File[] | null) => void | Promise<void>;
    onRemoveAttachment?: (id: string) => void;
    left?: ReactNode;
    model?: ReactNode;
}) {
    const { t } = useTranslation();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const canvasReferences = useAgentStore((state) => state.canvasReferences);
    const canSubmit = !disabled && !sending && Boolean(prompt.trim() || attachments.length || canvasReferences.length);
    return (
        <div className="px-2 pb-2 pt-2" onWheelCapture={(event) => event.stopPropagation()}>
            <div className="rounded-xl border px-3 pb-3 pt-3" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}>
                {attachments.length ? (
                    <div className="thin-scrollbar mb-2 flex gap-2 overflow-x-auto pb-1">
                        {attachments.map((item) => (
                            <Tooltip key={item.id} title={item.name}><div className="group relative size-14 shrink-0 overflow-hidden rounded-xl border" style={{ borderColor: theme.node.stroke }}>
                                <img src={item.url} alt={item.name} className="size-full object-cover" />
                                {onRemoveAttachment ? (
                                    <Button variant="ghost" size="icon" className="absolute right-1 top-1 size-5 rounded-md border opacity-0 shadow-sm group-hover:opacity-100 focus-visible:opacity-100 [&_svg]:size-3" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text }} onClick={() => onRemoveAttachment(item.id)} aria-label={t("agent.composer.removeImage")}>
                                        <X className="size-3" />
                                    </Button>
                                ) : null}
                            </div></Tooltip>
                        ))}
                    </div>
                ) : null}
                <AgentChatPromptInput value={prompt} disabled={disabled || sending} placeholder={placeholder} theme={theme} onChange={onPromptChange} onSubmit={() => { if (canSubmit) void onSubmit(); }} onAddFiles={onAddFiles} />
                <div className="@container mt-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1">
                        {onAddFiles ? (
                            <>
                                <input ref={fileInputRef} name="assistant-attachments" hidden type="file" accept="image/*" multiple onChange={(event) => {
                                    void onAddFiles(event.target.files);
                                    event.target.value = "";
                                }} />
                                <Tooltip title={t("agent.composer.uploadImage")}>
                                    <Button variant="ghost"  className="!h-8 !w-8 !min-w-8" disabled={disabled || sending} style={{ color: theme.node.muted }} icon={<ImagePlus className="size-4" />} onClick={() => fileInputRef.current?.click()} aria-label={t("agent.composer.uploadImage")} />
                                </Tooltip>
                            </>
                        ) : null}
                        {left}
                    </div>
                    <div className="flex min-w-0 items-center justify-end gap-1.5">
                        {model}
                        {sending && onStop ? (
                            <Tooltip title={t("agent.composer.stop")} placement="top"><Button variant="destructive" size="icon" loading={stopping} icon={<Square className="size-4" />} onClick={() => void onStop()} aria-label={t("agent.composer.stop")} /></Tooltip>
                        ) : (
                            <Tooltip title={t("agent.composer.send")} placement="top"><Button variant="default"  className="!h-10 !w-10 !min-w-10" disabled={!canSubmit} icon={sending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />} onClick={() => void onSubmit()} aria-label={t("agent.composer.send")} /></Tooltip>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

