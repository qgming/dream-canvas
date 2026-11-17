import { Menu, type MenuItem } from "@/components/ui/popover";
import { BetweenHorizontalStart, GalleryHorizontalEnd, GalleryHorizontal, Group, Plus, Trash2, Ungroup } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ContextMenuState } from "@/types/canvas";
import type { VideoFramePosition } from "@/lib/canvas/canvas-video-frame";

export function CanvasNodeContextMenu({ menu, canCaptureVideoFrame, canGroup, canUngroup, onClose, onCaptureVideoFrame, onDuplicate, onGroup, onUngroup, onDelete }: { menu: ContextMenuState; canCaptureVideoFrame: boolean; canGroup?: boolean; canUngroup?: boolean; onClose: () => void; onCaptureVideoFrame: (position: VideoFramePosition) => void; onDuplicate: () => void; onGroup?: () => void; onUngroup?: () => void; onDelete: () => void }) {
    const { t } = useTranslation();
    const action = (callback?: () => void) => () => { callback?.(); onClose(); };
    const items: MenuItem[] = [
        ...(canCaptureVideoFrame ? [
            { key: "first", icon: <BetweenHorizontalStart />, label: t("canvas.videoFrames.first"), onClick: action(() => onCaptureVideoFrame("first")) },
            { key: "last", icon: <GalleryHorizontalEnd />, label: t("canvas.videoFrames.last"), onClick: action(() => onCaptureVideoFrame("last")) },
            { key: "current", icon: <GalleryHorizontal />, label: t("canvas.videoFrames.current"), onClick: action(() => onCaptureVideoFrame("current")) },
            { type: "divider" as const },
        ] : []),
        ...(menu.type === "node" && canGroup ? [{ key: "group", icon: <Group />, label: t("canvas.nodeToolbar.group"), onClick: action(onGroup) }] : []),
        ...(menu.type === "node" && canUngroup ? [{ key: "ungroup", icon: <Ungroup />, label: t("canvas.nodeToolbar.ungroup"), onClick: action(onUngroup) }] : []),
        ...(menu.type === "node" ? [{ key: "duplicate", icon: <Plus />, label: t("canvas.controls.duplicate"), onClick: action(onDuplicate) }] : []),
        { key: "delete", icon: <Trash2 />, label: t("canvas.controls.delete"), danger: true, onClick: action(onDelete) },
    ];
    return <Menu open onOpenChange={(next) => { if (!next) onClose(); }} items={items} placement="bottomLeft"><button type="button" tabIndex={-1} aria-label={t("canvas.openMenu")} className="pointer-events-none fixed size-px opacity-0" style={{ left: menu.x, top: menu.y }} /></Menu>;
}
