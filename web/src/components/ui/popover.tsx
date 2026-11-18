import { Popover as Primitive, Tooltip as Tip, DropdownMenu } from "@animate-ui/react/primitives/radix-ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

function alignment(placement = "bottom") { return { side: placement.startsWith("top") ? "top" : placement.startsWith("left") ? "left" : placement.startsWith("right") ? "right" : "bottom", align: placement.endsWith("Left") ? "start" : placement.endsWith("Right") ? "end" : "center" } as const; }

export function Tooltip({ title, children, placement, open, onOpenChange, clickable = false, className }: { title?: ReactNode; children: ReactNode; placement?: string; open?: boolean; onOpenChange?: (open: boolean) => void; clickable?: boolean; className?: string }) {
    const [shown, setShown] = useState(false);
    const change = (next: boolean) => { setShown(next); onOpenChange?.(next); };
    if (!title) return children;
    return <Tip.Root open={open ?? shown} onOpenChange={change}><Tip.Trigger asChild onPointerDown={clickable ? (event) => event.preventDefault() : undefined} onClick={clickable ? (event) => { event.preventDefault(); change(true); } : undefined}>{children}</Tip.Trigger><Tip.Portal><Tip.Content data-ui-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore sideOffset={6} {...alignment(placement)} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()} className={cn("z-[1600] max-w-[min(20rem,calc(100vw-32px))] whitespace-pre-line break-words rounded-md border border-border bg-popover px-3 py-2 text-xs leading-5 text-popover-foreground shadow-md", className)}>{title}<Tip.Arrow className="fill-popover" /></Tip.Content></Tip.Portal></Tip.Root>;
}

export function Popover({ content, children, placement, open: controlled, onOpenChange, trigger = "hover", className }: { content: ReactNode; children: ReactNode; placement?: string; open?: boolean; onOpenChange?: (value: boolean) => void; trigger?: "hover" | "click" | string[]; className?: string }) {
    const [shown, setShown] = useState(false);
    const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
    const hover = trigger === "hover" || Array.isArray(trigger) && trigger.includes("hover");
    const change = (next: boolean) => { setShown(next); onOpenChange?.(next); };
    const enter = () => { if (!hover) return; if (hoverTimer.current) clearTimeout(hoverTimer.current); change(true); };
    const leave = () => { if (hover) hoverTimer.current = setTimeout(() => change(false), 120); };
    return <Primitive.Root open={controlled ?? shown} onOpenChange={change}><Primitive.Trigger asChild onMouseEnter={enter} onMouseLeave={leave}>{children}</Primitive.Trigger><Primitive.Portal><Primitive.Content data-popover-content data-ui-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore sideOffset={6} {...alignment(placement)} onOpenAutoFocus={(event) => hover && event.preventDefault()} onMouseEnter={enter} onMouseLeave={leave} onWheel={(event) => event.stopPropagation()} className={cn("z-[1500] max-h-[var(--radix-popover-content-available-height)] max-w-[calc(100vw-32px)] overflow-x-hidden overflow-y-auto rounded-xl border border-border bg-popover p-4 text-sm text-popover-foreground shadow-lg outline-none", className)}>{content}</Primitive.Content></Primitive.Portal></Primitive.Root>;
}

export type MenuItem = { key?: string; label?: ReactNode; icon?: ReactNode; disabled?: boolean; danger?: boolean; type?: "divider"; onClick?: () => void };
export function Menu({ children, items, placement, open, onOpenChange, disabled }: { children: ReactNode; items: MenuItem[]; placement?: string; open?: boolean; onOpenChange?: (value: boolean) => void; disabled?: boolean }) {
    // Staggered menu rows translate horizontally during entry; only the vertical axis should scroll.
    return <DropdownMenu.Root open={open} onOpenChange={onOpenChange} modal={false}><DropdownMenu.Trigger asChild disabled={disabled}>{children}</DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content data-ui-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore sideOffset={6} {...alignment(placement)} className="z-[1500] max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-44 max-w-[calc(100vw-32px)] overflow-x-hidden overflow-y-auto rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg">{items.map((item, index) => item.type === "divider" ? <DropdownMenu.Separator key={index} className="my-1 h-px bg-border" /> : <DropdownMenu.Item key={item.key ?? index} disabled={item.disabled} onSelect={item.onClick} className={cn("flex min-w-0 cursor-default items-center gap-2 rounded-md px-3 py-2 outline-none focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0", item.danger && "text-destructive focus:bg-destructive/10")}>{item.icon}<span className="min-w-0 flex-1 break-words">{item.label}</span></DropdownMenu.Item>)}</DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>;
}
