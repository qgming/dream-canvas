import { useEffect, useId, useMemo, useState } from "react";
import { Check, ChevronDown, CircleAlert, Cpu } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Popover } from "@animate-ui/react/primitives/radix-ui";
import { Command } from "cmdk";
import i18n from "@/i18n";
import { inputClass } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { findChannelModel, modelOptionLabel, modelOptionName, selectableModelsByCapability, type AiConfig, type ChannelModel, type ModelCapability } from "@/stores/use-config-store";

type ModelPickerProps = {
    config: AiConfig; value?: string; onChange: (model: string) => void; capability?: ModelCapability; toolsOnly?: boolean;
    className?: string; fullWidth?: boolean; placeholder?: string; onMissingConfig?: () => void; id?: string; disabled?: boolean;
    "aria-label"?: string; "aria-describedby"?: string;
    filterModel?: (model: ChannelModel) => boolean; emptyLabel?: string;
};

export function ModelPicker({ config, value, onChange, capability, toolsOnly = false, className, fullWidth = false, placeholder, onMissingConfig, id, disabled = false, "aria-label": ariaLabel, "aria-describedby": ariaDescription, filterModel, emptyLabel }: ModelPickerProps) {
    const { t } = useTranslation();
    const pickerId = useId();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [listId, setListId] = useState<string>();
    const options = useMemo(() => selectableModelsByCapability(config, capability, toolsOnly).filter((value) => !filterModel || filterModel(findChannelModel(config, value)!.model)), [capability, config, toolsOnly, filterModel]);
    const groups = useMemo(() => {
        const result: { channelId: string; name: string; models: string[] }[] = [];
        for (const value of options) {
            const match = findChannelModel(config, value)!;
            if (result.at(-1)?.channelId !== match.channel.id) result.push({ channelId: match.channel.id, name: match.channel.name, models: [] });
            result.at(-1)!.models.push(value);
        }
        return result;
    }, [config, options]);
    const current = value || "";
    const invalid = Boolean(current && !options.includes(current));
    const pickerPlaceholder = placeholder || t("settingsPanels.model.select");
    useEffect(() => {
        const closeOtherPicker = (event: Event) => { if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false); };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    return <Popover.Root open={open && !disabled} onOpenChange={(next) => {
        if (next && disabled) return;
        if (next && !options.length) onMissingConfig?.();
        if (next) window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
        setQuery(""); setOpen(next);
    }}>
        <Tooltip open={open ? false : undefined} title={invalid ? t("settingsPanels.model.unavailable") : current ? modelOptionLabel(config, current) : pickerPlaceholder}><Popover.Trigger asChild><button type="button" role="combobox" id={id} disabled={disabled} aria-label={ariaLabel || t("workbench.model")} aria-describedby={ariaDescription} aria-expanded={open} aria-controls={open ? listId : undefined} aria-haspopup="listbox" aria-invalid={invalid || undefined} className={cn("canvas-composer-model-picker flex h-8 w-fit max-w-full items-center gap-2 rounded-md border border-input bg-card px-3 text-sm font-normal text-card-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:border-ring aria-invalid:border-destructive aria-invalid:text-destructive disabled:cursor-not-allowed disabled:opacity-50", fullWidth ? "w-full min-w-0 justify-start" : "min-w-[9rem] justify-start", className)} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            {invalid ? <CircleAlert className="size-4 shrink-0" /> : <ModelIcon model={current} />}
            <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{current ? modelOptionLabel(config, current) : pickerPlaceholder}</span><ChevronDown className="size-3.5 shrink-0" />
        </button></Popover.Trigger></Tooltip>
        <Popover.Portal><Popover.Content data-ui-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore sideOffset={6} align="start" className="z-[1500] w-96 max-w-[calc(100vw-32px)] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg outline-none" onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
            {invalid ? <p role="alert" className="border-b border-border px-3 py-2 text-xs text-destructive">{t("settingsPanels.model.unavailable")}</p> : null}
            <Command label={ariaLabel || t("workbench.model")} loop>
                <Command.Input value={query} onValueChange={setQuery} aria-label={t("workspace.searchModels")} placeholder={t("workspace.searchModels")} className={cn(inputClass, "rounded-none border-0 border-b px-3")} />
                <Command.List ref={(element) => { if (element) setListId(element.id); }} className="thin-scrollbar max-h-80 overflow-x-hidden overflow-y-auto p-1" aria-label={ariaLabel || t("workbench.model")}>
                    <Command.Empty className="px-3 py-4 text-sm text-muted-foreground">{options.length ? t("ui.noMatches") : emptyLabel || emptyModelLabel(config, capability)}</Command.Empty>
                    {groups.map((group, index) => <Command.Group key={`${group.channelId}:${index}`} heading={group.name} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
                        {group.models.map((model) => {
                            const selected = findChannelModel(config, model)!.model;
                            return <Command.Item key={model} value={model} keywords={[selected.label, selected.name, group.name]} onSelect={() => { onChange(model); setOpen(false); setQuery(""); }} className="flex cursor-default items-center gap-2 rounded-md px-2 py-2 text-sm outline-none data-[selected=true]:bg-accent">
                                <ModelIcon model={model} /><span className="min-w-0 flex-1"><span className="block truncate">{selected.label || selected.name}</span><span className="block truncate text-xs text-muted-foreground">{selected.name}</span></span>{current === model ? <Check className="size-4 shrink-0" /> : null}
                            </Command.Item>;
                        })}
                    </Command.Group>)}
                </Command.List>
            </Command>
        </Popover.Content></Popover.Portal>
    </Popover.Root>;
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability ? i18n.t(`settingsPanels.model.capabilities.${capability}`) : "";
    if (capability && config.models.length) return i18n.t("settingsPanels.model.assign", { capability: label });
    return config.models.length ? i18n.t("settingsPanels.model.noMatch", { capability: label }) : i18n.t("settingsPanels.model.addFirst");
}

function ModelIcon({ model }: { model: string }) {
    const name = modelOptionName(model).toLowerCase();
    const icon = name.includes("claude") || name.includes("anthropic") ? "claude" : name.includes("gemini") || name.includes("google") ? "gemini" : name.includes("gpt") || name.includes("openai") ? "openai" : name.includes("grok") ? "grok" : name.includes("deepseek") ? "deepseek" : name.includes("glm") ? "glm" : "";
    return icon ? <img src={`/icons/${icon}.svg`} alt="" className="size-4 shrink-0 dark:invert" /> : <Cpu className="size-4 shrink-0" />;
}
