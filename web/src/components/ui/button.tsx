import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Slot } from "radix-ui";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "default" | "outline" | "ghost" | "destructive" | "link";
    size?: "default" | "sm" | "lg" | "icon";
    loading?: boolean;
    icon?: ReactNode;
    asChild?: boolean;
    ref?: Ref<HTMLButtonElement>;
};

export function Button({ className, variant = "outline", size = "default", loading, icon, disabled, asChild, children, type = "button", ...props }: ButtonProps) {
    const Component = asChild ? Slot.Root : "button";
    return <Component type={type} disabled={disabled || loading} aria-busy={loading || undefined} data-slot="button" className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        { default: "bg-primary text-primary-foreground hover:bg-primary/90", outline: "border border-input bg-transparent hover:bg-accent", ghost: "bg-transparent hover:bg-accent hover:text-accent-foreground", destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90", link: "text-foreground underline-offset-4 hover:underline" }[variant],
        { default: "h-8 px-3", sm: "h-7 gap-1.5 px-2 text-xs", lg: "h-10 px-4", icon: "size-8 p-0" }[size], className,
    )} {...props}>{asChild ? children : <>{loading ? <LoaderCircle className="animate-spin" /> : icon}{children ? <span data-button-label className="contents">{children}</span> : null}</>}</Component>;
}
