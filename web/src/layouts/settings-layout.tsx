import { Suspense } from "react";
import { Archive, Code2, Cpu, Database, Globe2, Info, KeyRound, ListTodo, Logs, Puzzle, SlidersHorizontal, UserRound, UsersRound } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/use-auth-store";

export default function SettingsLayout() {
    const { t } = useTranslation();
    const admin = useAuthStore((state) => state.user?.role === "admin");
    const groups = [
        { label: "settings.personal", items: [
            { path: "", label: "general", icon: Globe2 },
            { path: "/backup", label: "dataBackup", icon: Archive },
            { path: "/account", label: "account", icon: UserRound },
            ...(!admin ? [{ path: "/models", label: "models", icon: Cpu }] : []),
            { path: "/tasks", label: "tasks", icon: ListTodo },
            { path: "/access-tokens", label: "accessTokens", icon: KeyRound },
            { path: "/about", label: "about", icon: Info },
        ] },
        ...(admin ? [{ label: "settings.administration", items: [
            { path: "/site", label: "site", icon: SlidersHorizontal },
            { path: "/users", label: "users", icon: UsersRound },
            { path: "/channels", label: "channels", icon: Cpu },
            { path: "/model-scripts", label: "modelScripts", icon: Code2 },
            { path: "/canvas-plugins", label: "nodePlugins", icon: Puzzle },
            { path: "/logging", label: "logging", icon: Logs },
            { path: "/storage", label: "storage", icon: Database },
        ] }] : []),
    ];

    return (
        <div className="flex h-full min-h-0 flex-col lg:flex-row">
            <aside className="shrink-0 border-b border-border bg-sidebar px-4 pt-6 pb-3 text-sidebar-foreground lg:w-[var(--secondary-sidebar-width)] lg:overflow-y-auto lg:border-r lg:border-b-0 lg:px-3 lg:py-8">
                <h1 className="mb-5 px-3 text-lg font-medium tracking-tight">{t("navigation.settings")}</h1>
                <nav aria-label={t("settings.navigation")} className="flex gap-6 overflow-x-auto lg:block lg:space-y-7 lg:overflow-x-visible">
                    {groups.map((group) => <div key={group.label} className="shrink-0">
                        <p className="mb-2 hidden px-3 text-xs text-muted-foreground lg:block">{t(group.label)}</p>
                        <div className="flex gap-1 lg:block lg:space-y-1">
                            {group.items.map(({ path, label, icon: Icon }) => <NavLink key={path} to={`/settings${path}`} end={!path} className={({ isActive }) => cn("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-ring", isActive ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground")}>
                                <Icon className="size-4 shrink-0" /><span className="min-w-0 lg:whitespace-normal">{t(`settings.${label}`)}</span>
                            </NavLink>)}
                        </div>
                    </div>)}
                </nav>
            </aside>
            <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
                <div className="@container/settings mx-auto w-full max-w-6xl px-6 py-8 sm:px-8 xl:px-10">
                    <Suspense fallback={<p role="status" className="py-8 text-sm text-muted-foreground">{t("settings.loading")}</p>}><Outlet /></Suspense>
                </div>
            </main>
        </div>
    );
}
