import i18n from "@/i18n";
import { create } from "zustand";
import localforage from "localforage";

import { ApiError, captureSession } from "@/services/api/client";
import { getPreference, savePreference } from "@/services/api/preferences";
import type { CatalogChannel, ParameterControl } from "@/services/api/channels";
import { useAuthStore } from "@/stores/use-auth-store";

export type ModelCapability = "image" | "video" | "text" | "audio";
export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh";
export type ChannelModel = { id: string; name: string; label: string; capability: ModelCapability; parameters: ParameterControl[] };
export type ModelChannel = { id: string; name: string; models: ChannelModel[] };
export type AiConfig = {
    channelMode: "remote";
    channels: ModelChannel[];
    models: string[];
    model: string; imageModel: string; videoModel: string; textModel: string; audioModel: string;
    audioVoice: string; audioFormat: string; audioSpeed: string; audioInstructions: string;
    videoSeconds: string; vquality: string; videoGenerateAudio: string; videoWatermark: string; videoMode: string;
    systemPrompt: string; reasoningEffort: ReasoningEffort;
    quality: string; size: string; background: string; count: string; canvasImageCount: string;
    nodeRegenerateBehavior: "new-node" | "overwrite"; autoFocusOnSelect: boolean;
    modelParameters?: Record<string, unknown>;
};
export type GenerationPreference = Omit<AiConfig, "channelMode" | "channels" | "models" | "modelParameters">;
export const defaultConfig: AiConfig = {
    channelMode: "remote", channels: [], models: [], model: "", imageModel: "", videoModel: "", textModel: "", audioModel: "",
    audioVoice: "", audioFormat: "mp3", audioSpeed: "1", audioInstructions: "",
    videoSeconds: "6", vquality: "720", videoGenerateAudio: "true", videoWatermark: "false", videoMode: "frames",
    systemPrompt: "", reasoningEffort: "auto", quality: "auto", size: "1:1", background: "", count: "1", canvasImageCount: "3",
    nodeRegenerateBehavior: "new-node", autoFocusOnSelect: false,
};
type ConfigStore = {
    config: AiConfig; hydrated: boolean; version: number; saving: boolean; dirty: boolean; conflict: boolean; error: string;
    reset: () => void; load: (discardDraft?: boolean) => Promise<void>; save: () => Promise<void>; setCatalog: (catalog: CatalogChannel[]) => void;
    updateConfig: <K extends keyof GenerationPreference>(key: K, value: GenerationPreference[K]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
};

const drafts = localforage.createInstance({ name: "dream-canvas", storeName: "unsaved-preferences" });
let scopeRevision = 0;
let editRevision = 0;
let running: Promise<void> | null = null;
let pendingWrite = Promise.resolve();
const preference = ({ channelMode: _mode, channels: _channels, models: _models, modelParameters: _parameters, ...value }: AiConfig): GenerationPreference => value;
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
            set((state) => ({ config: { ...defaultConfig, ...(draft?.value || record.value), channels: state.config.channels, models: state.config.models }, version: draft?.version ?? record.version, hydrated: true, saving: false, dirty: Boolean(draft), conflict: Boolean(draft && draft.version !== record.version), error: draft ? i18n.t("errors.preferenceDraftRestored") : "" }));
        } catch (error) { if (scope === scopeRevision) set({ error: error instanceof Error ? error.message : i18n.t("errors.preferenceReadFailed") }); }
    },
    setCatalog: (catalog) => set((state) => {
        const channels = catalog.map((channel) => ({ id: channel.id, name: channel.name, models: channel.models.map((model) => ({ id: model.id, name: model.model, label: model.name, capability: model.capability, parameters: model.parameters })) }));
        return { config: { ...state.config, channels, models: modelOptionsFromChannels(channels) } };
    }),
    updateConfig: (key, value) => {
        if (!get().hydrated) return;
        editRevision++;
        set((state) => ({ config: { ...state.config, [key]: value }, dirty: true }));
        const owner = useAuthStore.getState().user?.id;
        if (!owner) return;
        const draft = { value: preference(get().config), version: get().version };
        pendingWrite = pendingWrite.catch(() => undefined).then(async () => { await drafts.setItem(draftKey(owner), draft); });
        void pendingWrite.catch((error: unknown) => { if (useAuthStore.getState().user?.id === owner) set({ error: error instanceof Error ? error.message : i18n.t("errors.preferenceDraftFailed") }); });
    },
    save: () => {
        if (running) return running;
        const owner = useAuthStore.getState().user?.id;
        const scope = scopeRevision;
        if (!owner || !get().hydrated || get().conflict) return Promise.resolve();
        const assertSession = captureSession();
        const operation = (async () => {
            set({ saving: true });
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
            } catch (error) { if (scope === scopeRevision) set({ error: error instanceof Error ? error.message : i18n.t("errors.preferenceSaveFailed"), conflict: error instanceof ApiError && error.code === "version_conflict" }); }
            finally { if (scope === scopeRevision) set({ saving: false }); }
        })();
        running = operation;
        void operation.finally(() => { if (running === operation) running = null; });
        return operation;
    },
    isAiConfigReady: (config, model) => Boolean(findChannelModel(config, model)),
}));

export const useEffectiveConfig = () => useConfigStore((state) => state.config);
export const boolConfig = (value: string, fallback: boolean) => value ? value === "true" : fallback;
export const encodeChannelModel = (channelId: string, model: string) => `${channelId}::${model}`;
export function decodeChannelModel(value: string) { const index = value.indexOf("::"); return index < 0 ? null : { channelId: value.slice(0, index), model: value.slice(index + 2) }; }
export const isChannelModelValue = (value: string) => Boolean(decodeChannelModel(value));
export const modelOptionName = (value: string) => decodeChannelModel(value)?.model || value;
function findChannelModel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const channel = config.channels.find((entry) => entry.id === decoded?.channelId);
    const model = channel?.models.find((entry) => entry.name === decoded?.model);
    return channel && model ? { channel, model } : undefined;
}
export const modelCapabilityOf = (config: AiConfig, value: string) => findChannelModel(config, value)?.model.capability;
export const modelMatchesCapability = (config: AiConfig, value: string, capability?: ModelCapability) => !capability || modelCapabilityOf(config, value) === capability;
export function modelOptionLabel(config: AiConfig, value: string) { const match = findChannelModel(config, value); return match ? `${match.model.label || match.model.name}（${match.channel.name}）` : modelOptionName(value); }
export const modelOptionsFromChannels = (channels: ModelChannel[]) => channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model.name)));
export const selectableModelsByCapability = (config: AiConfig, capability?: ModelCapability) => config.channels.flatMap((channel) => channel.models.filter((model) => !capability || model.capability === capability).map((model) => encodeChannelModel(channel.id, model.name)));
export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) { return value && modelOptionsFromChannels(channels).includes(value) ? value : ""; }
export function resolveModelForCapability(config: AiConfig, current: string | undefined, capability: ModelCapability) {
    const preferred = capability === "image" ? config.imageModel : capability === "video" ? config.videoModel : capability === "audio" ? config.audioModel : config.textModel;
    for (const value of [current, preferred]) { if (value && (!modelCapabilityOf(config, value) || modelCapabilityOf(config, value) === capability)) return value; }
    return "";
}
