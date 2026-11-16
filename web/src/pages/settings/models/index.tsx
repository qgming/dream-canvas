import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Empty, Spin, Tag } from "antd";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { modelCatalog } from "@/services/api/channels";
import { useAuthStore } from "@/stores/use-auth-store";

export default function ModelsPage() {
    const { t } = useTranslation();
    const owner = useAuthStore((state) => state.user?.id);
    const query = useQuery({ queryKey: ["model-catalog", owner], queryFn: modelCatalog });

    return (
        <section className="space-y-6">
            <header className="flex flex-wrap items-center justify-between gap-4">
                <h2 className="text-2xl font-medium tracking-tight">{t("settings.models")}</h2>
                <Button type="text" icon={<RefreshCw className="size-4" />} loading={query.isFetching} onClick={() => void query.refetch()}>{t("common.refresh")}</Button>
            </header>
            <p className="text-sm leading-6 text-muted-foreground">{t("settings.modelsDescription")}</p>
            {query.error ? <Alert type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>{t("common.retry")}</Button>} /> : null}
            {query.isLoading ? <Spin /> : null}
            {query.data?.length === 0 ? <Empty description={t("settings.modelsEmpty")} /> : null}
            {query.data?.map((channel) => <section key={channel.id} className="border-b border-border pb-5">
                <h3 className="font-medium">{channel.name}</h3>
                <div className="mt-3 flex flex-wrap gap-2">{channel.models.map((model) => <Tag key={model.id}>{model.name || model.model}</Tag>)}</div>
            </section>)}
        </section>
    );
}
