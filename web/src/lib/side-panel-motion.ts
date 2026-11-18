import { motionTokens } from "@animate-ui/react/utils/motion";

export const sidePanelTransition = motionTokens.transition.collapse;
export const SIDE_PANEL_MOTION_MS = sidePanelTransition.duration * 1000;
export const SIDE_PANEL_ENTER_X = -48;
export const SIDE_PANEL_EXIT_X = -28;
