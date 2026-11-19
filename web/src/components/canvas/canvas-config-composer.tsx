import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { createPortal } from "react-dom";
import { MediaPreview } from "@/components/ui/media-preview";
import { FileText, Group, Image as ImageIcon, Music2, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { NodeGenerationInput } from "./canvas-node-generation";
import type { CanvasNodeData } from "@/types/canvas";
import { buildGenerationConfig, generationInputKinds } from "@/lib/canvas/canvas-generation-helpers";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { cn } from "@/lib/utils";
import { isImeComposing } from "@/lib/keyboard-event";

type CanvasConfigComposerProps = {
    nodeId: string;
    nodes: CanvasNodeData[];
    value: string;
    inputs: NodeGenerationInput[];
    onChange: (value: string) => void;
    className?: string;
};

type Token =
    | { type: "text"; value: string }
    | { type: "reference"; nodeId: string };

type MentionState = {
    query: string;
};

export const CONFIG_REFERENCE_PATTERN = /@\[node:([^\]]+)\]/g;

export function CanvasConfigComposer({ nodeId, nodes, value, inputs, onChange, className }: CanvasConfigComposerProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const globalConfig = useEffectiveConfig();
    const node = nodes.find((item) => item.id === nodeId);
    const config = buildGenerationConfig(globalConfig, node, node?.metadata?.generationMode || "image");
    const inputKinds = generationInputKinds(config);
    const editorRef = useRef<HTMLDivElement>(null);
    const lastEmittedRef = useRef(value);
    const composingRef = useRef(false);
    const [mention, setMention] = useState<MentionState | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const tokens = useMemo(() => parseComposerTokens(value), [value]);
    const referenceById = useMemo(() => new Map(inputs.map((input) => [input.nodeId, input])), [inputs]);
    const candidates = useMemo(() => {
        if (!mention) return [];
        const query = (mention.query || "").trim().toLowerCase();
        return inputs.filter((input) => (input.type === "group" ? input.children.some((child) => inputKinds.includes(child.type)) : inputKinds.includes(input.type)) && (!query || `${resourceLabel(input, inputs)} ${input.title} ${input.type === "group" ? "" : input.text || ""}`.toLowerCase().includes(query)));
    }, [inputs, inputKinds, mention]);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        if (document.activeElement === editor && value === lastEmittedRef.current) return;
        editor.textContent = "";
        tokens.forEach((token) => {
            if (token.type === "text") {
                editor.append(document.createTextNode(token.value));
                return;
            }
            const input = referenceById.get(token.nodeId);
            if (input) editor.append(createReferenceChip(input, inputs, theme, setImagePreview));
            else editor.append(document.createTextNode(`@[node:${token.nodeId}]`));
        });
        lastEmittedRef.current = value;
    }, [inputs, referenceById, theme, tokens, value]);

    const emit = (next: string) => { lastEmittedRef.current = next; onChange(next); };

    const syncFromEditor = () => {
        const editor = editorRef.current;
        if (!editor) return;
        const next = serializeEditor(editor);
        emit(next);
        syncMention();
    };

    const syncMention = () => {
        const text = textBeforeCaret();
        const match = /@([^\s@]*)$/.exec(text);
        if (!match || !inputs.length) {
            closeMention();
            return;
        }
        setMention({ query: match[1] || "" });
        setActiveIndex(0);
    };

    const closeMention = () => {
        setMention(null);
        setActiveIndex(0);
    };

    const insertReference = (input: NodeGenerationInput) => {
        const editor = editorRef.current;
        if (!editor) return;
        removeActiveMention();
        const chip = createReferenceChip(input, inputs, theme, setImagePreview);
        const space = document.createTextNode(" ");
        const selection = window.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
        if (range) {
            range.insertNode(space);
            range.insertNode(chip);
            range.setStartAfter(space);
            range.collapse(true);
            selection?.removeAllRanges();
            selection?.addRange(range);
        } else {
            editor.append(chip, space);
            placeCaretAtEnd(editor);
        }
        closeMention();
        emit(serializeEditor(editor));
    };

    const stopCanvasInteraction = (event: PointerEvent | MouseEvent) => event.stopPropagation();

    return (
        <div
            data-canvas-no-zoom data-canvas-shortcuts-ignore
            className="relative"
            onMouseDown={stopCanvasInteraction}
            onPointerDown={stopCanvasInteraction}
            onWheel={(event) => event.stopPropagation()}
        >
                {!value.trim() ? <div className="pointer-events-none absolute inset-x-0 top-0 text-sm leading-6" style={{ color: theme.node.placeholder }}>{t("canvas.composer.placeholder")}</div> : null}
                <div
                    ref={editorRef}
                    contentEditable
                    suppressContentEditableWarning
                    role="textbox"
                    aria-label={t("workbench.prompt")}
                    aria-multiline="true"
                    className={cn("thin-scrollbar min-h-[3lh] max-h-[10lh] w-full cursor-text overflow-x-hidden overflow-y-auto overscroll-contain whitespace-pre-wrap break-words rounded-lg text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30", className)}
                    style={{ color: theme.node.text }}
                    onInput={() => {
                        if (!composingRef.current) syncFromEditor();
                    }}
                    onCompositionStart={() => {
                        composingRef.current = true;
                    }}
                    onCompositionEnd={() => {
                        composingRef.current = false;
                        syncFromEditor();
                    }}
                    onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                        event.stopPropagation();
                        if (isImeComposing(event)) return;
                        if (mention && candidates.length) {
                            if (event.key === "ArrowDown") {
                                event.preventDefault();
                                setActiveIndex((index) => (index + 1) % candidates.length);
                                return;
                            }
                            if (event.key === "ArrowUp") {
                                event.preventDefault();
                                setActiveIndex((index) => (index - 1 + candidates.length) % candidates.length);
                                return;
                            }
                            if (event.key === "Enter") {
                                event.preventDefault();
                                insertReference(candidates[Math.min(activeIndex, candidates.length - 1)]);
                                return;
                            }
                            if (event.key === "Escape") {
                                event.preventDefault();
                                closeMention();
                                return;
                            }
                        }
                        if ((event.key === "Backspace" || event.key === "Delete") && deleteAdjacentReference(event.key)) {
                            event.preventDefault();
                            requestAnimationFrame(syncFromEditor);
                            return;
                        }
                        requestAnimationFrame(syncMention);
                    }}
                    onBlur={() => window.setTimeout(closeMention, 120)}
                />
                {mention && candidates.length ? <MentionMenu anchor={editorRef.current} inputs={candidates} allInputs={inputs} activeIndex={Math.min(activeIndex, candidates.length - 1)} theme={theme} onSelect={insertReference} /> : null}
            {imagePreview ? <MediaPreview src={imagePreview} alt={t("canvas.composer.imagePreview")} style={{ display: "none" }} open onOpenChange={(visible) => !visible && setImagePreview(null)} /> : null}
        </div>
    );

}

