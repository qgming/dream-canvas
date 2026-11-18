import { useContext, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useMotionTokens, useShouldReduceMotion } from "@animate-ui/react/utils/motion";
import { EditGuardContext } from "@/hooks/use-edit-guard";
import { useDiscardChanges } from "@/hooks/use-discard-changes";
import { Menu } from "@/components/ui/popover";
import { Badge } from "@/components/ui/display";
import { AnimatedSidePanel } from "@/components/ui/animated-side-panel";
import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Tooltip } from "@/components/ui/popover";
import { LogOut, PanelLeftClose, PanelLeftOpen, Settings2, UserRound } from "lucide-react";
import { Link, NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { navigationTools } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";
import { useAppUiStore } from "@/stores/use-app-ui-store";
import { useAuthStore } from "@/stores/use-auth-store";

const itemClass = "flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-ring";
const collapsedItemClass = "mx-auto size-10 shrink-0 justify-center gap-0 p-0";

export function AppSidebar() {
    const { t } = useTranslation();
    const [mobileOpen, setMobileOpen] = useState(false);
    const [compactExpanded, setCompactExpanded] = useState(false);
    const edits = useContext(EditGuardContext);
    const signOut = useDiscardChanges(Boolean(edits?.dirty), () => useAuthStore.getState().signOut());
    const sidebarCollapsed = useAppUiStore((state) => state.sidebarCollapsed);
    const toggleSidebar = useAppUiStore((state) => state.toggleSidebar);
    const user = useAuthStore((state) => state.user);
    const reducedMotion = useShouldReduceMotion();
    const tokens = useMotionTokens();
    const transition = reducedMotion ? tokens.transition.instant : tokens.transition.collapse;
    const mobile = useMediaQuery("(max-width: 767px)");
    const compact = useMediaQuery("(max-width: 1199px)");
    const collapsed = mobile ? !mobileOpen : compact ? !compactExpanded : sidebarCollapsed;
    const navigationItemClass = cn(itemClass, "text-muted-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium aria-[current=page]:text-sidebar-accent-foreground", collapsed && collapsedItemClass);
    const toggleLabel = t(collapsed ? "sidebar.expand" : "sidebar.collapse");
    const closeMobile = () => { setMobileOpen(false); setCompactExpanded(false); };

    return (
        <motion.div className="relative h-full shrink-0" initial={false} animate={{ width: compact || collapsed ? 56 : 208 }} transition={transition}>
            {(mobile && mobileOpen || compact && compactExpanded) ? <button type="button" aria-label={t("sidebar.collapse")} className="fixed inset-0 z-[80] bg-background/70 backdrop-blur-sm" onClick={() => { closeMobile(); setCompactExpanded(false); }} /> : null}
            <AnimatedSidePanel open={!collapsed} width={208} collapsedWidth={56} aria-label={t("topNav.navigation")} data-canvas-shortcuts-ignore className={cn(compact && "absolute inset-y-0 left-0 z-[90]")} panelClassName={cn("flex flex-col border-r border-sidebar-border bg-sidebar p-2 text-sidebar-foreground", collapsed && "px-0")}>
                <motion.div layout="position" initial={false} animate={{ height: collapsed ? 88 : 48, marginBottom: collapsed ? 8 : 24 }} transition={transition} className={cn("flex shrink-0 items-center gap-2", collapsed ? "w-[55px] flex-col" : "px-2")}>
                    <Link to="/canvas" onClick={closeMobile} aria-label={t("meta.title")} className={cn("flex min-w-0 items-center text-foreground", collapsed ? collapsedItemClass : "flex-1 gap-2.5")}>
                        <motion.span layout="position" transition={transition} className={cn("shrink-0 bg-current", collapsed ? "size-[18px]" : "size-6")} style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }} />
                        <AnimatePresence initial={false}>{!collapsed ? <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, width: 0 }} transition={transition} className="truncate text-sm font-semibold tracking-tight">{t("meta.title")}</motion.span> : null}</AnimatePresence>
                    </Link>
                    <Button variant="ghost" size="icon" layout="position" transition={transition} onClick={() => mobile ? setMobileOpen(!mobileOpen) : compact ? setCompactExpanded(!compactExpanded) : toggleSidebar()} aria-label={toggleLabel} title={toggleLabel} aria-expanded={!collapsed} className={cn("rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground [&_svg]:size-[18px]", collapsed ? collapsedItemClass : "size-7 [&_svg]:size-4")}>
                        {collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-4" />}
                    </Button>
                </motion.div>
                <nav className={cn("min-h-0 flex-1 overflow-y-auto", collapsed ? "hide-scrollbar w-[55px] space-y-2" : "space-y-1")} aria-label={t("sidebar.workspace")}>
                    {navigationTools.map(({ slug, icon: Icon }, index) => (
                        <motion.div key={slug} initial={false} animate={{ paddingTop: !collapsed && (index === 3 || index === 5) ? 20 : 0 }} transition={transition}>
                        {index === 0 || index === 3 || index === 5 ? <motion.p initial={false} animate={{ height: collapsed ? 0 : "auto", marginBottom: collapsed ? 0 : 8, opacity: collapsed ? 0 : 1 }} transition={transition} aria-hidden={collapsed} className="overflow-hidden whitespace-nowrap px-3 text-xs text-muted-foreground">{t(index === 0 ? "ui.creation" : index === 3 ? "ui.resources" : "navigation.tasks")}</motion.p> : null}
                        <Tooltip key={slug} title={collapsed ? t(`navigation.${slug}`) : undefined} placement="right">
                            <NavLink to={`/${slug}`} onClick={closeMobile} aria-label={t(`navigation.${slug}`)} className={navigationItemClass}>
                                <Icon className="size-[18px] shrink-0" /><AnimatePresence initial={false}>{!collapsed ? <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, width: 0 }} transition={transition} className="truncate">{t(`navigation.${slug}`)}</motion.span> : null}</AnimatePresence>
                            </NavLink>
                        </Tooltip>
                        </motion.div>
                    ))}
                </nav>
                <div className={cn("shrink-0", collapsed ? "mt-2 w-[55px] space-y-2" : "mt-4 space-y-1")}>
                    <Tooltip title={collapsed ? t("navigation.settings") : undefined} placement="right">
                        <NavLink to="/settings" onClick={closeMobile} aria-label={t("navigation.settings")} className={navigationItemClass}>
                            <Settings2 className="size-[18px] shrink-0" /><AnimatePresence initial={false}>{!collapsed ? <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, width: 0 }} transition={transition} className="truncate">{t("navigation.settings")}</motion.span> : null}</AnimatePresence>
                        </NavLink>
                    </Tooltip>
                    <Menu placement="topLeft" items={ [
                        { key: "logout", icon: <LogOut className="size-4" />, label: t("sidebar.signOut"), onClick: signOut },
                    ] }>
                        <Button variant="ghost" size={collapsed ? "icon" : "default"} aria-label={t("sidebar.accountMenu")} className={cn(itemClass, "justify-start text-left font-normal text-muted-foreground [&_svg]:size-[18px]", collapsed && collapsedItemClass)}>
                            <UserRound className="size-[18px] shrink-0" />
                            <AnimatePresence initial={false}>{!collapsed ? <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, width: 0 }} transition={transition} className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden"><span className="truncate font-medium">{user?.username}</span>{user?.role === "admin" ? <Badge className="shrink-0">{t("sidebar.admin")}</Badge> : null}</motion.span> : null}</AnimatePresence>
                        </Button>
                    </Menu>
                </div>
            </AnimatedSidePanel>
        </motion.div>
    );
}
