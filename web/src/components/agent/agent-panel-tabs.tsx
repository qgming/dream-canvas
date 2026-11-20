import type { ReactNode } from "react";
import { Tooltip } from "@/components/ui/popover";
import { useTranslation } from "react-i18next";
import { Tabs } from "@animate-ui/react/primitives/radix-ui";

import { canvasThemes } from "@/lib/canvas-theme";

export function AgentPanelTabs<T extends string>({ value, items, theme, leading, right, onChange }: { value: T; items: { value: T; label: string; icon?: ReactNode; count?: number }[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; leading?: ReactNode; right?: ReactNode; onChange: (value: T) => void }) {
    const { t } = useTranslation();
    return (
        <div className="@container px-2">
            <div className="flex h-10 items-center gap-1">
                {leading ? <div className="flex shrink-0 items-center">{leading}</div> : null}
                <Tabs.Root value={value} onValueChange={(next) => onChange(next as T)} className="min-w-0 flex-1"><Tabs.List className="@container flex min-w-0 flex-1 items-center justify-center gap-1 overflow-hidden text-sm" aria-label={t("agent.panel.content")}>
                    {items.map((item) => (
                        <Tooltip key={item.value} title={`${item.label}${item.count ? ` ${item.count}` : ""}`} placement="bottom">
                            <Tabs.Trigger value={item.value} aria-label={`${item.label}${item.count ? ` ${item.count}` : ""}`} className={`inline-flex h-10 min-w-8 shrink-0 items-center justify-center gap-1.5 border-b-2 px-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${value === item.value ? "font-medium" : "font-normal"}`} style={{ borderColor: value === item.value ? theme.node.text : "transparent", color: value === item.value ? theme.node.text : theme.node.muted }}>
                                {item.icon ? <span className="agent-panel-tab-icon">{item.icon}</span> : null}
                                <span className={item.icon ? "hidden @min-[200px]:inline" : undefined}>{item.label}</span>
                                {item.count ? <span className="text-xs font-normal leading-none tabular-nums opacity-60">{item.count > 99 ? "99+" : item.count}</span> : null}
                            </Tabs.Trigger>
                        </Tooltip>
                    ))}
                </Tabs.List></Tabs.Root>
                {right ? <div className="flex shrink-0 items-center gap-1">{right}</div> : null}
            </div>
        </div>
    );
}
