import { useState } from "react";
import { App, Dropdown, Grid, Tooltip } from "antd";
import { Bot, ChevronsUpDown, LogOut, PanelLeftClose, PanelLeftOpen, Settings2, UserRound } from "lucide-react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { navigationTools } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/use-agent-store";
import { useAppUiStore } from "@/stores/use-app-ui-store";
import { useAuthStore } from "@/stores/use-auth-store";

const itemClass = "flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-ring";

export function AppSidebar() {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const navigate = useNavigate();
    const screens = Grid.useBreakpoint();
    const [mobileOpen, setMobileOpen] = useState(false);
    const sidebarCollapsed = useAppUiStore((state) => state.sidebarCollapsed);
    const toggleSidebar = useAppUiStore((state) => state.toggleSidebar);
    const user = useAuthStore((state) => state.user);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const togglePanel = useAgentStore((state) => state.togglePanel);
    const mobile = !screens.md;
    const collapsed = mobile ? !mobileOpen : sidebarCollapsed;
    const toggleLabel = t(collapsed ? "sidebar.expand" : "sidebar.collapse");
    const closeMobile = () => setMobileOpen(false);

    return (
        <div className={cn("h-full shrink-0", mobile ? "w-16" : collapsed ? "w-16" : "w-56")}>
            {mobile && mobileOpen ? <button type="button" aria-label={t("sidebar.collapse")} className="fixed inset-0 z-[80] bg-background/70 backdrop-blur-sm" onClick={closeMobile} /> : null}
            <aside aria-label={t("topNav.navigation")} data-canvas-shortcuts-ignore className={cn("flex h-full flex-col border-r border-sidebar-border bg-sidebar p-2 text-sidebar-foreground", mobile && "z-[90]", mobile && mobileOpen ? "fixed inset-y-0 left-0 w-56" : "relative w-full")}>
                <div className={cn("mb-6 flex h-12 shrink-0 items-center", collapsed ? "flex-col justify-center gap-1" : "gap-2 px-2")}>
                    <Link to="/canvas" onClick={closeMobile} aria-label={t("meta.title")} className="flex min-w-0 flex-1 items-center gap-2.5 text-foreground">
                        <span className="size-6 shrink-0 bg-current" style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }} />
                        {!collapsed ? <span className="truncate text-sm font-semibold tracking-tight">{t("meta.title")}</span> : null}
                    </Link>
                    <button type="button" onClick={() => mobile ? setMobileOpen(!mobileOpen) : toggleSidebar()} aria-label={toggleLabel} title={toggleLabel} aria-expanded={!collapsed} className={cn("grid shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring", collapsed ? "h-5 w-8" : "size-7")}>
                        {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
                    </button>
                </div>
                <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto" aria-label={t("sidebar.workspace")}>
                    {navigationTools.map(({ slug, icon: Icon }) => (
                        <Tooltip key={slug} title={collapsed ? t(`navigation.${slug}`) : undefined} placement="right">
                            <NavLink to={`/${slug}`} onClick={closeMobile} aria-label={t(`navigation.${slug}`)} className={({ isActive }) => cn(itemClass, collapsed && "justify-center !px-0", isActive ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground")}>
                                <Icon className="size-[18px] shrink-0" />{!collapsed ? <span className="truncate">{t(`navigation.${slug}`)}</span> : null}
                            </NavLink>
                        </Tooltip>
                    ))}
                </nav>
                <div className="mt-4 space-y-1">
                    <Tooltip title={collapsed ? t(panelOpen ? "topNav.closeAgent" : "topNav.openAgent") : undefined} placement="right">
                        <button type="button" aria-label={t(panelOpen ? "topNav.closeAgent" : "topNav.openAgent")} aria-pressed={panelOpen} onClick={() => { togglePanel(); closeMobile(); }} className={cn(itemClass, collapsed && "justify-center !px-0", panelOpen ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground")}>
                            <Bot className="size-[18px] shrink-0" />{!collapsed ? <span>{t("sidebar.assistant")}</span> : null}
                        </button>
                    </Tooltip>
                    <Tooltip title={collapsed ? t("navigation.settings") : undefined} placement="right">
                        <NavLink to="/settings" onClick={closeMobile} aria-label={t("navigation.settings")} className={({ isActive }) => cn(itemClass, collapsed && "justify-center !px-0", isActive ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground")}>
                            <Settings2 className="size-[18px] shrink-0" />{!collapsed ? <span>{t("navigation.settings")}</span> : null}
                        </NavLink>
                    </Tooltip>
                    <Dropdown trigger={["click"]} placement="topLeft" menu={{ items: [
                        { key: "account", icon: <UserRound className="size-4" />, label: t("settings.account"), onClick: () => { navigate("/settings/account"); closeMobile(); } },
                        { type: "divider" },
                        { key: "logout", icon: <LogOut className="size-4" />, label: t("sidebar.signOut"), onClick: () => { void useAuthStore.getState().signOut().catch((error: unknown) => message.error(error instanceof Error ? error.message : "退出失败")); } },
                    ] }}>
                        <button type="button" aria-label={t("sidebar.accountMenu")} className={cn("mt-2 flex h-14 w-full items-center gap-3 rounded-lg border-t border-sidebar-border px-3 text-left transition-colors hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring", collapsed && "justify-center !px-0")}>
                            <UserRound className="size-[18px] shrink-0" />
                            {!collapsed ? <><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{user?.username}</span><span className="text-[11px] text-muted-foreground">{t(user?.role === "admin" ? "sidebar.admin" : "sidebar.user")}</span></span><ChevronsUpDown className="size-3.5 text-muted-foreground" /></> : null}
                        </button>
                    </Dropdown>
                </div>
            </aside>
        </div>
    );
}
