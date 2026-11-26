import i18n from "@/i18n";
import { create } from "zustand";
import localforage from "localforage";

import { ApiError, captureSession } from "@/services/api/client";
import { getPreference, savePreference } from "@/services/api/preferences";
import type { ModelCatalog, ModelFeatures, ParameterControl } from "@/services/api/channels";
import { useAuthStore } from "@/stores/use-auth-store";
import { inputVisible } from "@/lib/model-inputs";

export type ModelCapability = "image" | "video" | "text" | "audio";
export type ChannelModel = { id: string; name: string; label: string; version: number; features: ModelFeatures; capability: ModelCapability; parameters: ParameterControl[] };
export type ModelChannel = { id: string; name: string; models: ChannelModel[] };
export type AiConfig = {
    channelMode: "remote";
    channels: ModelChannel[];
    orders: Record<string, string[]>;
    models: string[];
    model: string; imageModel: string; videoModel: string; textModel: string; audioModel: string; assistantModel: string;
    nodeRegenerateBehavior: "new-node" | "overwrite"; autoFocusOnSelect: boolean;
    modelParameters?: Record<string, unknown>;
};
export type GenerationPreference = Pick<AiConfig, "nodeRegenerateBehavior" | "autoFocusOnSelect">;
export const defaultConfig: AiConfig = {
    channelMode: "remote", channels: [], orders: {}, models: [], model: "", imageModel: "", videoModel: "", textModel: "", audioModel: "", assistantModel: "",
    nodeRegenerateBehavior: "new-node", autoFocusOnSelect: false,
};
type ConfigStore = {
    config: AiConfig; hydrated: boolean; version: number; saving: boolean; dirty: boolean; conflict: boolean; error: string;
    reset: () => void; load: (discardDraft?: boolean) => Promise<void>; save: () => Promise<void>; setCatalog: (catalog: ModelCatalog) => void;
    updateConfig: <K extends keyof GenerationPreference>(key: K, value: GenerationPreference[K]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
};

const drafts = localforage.createInstance({ name: "dream-canvas", storeName: "unsaved-preferences" });
let scopeRevision = 0;
let editRevision = 0;
let running: Promise<void> | null = null;
let pendingWrite = Promise.resolve();
const preference = (value?: Partial<GenerationPreference> | null): GenerationPreference => ({
    nodeRegenerateBehavior: value?.nodeRegenerateBehavior ?? defaultConfig.nodeRegenerateBehavior,
    autoFocusOnSelect: value?.autoFocusOnSelect ?? defaultConfig.autoFocusOnSelect,
});
const draftKey = (owner: string) => `${owner}/generation`;

export const useConfigStore = create<ConfigStore>((set, get) => ({
    config: defaultConfig, hydrated: false, version: 0, saving: false, dirty: false, conflict: false, error: "",
    reset: () => { scopeRevision++; running = null; set({ config: defaultConfig, hydrated: false, version: 0, saving: false, dirty: false, conflict: false, error: "" }); },
    load: async (discardDraft = false) => {
        const owner = useAuthStore.getState().user?.id;
        if (!owner) return;
        const assertSession = captureSession();
        const edit = editRevision;
        await running;
        try { assertSession(); } catch { return; }
        if (useAuthStore.getState().user?.id !== owner) return;
        if (edit !== editRevision) { set({ error: i18n.t("errors.preferenceChangedDuringRead") }); return; }
        const scope = ++scopeRevision;
        try {
            const record = await getPreference<GenerationPreference>("generation");
            await pendingWrite.catch(() => undefined);
            if (scope !== scopeRevision || useAuthStore.getState().user?.id !== owner) return;
            if (edit !== editRevision) throw new Error(i18n.t("errors.preferenceEditsPreserved"));
            if (discardDraft) {
                pendingWrite = pendingWrite.catch(() => undefined).then(async () => {
                    assertSession();
                    if (edit !== editRevision) throw new Error(i18n.t("errors.preferenceEditsPreserved"));
                    await drafts.removeItem(draftKey(owner));
                });
                await pendingWrite;
            }
            const draft = discardDraft ? null : await drafts.getItem<{ value: GenerationPreference; version: number }>(draftKey(owner));
            if (scope !== scopeRevision || useAuthStore.getState().user?.id !== owner) return;
            if (edit !== editRevision) throw new Error(i18n.t("errors.preferenceEditsPreserved"));
            const conflict = Boolean(draft && draft.version !== record.version);
            set((state) => ({ config: { ...state.config, ...preference(draft?.value || record.value) }, version: draft?.version ?? record.version, hydrated: true, saving: false, dirty: Boolean(draft), conflict, error: conflict ? i18n.t("errors.preferenceVersionConflict") : "" }));
            if (draft && !conflict) await get().save();
        } catch (error) { if (scope === scopeRevision) set({ error: error instanceof Error ? error.message : i18n.t("errors.preferenceReadFailed") }); }
    },
    setCatalog: (catalog) => set((state) => {
        const channels = catalog.channels.map((channel) => ({ id: channel.id, name: channel.name, models: channel.models.map((model) => ({ id: model.id, name: model.model, label: model.name, version: model.version, features: model.features, capability: model.capability, parameters: model.parameters })) }));
        const next = { ...state.config, channels, orders: catalog.orders, models: modelOptionsFromChannels(channels) };
        return { config: { ...next, imageModel: firstModel(next, "image"), videoModel: firstModel(next, "video"), textModel: firstModel(next, "text"), audioModel: firstModel(next, "audio"), assistantModel: firstModel(next, "text", true) } };
    }),
    updateConfig: (key, value) => {
        if (!get().hydrated || get().conflict || get().config[key] === value) return;
        editRevision++;
        set((state) => ({ config: { ...state.config, [key]: value }, dirty: true }));
        const owner = useAuthStore.getState().user?.id;
        if (!owner) return;
        const draft = { value: preference(get().config), version: get().version };
        pendingWrite = pendingWrite.catch(() => undefined).then(async () => { await drafts.setItem(draftKey(owner), draft); });
        void pendingWrite.catch((error: unknown) => { if (useAuthStore.getState().user?.id === owner) set({ error: error instanceof Error ? error.message : i18n.t("errors.preferenceDraftFailed") }); });
        void get().save();
    },
    save: () => {
        if (running) return running;
        const owner = useAuthStore.getState().user?.id;
        const scope = scopeRevision;
        if (!owner || !get().hydrated || get().conflict) return Promise.resolve();
        const assertSession = captureSession();
        const operation = (async () => {
            set({ saving: true, error: "" });
            try {
                while (get().dirty && scope === scopeRevision) {
                    await pendingWrite;
                    assertSession();
                    if (scope !== scopeRevision) return;
                    const revision = editRevision;
                    const record = await savePreference("generation", preference(get().config), get().version);
                    if (scope !== scopeRevision || useAuthStore.getState().user?.id !== owner) return;
                    set({ version: record.version, dirty: revision !== editRevision, error: "" });
                    const draft = { value: preference(get().config), version: record.version };
                    const changed = revision !== editRevision;
                    pendingWrite = pendingWrite.catch(() => undefined).then(async () => { if (changed) await drafts.setItem(draftKey(owner), draft); else await drafts.removeItem(draftKey(owner)); });
                    await pendingWrite;
                }
            } catch (error) { if (scope === scopeRevision) { const conflict = error instanceof ApiError && error.code === "version_conflict"; set({ error: conflict ? i18n.t("errors.preferenceVersionConflict") : error instanceof Error ? error.message : i18n.t("errors.preferenceSaveFailed"), conflict }); } }
            finally { if (scope === scopeRevision) set({ saving: false }); }
        })();
        running = operation;
        void operation.finally(() => { if (running === operation) running = null; });
        return operation;
    },
    isAiConfigReady: (config, model) => Boolean(findChannelModel(config, model)),
}));

export const useEffectiveConfig = () => useConfigStore((state) => state.config);
export const encodeChannelModel = (channelId: string, model: string) => `${channelId}::${model}`;
export function decodeChannelModel(value: string) { const index = value.indexOf("::"); return index < 0 ? null : { channelId: value.slice(0, index), model: value.slice(index + 2) }; }
export const isChannelModelValue = (value: string) => Boolean(decodeChannelModel(value));
export const modelOptionName = (value: string) => decodeChannelModel(value)?.model || value;
export function findChannelModel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const channel = config.channels.find((entry) => entry.id === decoded?.channelId);
    const model = channel?.models.find((entry) => entry.name === decoded?.model);
    return channel && model ? { channel, model } : undefined;
}
export const modelCapabilityOf = (config: AiConfig, value: string) => findChannelModel(config, value)?.model.capability;
export const modelMatchesCapability = (config: AiConfig, value: string, capability?: ModelCapability) => !capability || modelCapabilityOf(config, value) === capability;
export function modelOptionLabel(config: AiConfig, value: string) { const match = findChannelModel(config, value); return match ? `${match.model.label || match.model.name}（${match.channel.name}）` : modelOptionName(value); }
export const modelOptionsFromChannels = (channels: ModelChannel[]) => channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model.name)));
export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability, toolsOnly = false) {
    const models = config.channels.flatMap((channel) => channel.models.filter((model) => (!capability || model.capability === capability) && (!toolsOnly || model.features.tools)).map((model) => ({ id: model.id, value: encodeChannelModel(channel.id, model.name) })));
    const order = config.orders[toolsOnly ? "assistant" : capability || ""] || [];
    const position = new Map(order.map((id, index) => [id, index]));
    return models.sort((a, b) => (position.get(a.id) ?? order.length) - (position.get(b.id) ?? order.length)).map((model) => model.value);
}
export const firstModel = (config: AiConfig, capability: ModelCapability, toolsOnly = false) => selectableModelsByCapability(config, capability, toolsOnly)[0] || "";
export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) { return value && modelOptionsFromChannels(channels).includes(value) ? value : ""; }
export function resolveModelForCapability(config: AiConfig, current: string | undefined, capability: ModelCapability) {
    const preferred = capability === "image" ? config.imageModel : capability === "video" ? config.videoModel : capability === "audio" ? config.audioModel : config.textModel;
    if (current) {
        const configuredCapability = modelCapabilityOf(config, current);
        if (!configuredCapability || configuredCapability === capability) return current;
    }
    return preferred;
}

export const modelSupportsTools = (config: AiConfig, value: string) => findChannelModel(config, value)?.model.features.tools === true;
export const channelModelId = (config: AiConfig, value: string) => findChannelModel(config, value)?.model.id;
export function resolveModelParameters(config: AiConfig, model: string, overrides: Record<string, unknown> = {}) {
    const selected = findChannelModel(config, model)?.model;
    const values = { ...Object.fromEntries((selected?.parameters || []).filter((control) => control.type !== "reference" && control.default !== undefined).map((control) => [control.key, control.default])), ...overrides };
    return Object.fromEntries(Object.entries(values).filter(([key]) => { const control = selected?.parameters.find((control) => control.key === key); return !control || inputVisible(control, values); }));
}
