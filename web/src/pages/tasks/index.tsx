import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Descriptions, Drawer, Empty, Select, Table, Tag } from "antd";
import { RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";

import { AssetMedia } from "@/components/canvas/asset-media";
import { assetUrl } from "@/services/api/assets";
import { cancelGeneration, getGeneration, listGenerations, type GenerationTask } from "@/services/api/tasks";
import { captureSession } from "@/services/api/client";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useConfigStore } from "@/stores/use-config-store";

const states: Record<string, { label: string; color?: string }> = {
    queued: { label: "排队中" }, waiting_assets: { label: "等待素材同步" }, submitting: { label: "正在提交", color: "processing" },
    running: { label: "生成中", color: "processing" }, saving: { label: "正在保存", color: "processing" },
    succeeded: { label: "生成成功", color: "success" }, failed: { label: "生成失败", color: "error" },
    cancelled: { label: "已取消" }, interrupted: { label: "已中断", color: "warning" }, confirmation_required: { label: "结果待确认", color: "warning" },
};
const kinds = { text: "文本", image: "图片", video: "视频", audio: "音频" };
const saveStates: Record<string, string> = { saving: "保存中", saved: "已保存", failed: "保存失败" };
const syncStates: Record<string, string> = { local: "仅本地", pending: "等待同步", syncing: "同步中", synced: "已同步", failed: "同步失败" };

export default function TasksPage() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const query = useQuery({ queryKey: ["generation-tasks"], queryFn: listGenerations });
    const [filter, setFilter] = useState("");
    const [selectedId, setSelectedId] = useState("");
    const [cancelling, setCancelling] = useState("");
    const projects = useCanvasStore((state) => state.projects);
    const channels = useConfigStore((state) => state.config.channels);
    const detail = useQuery({ queryKey: ["generation-task", selectedId], queryFn: () => getGeneration(selectedId), enabled: Boolean(selectedId) });
    useEffect(() => {
        const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["generation-tasks"] }); void queryClient.invalidateQueries({ queryKey: ["generation-task"] }); };
        window.addEventListener("server-changed", refresh);
        return () => window.removeEventListener("server-changed", refresh);
    }, [queryClient]);
    const cancel = async (task: GenerationTask) => {
        const assertSession = captureSession();
        setCancelling(task.id);
        try { const updated = await cancelGeneration(task.id); assertSession(); queryClient.setQueryData(["generation-task", task.id], updated); await query.refetch(); message.success(updated.status === "cancelled" ? "任务已取消" : "取消状态已更新，请继续查看任务结果"); }
        catch (error) { message.error(error instanceof Error ? error.message : "取消失败"); }
        finally { setCancelling(""); }
    };
    const modelLabel = (task: GenerationTask) => {
        const channel = channels.find((item) => item.id === task.channelId);
        const model = channel?.models.find((item) => item.id === task.modelId);
        return `${channel?.name || task.channelId} / ${model?.label || task.modelId}`;
    };
    const task = detail.data;
    return (
        <main className="h-full overflow-auto bg-background text-foreground">
            <div className="mx-auto max-w-6xl space-y-6 px-6 py-10">
                <header className="flex flex-wrap items-end justify-between gap-4">
                    <div><h1 className="text-2xl font-medium">生成任务</h1><p className="mt-2 text-sm text-muted-foreground">查看任务进度、保存结果和待确认状态。</p></div>
                    <div className="flex gap-3"><Select aria-label="按任务状态筛选" className="w-40" value={filter} onChange={setFilter} options={[{ value: "", label: "全部状态" }, ...Object.entries(states).map(([value, item]) => ({ value, label: item.label }))]} /><Button type="text" icon={<RefreshCw className="size-4" />} loading={query.isFetching} onClick={() => { void query.refetch(); if (selectedId) void detail.refetch(); }}>刷新</Button></div>
                </header>
                {query.error ? <Alert type="error" title={query.error.message} /> : null}
                <Table<GenerationTask> rowKey="id" dataSource={query.data?.filter((task) => !filter || task.status === filter)} loading={query.isLoading} pagination={false} scroll={{ x: true }} locale={{ emptyText: <Empty description="还没有生成任务，后续提交的任务将在这里保留状态。" /> }} columns={[
                    { title: "类型", render: (_, task) => kinds[task.capability] },
                    { title: "项目", render: (_, task) => task.projectId ? <Link to={`/canvas/${encodeURIComponent(task.projectId)}`}>{projects.find((item) => item.id === task.projectId)?.title || "目标项目"}</Link> : "工作台" },
                    { title: "渠道 / 模型", render: (_, task) => <span className="break-all text-xs">{modelLabel(task)}</span> },
                    { title: "状态", render: (_, task) => <Tag color={states[task.status]?.color}>{states[task.status]?.label || task.status}</Tag> },
                    { title: "原件", render: (_, task) => saveStates[task.saveState] || "尚无保存结果" },
                    { title: "云同步", render: (_, task) => syncStates[task.syncState] || "尚无同步记录" },
                    { title: "提交时间", render: (_, task) => new Date(task.createdAt).toLocaleString() },
                    { title: "操作", render: (_, task) => <div className="flex gap-1"><Button type="text" size="small" onClick={() => setSelectedId(task.id)}>详情</Button>{["queued", "waiting_assets"].includes(task.status) ? <Button type="text" size="small" loading={cancelling === task.id} onClick={() => void cancel(task)}>取消</Button> : null}</div> },
                ]} />
            </div>
            <Drawer title="任务详情" open={Boolean(selectedId)} onClose={() => setSelectedId("")} size={640}>
                {detail.error ? <Alert type="error" title={detail.error.message} action={<Button onClick={() => void detail.refetch()}>重新读取</Button>} /> : null}
                {task ? <div className="space-y-6">
                    <Descriptions column={1} size="small" items={[
                        { key: "id", label: "任务编号", children: <span className="break-all">{task.id}</span> },
                        { key: "status", label: "生成状态", children: states[task.status]?.label || task.status },
                        { key: "save", label: "原件保存", children: saveStates[task.saveState] || "尚无保存结果" },
                        { key: "sync", label: "云同步", children: syncStates[task.syncState] || "尚无同步记录" },
                        { key: "upstream", label: "上游编号", children: task.upstreamId || "尚未记录" },
                        { key: "version", label: "提交时项目版本", children: task.projectId ? task.projectVersion : "工作台任务" },
                        { key: "cancel", label: "取消请求", children: task.cancelRequested ? "已提出，最终结果以任务状态为准" : "未提出" },
                    ]} />
                    {task.error ? <Alert type={task.status === "confirmation_required" ? "warning" : "error"} title={task.error} /> : null}
                    {task.status === "confirmation_required" ? <p className="text-sm text-muted-foreground">上游结果尚未确认，请保留任务编号，等待核对结果后再决定后续操作。</p> : null}
                    {task.text ? <pre className="whitespace-pre-wrap break-words text-sm leading-6">{task.text}</pre> : null}
                    {(task.assetIds || []).map((id) => <div key={id} className="space-y-2">{task.capability !== "text" ? <AssetMedia kind={task.capability} src={assetUrl(id)} alt="任务成品" controls className="max-h-96 max-w-full object-contain" /> : null}<a href={assetUrl(id)} target="_blank" rel="noreferrer" className="text-sm underline">查看保存原件</a></div>)}
                    <details><summary className="cursor-pointer text-sm">提交内容</summary><pre className="mt-3 whitespace-pre-wrap break-words text-xs leading-5">{JSON.stringify(task.input, null, 2)}</pre></details>
                </div> : null}
            </Drawer>
        </main>
    );
}
