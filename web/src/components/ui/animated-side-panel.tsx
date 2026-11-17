import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";
import { cn } from "@/lib/utils";
import { SIDE_PANEL_ENTER_X, SIDE_PANEL_EXIT_X, sidePanelTransition } from "@/lib/side-panel-motion";

type Props = Omit<HTMLMotionProps<"aside">, "initial" | "animate" | "transition"> & {
    open: boolean;
    width: number | string;
    collapsedWidth?: number;
    animateOnMount?: boolean;
    resizing?: boolean;
    panelClassName?: string;
};

export function AnimatedSidePanel({ open, width, collapsedWidth = 0, animateOnMount = false, resizing, className, panelClassName, children, ...props }: Props) {
    const reducedMotion = useReducedMotion();
    const transition = { ...sidePanelTransition, duration: resizing || reducedMotion ? 0 : sidePanelTransition.duration };
    const hidden = !open && collapsedWidth === 0;
    const enter = animateOnMount && !reducedMotion;
    return <motion.div
        className={cn("relative flex h-full shrink-0", className)}
        initial={enter ? { width: collapsedWidth, opacity: collapsedWidth ? 1 : 0 } : false}
        animate={{ width: open ? width : collapsedWidth, opacity: hidden ? 0 : 1 }}
        transition={transition}
        style={{ overflow: "clip", pointerEvents: hidden ? "none" : undefined }}
    >
        <motion.aside
            {...props}
            className={cn("relative h-full shrink-0", panelClassName)}
            aria-hidden={hidden || undefined}
            inert={hidden}
            initial={enter ? { x: SIDE_PANEL_ENTER_X } : false}
            animate={{ width: !open && collapsedWidth ? collapsedWidth : width, x: hidden ? SIDE_PANEL_EXIT_X : 0 }}
            transition={transition}
        >{children}</motion.aside>
    </motion.div>;
}
