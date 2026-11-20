import { useId, useLayoutEffect, useRef, useState, type InputHTMLAttributes, type TextareaHTMLAttributes, type ReactNode, type Ref } from "react";
import { Eye, EyeOff, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { useTranslation } from "react-i18next";

export const inputClass = "flex h-8 w-full min-w-0 rounded-md border border-input bg-card px-3 py-1 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/25";
type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> & { size?: "small" | "large" | "middle"; prefix?: ReactNode; status?: "error" | "warning"; showCount?: boolean; onPressEnter?: (event: React.KeyboardEvent<HTMLInputElement>) => void; ref?: Ref<HTMLInputElement> };

export function Input({ className, prefix, size, status, showCount, onPressEnter, onKeyDown, ...props }: InputProps) {
    const id = useId();
    const field = <input data-slot="input" className={cn(inputClass, size === "small" && "h-7", size === "large" && "h-10", prefix && "border-0 bg-transparent pl-0 focus-visible:ring-0", !prefix && className)} aria-invalid={status === "error" || undefined} onKeyDown={(event) => { onKeyDown?.(event); if (event.key === "Enter") onPressEnter?.(event); }} {...props} id={props.id || id} aria-label={props["aria-label"] || props.placeholder} />;
    return prefix ? <div className={cn("flex w-full items-center gap-2 rounded-md border border-input bg-card px-3 focus-within:ring-2 focus-within:ring-ring/30", className)}><span className="shrink-0 text-foreground">{prefix}</span>{field}</div> : field;
}

export function PasswordInput({ showLabel, hideLabel, ...props }: InputProps & { showLabel?: string; hideLabel?: string }) {
    const [visible, setVisible] = useState(false);
    const { t } = useTranslation();
    return <div className="relative w-full"><Input {...props} type={visible ? "text" : "password"} className={cn("pr-10", props.className)} /><Button variant="ghost" size="icon" disabled={props.disabled} className={cn("absolute right-0 top-0", props.size === "large" && "size-10", props.size === "small" && "size-7")} aria-label={visible ? hideLabel || t("ui.hidePassword") : showLabel || t("ui.showPassword")} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff /> : <Eye />}</Button></div>;
}

export function SearchInput({ onSearch, ...props }: InputProps & { onSearch?: (value: string) => void }) {
    return <Input {...props} type="search" prefix={<Search className="size-4" />} onPressEnter={(event) => { props.onPressEnter?.(event); onSearch?.(event.currentTarget.value); }} />;
}

export function Textarea({ className, autoSize, showCount, status, value, onChange, ref: forwardedRef, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement>; status?: "error" | "warning"; autoSize?: boolean | { minRows?: number; maxRows?: number }; showCount?: boolean }) {
    const ref = useRef<HTMLTextAreaElement>(null);
    useLayoutEffect(() => {
        const element = ref.current;
        if (!autoSize || !element) return;
        const bounds = typeof autoSize === "object" ? autoSize : {};
        element.style.height = "auto";
        element.style.height = `${Math.min(Math.max(element.scrollHeight, (bounds.minRows || 2) * 22 + 16), bounds.maxRows ? bounds.maxRows * 22 + 16 : Infinity)}px`;
    }, [value, autoSize]);
    return <div className="w-full"><textarea ref={(element) => { ref.current = element; if (typeof forwardedRef === "function") forwardedRef(element); else if (forwardedRef) forwardedRef.current = element; }} data-slot="textarea" aria-invalid={status === "error" || undefined} value={value} onChange={onChange} className={cn(inputClass, "h-auto min-h-20 py-2 leading-[22px]", className)} {...props} />{showCount ? <span className="mt-1 block text-right text-xs text-muted-foreground">{String(value || "").length}{props.maxLength ? ` / ${props.maxLength}` : ""}</span> : null}</div>;
}

export function NumberInput({ value, onChange, precision, className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "size"> & { ref?: Ref<HTMLInputElement>; value?: number | null; onChange?: (value: number | null) => void; precision?: number }) {
    return <Input {...props} type="number" inputMode="decimal" value={value ?? ""} className={className} step={props.step ?? (precision === undefined ? "any" : 10 ** -precision)} onChange={(event) => { const value = event.target.value; onChange?.(value === "" ? null : Number(value)); }} />;
}
