import { useCallback, useEffect, useRef, useState } from "react";
import { nanoid } from "nanoid";
import i18n from "@/i18n";

import { captureSession } from "@/services/api/client";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import type { GenerationOptions } from "@/services/api/tasks";

type Target = Required<Pick<GenerationOptions, "projectId" | "projectVersion" | "nodeId" | "batchId">>;
type Preparation = { nodeId: string; signal?: AbortSignal; assertSession: () => void; resolve: (target: Target) => void; reject: (error: unknown) => void; stop: () => void };
const interrupted = () => new DOMException(i18n.t("errors.waitStopped"), "AbortError");

export function useGenerationTarget(projectId: string) {
    const [revision, setRevision] = useState(0);
    const pending = useRef(new Set<Preparation>());
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            for (const request of pending.current) { request.stop(); request.reject(interrupted()); }
            pending.current.clear();
        };
    }, []);
    // Coalesce requests from this render and flush the authoritative store before submission.
    useEffect(() => {
        const batch = [...pending.current];
        if (!batch.length) return;
        for (const request of batch) {
            try { request.assertSession(); }
            catch (error) { pending.current.delete(request); request.stop(); request.reject(error); }
        }
        if (!pending.current.size) return;
        void useCanvasStore.getState().ensureSaved(projectId).then((project) => {
            for (const request of batch) {
                if (!pending.current.has(request)) continue;
                try {
                    request.assertSession();
                    if (!mounted.current || request.signal?.aborted) throw interrupted();
                    if (!project.nodes.some((node) => node.id === request.nodeId)) throw new Error(i18n.t("errors.projectTargetRemoved"));
                    request.resolve({ projectId, projectVersion: project.version, nodeId: request.nodeId, batchId: nanoid() });
                } catch (error) { request.reject(error); }
                finally { pending.current.delete(request); request.stop(); }
            }
        }, (error: unknown) => {
            for (const request of batch) { if (!pending.current.delete(request)) continue; request.stop(); request.reject(error); }
        });
    }, [revision, projectId]);
    return useCallback((nodeId: string, signal?: AbortSignal): Promise<Target> => new Promise((resolve, reject) => {
        if (!mounted.current || signal?.aborted) { reject(interrupted()); return; }
        const abort = () => { pending.current.delete(request); request.stop(); reject(interrupted()); };
        const request: Preparation = { nodeId, signal, assertSession: captureSession(), resolve, reject, stop: () => signal?.removeEventListener("abort", abort) };
        pending.current.add(request);
        signal?.addEventListener("abort", abort, { once: true });
        setRevision((value) => value + 1);
    }), [projectId]);
}
