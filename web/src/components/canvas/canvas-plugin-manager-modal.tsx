import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFeedback } from "@/hooks/use-feedback";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/controls";
import { Tabs } from "@/components/ui/tabs";
import { Notice } from "@/components/ui/display";
import { AlertTriangle, Download, Puzzle, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { installPluginFromUrl, setPluginEnabled, uninstallPlugin, updatePlugin } from "@/lib/canvas/plugin-loader";
import { fetchOfficialPlugins, hasUpgrade, type OfficialPluginEntry } from "@/lib/canvas/plugin-registry";
import { useThemeStore } from "@/stores/use-theme-store";
import { usePluginStore, type InstalledPlugin } from "@/stores/canvas/use-plugin-store";

export function CanvasPluginManagerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { notify, confirm } = useFeedback();
    const plugins = usePluginStore((state) => state.plugins);
    const [url, setUrl] = useState("");
    const [installing, setInstalling] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [actionError, setActionError] = useState("");
    const actionLock = useRef(false);
    const registryLock = useRef(false);
    const busy = installing || Boolean(busyId);

    const [official, setOfficial] = useState<OfficialPluginEntry[]>([]);
    const [loadingOfficial, setLoadingOfficial] = useState(false);
    const [officialError, setOfficialError] = useState<string | null>(null);

    const recordById = useMemo(() => new Map(plugins.map((item) => [item.id, item])), [plugins]);
    const localPlugins = useMemo(() => plugins.filter((item) => item.local), [plugins]);
    const thirdPartyPlugins = useMemo(() => plugins.filter((item) => !item.local && !item.official), [plugins]);

    const loadOfficial = useCallback(async () => {
        if (registryLock.current) return;
        registryLock.current = true;
        setLoadingOfficial(true);
        setOfficialError(null);
        try {
            setOfficial(await fetchOfficialPlugins());
        } catch (error) {
            setOfficialError(error instanceof Error ? error.message : String(error));
        } finally {
            registryLock.current = false;
            setLoadingOfficial(false);
        }
    }, []);

    // Read the registry once each time the panel opens, including when the list is empty.
    useEffect(() => {
        if (open) { setActionError(""); void loadOfficial(); }
    }, [open, loadOfficial]);

    const handleInstallUrl = async () => {
        const target = url.trim();
        if (!target || actionLock.current) return;
        actionLock.current = true;
        setActionError("");
        setInstalling(true);
        try {
            const plugin = await installPluginFromUrl(target);
            notify.success(t("canvas.plugins.installedPlugin", { name: plugin.name }));
            setUrl("");
        } catch (error) {
            const message = t("canvas.plugins.installFailed", { error: error instanceof Error ? error.message : String(error) });
            setActionError(message);
            notify.error(message);
        } finally {
            actionLock.current = false;
            setInstalling(false);
        }
    };

    const handleInstallOfficial = async (entry: OfficialPluginEntry) => {
        if (actionLock.current) return;
        actionLock.current = true;
        setActionError("");
        setBusyId(entry.id);
        try {
            const plugin = await installPluginFromUrl(entry.url, { official: true });
            notify.success(t("canvas.plugins.installed", { name: plugin.name }));
        } catch (error) {
            const message = t("canvas.plugins.installFailed", { error: error instanceof Error ? error.message : String(error) });
            setActionError(message);
            notify.error(message);
        } finally {
            actionLock.current = false;
            setBusyId(null);
        }
    };

    const runOnPlugin = async (record: InstalledPlugin, action: () => Promise<void>, successText: string) => {
        if (actionLock.current) return;
        actionLock.current = true;
        setActionError("");
        setBusyId(record.id);
        try {
            await action();
            notify.success(successText);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setActionError(message);
            notify.error(message);
        } finally {
            actionLock.current = false;
            setBusyId(null);
        }
    };

    // Installed plugin actions: enable toggle plus update/uninstall for non-local plugins.
    // Highlight the update action when a newer remote version is available.
    const installedControls = (record: InstalledPlugin, upgradable = false) => (
        <>
            <Switch size="small" checked={record.enabled} disabled={busy} loading={busyId === record.id} aria-label={`${record.name} · ${t(record.enabled ? "canvas.plugins.enabled" : "canvas.plugins.disabled")}`} onChange={(checked) => runOnPlugin(record, () => setPluginEnabled(record, checked), t(checked ? "canvas.plugins.enabled" : "canvas.plugins.disabled"))} />
            {!record.local && (
                <>
                    <Button
                        variant={upgradable ? "default" : "ghost"}
                        size="sm"
                        icon={<RefreshCw className="size-4" />}
                        loading={busyId === record.id}
                        disabled={busy}
                        title={t(upgradable ? "canvas.plugins.upgradeAvailable" : "canvas.plugins.updateFromSource")}
                        aria-label={`${t(upgradable ? "canvas.plugins.upgradeAvailable" : "canvas.plugins.updateFromSource")} · ${record.name}`}
                        onClick={() => runOnPlugin(record, async () => void (await updatePlugin(record)), t("canvas.plugins.updated"))}
                    />
                    <Button variant="ghost" data-destructive size="sm" icon={<Trash2 className="size-4" />} aria-label={`${t("canvas.plugins.uninstall")} · ${record.name}`} disabled={busy} onClick={() => confirm({ title: t("canvas.plugins.uninstallTitle"), confirmText: t("canvas.plugins.uninstall"), destructive: true, onConfirm: () => uninstallPlugin(record.id) })} />
                </>
            )}
        </>
    );

    // Add a green dot at the icon's top-right corner when an update is available.
    // A card-colored box shadow separates the dot visually from the icon.
    const withUpgradeDot = (icon: ReactNode) => (
        <span className="relative inline-flex">
            {icon}
            <Tooltip title={t("canvas.plugins.newVersion")}><span tabIndex={0} className="absolute -right-1 -top-1 size-2 rounded-full" style={{ background: "var(--success)", boxShadow: `0 0 0 2px ${theme.node.fill}` }} /></Tooltip>
        </span>
    );

    const versionTag = (version: string) => (
        <span className="shrink-0 rounded-full px-1.5 py-0.5 text-xs" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>
            v{version}
        </span>
    );

    const emptyHint = (text: string) => (
        <div className="py-10 text-center text-sm" style={{ color: theme.node.muted }}>
            {text}
        </div>
    );

    // Shared plugin row: icon, title with name and version, description, and actions.
    const row = (key: string, icon: ReactNode, name: string, version: string, subtitle: string | undefined, right: ReactNode) => (
        <div key={key} className="flex items-center gap-3 rounded-xl border px-3 py-2.5" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
            <span className="grid size-9 shrink-0 place-items-center rounded-lg text-base" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>
                {icon}
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2 text-sm font-medium" style={{ color: theme.node.text }}>
                    <span className="truncate">{name}</span>
                    {versionTag(version)}
                </div>
                {subtitle ? (
                    <div className="mt-0.5 truncate text-xs" style={{ color: theme.node.muted }}>
                        {subtitle}
                    </div>
                ) : null}
            </div>
            {right}
        </div>
    );

    const officialTab = (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <div className="text-xs" style={{ color: theme.node.muted }}>
                    {t("canvas.plugins.officialDescription")}
                </div>
                <Button variant="ghost" size="sm" icon={<RefreshCw className={`size-4 ${loadingOfficial ? "animate-spin" : ""}`} />} onClick={loadOfficial} disabled={loadingOfficial}>
                    {t("canvas.plugins.refresh")}
                </Button>
            </div>
            {officialError ? (
                <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                    {t("canvas.plugins.loadFailed", { error: officialError })}
                </div>
            ) : loadingOfficial && official.length === 0 ? (
                emptyHint(t("canvas.plugins.loadingOfficial"))
            ) : official.length === 0 ? (
                emptyHint(t("canvas.plugins.noOfficial"))
            ) : (
                <div className="thin-scrollbar max-h-[46vh] space-y-2 overflow-auto">
                    {official.map((entry) => {
                        const record = recordById.get(entry.id);
                        // Show the update dot and highlight the action when the remote version is newer.
                        const upgradable = Boolean(record && hasUpgrade(record.version, entry.version));
                        const icon = entry.icon || <Puzzle className="size-4" />;
                        return row(
                            entry.id,
                            upgradable ? withUpgradeDot(icon) : icon,
                            entry.name,
                            // Show local and remote versions in the title so the update target is explicit.
                            upgradable && record ? `${record.version} → ${entry.version}` : entry.version,
                            entry.description,
                            record ? (
                                installedControls(record, upgradable)
                            ) : (
                                <Button variant="default" size="sm" icon={<Download className="size-4" />} disabled={busy} loading={busyId === entry.id} onClick={() => handleInstallOfficial(entry)}>
                                    {t("canvas.plugins.install")}
                                </Button>
                            ),
                        );
                    })}
                </div>
            )}
        </div>
    );

    const localTab = <div className="thin-scrollbar max-h-[52vh] space-y-2 overflow-auto">{localPlugins.map((record) => row(record.id, <Puzzle className="size-4" />, record.name, record.version, record.description || record.url, installedControls(record)))}</div>;

    const thirdPartyTab = (
        <div className="space-y-3">
            <div className="flex gap-2">
                <Input aria-label={t("canvas.plugins.urlPlaceholder")} placeholder={t("canvas.plugins.urlPlaceholder")} value={url} onChange={(event) => setUrl(event.target.value)} onPressEnter={handleInstallUrl} />
                <Button variant="default" disabled={busy || !url.trim()} loading={installing} onClick={handleInstallUrl} icon={<Puzzle className="size-4" />}>
                    {t("canvas.plugins.install")}
                </Button>
            </div>
            <div className="thin-scrollbar max-h-[42vh] space-y-2 overflow-auto">{thirdPartyPlugins.length === 0 ? emptyHint(t("canvas.plugins.noThirdParty")) : thirdPartyPlugins.map((record) => row(record.id, <Puzzle className="size-4" />, record.name, record.version, record.description || record.url, installedControls(record)))}</div>
        </div>
    );

    const tabs = [
        { key: "official", label: t("canvas.plugins.official"), children: officialTab },
        ...(localPlugins.length > 0 ? [{ key: "local", label: t("canvas.plugins.local"), children: localTab }] : []),
        { key: "third", label: t("canvas.plugins.thirdParty"), children: thirdPartyTab },
    ];

    return (
        <Dialog title={t("canvas.plugins.title")} open={open} busy={busy} dirty={Boolean(url.trim())} onClose={() => { setUrl(""); setActionError(""); onClose(); }} footer={null} width={640}>
            <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5" style={{ borderColor: "color-mix(in srgb, var(--warning) 30%, transparent)", background: "color-mix(in srgb, var(--warning) 5%, transparent)", color: theme.node.text }}>
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                    <span>{t("canvas.plugins.warning")}</span>
                </div>
                <Tabs items={tabs} />
                {actionError ? <Notice type="error" title={actionError} /> : null}
            </div>
        </Dialog>
    );
}
