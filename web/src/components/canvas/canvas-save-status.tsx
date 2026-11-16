import { App, Button } from "antd";
import { useParams } from "react-router-dom";

import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { captureSession } from "@/services/api/client";

export function CanvasSaveStatus() {
    const { id = "" } = useParams();
    const { message, modal } = App.useApp();
    const state = useCanvasStore((store) => store.saves[id]);
    const remote = useCanvasStore((store) => store.remoteChanges[id]);
    if ((!state || state.status === "saved") && !remote) return null;
    if ((!state || state.status === "saved") && remote) return <div role="status" className="absolute inset-x-4 bottom-20 z-50 mx-auto flex w-fit items-center gap-3 rounded-lg bg-popover px-4 py-3 text-sm text-popover-foreground" data-canvas-shortcuts-ignore><span>{remote < 0 ? "服务端项目已删除，当前页面内容仍保留" : "项目已在其他页面或工具中更新"}</span><Button type="text" size="small" onClick={() => window.location.reload()}>重新读取</Button></div>;
    if (!state) return null;
    if (state.status === "saving") return <span className="pointer-events-none absolute right-6 bottom-20 z-30 text-xs text-muted-foreground">正在保存</span>;
    const act = async (action: () => Promise<unknown>) => { try { await action(); } catch (error) { message.error(error instanceof Error ? error.message : "操作失败"); } };
    return (
        <div role="alert" className="absolute inset-x-4 bottom-20 z-50 mx-auto flex w-fit max-w-[calc(100%-2rem)] flex-wrap items-center gap-2 rounded-xl border border-border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-sm" data-canvas-shortcuts-ignore>
            <span>{state.message || "保存失败，未保存内容已保留"}</span>
            {state.status !== "conflict" ? <Button type="text" size="small" onClick={() => void act(() => useCanvasStore.getState().retrySave(id))}>重试保存</Button> : null}
            <Button type="text" size="small" onClick={() => void act(async () => { await useCanvasStore.getState().saveCopy(id); message.success("已保存副本，可在项目列表打开；当前未保存内容仍保留"); })}>另存副本</Button>
            <Button type="text" size="small" onClick={() => { const assertSession = captureSession(); modal.confirm({ title: "重新读取服务端项目？", content: "这会放弃当前项目的未保存编辑，建议先另存副本。", okText: "放弃编辑并读取", cancelText: "保留编辑", onOk: () => act(async () => { assertSession(); await useCanvasStore.getState().reloadProject(id); assertSession(); window.location.reload(); }) }); }}>重新读取</Button>
        </div>
    );
}