function MentionMenu({ anchor, inputs, allInputs, activeIndex, theme, onSelect }: { anchor: HTMLElement | null; inputs: NodeGenerationInput[]; allInputs: NodeGenerationInput[]; activeIndex: number; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onSelect: (input: NodeGenerationInput) => void }) {
    const selectedRef = useRef(false);
    const activeItemRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        activeItemRef.current?.scrollIntoView({ block: "nearest" });
    }, [activeIndex, inputs]);

    const selectInput = (input: NodeGenerationInput) => {
        if (selectedRef.current) return;
        selectedRef.current = true;
        onSelect(input);
    };

    const rect = anchor?.getBoundingClientRect();
    if (!rect) return null;
    const top = rect.bottom + 6 + 224 <= window.innerHeight ? rect.bottom + 6 : Math.max(8, rect.top - 224 - 6);
    return createPortal(
        <div data-ui-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore className="fixed z-[1600] max-h-56 w-64 max-w-[calc(100vw-16px)] overflow-x-hidden overflow-y-auto rounded-xl border p-1 shadow-lg" style={{ top, left: Math.max(8, Math.min(rect.left, window.innerWidth - 264)), background: theme.toolbar.panel, borderColor: theme.toolbar.border }} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
            {inputs.map((input, index) => (
                <button
                    key={input.nodeId}
                    ref={index === activeIndex ? activeItemRef : undefined}
                    type="button"
                    className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition"
                    style={{ background: index === activeIndex ? theme.toolbar.activeBg : "transparent", color: index === activeIndex ? theme.toolbar.activeText : theme.node.text }}
                    onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        selectInput(input);
                    }}
                >
                    <ResourcePreview input={input} />
                    <span className="min-w-0 flex-1">
                        <span className="block font-medium">{resourceLabel(input, allInputs)}</span>
                        <span className="block truncate opacity-65">{input.type === "group" ? i18n.t("canvas.node.nodeCount", { count: input.children.length }) : input.text || input.title}</span>
                    </span>
                </button>
            ))}
        </div>, document.body,
    );
}

function ResourcePreview({ input }: { input: NodeGenerationInput }) {
    if (input.type === "group") return <span className="grid size-9 shrink-0 place-items-center"><Group className="size-4" /></span>;
    if (input.type === "image" && input.image) return <img src={input.image.dataUrl} alt="" className="size-9 rounded-md object-cover" />;
    if (input.type === "video" && input.video) return <video src={input.video.url} className="size-9 rounded-md bg-black object-cover" muted preload="metadata" />;
    const Icon = input.type === "audio" ? Music2 : input.type === "video" ? Video : input.type === "image" ? ImageIcon : FileText;
    return (
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted">
            <Icon className="size-4" />
        </span>
    );
}

