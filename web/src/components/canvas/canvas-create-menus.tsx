import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Menu } from "@/components/ui/popover";

import { listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { getNodeSpec } from "@/constant/canvas";
import { CanvasNodeType, type ConnectionHandle, type Position } from "@/types/canvas";

export type PendingConnectionCreate = {
    connection: ConnectionHandle;
    position: Position;
};

export function NodeCreateMenu({
    position,
    fromConnection = false,
    onCreate,
    onClose,
}: {
    position: Position;
    fromConnection?: boolean;
    onCreate: (type: string) => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    useNodeRegistryVersion();
    const previousFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const label = t(fromConnection ? "canvas.createMenu.fromNode" : "canvas.createMenu.select");
    const items = listNodeDefinitions()
        .filter((def) => def.showInCreateMenu !== false && (!fromConnection || def.type !== CanvasNodeType.Group))
        .map((def) => ({ key: def.type, icon: def.icon, label: getNodeSpec(def.type).title, onClick: () => onCreate(def.type) }));
    return (
        <Menu
            open
            placement="bottomLeft"
            items={items}
            itemClassName="min-h-8 px-2 py-1"
            onOpenChange={(open) => { if (!open) onClose(); }}
            contentProps={{
                "aria-label": label,
                className: "thin-scrollbar w-52 min-w-0 rounded-xl overscroll-contain",
                avoidCollisions: true,
                collisionPadding: 8,
                updatePositionStrategy: "always",
                onCloseAutoFocus: (event) => {
                    event.preventDefault();
                    previousFocus.current?.focus({ preventScroll: true });
                },
                onPointerDown: (event) => event.stopPropagation(),
                onMouseDown: (event) => event.stopPropagation(),
                onWheel: (event) => event.stopPropagation(),
                onContextMenu: (event) => { event.preventDefault(); event.stopPropagation(); },
            }}
        >
            <button type="button" tabIndex={-1} aria-label={label} className="pointer-events-none absolute size-px opacity-0" style={{ left: position.x, top: position.y }} />
        </Menu>
    );
}
