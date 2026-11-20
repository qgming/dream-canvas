import { useState } from "react";
import { Tabs } from "@animate-ui/react/primitives/radix-ui";
import { Reorder, useDragControls } from "motion/react";
import { useMotionTokens, useShouldReduceMotion } from "@animate-ui/react/utils/motion";
import { Bot, FileText, GripVertical, Image, Music2, Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge, Notice, Spinner } from "@/components/ui/display";
import { Button } from "@/components/ui/button";
import type { Capability, ChannelEntry } from "@/services/api/channels";
import { moveBy, sortByOrder } from "../use-model-ordering";
import { OrderButtons } from "./order-buttons";

type Item = { id: string; name: string; model: string; channel: string; enabled: boolean };

const groups = [
    { key: "image", label: "workspace.image", icon: Image },
    { key: "video", label: "workspace.video", icon: Video },
    { key: "text", label: "workspace.text", icon: FileText },
    { key: "audio", label: "workspace.audio", icon: Music2 },
    { key: "assistant", label: "modelOrdering.assistant", icon: Bot },
] as const;

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
        {queryError || error ? <Notice type={conflict ? "warning" : "error"} title={queryError || error} action={<div className="flex gap-2">{conflict ? <Button disabled={busy} onClick={onReload}>{t("workspace.reload")}</Button> : null}<Button disabled={busy} onClick={onRetry}>{t("workspace.retry")}</Button></div>} /> : null}
        {conflict && error ? <p className="text-xs text-muted-foreground">{t("modelOrdering.conflictHint")}</p> : null}
        {loading ? <Spinner label={t("settings.loading")} /> : <Tabs.Root value={tab} onValueChange={setTab} className="min-w-0">
            <div className="thin-scrollbar mb-4 min-w-0 overflow-x-auto overflow-y-hidden pb-2">
                <Tabs.List aria-label={t("workspace.type")} className="inline-flex w-max items-center gap-1 rounded-xl border border-border bg-card p-1">
                    {groups.map(({ key, label, icon: Icon }) => <Tabs.Trigger key={key} value={key} className="inline-flex h-8 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-accent data-[state=active]:text-card-foreground data-[state=active]:shadow-sm"><Icon className="size-4 text-foreground" />{t(label)}<span className="text-xs text-muted-foreground">{items(key).length}</span></Tabs.Trigger>)}
                </Tabs.List>
            </div>
            {groups.map(({ key }) => <Tabs.Content key={key} value={key} className="outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <OrderGroup value={key} items={items(key)} disabled={orderingDisabled} onPreview={onPreview} onCommit={onCommit} onReorder={onReorder} />
            </Tabs.Content>)}
        </Tabs.Root>}
    </section>;
}
