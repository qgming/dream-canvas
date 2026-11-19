import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { getNodeSpec } from "@/constant/canvas";
import { CanvasNodeType, type ConnectionHandle, type Position } from "@/types/canvas";

export type PendingConnectionCreate = {
    connection: ConnectionHandle;
    position: Position;
};

export function ConnectionCreateMenu({
    pending,
    scale = 1,
    onCreate,
    onClose,
}: {
    pending: PendingConnectionCreate;
    scale?: number;
    onCreate: (type: string) => void;
    onClose: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    useNodeRegistryVersion();
    const definitions = listNodeDefinitions().filter((def) => def.showInCreateMenu !== false && def.type !== CanvasNodeType.Group);
    const menuRef = useRef<HTMLDivElement>(null);
    useMenuFocus(menuRef, onClose);
    return (
        <div
            ref={menuRef} role="menu" aria-label={t("canvas.createMenu.fromNode")} data-ui-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore onKeyDown={menuKeyDown}
            className="absolute z-[120] max-h-[70vh] w-[240px] overflow-x-hidden overflow-y-auto rounded-xl border p-2 shadow-lg thin-scrollbar"
            data-connection-create-menu
            style={{ left: pending.position.x, top: pending.position.y, transform: `scale(${1 / scale})`, transformOrigin: "top left", background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="mb-1.5 flex items-center justify-between px-1">
                <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
                    {t("canvas.createMenu.fromNode")}
                </span>
                <Button variant="ghost" size="icon" className="size-7 opacity-55 hover:opacity-100" onClick={onClose} aria-label={t("canvas.createMenu.close")}><X /></Button>
            </div>
            <div className="grid gap-0.5">
                {definitions.map((def) => <ConnectionCreateOption key={def.type} theme={theme} icon={def.icon} title={getNodeSpec(def.type).title} description={def.description} onClick={() => onCreate(def.type)} />)}
            </div>
        </div>
    );
}

export function ConnectionCreateOption({ theme, icon, title, description, onClick }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; icon: React.ReactNode; title: string; description?: string; onClick?: () => void }) {
    return (
        <button
            type="button"
            role="menuitem"
            className="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left outline-none transition focus-visible:bg-accent"
            style={{ color: theme.node.text }}
            onClick={onClick}
            onMouseEnter={(event) => (event.currentTarget.style.background = theme.node.fill)}
            onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
        >
            <span className="grid size-7 shrink-0 place-items-center [&_svg]:size-4 [&_svg]:shrink-0" style={{ color: theme.node.muted }}>
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-medium leading-5">{title}</span>
                {description ? (
                    <span className="mt-0.5 block truncate text-xs" style={{ color: theme.node.muted }}>
                        {description}
                    </span>
                ) : null}
            </span>
        </button>
    );
}

export function NodeCreateMenu({ position, scale = 1, onCreate, onClose }: { position: Position; scale?: number; onCreate: (type: string) => void; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    useNodeRegistryVersion();
    const menuRef = useRef<HTMLDivElement>(null);
    useMenuFocus(menuRef, onClose);
    const definitions = listNodeDefinitions().filter((def) => def.showInCreateMenu !== false);
    // Close automatically when clicking outside the menu.
    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        return () => document.removeEventListener("pointerdown", handlePointerDown, true);
    }, [onClose]);
    return (
        <div
            ref={menuRef}
            role="menu" aria-label={t("canvas.createMenu.select")} data-ui-overlay data-canvas-shortcuts-ignore onKeyDown={menuKeyDown}
            className="absolute z-[120] max-h-[70vh] w-[240px] overflow-x-hidden overflow-y-auto rounded-xl border p-2 shadow-lg thin-scrollbar"
            data-canvas-no-zoom
            style={{ left: position.x, top: position.y, transform: `scale(${1 / scale})`, transformOrigin: "top left", background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="mb-1.5 flex items-center justify-between px-1">
                <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
                    {t("canvas.createMenu.select")}
                </span>
                <Button variant="ghost" size="icon" className="size-7 rounded-lg opacity-55 hover:opacity-100" onClick={onClose} aria-label={t("canvas.createMenu.close")}>
                    <X className="size-4" />
                </Button>
            </div>
            <div className="grid gap-0.5">
                {definitions.map((def) => (
                    <ConnectionCreateOption key={def.type} theme={theme} icon={def.icon} title={getNodeSpec(def.type).title} description={def.description} onClick={() => onCreate(def.type)} />
                ))}
            </div>
        </div>
    );
}

function useMenuFocus(ref: React.RefObject<HTMLDivElement | null>, onClose: () => void) {
    const close = useRef(onClose);
    close.current = onClose;
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
        const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); } };
        const element = ref.current;
        element?.addEventListener("keydown", escape);
        return () => { element?.removeEventListener("keydown", escape); previous?.focus(); };
    }, [ref]);
}

function menuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]")];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    event.preventDefault(); event.stopPropagation(); items[next]?.focus();
}
