import { useState } from "react";
import { Reorder, useDragControls } from "motion/react";
import { useMotionTokens, useShouldReduceMotion } from "@animate-ui/react/utils/motion";
import { GripVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge, Notice, Spinner } from "@/components/ui/display";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import type { Capability, ChannelEntry } from "@/services/api/channels";
import { moveBy, sortByOrder } from "../use-model-ordering";
import { OrderButtons } from "./order-buttons";

type Item = { id: string; name: string; model: string; channel: string; enabled: boolean };

const groups: { key: Capability | "assistant"; label: string }[] = [
    { key: "image", label: "workspace.image" },
    { key: "video", label: "workspace.video" },
    { key: "text", label: "workspace.text" },
    { key: "audio", label: "modelScripts.tts" },
    { key: "assistant", label: "modelOrdering.assistant" },
];

function OrderRow({ item, index, count, disabled, onOrderStart, onOrderEnd, onMove }: { item: Item; index: number; count: number; disabled: boolean; onOrderStart: () => void; onOrderEnd: () => void; onMove: (index: number) => void }) {
    const { t } = useTranslation();
    const controls = useDragControls();
    const tokens = useMotionTokens();
    const reducedMotion = useShouldReduceMotion();
    const dragLabel = t("modelOrdering.dragItem", { name: item.name });
    return <Reorder.Item value={item.id} tabIndex={-1} drag={disabled ? false : "y"} dragListener={false} dragControls={controls} transition={reducedMotion ? tokens.transition.instant : tokens.spring.reflow} onKeyDown={(event) => { if (event.target === event.currentTarget) event.preventDefault(); }} onDragStart={disabled ? undefined : onOrderStart} onDragEnd={disabled ? undefined : onOrderEnd} className="flex items-center gap-2 border-b border-border px-2 py-2 last:border-b-0">
        <Button type="button" tabIndex={-1} variant="ghost" size="icon" className="size-7 touch-none enabled:cursor-grab enabled:active:cursor-grabbing" disabled={disabled} aria-label={dragLabel} onPointerDown={(event) => { if (!disabled) controls.start(event); }}>
            <GripVertical />
        </Button>
        <OrderButtons label={dragLabel} index={index} count={count} disabled={disabled} onMove={onMove} />
        <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 break-words text-sm font-medium">{item.name || item.model}</span>
                <Badge color={item.enabled ? "success" : undefined}>{t(item.enabled ? "workspace.enabled" : "workspace.disabled")}</Badge>
            </div>
            <p className="mt-0.5 break-all text-xs text-muted-foreground">{item.channel} · {item.model}</p>
        </div>
    </Reorder.Item>;
}

function OrderGroup({ value, items, disabled, onPreview, onCommit, onReorder }: { value: string; items: Item[]; disabled: boolean; onPreview: (value: string, ids: string[]) => void; onCommit: (value: string) => void; onReorder: (value: string, ids: string[]) => void }) {
    const { t } = useTranslation();
    const ids = items.map((item) => item.id);
    return items.length ? <Reorder.Group axis="y" values={ids} onReorder={(next) => onPreview(value, next)} className="overflow-hidden rounded-lg border border-border bg-card text-card-foreground">
        {items.map((item, index) => <OrderRow key={item.id} item={item} index={index} count={items.length} disabled={disabled} onOrderStart={() => onPreview(value, ids)} onOrderEnd={() => onCommit(value)} onMove={(nextIndex) => onReorder(value, moveBy(ids, index, nextIndex))} />)}
    </Reorder.Group> : <p className="py-8 text-center text-sm text-muted-foreground">{t("modelOrdering.empty")}</p>;
}

export function ModelOrderingSettings({ channels, orders, loading, queryError, busy, error, conflict, onPreview, onCommit, onReorder, onRetry, onReload }: {
    channels: ChannelEntry[];
    orders: Record<string, string[]>;
    loading: boolean;
    queryError: string;
    busy: boolean;
    error: string;
    conflict: boolean;
    onPreview: (key: string, ids: string[]) => void;
    onCommit: (key: string) => void;
    onReorder: (key: string, ids: string[]) => void;
    onRetry: () => void;
    onReload: () => void;
}) {
    const { t } = useTranslation();
    const [tab, setTab] = useState("image");
    const all = channels.flatMap((channel) => channel.models.map((model) => ({
        id: model.id,
        name: model.name,
        model: model.model,
        enabled: model.enabled,
        channel: channel.channel.name,
        capability: model.capability,
        tools: model.features?.tools === true,
    })));
    const orderingDisabled = loading || busy || Boolean(queryError);
    const items = (capability: Capability | "assistant") => {
        const key = capability;
        const candidates = all.filter((model) => capability === "assistant" ? model.capability === "text" && model.tools : model.capability === capability);
        return sortByOrder(candidates, (model) => model.id, orders[key]);
    };
    return <section className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="text-base font-medium">{t("modelOrdering.title")}</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{t("modelOrdering.description")}</p></div>
            <span role="status" className="text-xs text-muted-foreground">{loading ? t("settings.loading") : busy ? t("modelOrdering.saving") : error || queryError ? t("workspace.saveFailed") : t("workspace.allSaved")}</span>
        </div>
        {queryError || error ? <Notice type={conflict ? "warning" : "error"} title={queryError || error} action={<div className="flex gap-2">{conflict ? <Button disabled={busy} onClick={onReload}>{t("workspace.reload")}</Button> : null}<Button disabled={busy} onClick={onRetry}>{t("workspace.retry")}</Button></div>} /> : null}
        {conflict && error ? <p className="text-xs text-muted-foreground">{t("modelOrdering.conflictHint")}</p> : null}
        {loading ? <Spinner label={t("settings.loading")} /> : <Tabs value={tab} onValueChange={setTab} items={groups.map((group) => {
            const groupItems = items(group.key);
            return {
                key: group.key,
                label: <>{t(group.label)} <span className="ml-1 text-xs text-muted-foreground">{groupItems.length}</span></>,
                children: <OrderGroup value={group.key} items={groupItems.map(({ id, name, model, channel, enabled }) => ({ id, name, model, channel, enabled }))} disabled={orderingDisabled} onPreview={onPreview} onCommit={onCommit} onReorder={onReorder} />,
            };
        })} />}
    </section>;
}