function createReferenceChip(input: NodeGenerationInput, inputs: NodeGenerationInput[], theme: (typeof canvasThemes)[keyof typeof canvasThemes], onImagePreview: (url: string) => void) {
    const wrapper = document.createElement("span");
    wrapper.contentEditable = "false";
    wrapper.dataset.referenceNodeId = input.nodeId;
    wrapper.className = "mx-px inline-flex h-7 max-w-40 items-center justify-center overflow-hidden rounded-md border px-1 text-xs leading-none align-middle";
    Object.assign(wrapper.style, chipStyle(theme));
    if (input.type === "image" && input.image) {
        const image = document.createElement("img");
        image.src = input.image.dataUrl;
        image.alt = input.title;
        image.className = "size-6 rounded object-cover";
        wrapper.className = "mx-px inline-flex size-6 items-center justify-center overflow-hidden rounded align-middle";
        wrapper.appendChild(image);
        wrapper.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            onImagePreview(input.image?.dataUrl || "");
        });
    } else {
        wrapper.title = input.type === "group" ? input.title : input.text || input.title;
        const text = document.createElement("span");
        text.className = "block truncate";
        text.textContent = input.type === "text" ? input.text || input.title : input.title;
        wrapper.appendChild(text);
    }
    return wrapper;
}

function serializeEditor(editor: HTMLElement) {
    return serializeNodes(editor.childNodes).replace(/\uFEFF/g, "");
}

function serializeNodes(nodes: NodeListOf<ChildNode>) {
    let result = "";
    nodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) result += node.textContent || "";
        if (!(node instanceof HTMLElement)) return;
        const nodeId = node.dataset.referenceNodeId;
        if (nodeId) result += `@[node:${nodeId}]`;
        else if (node.tagName === "BR") result += "\n";
        else result += serializeNodes(node.childNodes);
    });
    return result;
}

function removeActiveMention() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    const text = textBeforeCaret();
    const match = /@([^\s@]*)$/.exec(text);
    if (!match) return;
    range.setStart(range.startContainer, Math.max(0, range.startOffset - (match[1] || "").length - 1));
    range.deleteContents();
}

function deleteAdjacentReference(key: string) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    const target = adjacentReferenceNode(range, key);
    if (!target) return false;
    const nextCaretNode = document.createTextNode("");
    target.replaceWith(nextCaretNode);
    range.setStart(nextCaretNode, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
}

function adjacentReferenceNode(range: Range, key: string) {
    const container = range.startContainer;
    const offset = range.startOffset;
    const previous = key === "Backspace";
    if (container.nodeType === Node.TEXT_NODE) {
        const text = container.textContent || "";
        if ((previous && offset > 0) || (!previous && offset < text.length)) return null;
        return findReferenceSibling(container, previous);
    }
    const children = Array.from(container.childNodes);
    return findReferenceSibling(children[previous ? offset - 1 : offset] || container, previous, true);
}

function findReferenceSibling(node: Node, previous: boolean, includeSelf = false): HTMLElement | null {
    let current: Node | null = includeSelf ? node : previous ? node.previousSibling : node.nextSibling;
    while (current && current.nodeType === Node.TEXT_NODE && !(current.textContent || "").trim()) current = previous ? current.previousSibling : current.nextSibling;
    return current instanceof HTMLElement && current.dataset.referenceNodeId ? current : null;
}

function textBeforeCaret() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return "";
    const range = selection.getRangeAt(0).cloneRange();
    const editor = closestEditor(range.startContainer);
    if (!editor) return "";
    range.setStart(editor, 0);
    return range.toString();
}

function closestEditor(node: Node) {
    const element = node instanceof Element ? node : node.parentElement;
    return element?.closest("[contenteditable='true']") || null;
}

function placeCaretAtEnd(element: HTMLElement) {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}

function parseComposerTokens(value: string): Token[] {
    const tokens: Token[] = [];
    let lastIndex = 0;
    for (const match of value.matchAll(CONFIG_REFERENCE_PATTERN)) {
        if (match.index === undefined) continue;
        if (match.index > lastIndex) tokens.push({ type: "text", value: value.slice(lastIndex, match.index) });
        tokens.push({ type: "reference", nodeId: match[1] });
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < value.length) tokens.push({ type: "text", value: value.slice(lastIndex) });
    return tokens;
}

function resourceLabel(input: NodeGenerationInput, inputs: NodeGenerationInput[]) {
    const sameTypeInputs = inputs.filter((item) => item.type === input.type);
    const index = Math.max(0, sameTypeInputs.findIndex((item) => item.nodeId === input.nodeId));
    return i18n.t(`canvas.composer.resources.${input.type}`, { index: index + 1 });
}

function chipStyle(theme: (typeof canvasThemes)[keyof typeof canvasThemes]): CSSProperties {
    return { background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text };
}
