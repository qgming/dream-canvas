import { Dialog as Primitive } from "@animate-ui/react/primitives/radix-ui";
import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { DialogEditContext, useEditGuard, type EditRegistration } from "@/hooks/use-edit-guard";
import { Button } from "./button";
import { AlertDialog } from "./alert-dialog";

export type DialogProps = { open?: boolean; title: ReactNode; description?: ReactNode; children?: ReactNode; onClose: () => void; footer?: ReactNode; footerStart?: ReactNode; secondaryAction?: ReactNode; headerActions?: ReactNode; width?: number | string; className?: string; bodyClassName?: string; style?: CSSProperties; onConfirm?: () => void | Promise<unknown>; confirmText?: ReactNode; cancelText?: ReactNode; confirmDisabled?: boolean; busy?: boolean; dirty?: boolean; destructive?: boolean; side?: "right" | "left" | "bottom" };
export function Dialog({ open, title, description, children, onClose, footer, footerStart, secondaryAction, headerActions, width, className, bodyClassName, style, onConfirm, confirmText, cancelText, confirmDisabled, busy, dirty, destructive, side }: DialogProps) {
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
    const locked = pending || busy;
    const actions = footer !== undefined ? footer : onConfirm ? <Button variant={destructive ? "destructive" : "default"} disabled={confirmDisabled} loading={locked} onClick={() => void confirm()}>{confirmText || t("common.save")}</Button> : null;
    useEditGuard(Boolean(open && dirty), onClose);
    useEffect(() => { if (open) setError(""); }, [open]);
    const close = () => {
        if (submitting.current || busy) return;
        if (dirty || [...edits.current.values()].some((edit) => edit.dirty)) { discardFocus.current = document.activeElement as HTMLElement; setDiscard(true); }
        else onClose();
    };
    const restoreFocus = (target: HTMLElement | null) => requestAnimationFrame(() => { (target?.isConnected ? target : previousFocus.current)?.focus(); });
    const confirm = async () => {
        if (!onConfirm || submitting.current || busy || confirmDisabled) return;
        submitting.current = true; setPending(true); setError("");
        try { await onConfirm(); } catch (error) { setError(error instanceof Error ? error.message : t("ui.operationFailed")); }
        finally { submitting.current = false; setPending(false); }
    };
    return <><Primitive.Root open={Boolean(open)} onOpenChange={(next) => { if (!next) close(); }}><Primitive.Portal><Primitive.Overlay data-ui-overlay className="fixed inset-0 z-[1400] bg-overlay backdrop-blur-[2px]" /><Primitive.Content data-side={side} data-ui-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore data-slot="dialog-content" aria-busy={locked} className={cn("fixed z-[1401] flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl outline-none", side ? "inset-y-4" : "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", side === "right" && "right-4", side === "left" && "left-4", side === "bottom" && "inset-x-4 bottom-4 top-auto max-h-[85dvh] w-auto", className)} style={{ width: width ?? (side === "bottom" ? "auto" : 560), ...style }} onOpenAutoFocus={() => { previousFocus.current = document.activeElement as HTMLElement; }} onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(previousFocus.current); }} onEscapeKeyDown={(event) => { if (submitting.current || busy) event.preventDefault(); }} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 pb-2 pt-3"><div className="min-w-0 flex-1"><Primitive.Title className="break-words text-lg font-medium leading-6">{title || t("common.details")}</Primitive.Title><Primitive.Description className={description ? "mt-1 text-sm leading-5 text-muted-foreground" : "sr-only"}>{description || (typeof title === "string" ? title : t("common.details"))}</Primitive.Description></div><div className="ml-auto flex flex-wrap items-center justify-end gap-2">{headerActions}<Button size="icon" variant="ghost" disabled={locked} onClick={close} title={t("ui.close")} aria-label={t("ui.close")}><X /></Button></div></header>
        <DialogEditContext.Provider value={context}><div inert={locked} className={cn("thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pt-1", actions ? "pb-0" : "pb-4", bodyClassName)}>{children}{error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}</div></DialogEditContext.Provider>
        {actions ? <fieldset disabled={locked} className="m-0 flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2 border-0 px-4 pb-4 pt-4">{footerStart ? <div className="mr-auto flex min-w-0 items-center gap-2">{footerStart}</div> : null}{secondaryAction !== undefined ? secondaryAction : <Button disabled={locked} onClick={close}>{cancelText || t("common.cancel")}</Button>}{actions}</fieldset> : null}
    </Primitive.Content></Primitive.Portal></Primitive.Root>
    <AlertDialog open={discard} title={t("ui.discardTitle")} description={t("ui.discardDescription")} cancelText={t("ui.keepEditing")} confirmText={t("ui.discard")} destructive onClose={() => setDiscard(false)} onConfirm={() => { edits.current.forEach((edit) => edit.reset()); setDiscard(false); onClose(); }} onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(discardFocus.current); }} /></>;
}

export function Sheet(props: Omit<DialogProps, "side">) { return <Dialog {...props} side="right" />; }
