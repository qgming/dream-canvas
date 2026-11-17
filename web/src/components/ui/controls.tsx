import { createContext, useContext, type ReactNode, type ComponentProps } from "react";
import { Checkbox as CheckboxPrimitive, Switch as SwitchPrimitive, Slider as SliderPrimitive, RadioGroup, ToggleGroup } from "radix-ui";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

type Option<T> = T | { value: T; label: ReactNode; disabled?: boolean };
const option = <T,>(entry: Option<T>) => typeof entry === "object" && entry !== null && "value" in entry ? entry as { value: T; label: ReactNode; disabled?: boolean } : { value: entry as T, label: entry as ReactNode };
const CheckboxGroupContext = createContext<{ value: unknown[]; onChange: (values: unknown[]) => void } | null>(null);
type CheckboxProps = Omit<ComponentProps<typeof CheckboxPrimitive.Root>, "checked" | "defaultChecked" | "value" | "onChange"> & { checked?: boolean; indeterminate?: boolean; value?: unknown; onChange?: (event: { target: { checked: boolean } }) => void };
function CheckboxControl({ checked, indeterminate, disabled, value, onChange, children, className, ...props }: CheckboxProps) {
    const group = useContext(CheckboxGroupContext);
    const selected = group ? group.value.includes(value) : checked;
    return <label className={cn("inline-flex cursor-pointer items-center gap-2 text-sm", disabled && "cursor-not-allowed opacity-50", className)}><CheckboxPrimitive.Root {...props} checked={indeterminate ? "indeterminate" : Boolean(selected)} disabled={disabled} onCheckedChange={(next) => { const state = next === true; if (group) group.onChange(state ? [...group.value, value] : group.value.filter((entry) => entry !== value)); onChange?.({ target: { checked: state } }); }} className="grid size-4 shrink-0 place-items-center rounded-[4px] border border-input outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground"><CheckboxPrimitive.Indicator>{indeterminate ? <Minus className="size-3" /> : <Check className="size-3" />}</CheckboxPrimitive.Indicator></CheckboxPrimitive.Root>{children}</label>;
}
function CheckboxGroup({ value = [], onChange, options, children, className, ...props }: Omit<ComponentProps<"div">, "onChange"> & { value?: unknown[]; onChange?: (values: unknown[]) => void; options?: Option<unknown>[] }) {
    return <CheckboxGroupContext.Provider value={{ value, onChange: (next) => onChange?.(next) }}><div role="group" tabIndex={-1} {...props} className={cn("flex flex-wrap gap-3", className)}>{options ? options.map((entry, index) => { const item = option(entry); return <CheckboxControl key={index} value={item.value} disabled={item.disabled}>{item.label}</CheckboxControl>; }) : children}</div></CheckboxGroupContext.Provider>;
}
export const Checkbox = Object.assign(CheckboxControl, { Group: CheckboxGroup });

export function Switch({ checked, onChange, disabled, loading, size, className, checkedChildren, unCheckedChildren, ...props }: Omit<ComponentProps<typeof SwitchPrimitive.Root>, "onChange"> & { onChange?: (value: boolean) => void; loading?: boolean; size?: "small"; checkedChildren?: ReactNode; unCheckedChildren?: ReactNode }) {
    return <SwitchPrimitive.Root {...props} checked={Boolean(checked)} onCheckedChange={onChange} disabled={disabled || loading} className={cn("inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-input p-0.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 data-[state=checked]:bg-primary", size === "small" && "h-4 w-7", className)}><SwitchPrimitive.Thumb className={cn("block size-4 rounded-full bg-background shadow-sm transition-transform data-[state=checked]:translate-x-4", size === "small" && "size-3 data-[state=checked]:translate-x-3")} /></SwitchPrimitive.Root>;
}

export function Slider({ value, onChange, min = 0, max = 100, step = 1, className, ...props }: Omit<ComponentProps<typeof SliderPrimitive.Root>, "value" | "defaultValue" | "onChange"> & { value?: number; onChange?: (value: number) => void }) {
    return <SliderPrimitive.Root tabIndex={-1} {...props} min={min} max={max} step={step} value={[value ?? min]} onValueChange={([next]) => onChange?.(next)} className={cn("relative flex h-8 w-full touch-none items-center select-none outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}><SliderPrimitive.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-secondary"><SliderPrimitive.Range className="absolute h-full bg-primary" /></SliderPrimitive.Track><SliderPrimitive.Thumb aria-label={props["aria-label"]} className="block size-4 rounded-full border border-primary bg-background shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" /></SliderPrimitive.Root>;
}

export function Segmented<T extends string | number>({ value, onChange, options, className, size, block, id, "aria-label": ariaLabel }: { value?: T; onChange?: (value: T) => void; options: Option<T>[]; className?: string; size?: "small" | "middle" | "large"; block?: boolean; id?: string; "aria-label"?: string }) {
    return <ToggleGroup.Root type="single" id={id} aria-label={ariaLabel} value={String(value ?? "")} onValueChange={(next) => { if (!next) return; const match = options.map(option).find((item) => String(item.value) === next); if (match) onChange?.(match.value); }} className={cn("inline-flex max-w-full items-center gap-1 rounded-md bg-muted p-1", block && "flex w-full", className)}>{options.map((entry) => { const item = option(entry); return <ToggleGroup.Item key={String(item.value)} value={String(item.value)} disabled={item.disabled} className={cn("inline-flex min-h-7 flex-1 items-center justify-center gap-2 rounded-sm px-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm", size === "small" && "min-h-6 text-xs")}>{item.label}</ToggleGroup.Item>; })}</ToggleGroup.Root>;
}

function Radio({ value, children }: { value?: unknown; children?: ReactNode }) {
    return <label className="flex cursor-pointer items-start gap-2 text-sm"><RadioGroup.Item value={String(value)} className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border border-input outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:border-primary"><RadioGroup.Indicator className="size-2 rounded-full bg-primary" /></RadioGroup.Item><span>{children}</span></label>;
}
function Radios({ value, onChange, children, className, ...props }: Omit<ComponentProps<typeof RadioGroup.Root>, "value" | "onChange"> & { value?: unknown; onChange?: (event: { target: { value: any } }) => void; children: ReactNode }) {
    return <RadioGroup.Root {...props} value={String(value)} onValueChange={(next) => onChange?.({ target: { value: next } })} className={cn("grid gap-2", className)}>{children}</RadioGroup.Root>;
}
export const RadioControl = Object.assign(Radio, { Group: Radios });
