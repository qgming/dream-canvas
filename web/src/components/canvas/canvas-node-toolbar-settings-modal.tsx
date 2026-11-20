import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/controls";
import { EditorForm, Field } from "@/components/ui/form";
import { Dialog } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/controls";
import { Badge as Tag } from "@/components/ui/display";
import { Tooltip } from "@/components/ui/popover";
import { Ellipsis, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { NodeToolbarConfig } from "@/stores/canvas/use-node-toolbar-store";
import type { CanvasNodeToolbarItem } from "@/types/canvas-plugin";

type PreviewTool = Pick<CanvasNodeToolbarItem, "id" | "title" | "label" | "icon" | "danger">;

type PreviewScroll = {
    left: number;
    max: number;
    viewport: number;
    content: number;
};

export function NodeToolbarSettingsModal({
    open,
    tools,
    nodeIcon,
    nodeLabel,
    value,
    savedValue,
    onChange,
    onCancel,
    onSave,
}: {
    open: boolean;
    tools: PreviewTool[];
    nodeIcon: ReactNode;
    nodeLabel: string;
    value: NodeToolbarConfig;
    savedValue: NodeToolbarConfig;
    onChange: (value: NodeToolbarConfig) => void;
    onCancel: () => void;
    onSave: () => void;
}) {
    const { t } = useTranslation();
    const previewToolbarRef = useRef<HTMLDivElement>(null);
    const scrollbarTrackRef = useRef<HTMLInputElement>(null);
    const [previewScroll, setPreviewScroll] = useState<PreviewScroll>({ left: 0, max: 0, viewport: 1, content: 1 });
    const { showLabels } = value;
    const selectedTools = useMemo(() => { const hidden = new Set(value.hiddenIds); return tools.filter((tool) => !hidden.has(tool.id)); }, [tools, value.hiddenIds]);
    const selectedIds = useMemo(() => selectedTools.map((tool) => tool.id), [selectedTools]);
    const previewTools: PreviewTool[] = [
        ...selectedTools,
        { id: "more", title: t("canvas.toolbarSettings.customize"), label: "", icon: <Ellipsis className="size-4" /> },
    ];

    const syncPreviewScroll = useCallback(() => {
        const toolbar = previewToolbarRef.current;
        if (!toolbar) return;
        setPreviewScroll({
            left: toolbar.scrollLeft,
            max: Math.max(0, toolbar.scrollWidth - toolbar.clientWidth),
            viewport: Math.max(1, toolbar.clientWidth),
            content: Math.max(1, toolbar.scrollWidth),
        });
    }, []);

    const setPreviewScrollLeft = useCallback(
        (left: number) => {
            const toolbar = previewToolbarRef.current;
            if (!toolbar) return;
            toolbar.scrollLeft = left;
            syncPreviewScroll();
        },
        [syncPreviewScroll],
    );

    const updateSelectedTools = (values: unknown[]) => {
        const next = new Set(values);
        const available = new Set(tools.map((tool) => tool.id));
        onChange({ ...value, hiddenIds: [...value.hiddenIds.filter((id) => !available.has(id)), ...tools.filter((tool) => !next.has(tool.id)).map((tool) => tool.id)] });
    };

    useEffect(() => {
        if (!open) return;
        const toolbar = previewToolbarRef.current;
        const sync = () => syncPreviewScroll();
        const frames: number[] = [];
        const firstFrame = window.requestAnimationFrame(() => {
            sync();
            frames.push(window.requestAnimationFrame(sync));
        });
        frames.push(firstFrame);
        const timer = window.setTimeout(sync, 120);
        const resizeObserver = typeof ResizeObserver !== "undefined" && toolbar ? new ResizeObserver(sync) : null;
        if (resizeObserver && toolbar) {
            resizeObserver.observe(toolbar);
            toolbar.childNodes.forEach((child) => {
                if (child instanceof Element) resizeObserver.observe(child);
            });
        }
        sync();
        window.addEventListener("resize", syncPreviewScroll);
        return () => {
            frames.forEach((frame) => window.cancelAnimationFrame(frame));
            window.clearTimeout(timer);
            resizeObserver?.disconnect();
            window.removeEventListener("resize", syncPreviewScroll);
        };
    }, [open, selectedIds, showLabels, previewTools.length, syncPreviewScroll]);

    const scrollbarWidth = scrollbarTrackRef.current?.clientWidth || previewScroll.viewport;
    const scrollbarThumbWidth = previewScroll.max > 0 ? Math.min(scrollbarWidth, Math.max(64, (previewScroll.viewport / previewScroll.content) * scrollbarWidth)) : scrollbarWidth;

    return (
        <Dialog
            title={t("canvas.toolbarSettings.customize")}
            description={t("canvas.toolbarSettings.description")}
            open={open}
            width={760}
            onClose={onCancel}
            dirty={showLabels !== savedValue.showLabels || JSON.stringify([...value.hiddenIds].sort()) !== JSON.stringify([...savedValue.hiddenIds].sort())}
            onConfirm={onSave}
            footerStart={<label className="inline-flex items-center gap-2 text-sm"><span>{t("canvas.toolbarSettings.showLabels")}</span><Switch checked={showLabels} aria-label={t("canvas.toolbarSettings.showLabels")} onChange={(showLabels) => onChange({ ...value, showLabels })} /></label>}
        >
            <section className="mb-4 rounded-xl border border-border p-4">
                <h3 className="flex items-center gap-2 text-base font-medium"><Settings2 className="size-4" />{t("canvas.toolbarSettings.preview")}</h3>
                <div className="relative flex min-h-[300px] w-full justify-center pt-20 pb-9">
                    <div
                        ref={previewToolbarRef}
                        className="hide-scrollbar absolute left-2 right-2 top-3 z-10 flex items-center gap-1 overflow-x-auto overflow-y-hidden rounded-xl border p-1 text-sm"
                        style={{ background: "var(--popover)", borderColor: "var(--border)", color: "var(--foreground)" }}
                        onScroll={syncPreviewScroll}
                    >
                        {previewTools.map((tool) => (
                            <PreviewToolbarItem key={tool.id} tool={tool} showLabels={showLabels} />
                        ))}
                    </div>
                    <div
                        className="flex h-48 w-full max-w-[360px] flex-col items-center justify-center rounded-xl border"
                        style={{ background: "var(--muted)", borderColor: "var(--border)", color: "var(--muted-foreground)" }}
                    >
                        <span aria-hidden className="mb-2 [&_svg]:size-8">{nodeIcon}</span>
                        <span data-secondary>{nodeLabel}</span>
                    </div>
                    <input
                        ref={scrollbarTrackRef}
                        type="range"
                        min={0}
                        max={Math.max(previewScroll.max, 1)}
                        value={Math.min(previewScroll.left, Math.max(previewScroll.max, 1))}
                        disabled={previewScroll.max <= 0}
                        aria-label={t("canvas.toolbarSettings.scrollPreview")}
                        className="absolute bottom-4 left-10 right-10 h-2.5 cursor-pointer appearance-none bg-transparent disabled:cursor-default [&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:w-[var(--preview-scrollbar-thumb-width)] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[var(--muted-foreground)] [&::-moz-range-track]:h-2.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-[var(--muted)] [&::-webkit-slider-runnable-track]:h-2.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[var(--muted)] [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-[var(--preview-scrollbar-thumb-width)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--muted-foreground)]"
                        style={{ "--preview-scrollbar-thumb-width": `${scrollbarThumbWidth}px` } as CSSProperties}
                        onInput={(event) => setPreviewScrollLeft(Number(event.currentTarget.value))}
                        onChange={(event) => setPreviewScrollLeft(Number(event.target.value))}
                    />
                </div>
            </section>

            <EditorForm className="!mb-0">
                <Field
                    className="!mb-4"
                    label={
                        <div className="flex flex-wrap items-center gap-2">
                            <span>{t("canvas.toolbarSettings.quickTools")}</span>
                            <Tag className="m-0">
                                {selectedTools.length}/{tools.length}
                            </Tag>
                        </div>
                    }
                >
                    <Checkbox.Group value={selectedIds} aria-label={t("canvas.toolbarSettings.quickTools")} className="grid w-full gap-3 md:grid-cols-3" onChange={updateSelectedTools}>
                        {tools.map((tool) => (
                            <Checkbox key={tool.id} value={tool.id} className="m-0">
                                <span className="inline-flex items-center gap-2 [&_svg]:size-4 [&_svg]:shrink-0">
                                    {tool.icon}
                                    {tool.label}
                                </span>
                            </Checkbox>
                        ))}
                    </Checkbox.Group>
                </Field>
            </EditorForm>
        </Dialog>
    );
}

function PreviewToolbarItem({ tool, showLabels }: { tool: PreviewTool; showLabels: boolean }) {
    return (
        <Tooltip title={tool.title}>
            <span className="flex shrink-0 items-center" style={{ color: tool.danger ? "var(--destructive)" : undefined }}>
                <span className={`flex h-8 items-center rounded-lg [&_svg]:size-4 [&_svg]:shrink-0 ${showLabels && tool.label ? "gap-1.5 px-2" : "size-8 justify-center"}`}>
                    {tool.icon}
                    {showLabels && tool.label ? <span className="whitespace-nowrap">{tool.label}</span> : null}
                </span>
            </span>
        </Tooltip>
    );
}
