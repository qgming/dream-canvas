import { Popover } from "@animate-ui/react/primitives/radix-ui";
import { Command } from "cmdk";
import { Check, ChevronDown, X } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { inputClass } from "./input";
import { Badge } from "./display";

type ChoiceProps<T> = Omit<ComponentProps<"button">, "value" | "onChange" | "onSelect"> & {
    value?: T | T[]; onChange?: (value: any) => void;
    options?: { value: T; label?: ReactNode; disabled?: boolean }[];
    placeholder?: string; multiple?: boolean; creatable?: boolean; searchable?: boolean;
    clearable?: boolean; compact?: boolean; borderless?: boolean;
};

export function Choice<T extends string | number>({ value, onChange, options = [], placeholder, multiple, creatable, searchable, clearable, className, compact, borderless, ...props }: ChoiceProps<T>) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [listId, setListId] = useState<string>();
    const selected = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
    const choose = (next: T) => {
        onChange?.(multiple ? selected.includes(next) ? selected.filter((entry) => entry !== next) : [...selected, next] : next);
        setQuery("");
        if (!multiple) setOpen(false);
    };
    const canCreate = creatable && query.trim() && !options.some((item) => String(item.value) === query.trim());
    return <Popover.Root open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}>
        <Popover.Trigger asChild><button {...props} type="button" role="combobox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-haspopup="listbox" aria-label={props["aria-label"] || placeholder} className={cn(inputClass, "h-auto min-h-8 items-center gap-2 text-left", compact && "min-h-7 text-xs", borderless && "border-transparent", className)}>
            <span className={cn("flex min-w-0 flex-1 flex-wrap gap-1", !selected.length && "text-muted-foreground")}>{selected.length ? selected.map((entry) => {
                const label = options.find((item) => item.value === entry)?.label ?? entry;
                return multiple ? <Badge key={String(entry)}>{label}</Badge> : <span key={String(entry)} className="truncate">{label}</span>;
            }) : placeholder || t("ui.select")}</span><ChevronDown className="size-3.5 shrink-0 text-foreground" />
        </button></Popover.Trigger>
        <Popover.Portal><Popover.Content data-choice-content data-ui-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore sideOffset={6} align="start" className="z-[1500] min-w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-32px)] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg outline-none" onWheel={(event) => event.stopPropagation()}>
            <Command label={props["aria-label"] || placeholder || t("ui.select")} loop>
                <Command.Input value={query} onValueChange={setQuery} placeholder={t("ui.search")} aria-label={t("ui.search")} className={cn(inputClass, "rounded-none border-0 border-b px-3", !searchable && !multiple && !creatable && "sr-only")} />
                <Command.List ref={(element) => { if (element) setListId(element.id); }} aria-label={props["aria-label"] || placeholder || t("ui.select")} className="max-h-64 overflow-x-hidden overflow-y-auto p-1" aria-multiselectable={multiple || undefined}>
                    <Command.Empty className="px-3 py-4 text-sm text-muted-foreground">{t("ui.noMatches")}</Command.Empty>
                    {clearable && selected.length ? <Command.Item value="__clear_selection__" keywords={[t("ui.clear")]} onSelect={() => { onChange?.(multiple ? [] : undefined); setOpen(false); }} className="flex cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground data-[selected=true]:bg-accent"><X className="size-4" />{t("ui.clear")}</Command.Item> : null}
                    {options.map((item) => <Command.Item key={String(item.value)} value={`option:${item.value}`} keywords={[String(item.value), ...(typeof item.label === "string" ? [item.label] : [])]} disabled={item.disabled} onSelect={() => choose(item.value)} className="flex cursor-default items-center gap-3 rounded-md px-3 py-2 text-sm outline-none data-[selected=true]:bg-accent data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50"><span className="min-w-0 flex-1">{item.label ?? item.value}</span>{selected.includes(item.value) ? <Check className="size-4" /> : null}</Command.Item>)}
                    {canCreate ? <Command.Item value={query.trim()} onSelect={() => choose(query.trim() as T)} className="cursor-default rounded-md px-3 py-2 text-sm data-[selected=true]:bg-accent">{t("ui.useValue", { value: query.trim() })}</Command.Item> : null}
                    {multiple ? selected.filter((entry) => !options.some((item) => item.value === entry)).map((entry) => <Command.Item key={String(entry)} value={String(entry)} onSelect={() => choose(entry)} className="flex cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm data-[selected=true]:bg-accent"><span className="flex-1">{entry}</span><Check className="size-4" /></Command.Item>) : null}
                </Command.List>
            </Command>
        </Popover.Content></Popover.Portal>
    </Popover.Root>;
}
