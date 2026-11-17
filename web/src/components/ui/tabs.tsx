import { Tabs as Primitive, Accordion } from "radix-ui";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

export function Tabs({ items, value, onValueChange, className }: { items: { key: string; label: ReactNode; children: ReactNode; disabled?: boolean; keepMounted?: boolean }[]; value?: string; onValueChange?: (value: string) => void; className?: string }) {
    return <Primitive.Root value={value} defaultValue={items[0]?.key} onValueChange={onValueChange} className={className}><Primitive.List className="mb-4 flex gap-4 overflow-x-auto border-b border-border">{items.map((item) => <Primitive.Trigger key={item.key} value={item.key} disabled={item.disabled} className="shrink-0 border-b-2 border-transparent px-1 py-3 text-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:border-foreground data-[state=active]:font-medium data-[state=active]:text-foreground disabled:opacity-50">{item.label}</Primitive.Trigger>)}</Primitive.List>{items.map((item) => <Primitive.Content key={item.key} value={item.key} forceMount={item.keepMounted ? true : undefined} className="outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=inactive]:hidden">{item.children}</Primitive.Content>)}</Primitive.Root>;
}

export function Disclosure({ title, open, onOpenChange, children, className }: { title: ReactNode; open: boolean; onOpenChange: (value: boolean) => void; children: ReactNode; className?: string }) {
    return <Accordion.Root type="single" collapsible value={open ? "content" : ""} onValueChange={(value) => onOpenChange(Boolean(value))} className={className}><Accordion.Item value="content"><Accordion.Header><Accordion.Trigger className="group flex w-full items-center justify-between gap-3 py-3 text-left text-sm font-medium">{title}<ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" /></Accordion.Trigger></Accordion.Header><Accordion.Content forceMount hidden={!open} className="pt-2">{children}</Accordion.Content></Accordion.Item></Accordion.Root>;
}
