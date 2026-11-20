import { PageHeader } from "@/components/layout/page-header";
import { useQuery } from "@tanstack/react-query";
import { Notice as Alert } from "@/components/ui/display";
import { Button } from "@/components/ui/button";
import { EmptyState as Empty } from "@/components/ui/display";
import { Spinner as Spin } from "@/components/ui/display";
import { Badge as Tag } from "@/components/ui/display";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { modelCatalog, type CatalogChannel } from "@/services/api/channels";
import { DataTable } from "@/components/ui/data-table";
import { useAuthStore } from "@/stores/use-auth-store";

export default function ModelsPage() {
    const { t } = useTranslation();
    const owner = useAuthStore((state) => state.user?.id);
    const query = useQuery({ queryKey: ["model-catalog", owner], queryFn: modelCatalog });
    const capabilities = { text: t("workspace.text"), image: t("workspace.image"), video: t("workspace.video"), audio: t("workspace.audio") };

    return (
        <section className="space-y-6">
            <PageHeader title={t("settings.models")} description={t("settings.modelsDescription")} actions={<Button variant="outline" icon={<RefreshCw className="size-4" />} loading={query.isFetching} onClick={() => void query.refetch()}>{t("common.refresh")}</Button>} />
            {query.error ? <Alert type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>{t("common.retry")}</Button>} /> : null}
            {query.isLoading ? <div className="flex min-h-40 items-center justify-center"><Spin /></div> : null}
            {!query.error && query.data?.channels.length === 0 ? <Empty description={t("settings.modelsEmpty")} /> : null}
            {query.data?.channels.map((channel) => <section key={channel.id} className="space-y-4 pt-2">
                <h2 className="text-base font-semibold break-words">{channel.name}</h2>
                <DataTable<CatalogChannel["models"][number]> rowId="id" rows={channel.models} columns={[
                    { title: t("workspace.name"), render: (_, model) => <span className="font-medium break-words">{model.name || model.model}</span> },
                    { title: t("workspace.modelId"), dataIndex: "model", render: (model) => <span className="break-all text-muted-foreground">{model}</span> },
                    { title: t("workspace.type"), dataIndex: "capability", render: (value: keyof typeof capabilities) => <Tag>{capabilities[value]}</Tag> },
                ]} />
            </section>)}
        </section>
    );
}
