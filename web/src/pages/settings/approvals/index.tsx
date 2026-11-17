import { useTranslation } from "react-i18next";
import appI18n from "@/i18n";
import { PageHeader } from "@/components/layout/page-header";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Notice as Alert } from "@/components/ui/display";
import { useFeedback } from "@/hooks/use-feedback";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Badge as Tag } from "@/components/ui/display";

import { apiRequest, captureSession } from "@/services/api/client";
import { decideApproval, type Approval } from "@/services/api/projects";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";

export default function ApprovalsPage() {
    useTranslation();
    const { notify, confirm } = useFeedback();
    const queryClient = useQueryClient();
    const query = useQuery({ queryKey: ["approvals"], queryFn: () => apiRequest<Approval[]>("/approvals") });
    const decide = async (approval: Approval, accept: boolean, assertSession = captureSession()) => {
        try {
            assertSession();
            const result = await decideApproval(approval.id, accept);
            assertSession();
            await Promise.all([queryClient.invalidateQueries({ queryKey: ["approvals"] }), useAssetStore.getState().loadAssets(), useCanvasStore.getState().refreshProjects()]);
            assertSession();
            notify.success("deleteState" in result ? result.message : accept ? appI18n.t("workspace.operationAccepted") : appI18n.t("workspace.operationRejected"));
        } catch (error) { notify.error(error instanceof Error ? error.message : appI18n.t("workspace.confirmFailed")); throw error; }
    };
    const confirmApproval = (record: Approval) => {
        const assertSession = captureSession();
        confirm({ title: record.action === "delete_project" ? appI18n.t("workspace.confirmProjectDelete") : appI18n.t("workspace.confirmAssetDelete"), content: record.action === "delete_project" ? appI18n.t("workspace.projectDeleteDescription") : appI18n.t("workspace.assetDeleteDescription"), confirmText: appI18n.t("workspace.confirmDelete"), cancelText: appI18n.t("workspace.cancel"), destructive: true, onConfirm: () => decide(record, true, assertSession) });
    };
    return (
        <section className="space-y-6">
            <PageHeader title={appI18n.t("workspace.approvals")} description={appI18n.t("workspace.approvalsDescription")} actions={<Button variant="ghost" loading={query.isFetching} onClick={() => void query.refetch()}>{appI18n.t("workspace.refresh")}</Button>} />
            {query.error ? <Alert type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>{appI18n.t("workspace.retry")}</Button>} /> : null}
            <DataTable<Approval> rowId="id" rows={query.data} loading={query.isLoading} failed={query.isError} columns={[
                { title: appI18n.t("workspace.type"), render: (_, record) => <span className="font-medium">{record.action === "delete_project" ? appI18n.t("workspace.deleteProject") : appI18n.t("workspace.globalDeleteAsset")}</span> },
                { title: appI18n.t("workspace.target"), render: (_, record) => <span className="break-all text-muted-foreground">{record.action === "delete_project" ? useCanvasStore.getState().projects.find((project) => project.id === record.targetId)?.title || record.targetId : useAssetStore.getState().assets.find((asset) => asset.id === record.targetId)?.title || record.targetId}</span> },
                { title: appI18n.t("workspace.status"), render: (_, record) => <Tag color={record.status === "pending" ? "warning" : record.status === "accepted" ? "success" : undefined}>{record.status === "pending" ? appI18n.t("workspace.waitingApproval") : record.status === "accepted" ? appI18n.t("workspace.accepted") : appI18n.t("workspace.rejected")}</Tag> },
                { title: appI18n.t("workspace.actions"), align: "right", render: (_, record) => record.status === "pending" ? <div className="flex flex-wrap items-center justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => { void decide(record, false).catch(() => undefined); }}>{appI18n.t("workspace.reject")}</Button><Button size="sm" variant="ghost" data-destructive onClick={() => confirmApproval(record)}>{appI18n.t("workspace.confirm")}</Button></div> : null },
            ]} />
        </section>
    );
}
