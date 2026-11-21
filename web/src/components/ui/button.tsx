import type { ReactElement, ReactNode, Ref } from "react";
import type { HTMLMotionProps } from "motion/react";
import { Button as AnimatedButton } from "@animate-ui/react/primitives/buttons/button";
import { IconButton as AnimatedIconButton } from "@animate-ui/react/primitives/buttons/icon";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "./popover";

export type ButtonProps = Omit<HTMLMotionProps<"button">, "children"> & {
    children?: ReactNode;
    variant?: "default" | "outline" | "ghost" | "destructive" | "link";
    size?: "default" | "sm" | "lg" | "icon";
    loading?: boolean;
    icon?: ReactNode;
    asChild?: boolean;
    ref?: Ref<HTMLButtonElement>;
};

export function Button({ className, variant = "outline", size = "default", loading, icon, disabled, asChild, children, style, title, type = "button", ...props }: ButtonProps) {
    const buttonClass = cn(
        "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 data-[destructive]:text-destructive data-[destructive]:hover:text-destructive [&_svg]:size-4 [&_svg]:shrink-0",
        { default: "border border-foreground/30 bg-card text-card-foreground hover:border-foreground/50 hover:bg-accent aria-pressed:bg-accent", outline: "border border-input bg-card text-card-foreground hover:bg-accent hover:text-accent-foreground", ghost: "bg-card text-card-foreground hover:bg-accent hover:text-accent-foreground", destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90", link: "text-foreground underline-offset-4 hover:underline" }[variant],
        { default: "h-8 px-3", sm: "h-7 gap-1.5 px-2 text-xs", lg: "h-10 px-4", icon: "size-8 p-0" }[size], className,
    );
    const iconOnly = !asChild && (size === "icon" || Boolean(icon && !children));
    // IconButton's inline relative positioning must not override positioned toolbar controls.
    const common = { type, disabled: disabled || loading, "aria-busy": loading || undefined, className: buttonClass, ...props, style: iconOnly ? { position: undefined, ...style } : style };
    const Primitive = iconOnly ? AnimatedIconButton : AnimatedButton;
    const button = asChild ? <Primitive {...common} asChild>{children as ReactElement}</Primitive> : <Primitive {...common}>{loading ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : icon}{children ? <span data-button-label className="contents">{children}</span> : null}</Primitive>;
    return title ? <Tooltip title={title}>{button}</Tooltip> : button;
}
