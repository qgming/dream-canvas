import appI18n from "@/i18n";
import { useCallback, useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { Hand, MousePointer2 } from "lucide-react";

import { useOpenModelSettings } from "@/hooks/use-open-model-settings";
import { requestEdit, requestGeneration, requestImageQuestion, type AiTextMessage } from "@/services/api/image";
import { uploadImage } from "@/services/image-storage";
import { uploadMediaFile } from "@/services/file-storage";
import { captureSession } from "@/services/api/client";
import { useGenerationTarget } from "./use-generation-target";
import { requestVideoGeneration, storeGeneratedVideo } from "@/services/api/video";
import { decodeChannelModel, resolveModelParameters, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { buildNodeContext } from "@/lib/canvas/plugin-node-context";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasNodeToolbarItem, CanvasPluginAi, CanvasPluginHost, GenerateOptions } from "@/types/canvas-plugin";
import type { ReferenceImage } from "@/types/image";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

type PluginHostParams = {
    projectId: string;
    effectiveConfig: AiConfig;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    theme: CanvasTheme;
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    viewportRef: MutableRefObject<ViewportTransform>;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setDialogNodeId: Dispatch<SetStateAction<string | null>>;
    applyAgentOps: (ops?: CanvasAgentOp[]) => unknown;
    startGenerationRequest: (targetNodeId: string, originNodeId: string) => AbortController;
    finishGenerationRequest: (targetNodeId: string, controller: AbortController) => void;
    stopGeneration: (nodeId: string) => void;
};

/**
 * Plugin node host capabilities: expose host-side AI generation, canvas access, and panel controls
 * through plugin-callable host/ai objects; returns renderers for plugin panels and toolbars.
 */
export function usePluginHost(params: PluginHostParams) {
    const { t } = useTranslation();
    const openModelSettings = useOpenModelSettings();
    const { projectId, effectiveConfig, isAiConfigReady, theme, nodesRef, connectionsRef, viewportRef, setNodes, setDialogNodeId, applyAgentOps, startGenerationRequest, finishGenerationRequest, stopGeneration } = params;
    const prepareTarget = useGenerationTarget(projectId);
    const assertSession = useRef(captureSession()).current;

    // Host capabilities available to plugin nodes; methods receive nodeId and are not bound to a specific node.
    const pluginAi = useMemo<CanvasPluginAi>(() => {
        const toReferences = async (refs?: string[], signal?: AbortSignal): Promise<ReferenceImage[]> => {
            assertSession();
            return Promise.all((refs || []).filter(Boolean).map(async (src, index) => {
                assertSession();
                const asset = await uploadImage(src, { signal });
                return { id: `plugin-ref-${index}`, name: `ref-${index}.png`, type: asset.mimeType, dataUrl: asset.url, storageKey: asset.storageKey };
            }));
        };
        const target = (nodeId?: string, signal?: AbortSignal) => {
            if (!nodeId) throw new Error(appI18n.t("workspace.pluginTargetRequired"));
            return prepareTarget(nodeId, signal);
        };
        // Open the configuration dialog and throw when AI is not configured, allowing the plugin to handle the error.
        const ensureReady = (config: AiConfig) => {
            if (!isAiConfigReady(config, config.model)) {
                openModelSettings();
                throw new Error(t("canvas.plugins.aiConfigRequired"));
            }
        };
        const generationConfig = (mode: ModelCapability, options?: GenerateOptions) => {
            const node = nodesRef.current.find((node) => node.id === options?.nodeId);
            if (!node) throw new Error(appI18n.t("workspace.pluginTargetMissing"));
            const config = buildGenerationConfig(effectiveConfig, node, mode);
            if (options?.model !== undefined) config.model = options.model;
            ensureReady(config);
            const decoded = decodeChannelModel(config.model);
            const model = config.channels.find((channel) => channel.id === decoded?.channelId)?.models.find((model) => model.name === decoded?.model);
            if (model?.capability !== mode) throw new Error(appI18n.t("errors.validChannelModel"));
            const parameters = { ...node.metadata?.modelParameters?.[config.model], ...options?.parameters };
            for (const key of Object.keys(parameters)) {
                if (!model.parameters.some((control) => control.type !== "reference" && control.key === key)) throw new Error(appI18n.t("errors.undeclaredParameter", { name: key }));
            }
            config.modelParameters = resolveModelParameters(config, config.model, parameters);
            return { config, nodeId: node.id };
        };
        const saveTarget = (nodeId: string, mode: ModelCapability, prompt: string, config: AiConfig, signal?: AbortSignal) => {
            assertSession();
            if (signal?.aborted) throw new DOMException(appI18n.t("errors.waitStopped"), "AbortError");
            setNodes((nodes) => nodes.map((node) => node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: "loading", errorDetails: undefined, generationMode: mode, prompt, model: config.model, modelParameters: { ...node.metadata?.modelParameters, [config.model]: config.modelParameters || {} } } } : node));
            return target(nodeId, signal);
        };
        const runGeneration = async <T,>(nodeId: string, signal: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>) => {
            if (signal?.aborted) throw new DOMException(appI18n.t("errors.waitStopped"), "AbortError");
            const controller = startGenerationRequest(nodeId, nodeId);
            const abort = () => controller.abort();
            signal?.addEventListener("abort", abort, { once: true });
            try { return await run(controller.signal); }
            catch (error) {
                if (!controller.signal.aborted) setNodes((nodes) => nodes.map((node) => node.id === nodeId && node.metadata?.status === "loading" ? { ...node, metadata: { ...node.metadata, status: "error", errorDetails: error instanceof Error ? error.message : appI18n.t("workbench.generationFailed") } } : node));
                throw error;
            } finally {
                signal?.removeEventListener("abort", abort);
                if (!controller.signal.aborted) setNodes((nodes) => nodes.map((node) => node.id === nodeId && node.metadata?.status === "loading" ? { ...node, metadata: { ...node.metadata, status: "error", errorDetails: appI18n.t("errors.waitStopped") } } : node));
                finishGenerationRequest(nodeId, controller);
            }
        };
        return {
            generateImage: async (prompt, options) => {
                assertSession();
                const { config, nodeId } = generationConfig("image", options);
                return runGeneration(nodeId, options?.signal, async (signal) => {
                    const references = await toReferences(options?.references, signal);
                    const bound = await saveTarget(nodeId, "image", prompt, config, signal);
                    const items = references.length ? await requestEdit(config, prompt, references, { ...bound, signal }) : await requestGeneration(config, prompt, { ...bound, signal });
                    return { images: items.map((item) => item.dataUrl) };
                });
            },
            generateVideo: async (prompt, options) => {
                assertSession();
                const { config, nodeId } = generationConfig("video", options);
                return runGeneration(nodeId, options?.signal, async (signal) => {
                    const references = await toReferences(options?.references, signal);
                    const videos = await Promise.all((options?.videos || []).map(async (url, index) => {
                        const asset = await uploadMediaFile(url, "video");
                        assertSession();
                        return { id: `plugin-video-${index}`, name: `video-${index + 1}`, type: asset.mimeType, url: asset.url, storageKey: asset.storageKey };
                    }));
                    const bound = await saveTarget(nodeId, "video", prompt, config, signal);
                    const file = await storeGeneratedVideo(await requestVideoGeneration(config, prompt, references, { ...bound, signal, videos }));
                    return { url: file.url, mimeType: file.mimeType, width: file.width, height: file.height, durationMs: file.durationMs };
                });
            },
            generateText: async (prompt, options) => {
                assertSession();
                const { config, nodeId } = generationConfig("text", options);
                const messages: AiTextMessage[] = [...(options?.system ? [{ role: "system" as const, content: options.system }] : []), { role: "user" as const, content: prompt }];
                return runGeneration(nodeId, options?.signal, async (signal) => {
                    const bound = await saveTarget(nodeId, "text", prompt, config, signal);
                    let previous = "";
                    const text = await requestImageQuestion(config, messages, (value) => { options?.onDelta?.(value.startsWith(previous) ? value.slice(previous.length) : value); previous = value; }, { ...bound, signal });
                    return { text };
                });
            },
            // List configured models for a capability; labels use the model name without the channel prefix.
            listModels: (capability) => selectableModelsByCapability(effectiveConfig, capability as ModelCapability | undefined).map((value) => ({ value, label: decodeChannelModel(value)?.model || value })),
            defaultModel: (capability) => buildGenerationConfig(effectiveConfig, undefined, capability).model,
            stopGeneration: (nodeId) => { if (nodeId) stopGeneration(nodeId); },
        };
    }, [assertSession, effectiveConfig, isAiConfigReady, nodesRef, openModelSettings, prepareTarget, setNodes, startGenerationRequest, finishGenerationRequest, stopGeneration, t]);

    const pluginHost = useMemo<CanvasPluginHost>(
        () => ({
            getNode: (id) => nodesRef.current.find((node) => node.id === id) || null,
            getNodes: () => nodesRef.current,
            getConnections: () => connectionsRef.current,
            getUpstream: (nodeId) =>
                connectionsRef.current
                    .filter((conn) => conn.toNodeId === nodeId)
                    .map((conn) => nodesRef.current.find((node) => node.id === conn.fromNodeId))
                    .filter((node): node is CanvasNodeData => Boolean(node)),
            getDownstream: (nodeId) =>
                connectionsRef.current
                    .filter((conn) => conn.fromNodeId === nodeId)
                    .map((conn) => nodesRef.current.find((node) => node.id === conn.toNodeId))
                    .filter((node): node is CanvasNodeData => Boolean(node)),
            updateNode: (nodeId, patch) => setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, ...patch } : node))),
            updateMetadata: (nodeId, patch) => setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...patch } } : node))),
            applyOps: (ops) => applyAgentOps(ops),
            ai: pluginAi,
            openPanel: (nodeId) => setDialogNodeId(nodeId),
            closePanel: () => setDialogNodeId(null),
        }),
        [applyAgentOps, pluginAi],
    );

    const renderPluginPanel = useCallback(
        (panelNode: CanvasNodeData) => {
            const Panel = getNodeDefinition(panelNode.type)?.Panel;
            if (!Panel) return null;
            const ctx = buildNodeContext(pluginHost, panelNode, theme, viewportRef.current.k);
            return <Panel key={panelNode.id} ctx={ctx} onClose={() => setDialogNodeId(null)} />;
        },
        [pluginHost, theme],
    );

    // Build the node toolbar from plugin items and a host-provided interaction/move toggle when enabled.
    const buildNodeToolbarItems = useCallback(
        (node: CanvasNodeData): CanvasNodeToolbarItem[] => {
            const definition = getNodeDefinition(node.type);
            const ctx = buildNodeContext(pluginHost, node, theme, viewportRef.current.k);
            const custom = definition?.toolbar?.(ctx) || [];
            // Show the interaction/move toggle only for nodes with content that are not forced into an interactive state.
            if (!definition?.interactionToggle || !node.metadata?.content || definition.forceInteractive?.(node)) return custom;
            const interactive = Boolean(node.metadata?.interactive);
            const toggle: CanvasNodeToolbarItem = {
                id: "node-interaction-toggle",
                title: t(interactive ? "canvas.plugins.interactiveTitle" : "canvas.plugins.movableTitle"),
                label: t(interactive ? "canvas.plugins.move" : "canvas.plugins.interact"),
                icon: interactive ? <Hand className="size-4" /> : <MousePointer2 className="size-4" />,
                active: interactive,
                onClick: () => pluginHost.updateMetadata(node.id, { interactive: !interactive }),
            };
            return [toggle, ...custom];
        },
        [pluginHost, t, theme],
    );

    return { pluginHost, renderPluginPanel, buildNodeToolbarItems };
}
