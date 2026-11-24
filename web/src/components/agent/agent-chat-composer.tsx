import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Images, LayoutGrid, LoaderCircle, Plus, Square, Upload, X } from "lucide-react";
import { nanoid } from "nanoid";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Menu, Tooltip } from "@/components/ui/popover";
import { AssetPickerModal } from "@/components/canvas/asset-picker-modal";
import { useFeedback } from "@/hooks/use-feedback";
import { canvasThemes } from "@/lib/canvas-theme";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/use-agent-store";
import { useAssetStore, type AssetKind } from "@/stores/use-asset-store";
import type { AgentChatAttachment } from "./agent-chat-message";
import { AgentChatPromptInput } from "./agent-chat-prompt-input";
import { AgentCanvasPicker, AgentSkillPicker } from "./agent-composer-pickers";

const attachmentKinds: readonly AssetKind[] = ["image", "text"];

export function AgentChatComposer({ wide, visible, prompt, attachments = [], disabled, sending, stopping, uploading, placeholder, theme, onPromptChange, onSubmit, onStop, onAddFiles, onRemoveAttachment, model, reasoning, targetProjectId }: {
    wide?: boolean;
    visible: boolean;
    prompt: string;
    attachments?: AgentChatAttachment[];
    disabled?: boolean;
    sending?: boolean;
    stopping?: boolean;
    uploading?: boolean;
    placeholder: string;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onPromptChange: (value: string) => void;
    onSubmit: () => void;
    onStop?: () => void;
    onAddFiles?: (files: FileList | File[] | null) => void | Promise<void>;
    onRemoveAttachment?: (id: string) => void;
    model?: ReactNode;
    reasoning?: ReactNode;
    targetProjectId: string;
}) {
    const { t } = useTranslation();
    const { notify } = useFeedback();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [picker, setPicker] = useState<"canvas" | "library" | null>(null);
    useEffect(() => { if (!visible) setPicker(null); }, [visible]);
    const locked = Boolean(disabled || sending || uploading || picker);
    const canSubmit = !locked && Boolean(prompt.trim() || attachments.length);
    const stoppingTurn = Boolean(sending && onStop);
    const sendLabel = t(stoppingTurn ? "agent.composer.stop" : "agent.composer.send");
    return <div className={cn("p-3 pt-2", wide && "px-4 pb-4")} data-base-ui-swipe-ignore>
        <div className={cn("rounded-2xl border border-border p-3 focus-within:border-ring/40", wide ? "bg-card" : "bg-background")}>
            {attachments.length ? <div className="thin-scrollbar mb-2 flex gap-2 overflow-x-auto pb-1">
                {attachments.map((item) => <Tooltip key={item.id} title={item.name}><div className="group relative size-14 shrink-0 overflow-hidden rounded-lg border border-border">
                    <img src={item.url} alt={item.name} loading="lazy" className="size-full object-cover" />
                    {onRemoveAttachment ? <Button variant="ghost" size="icon" disabled={locked} className="absolute right-1 top-1 size-5 rounded-md opacity-0 shadow-sm group-hover:opacity-100 focus-visible:opacity-100 [&_svg]:size-3" onClick={() => onRemoveAttachment(item.id)} aria-label={t("agent.composer.removeImage")} icon={<X />} /> : null}
                </div></Tooltip>)}
            </div> : null}
            <AgentChatPromptInput compact={wide} value={prompt} disabled={locked} placeholder={placeholder} theme={theme} targetProjectId={targetProjectId} onChange={onPromptChange} onSubmit={() => { if (canSubmit) onSubmit(); }} onAddFiles={locked ? undefined : onAddFiles} />
            <div className="mt-3 flex min-w-0 flex-wrap items-center gap-1.5">
                <div className="flex shrink-0 items-center gap-1">
                    <Menu placement="topLeft" disabled={locked} items={[
                        { key: "upload", label: t("agent.drawer.addLocal"), icon: <Upload />, disabled: !onAddFiles, onClick: () => fileInputRef.current?.click() },
                        { key: "canvas", label: t("agent.drawer.addCanvas"), icon: <LayoutGrid />, onClick: () => setPicker("canvas") },
                        { key: "library", label: t("agent.drawer.addLibrary"), icon: <Images />, onClick: () => setPicker("library") },
                    ]}><Button variant="ghost" size="icon" disabled={locked} icon={uploading ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Plus />} title={t("agent.drawer.addReference")} aria-label={t("agent.drawer.addReference")} /></Menu>
                    <AgentSkillPicker disabled={locked} />
                </div>
                <div className="ml-auto flex min-w-0 flex-[1_1_13rem] items-center justify-end gap-1.5">
                    {model}{reasoning && <div className="min-w-0 max-w-[45%]">{reasoning}</div>}
                    <Button variant={stoppingTurn ? "destructive" : "default"} size="icon" className="rounded-full" icon={stoppingTurn ? <Square className="size-3.5 fill-current" /> : sending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <ArrowUp className="size-4" />} title={sendLabel} aria-label={sendLabel} aria-busy={sending || stopping} loading={stopping} disabled={!stoppingTurn && !canSubmit} onClick={() => stoppingTurn ? onStop?.() : onSubmit()} />
                </div>
            </div>
            <input ref={fileInputRef} name="assistant-attachments" hidden type="file" accept="image/*" multiple disabled={locked} onChange={(event) => {
                if (!locked) void onAddFiles?.(Array.from(event.target.files || []));
                event.target.value = "";
            }} />
        </div>
        <AgentCanvasPicker open={visible && picker === "canvas"} onClose={() => setPicker(null)} targetProjectId={targetProjectId} disabled={disabled || sending || uploading} />
        <AssetPickerModal open={visible && picker === "library"} title={t("agent.drawer.addLibrary")} kinds={attachmentKinds} onClose={() => setPicker(null)} onInsert={(payload) => {
            if (disabled || sending || uploading) return;
            const agent = useAgentStore.getState();
            if (payload.kind === "text") useAgentStore.setState({ prompt: `${agent.prompt}${agent.prompt ? "\n" : ""}${payload.content}` });
            if (payload.kind === "image") {
                const asset = useAssetStore.getState().assets.find((item) => item.kind === "image" && item.data.dataUrl === payload.dataUrl);
                if (asset?.kind !== "image" || asset.saveState !== "saved") { notify.warning(t("errors.imageNotSaved")); return; }
                if (agent.attachments.some((item) => item.url === payload.dataUrl)) { setPicker(null); return; }
                useAgentStore.setState({ attachments: [...agent.attachments, { id: nanoid(), name: payload.title, url: payload.dataUrl, dataUrl: payload.dataUrl, type: asset.data.mimeType, size: asset.data.bytes, width: asset.data.width, height: asset.data.height }] });
            }
            setPicker(null);
        }} />
    </div>;
}

