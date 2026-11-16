import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Space, Table, Tag } from "antd";

import { apiRequest, captureSession } from "@/services/api/client";
import { decideApproval, type Approval } from "@/services/api/projects";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";

export default function ApprovalsPage() {
    const { message, modal } = App.useApp();
    const queryClient = useQueryClient();
    const query = useQuery({ queryKey: ["approvals"], queryFn: () => apiRequest<Approval[]>("/approvals") });
    const decide = async (approval: Approval, accept: boolean, assertSession = captureSession()) => {
        try {
            assertSession();
            const result = await decideApproval(approval.id, accept);
            assertSession();
            await Promise.all([queryClient.invalidateQueries({ queryKey: ["approvals"] }), useAssetStore.getState().loadAssets(), useCanvasStore.getState().refreshProjects()]);
            assertSession();
            message.success("deleteState" in result ? result.message : accept ? "操作已确认" : "操作已拒绝");
        } catch (error) { message.error(error instanceof Error ? error.message : "确认失败"); throw error; }
    };
    const confirm = (record: Approval) => {
        const assertSession = captureSession();
        modal.confirm({ title: record.action === "delete_project" ? "确认删除项目？" : "确认全局删除资产？", content: record.action === "delete_project" ? "删除项目将解除媒体引用，资产库中的原件保留。" : "所有项目中的此媒体将不可读取，节点、提示词和参数保留。", okText: "确认删除", cancelText: "取消", okButtonProps: { danger: true }, onOk: () => decide(record, true, assertSession) });
    };
    return (
        <section>
            <header className="mb-5 flex items-center justify-between"><h2 className="text-2xl font-medium tracking-tight">操作确认</h2><Button type="text" onClick={() => void query.refetch()}>刷新</Button></header>
            <p className="mb-6 text-sm leading-6 text-muted-foreground">查看并确认助手或远程工具申请的项目删除、全局资产删除操作。</p>
            {query.error ? <Alert type="error" title={query.error.message} /> : null}
            <Table<Approval> rowKey="id" dataSource={query.data} loading={query.isLoading} pagination={false} scroll={{ x: true }} columns={[
                { title: "操作", render: (_, record) => record.action === "delete_project" ? "删除项目" : "全局删除资产" },
                { title: "目标", render: (_, record) => record.action === "delete_project" ? useCanvasStore.getState().projects.find((project) => project.id === record.targetId)?.title || record.targetId : useAssetStore.getState().assets.find((asset) => asset.id === record.targetId)?.title || record.targetId },
                { title: "状态", render: (_, record) => <Tag>{record.status === "pending" ? "等待确认" : record.status === "accepted" ? "已确认" : "已拒绝"}</Tag> },
                { title: "操作", render: (_, record) => record.status === "pending" ? <Space><Button type="text" onClick={() => { void decide(record, false).catch(() => undefined); }}>拒绝</Button><Button type="text" danger onClick={() => confirm(record)}>确认</Button></Space> : null },
            ]} />
        </section>
    );
}
