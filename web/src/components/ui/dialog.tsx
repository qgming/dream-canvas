import { Dialog as Primitive, AlertDialog } from "radix-ui";
import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { DialogEditContext, useEditGuard, type EditRegistration } from "@/hooks/use-edit-guard";
import { Button } from "./button";

export type DialogProps = { open?: boolean; title: ReactNode; description?: ReactNode; children?: ReactNode; onClose: () => void; footer?: ReactNode; width?: number | string; className?: string; bodyClassName?: string; style?: CSSProperties; onConfirm?: () => void | Promise<unknown>; confirmText?: ReactNode; cancelText?: ReactNode; confirmDisabled?: boolean; busy?: boolean; dirty?: boolean; destructive?: boolean; side?: "right" | "left" | "bottom" };
export function Dialog({ open, title, description, children, onClose, footer, width, className, bodyClassName, style, onConfirm, confirmText, cancelText, confirmDisabled, busy, dirty, destructive, side }: DialogProps) {
    const { t } = useTranslation();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState("");
    const [discard, setDiscard] = useState(false);
    const submitting = useRef(false);
    const edits = useRef(new Map<string, EditRegistration>());
    const previousFocus = useRef<HTMLElement | null>(null);
    const discardFocus = useRef<HTMLElement | null>(null);
    const register = useCallback((id: string, edit: EditRegistration | null) => { if (edit) edits.current.set(id, edit); else edits.current.delete(id); }, []);
    const context = useMemo(() => ({ active: Boolean(open), register }), [open, register]);
    useEditGuard(Boolean(open && dirty), onClose);
    useEffect(() => { if (open) setError(""); }, [open]);
    const close = () => {
        if (pending || busy) return;
        if (dirty || [...edits.current.values()].some((edit) => edit.dirty)) setDiscard(true);
        else onClose();
    };
    const restoreFocus = (target: HTMLElement | null) => requestAnimationFrame(() => { (target?.isConnected ? target : previousFocus.current)?.focus(); });
    const confirm = async () => {
        if (!onConfirm || submitting.current || busy || confirmDisabled) return;
        submitting.current = true; setPending(true); setError("");
        try { await onConfirm(); } catch (error) { setError(error instanceof Error ? error.message : t("ui.operationFailed")); }
        finally { submitting.current = false; setPending(false); }
    };
    return <><Primitive.Root open={Boolean(open)} onOpenChange={(next) => { if (!next) close(); }}><Primitive.Portal><Primitive.Overlay data-ui-overlay className="fixed inset-0 z-[1400] bg-foreground/25 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none" /><Primitive.Content data-ui-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore data-slot="dialog-content" className={cn("fixed z-[1401] flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl outline-none", side ? "inset-y-4" : "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", side === "right" && "right-4", side === "left" && "left-4", side === "bottom" && "inset-x-4 bottom-4 top-auto max-h-[85dvh] w-auto", className)} style={{ width: width ?? (side === "bottom" ? "auto" : 560), ...style }} onOpenAutoFocus={() => { previousFocus.current = document.activeElement as HTMLElement; }} onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(previousFocus.current); }} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-4"><div className="min-w-0"><Primitive.Title className="text-lg font-medium leading-6">{title || t("common.details")}</Primitive.Title><Primitive.Description className={description ? "mt-2 text-sm leading-5 text-muted-foreground" : "sr-only"}>{description || (typeof title === "string" ? title : t("common.details"))}</Primitive.Description></div><Button size="icon" variant="ghost" disabled={pending || busy} onClick={close} aria-label={t("ui.close")}><X /></Button></header>
        <DialogEditContext.Provider value={context}><div inert={pending || busy} aria-busy={pending || busy} className={cn("thin-scrollbar min-h-0 flex-1 overflow-y-auto p-6", bodyClassName)}>{children}{error ? <p role="alert" className="mt-4 text-sm text-destructive">{error}</p> : null}</div></DialogEditContext.Provider>
        {footer !== null ? <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4">{footer ?? <><Button disabled={pending || busy} onClick={close}>{cancelText || t("common.cancel")}</Button>{onConfirm ? <Button variant={destructive ? "destructive" : "default"} disabled={confirmDisabled} loading={pending || busy} onClick={() => void confirm()}>{confirmText || t("common.save")}</Button> : null}</>}</footer> : null}
    </Primitive.Content></Primitive.Portal></Primitive.Root>
    <AlertDialog.Root open={discard} onOpenChange={setDiscard}><AlertDialog.Portal><AlertDialog.Overlay data-ui-overlay className="fixed inset-0 z-[1700] bg-foreground/25" /><AlertDialog.Content data-ui-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore onOpenAutoFocus={() => { discardFocus.current = document.activeElement as HTMLElement; }} onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(discardFocus.current); }} className="fixed left-1/2 top-1/2 z-[1701] w-[calc(100vw-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover p-6 text-popover-foreground shadow-xl"><AlertDialog.Title className="text-lg font-medium">{t("ui.discardTitle")}</AlertDialog.Title><AlertDialog.Description className="mt-3 text-sm leading-6 text-muted-foreground">{t("ui.discardDescription")}</AlertDialog.Description><div className="mt-6 flex justify-end gap-2"><AlertDialog.Cancel asChild><Button>{t("ui.keepEditing")}</Button></AlertDialog.Cancel><AlertDialog.Action asChild><Button variant="destructive" onClick={() => { edits.current.forEach((edit) => edit.reset()); onClose(); }}>{t("ui.discard")}</Button></AlertDialog.Action></div></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root></>;
}

export function Sheet(props: Omit<DialogProps, "side">) { return <Dialog {...props} side="right" />; }
