import { useCallback, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { EditGuardContext } from "@/hooks/use-edit-guard";
import { useFeedback } from "@/hooks/use-feedback";
import { publishClient, acknowledgeClient, removeClient, type ClientCommand, type ClientState } from "@/services/api/clients";
import { captureSession } from "@/services/api/client";

import i18n from "@/i18n";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import type { CanvasConnection, CanvasNodeData, ContextMenuState, ViewportTransform } from "@/types/canvas";

type GenerateNodeRef = MutableRefObject<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => Promise<void>) | null>;

type AgentBridgeParams = {
    ready: boolean;
    projectId: string;
    title: string | undefined;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: Set<string>;
    viewport: ViewportTransform;
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    selectedNodeIdsRef: MutableRefObject<Set<string>>;
    viewportRef: MutableRefObject<ViewportTransform>;
    generateNodeRef: GenerateNodeRef;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setViewport: Dispatch<SetStateAction<ViewportTransform>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
};

let navigationCommand: ClientCommand | null = null;

/**
 * Publish this page's selection and snapshot for mentions and node plugins.
 * Server business tools must use the backend service instead of this page bridge.
 */
export function useAgentBridge(params: AgentBridgeParams) {
    const { ready, projectId, title, nodes, connections, selectedNodeIds, viewport, nodesRef, connectionsRef, selectedNodeIdsRef, viewportRef, generateNodeRef, setNodes, setConnections, setSelectedNodeIds, setSelectedConnectionId, setViewport, setContextMenu } =
        params;
    const setAgentCanvasContext = useAgentStore((state) => state.setCanvasContext);
    const navigate = useNavigate();
    const editGuard = useContext(EditGuardContext);
    const { notify } = useFeedback();
    const [clientId] = useState(() => [...crypto.getRandomValues(new Uint8Array(32))].map((value) => value.toString(16).padStart(2, "0")).join(""));
    const clientRevision = useRef(0);
    const registrationRevision = useRef(0);
    const latestClient = useRef<ClientState | null>(null);
    const received = useRef(new Map<string, boolean | null>());
    const pendingApplication = useRef<ClientCommand | null>(null);
    const acknowledge = useRef<(command: ClientCommand, accepted: boolean) => void>(() => {});
    const receiveCommand = useRef<(command: ClientCommand) => boolean | null>(() => false);
    receiveCommand.current = (command) => {
        const current = latestClient.current;
        if (!current || command.projectId !== projectId || command.revision !== current.revision) return false;
        if (command.kind === "client_select" && command.value.nodeIds?.every((id) => nodesRef.current.some((node) => node.id === id))) { pendingApplication.current = command; setSelectedNodeIds(new Set(command.value.nodeIds)); setSelectedConnectionId(null); return null; }
        if (command.kind === "client_viewport" && command.value.viewport) { pendingApplication.current = command; useCanvasStore.getState().setProjectViewport(projectId, command.value.viewport, true); return null; }
        if (command.kind === "client_navigate" && command.value.projectId && !editGuard?.dirty) { if (command.value.projectId === projectId) return true; navigationCommand = command; navigate(`/canvas/${encodeURIComponent(command.value.projectId)}`); return null; }
        return false;
    };
    const publish = useRef<() => void>(() => {});
    const canUndo = useCanvasStore((state) => Boolean(state.histories[projectId]?.past.length));
    const projectTitle = title || i18n.t("canvas.project.untitled");

    const agentSnapshot = useMemo<CanvasAgentSnapshot>(() => ({ projectId, title: projectTitle, nodes, connections, selectedNodeIds: Array.from(selectedNodeIds), viewport }), [connections, projectTitle, nodes, projectId, selectedNodeIds, viewport]);
    useEffect(() => {
        const command = pendingApplication.current;
        if (!command) return;
        const ids = command.value.nodeIds || [], target = command.value.viewport;
        const accepted = command.kind === "client_select" ? ids.length === selectedNodeIds.size && ids.every(id => selectedNodeIds.has(id)) : Boolean(target && target.x === viewport.x && target.y === viewport.y && target.k === viewport.k);
        pendingApplication.current = null;
        received.current.set(command.id, accepted);
        acknowledge.current(command, accepted);
    }, [selectedNodeIds, viewport]);
    useEffect(() => {
        if (!ready) return;
        latestClient.current = { id: clientId, projectId, title: projectTitle, revision: ++clientRevision.current, nodeIds: nodes.map((node) => node.id), selectedNodeIds: [...selectedNodeIds], viewport };
        publish.current();
    }, [ready, clientId, projectId, projectTitle, nodes, selectedNodeIds, viewport]);
    useEffect(() => {
        if (!ready) return;
        let disposed = false, writing = false, pending = false;
        const registration = ++registrationRevision.current;
        let source: EventSource | undefined;
        const assertSession = captureSession();
        const connect = () => {
            if (source || disposed) return;
            source = new EventSource(`/api/clients/${encodeURIComponent(clientId)}/events?registration=${registration}`);
            source.addEventListener("commands", (event) => {
                const commands = JSON.parse((event as MessageEvent<string>).data) as ClientCommand[];
                const ids = new Set(commands.map(command => command.id));
                for (const id of received.current.keys()) if (!ids.has(id)) received.current.delete(id);
                for (const command of commands) {
                    if (navigationCommand?.id === command.id) continue;
                    const accepted = received.current.has(command.id) ? received.current.get(command.id)! : receiveCommand.current(command);
                    received.current.set(command.id, accepted);
                    if (accepted === null) continue;
                    acknowledge.current(command, accepted);
                }
            });
            source.onerror = () => { if (source?.readyState === EventSource.CLOSED) { source.close(); source = undefined; sync(); } };
        };
        const sync = () => {
            pending = true; if (writing || disposed) return; writing = true;
            void (async () => { while (pending && !disposed) { pending = false; const value = latestClient.current; if (!value) return; assertSession(); await publishClient(value, registration); assertSession(); if (!disposed) connect(); } })().catch((error: unknown) => { if (!disposed) notify.error(error instanceof Error ? error.message : i18n.t("errors.clientStateFailed")); }).finally(() => { writing = false; });
        };
        acknowledge.current = (command, accepted) => { void acknowledgeClient(clientId, command.id, accepted).catch((error: unknown) => { if (!disposed) notify.error(error instanceof Error ? error.message : i18n.t("errors.clientStateFailed")); }); };
        publish.current = sync; sync(); window.addEventListener("focus", sync);
        return () => { disposed = true; source?.close(); publish.current = () => {}; acknowledge.current = () => {}; window.removeEventListener("focus", sync); void removeClient(clientId, registration).catch(() => {}); };
    }, [ready, clientId, projectId, notify]);
    useEffect(() => {
        const command = navigationCommand;
        if (!ready || !command || command.value.projectId !== projectId) return;
        void acknowledgeClient(command.clientId, command.id, true, projectId).then(() => { if (navigationCommand?.id === command.id) navigationCommand = null; }).catch((error: unknown) => notify.error(error instanceof Error ? error.message : i18n.t("errors.clientStateFailed")));
    }, [ready, projectId, notify]);
    const applyAgentOps = useCallback(
        (ops?: CanvasAgentOp[]) => {
            const safeOps = Array.isArray(ops) ? ops.filter((op) => op?.type) : [];
            const before = { projectId, title: projectTitle, nodes: nodesRef.current, connections: connectionsRef.current, selectedNodeIds: Array.from(selectedNodeIdsRef.current), viewport: viewportRef.current };
            const generationOps = safeOps.filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation" && Boolean(op.nodeId));
            const next = applyCanvasAgentOps(
                before,
                safeOps.filter((op) => op.type !== "run_generation"),
            );
            nodesRef.current = next.nodes;
            connectionsRef.current = next.connections;
            selectedNodeIdsRef.current = new Set(next.selectedNodeIds);
            viewportRef.current = next.viewport;
            setNodes(next.nodes);
            setConnections(next.connections);
            setSelectedNodeIds(new Set(next.selectedNodeIds));
            setSelectedConnectionId(null);
            if (safeOps.some((op) => op.type === "set_viewport")) useCanvasStore.getState().setProjectViewport(projectId, next.viewport, true);
            else setViewport(next.viewport);
            setContextMenu(null);
            if (generationOps.length) {
                queueMicrotask(() =>
                    generationOps.forEach((op) => {
                        const target = nodesRef.current.find((node) => node.id === op.nodeId);
                        const prompt = op.prompt?.trim() ? op.prompt : (target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                        void generateNodeRef.current?.(op.nodeId, op.mode || target?.metadata?.generationMode || "image", prompt);
                    }),
                );
            }
            return { ...next, projectId, title: projectTitle };
        },
        [projectTitle, projectId],
    );
    const undoAgentOps = useCallback(() => {
        void useCanvasStore.getState().undo(projectId).catch((error: unknown) => notify.error(error instanceof Error ? error.message : i18n.t("workspace.operationFailed")));
        return null;
    }, [projectId, notify]);

    useEffect(() => {
        setAgentCanvasContext({ clientId, snapshot: agentSnapshot, applyOps: applyAgentOps, undoOps: undoAgentOps, canUndo });
        return () => setAgentCanvasContext(null);
    }, [clientId, agentSnapshot, applyAgentOps, canUndo, setAgentCanvasContext, undoAgentOps]);

    return { applyAgentOps };
}
