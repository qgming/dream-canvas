import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Upload } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/display";
import { Field } from "@/components/ui/form";
import { useFeedback } from "@/hooks/use-feedback";
import { exportAssets, importAssetPackage } from "@/lib/asset-transfer";
import { captureSession } from "@/services/api/client";
import { useAssetStore } from "@/stores/use-asset-store";

export default function BackupPage() {
    const { t } = useTranslation();
    const { notify } = useFeedback();
    const hydrated = useAssetStore((state) => state.hydrated);
    const assetError = useAssetStore((state) => state.error);
    const input = useRef<HTMLInputElement>(null);
    const running = useRef(false);
    const [busy, setBusy] = useState<"" | "export" | "import">("");
    const [error, setError] = useState("");

    const transfer = async (action: "export" | "import", file?: File) => {
        if (running.current || action === "import" && !file) return;
        const assertSession = captureSession();
        running.current = true;
        setBusy(action);
        setError("");
        try {
            if (action === "export") {
                await useAssetStore.getState().loadAssets();
                assertSession();
                const current = useAssetStore.getState();
                if (current.error) throw new Error(current.error);
                if (!current.assets.length) { notify.warning(t("assets.noneToExport")); return; }
                await exportAssets(current.assets, t("assets.packageName"));
            } else {
                const count = await importAssetPackage(file!);
                assertSession();
                notify.success(t("assets.imported", { count }));
            }
        } catch (failure) {
            const detail = failure instanceof Error ? failure.message : String(failure);
            const message = action === "import" ? `${t("backup.importFailed")} ${detail}` : detail;
            setError(message);
            notify.error(message);
        } finally {
            if (action === "import") window.dispatchEvent(new Event("assets-changed"));
            running.current = false;
            setBusy("");
        }
    };

    return <section className="space-y-6">
        <PageHeader title={t("settings.dataBackup")} />
        {assetError ? <Notice type="error" title={assetError} action={<Button disabled={Boolean(busy)} onClick={() => void useAssetStore.getState().loadAssets()}>{t("common.retry")}</Button>} /> : null}
        <section aria-labelledby="asset-backup-title">
            <h2 id="asset-backup-title" className="mb-2 text-base font-semibold">{t("assets.title")}</h2>
            <Field layout="horizontal" label={t("assets.export")} help={`${t("backup.exportDescription")}\n${t("backup.description")}`}>
                <Button variant="outline" icon={<Download />} loading={busy === "export"} disabled={!hydrated || Boolean(assetError) || Boolean(busy)} onClick={() => void transfer("export")}>{t("assets.export")}</Button>
            </Field>
            <Field layout="horizontal" label={t("assets.import")} help={t("backup.importDescription")}>
                <Button variant="outline" icon={<Upload />} loading={busy === "import"} disabled={Boolean(busy)} onClick={() => input.current?.click()}>{t("assets.import")}</Button>
            </Field>
            {busy ? <p role="status" className="mt-2 text-xs text-muted-foreground">{t(busy === "export" ? "backup.exporting" : "backup.importing")}</p> : null}
            {error ? <Notice type="error" className="mt-3" title={error} /> : null}
        </section>
        <input ref={input} type="file" accept="application/zip,.zip" hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void transfer("import", file); }} />
    </section>;
}
