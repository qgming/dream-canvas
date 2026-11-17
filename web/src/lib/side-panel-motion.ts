export const SIDE_PANEL_MOTION_MS = 500;
export const SIDE_PANEL_ENTER_X = -48;
export const SIDE_PANEL_EXIT_X = -28;
export const sidePanelTransition = {
    type: "tween",
    duration: SIDE_PANEL_MOTION_MS / 1000,
    ease: [0.22, 1, 0.36, 1],
} as const;
