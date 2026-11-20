import { AlertDialog as Primitive } from "@animate-ui/react/primitives/radix-ui";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./button";

export type AlertDialogProps = Pick<ComponentProps<typeof Primitive.Content>, "onOpenAutoFocus" | "onCloseAutoFocus"> & {
    open: boolean; title: ReactNode; description?: ReactNode; children?: ReactNode; actions?: ReactNode;
    onClose: () => void; onConfirm: () => void | Promise<unknown>; confirmText?: ReactNode; cancelText?: ReactNode;
    confirmDisabled?: boolean; busy?: boolean; destructive?: boolean;
};

export function AlertDialog({ open, title, description, children, actions, onClose, onConfirm, confirmText, cancelText, confirmDisabled, busy, destructive, onOpenAutoFocus, onCloseAutoFocus }: AlertDialogProps) {
    const { t } = useTranslation();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState("");
    const submitting = useRef(false);
    const previousFocus = useRef<HTMLElement | null>(null);
    const locked = pending || busy;
    useEffect(() => { if (open) setError(""); }, [open]);
    const confirm = async () => {
        if (!open || submitting.current || busy || confirmDisabled) return;
        submitting.current = true; setPending(true); setError("");
        try { await onConfirm(); }
        catch (failure) { setError(failure instanceof Error ? failure.message : t("ui.operationFailed")); }
        finally { submitting.current = false; setPending(false); }
    };
    return <Primitive.Root open={open} onOpenChange={(next) => { if (!next && !submitting.current && !busy) onClose(); }}>
        <Primitive.Portal>
            <Primitive.Overlay data-ui-overlay className="fixed inset-0 z-[1700] bg-overlay backdrop-blur-[2px]" />
            <Primitive.Content data-ui-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore data-slot="alert-dialog-content" aria-busy={locked} className="fixed left-1/2 top-1/2 z-[1701] flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl outline-none" onOpenAutoFocus={(event) => { previousFocus.current = document.activeElement as HTMLElement; onOpenAutoFocus?.(event); }} onCloseAutoFocus={(event) => { onCloseAutoFocus?.(event); if (!event.defaultPrevented) { event.preventDefault(); if (previousFocus.current?.isConnected) previousFocus.current.focus(); } }} onEscapeKeyDown={(event) => { if (submitting.current || busy) event.preventDefault(); }} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
                <header className="shrink-0 px-4 pb-2 pt-3"><Primitive.Title className="break-words text-lg font-medium leading-6">{title}</Primitive.Title></header>
                <div inert={locked} className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pt-1">
                    <Primitive.Description asChild><div className={description ? "break-words text-sm leading-5 text-muted-foreground" : "sr-only"}>{description || (typeof title === "string" ? title : t("ui.confirm"))}</div></Primitive.Description>
                    {children}
                    {error ? <p role="alert" className="mt-3 break-words text-sm leading-5 text-destructive">{error}</p> : null}
                </div>
                <fieldset disabled={locked} className="m-0 flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2 border-0 px-4 pb-4 pt-4">
                    {actions}
                    <Primitive.Cancel asChild><Button disabled={locked}>{cancelText || t("common.cancel")}</Button></Primitive.Cancel>
                    <Primitive.Action asChild><Button variant={destructive ? "destructive" : "default"} disabled={confirmDisabled} loading={locked} onClick={(event) => { event.preventDefault(); void confirm(); }}>{confirmText || t("ui.confirm")}</Button></Primitive.Action>
                </fieldset>
            </Primitive.Content>
        </Primitive.Portal>
    </Primitive.Root>;
}
