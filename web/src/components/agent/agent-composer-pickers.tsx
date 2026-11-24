import { useEffect, useMemo, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { Command } from "cmdk";
import { Popover } from "@animate-ui/react/primitives/radix-ui";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, Notice, Spinner } from "@/components/ui/display";
import { inputClass, SearchInput } from "@/components/ui/input";
import { buildCanvasResourceReferences } from "@/lib/canvas/canvas-resource-references";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { canvasReferenceIcon } from "./agent-canvas-reference-preview";
import { agentReferenceMarker } from "./agent-chat-inline-tokens";
import { useAgentReferenceNodes } from "./use-agent-reference-nodes";

export function AgentSkillPicker({ disabled }: { disabled?: boolean }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const skills = useAgentSkillStore((state) => state.skills);
    const selected = useAgentSkillStore((state) => state.selectedSkill);
    const loading = useAgentSkillStore((state) => state.loading);
    const errors = useAgentSkillStore((state) => state.errors);
    useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
    return <Popover.Root open={open && !disabled} onOpenChange={(next) => {
        setOpen(next);
        const catalog = useAgentSkillStore.getState();
        if (next && !disabled && !catalog.loading) void catalog.loadSkills();
    }}>
        <Popover.Trigger asChild><Button variant="ghost" size="icon" disabled={disabled} title={t("agent.skills.selectLocal")} aria-label={t("agent.skills.selectLocal")} aria-pressed={Boolean(selected)} className="aria-pressed:bg-accent" icon={<Sparkles />} /></Popover.Trigger>
        <Popover.Portal><Popover.Content side="top" align="start" sideOffset={8} data-ui-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore className="z-[1500] w-80 max-w-[calc(100vw-32px)] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg outline-none" onWheel={(event) => event.stopPropagation()}>
            <Command label={t("agent.skills.selectLocal")} loop>
                <Command.Input aria-label={t("agent.drawer.skillSearch")} placeholder={t("agent.drawer.skillSearch")} className={`${inputClass} rounded-none border-0 border-b px-3`} />
                {errors.length ? <Notice type="error" className="m-2 p-2" title={errors.join(" · ")} action={<Button size="sm" disabled={loading} onClick={() => void useAgentSkillStore.getState().loadSkills()}>{t("workspace.retry")}</Button>} /> : null}
                {loading ? <div className="flex justify-center p-3"><Spinner size="small" /></div> : null}
                <Command.List className="thin-scrollbar max-h-[min(18rem,45dvh)] overflow-x-hidden overflow-y-auto p-1">
                    {!loading && !errors.length ? <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">{t("agent.drawer.noSkills")}</Command.Empty> : null}
                    {skills.filter((skill) => skill.enabled).map((skill) => <Command.Item key={skill.path} value={skill.name} keywords={[skill.interface?.displayName || "", skill.description]} onSelect={() => { useAgentSkillStore.getState().selectSkill(skill); setOpen(false); }} className="flex cursor-default items-center gap-2 rounded-lg px-3 py-2 outline-none data-[selected=true]:bg-accent">
                        <Sparkles className="size-4 shrink-0" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{skill.interface?.displayName || skill.name}</span><span className="block truncate text-xs text-muted-foreground">{skill.interface?.shortDescription || skill.shortDescription || skill.description}</span></span>{selected?.name === skill.name ? <Check className="size-4 shrink-0" /> : null}
                    </Command.Item>)}
                </Command.List>
            </Command>
        </Popover.Content></Popover.Portal>
    </Popover.Root>;
}

export function AgentCanvasPicker({ open, onClose, targetProjectId, disabled }: { open: boolean; onClose: () => void; targetProjectId: string; disabled?: boolean }) {
    const { t } = useTranslation();
    const { nodes } = useAgentReferenceNodes(targetProjectId, open);
    const selected = useAgentStore((state) => state.canvasReferences);
    const [query, setQuery] = useState("");
    const otherProject = selected.some((item) => item.projectId !== targetProjectId);
    const references = useMemo(() => open && nodes ? buildCanvasResourceReferences(nodes) : [], [nodes, open]);
    const filtered = references.filter((reference) => !query.trim() || `${reference.title} ${reference.label} ${reference.text || ""}`.toLowerCase().includes(query.trim().toLowerCase()));
    return <Dialog title={t("agent.drawer.addCanvas")} open={open} onClose={onClose} footer={null} width={620}>
        {!nodes || otherProject ? <Notice title={t(otherProject ? "workspace.referencesProject" : "agent.drawer.canvasUnavailable")} /> : <>
            <SearchInput className="mb-3" aria-label={t("agent.drawer.searchCanvas")} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("agent.drawer.searchCanvas")} />
            <div className="thin-scrollbar max-h-[55dvh] space-y-1 overflow-y-auto">
            {filtered.map((reference) => {
                const Icon = canvasReferenceIcon(reference.kind);
                const added = selected.some((item) => item.nodeId === reference.nodeId);
                return <button key={reference.nodeId} type="button" disabled={disabled || added} className="flex w-full items-center gap-3 rounded-lg p-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" onClick={() => {
                    const state = useAgentStore.getState();
                    if (disabled || !open || state.canvasReferences.some((item) => item.nodeId === reference.nodeId || item.projectId !== targetProjectId)) return;
                    const marker = agentReferenceMarker(reference);
                    useAgentStore.setState({ canvasReferences: [...state.canvasReferences, { ...reference, projectId: targetProjectId }], prompt: `${state.prompt}${state.prompt && !/\s$/.test(state.prompt) ? " " : ""}${marker} ` });
                    onClose();
                }}>
                    {reference.kind === "image" && reference.previewUrl ? <img src={reference.previewUrl} alt="" loading="lazy" className="size-12 shrink-0 rounded-md object-cover" /> : <span className="grid size-12 shrink-0 place-items-center"><Icon className="size-5" /></span>}
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{reference.title}</span><span className="block truncate text-xs text-muted-foreground">{t(`assets.kinds.${reference.kind}`)}</span></span>{added ? <Check className="size-4 shrink-0" /> : null}
                </button>;
            })}
            {!filtered.length ? <EmptyState description={t("agent.composer.mentions.noResources")} /> : null}
            </div>
        </>}
    </Dialog>;
}
