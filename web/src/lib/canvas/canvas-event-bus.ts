import localforage from "localforage";

import type { PluginStorage } from "@/types/canvas-plugin";
import { captureSession } from "@/services/api/client";
import { useAuthStore } from "@/stores/use-auth-store";

// Lightweight canvas event bus for communication between nodes and plugins.
type Handler = (payload: unknown) => void;
const handlers = new Map<string, Set<Handler>>();

export function emitCanvasEvent(event: string, payload?: unknown) {
    handlers.get(event)?.forEach((handler) => {
        try {
            handler(payload);
        } catch (error) {
            console.error(`[canvas-event] handler for "${event}" failed`, error);
        }
    });
}

export function onCanvasEvent(event: string, handler: Handler) {
    let set = handlers.get(event);
    if (!set) {
        set = new Set();
        handlers.set(event, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
}

// Browser-only plugin preferences are scoped by account; project data belongs in node metadata.
const stores = new Map<string, LocalForage>();

export function createPluginStorage(pluginId: string): PluginStorage {
    const owner = useAuthStore.getState().user?.id;
    const assertSession = captureSession();
    const scopedKey = (key: string) => { assertSession(); if (!owner) throw new Error("请先登录后使用插件存储"); return `${owner}/${key}`; };
    let store = stores.get(pluginId);
    if (!store) {
        store = localforage.createInstance({ name: "infinite-canvas-plugins", storeName: pluginId });
        stores.set(pluginId, store);
    }
    return {
        get: async <T = unknown>(key: string) => { const value = await store!.getItem<T>(scopedKey(key)); assertSession(); return value; },
        set: async (key, value) => {
            await store!.setItem(scopedKey(key), value);
            assertSession();
        },
        remove: async (key) => {
            await store!.removeItem(scopedKey(key));
            assertSession();
        },
    };
}
