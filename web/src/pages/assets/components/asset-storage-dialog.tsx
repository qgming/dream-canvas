import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightLeft, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Choice } from "@/components/ui/choice";
import { Dialog } from "@/components/ui/dialog";
import { Notice, Spinner } from "@/components/ui/display";
import { EditorForm, Field, useEditorForm } from "@/components/ui/form";
import { useFeedback } from "@/hooks/use-feedback";
import { ApiError, captureSession } from "@/services/api/client";
import { listAssetStorages, migrateAsset, retryAssetSync } from "@/services/api/assets";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";

export function AssetStorageDialog({ asset, open, onClose }: { asset: Asset; open: boolean; onClose: () => void }) {
    const { t } = useTranslation();
    const { notify } = useFeedback();
    const form = useEditorForm<{ storageId: string }>({ storageId: "" });
    const query = useQuery({ queryKey: ["asset-storages"], queryFn: listAssetStorages, enabled: open && asset.kind !== "text", staleTime: 0 });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const operation = useRef(false);
    const destinations = query.data?.filter((storage) => storage.id !== asset.storageId) || [];
    const migration = asset.migration;
    const canRetry = migration ? migration.state === "failed" : asset.syncState === "failed" || asset.syncState === "local";
    useEffect(() => { form.reset({ storageId: "" }); setError(""); }, [open, asset.storageId, Boolean(migration), form]);
    const run = async (action: () => Promise<unknown>) => {
        if (operation.current) return;
        const assertSession = captureSession(); operation.current = true; setBusy(true); setError("");
        try {
            await action(); assertSession();
            form.reset({ storageId: "" });
            await useAssetStore.getState().loadAssets(); assertSession();
            const state = useAssetStore.getState();
            if (state.error) throw new Error(state.error);
            const current = state.assets.find((item) => item.id === asset.id);
            if (current?.syncState === "local" && !current.migration) notify.warning(t("assets.storageStatus.cloudUnavailable"));
            else notify.success(t(current?.syncState === "synced" && !current.migration ? "assets.storageStatus.cloudSynced" : "assets.storageMigration.queued"));
        } catch (error) {
            if (error instanceof ApiError && error.code === "asset_changed") void useAssetStore.getState().loadAssets();
            setError(error instanceof Error ? error.message : t("ui.operationFailed"));
        } finally { operation.current = false; setBusy(false); }
    };
    return <Dialog open={open} title={t("assets.storageMigration.title")} width={480} busy={busy} onClose={onClose} footer={asset.kind !== "text" && !migration && destinations.length ? <Button variant="default" icon={<ArrowRightLeft />} loading={busy} disabled={query.isFetching || query.isError} type="submit" form={`asset-storage-${asset.id}`}>{t("assets.storageMigration.submit")}</Button> : null}>
        <div className="space-y-4">
            <dl className="space-y-2 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2"><dt className="text-muted-foreground">{t("assets.storageMigration.current")}</dt><dd className="break-words">{asset.kind === "text" ? t("assets.storageMigration.database") : asset.storageName || t(asset.storageId ? "assets.storageMigration.unknownStorage" : "assets.storageMigration.local")}</dd></div>
                <div className="flex flex-wrap items-start justify-between gap-2"><dt className="text-muted-foreground">{t("workspace.status")}</dt><dd role="status" className="text-right">{asset.kind === "text" ? t("assets.storageStatus.textSaved") : migration ? t(`assets.storageMigration.states.${migration.state}`) : t(`assets.storageMigration.syncStates.${asset.syncState || "local"}`)}</dd></div>
            </dl>
            {asset.kind === "text" ? <p className="text-sm text-muted-foreground">{t("assets.storageStatus.cloudNotApplicable")}</p> : <>
                {migration ? <Notice type={migration.state === "failed" ? "error" : "info"} title={t("assets.storageMigration.targetName", { name: migration.storageName })} description={migration.error || t("assets.storageMigration.hint")} /> : null}
                {canRetry && Boolean(migration || asset.storageId || query.data?.some((storage) => storage.default)) ? <Button icon={<RefreshCw />} loading={busy} onClick={() => void run(() => retryAssetSync(asset.id))}>{t(migration || asset.syncState === "failed" ? "workspace.retry" : asset.storageId ? "assets.storageMigration.sync" : "assets.storageMigration.syncDefault")}</Button> : null}
                {query.isPending ? <Spinner /> : query.error ? <Notice type="error" title={query.error.message} action={<Button disabled={busy || query.isFetching} onClick={() => void query.refetch()}>{t("workspace.retry")}</Button>} /> : !migration ? destinations.length ? <EditorForm id={`asset-storage-${asset.id}`} form={form} disabled={busy} onSubmit={(values) => run(() => migrateAsset(asset.id, values.storageId, asset.updatedAt))}>
                    <Field name="storageId" label={t("assets.storageMigration.target")} help={t("assets.storageMigration.hint")} schema={z.string().min(1, t("assets.storageMigration.selectRequired"))}><Choice placeholder={t("assets.storageMigration.select")} options={destinations.map((storage) => ({ value: storage.id, label: storage.name }))} /></Field>
                </EditorForm> : <p className="text-sm text-muted-foreground">{t(query.data?.length ? "assets.storageMigration.noOther" : "assets.storageStatus.cloudUnavailable")}</p> : null}
            </>}
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
    </Dialog>;
}
