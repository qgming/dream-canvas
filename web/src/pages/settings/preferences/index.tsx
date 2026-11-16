import { Alert, App, Button, Form, Input, Radio, Select, Switch } from "antd";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/components/model-picker";
import { videoResolutionOptions } from "@/components/video-settings-panel";
import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";
import { computeMediaSize, inferMediaRatio, inferMediaScale, mediaScaleOptions, parseVideoResolution } from "@/lib/media-size";
import { useConfigStore } from "@/stores/use-config-store";
import { useOpenModelSettings } from "@/hooks/use-open-model-settings";
import { captureSession } from "@/services/api/client";

const modelGroups = [
    { capability: "image", modelKey: "imageModel", labelKey: "config.preferences.defaultImageModel" },
    { capability: "video", modelKey: "videoModel", labelKey: "config.preferences.defaultVideoModel" },
    { capability: "text", modelKey: "textModel", labelKey: "config.preferences.defaultTextModel" },
    { capability: "audio", modelKey: "audioModel", labelKey: "config.preferences.defaultAudioModel" },
] as const;

export default function PreferencesPage() {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const openModelSettings = useOpenModelSettings();
    const config = useConfigStore((state) => state.config);
    const hydrated = useConfigStore((state) => state.hydrated);
    const error = useConfigStore((state) => state.error);
    const saving = useConfigStore((state) => state.saving);
    const dirty = useConfigStore((state) => state.dirty);
    const conflict = useConfigStore((state) => state.conflict);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const imageResolutionOptions = mediaScaleOptions.map((value) => ({ value, label: value === "auto" ? t("settingsPanels.common.auto") : value.toUpperCase() }));
    const reload = () => {
        const assertSession = captureSession();
        const read = async () => { try { assertSession(); await useConfigStore.getState().load(true); } catch (error) { message.error(error instanceof Error ? error.message : "读取失败"); } };
        if (dirty) modal.confirm({ title: "放弃未保存的创作偏好？", content: "重新读取将清除当前偏好草稿，请先复制需要保留的内容。", okText: "放弃并读取", cancelText: "保留编辑", onOk: read });
        else void read();
    };
    return (
        <section>
            <header className="mb-8">
                <h2 className="text-2xl font-medium tracking-tight">{t("settings.preferences")}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("settings.preferencesDescription")}</p>
            </header>
            {error ? <Alert type="error" className="mb-4" title={error} action={<Button onClick={reload}>重新读取</Button>} /> : null}
            <Form layout="vertical" requiredMark={false} disabled={!hydrated}>
                <div className="mb-2 text-sm font-semibold">{t("config.preferences.defaultModels")}</div>
                <div className="mb-4 grid gap-4 xl:grid-cols-2">
                    {modelGroups.map((group) => (
                        <Form.Item key={group.modelKey} label={t(group.labelKey)} className="mb-0">
                            <ModelPicker config={config} value={config[group.modelKey]} onChange={(model) => updateConfig(group.modelKey, model)} capability={group.capability} onMissingConfig={openModelSettings} fullWidth />
                        </Form.Item>
                    ))}
                </div>
                <div className="mb-2 text-sm font-semibold">{t("config.preferences.generation")}</div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    <Form.Item label={t("config.preferences.canvasImageCount")} extra={t("config.preferences.canvasImageCountDescription")} className="mb-4">
                        <Input
                            type="number"
                            min={1}
                            max={15}
                            value={config.canvasImageCount}
                            onChange={(event) => updateConfig("canvasImageCount", event.target.value)}
                            onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))}
                        />
                    </Form.Item>
                    <Form.Item label={t("config.preferences.imageResolution")} className="mb-4">
                        <Select value={inferMediaScale(config.size)} options={imageResolutionOptions} onChange={(scale) => updateConfig("size", computeMediaSize(scale, inferMediaRatio(config.size)))} />
                    </Form.Item>
                    <Form.Item label={t("config.preferences.videoResolution")} className="mb-4">
                        <Select value={parseVideoResolution(config.vquality)} options={videoResolutionOptions} onChange={(value) => updateConfig("vquality", value)} />
                    </Form.Item>
                    <Form.Item label={t("config.preferences.audioVoice")} className="mb-4">
                        <Select value={config.audioVoice} options={audioVoiceOptions} onChange={(value) => updateConfig("audioVoice", value)} />
                    </Form.Item>
                    <Form.Item label={t("config.preferences.audioFormat")} className="mb-4">
                        <Select value={config.audioFormat} options={audioFormatOptions} onChange={(value) => updateConfig("audioFormat", value)} />
                    </Form.Item>
                    <Form.Item label={t("config.preferences.audioSpeed")} className="mb-4">
                        <Input
                            type="number"
                            min={0.25}
                            max={4}
                            step={0.05}
                            value={config.audioSpeed}
                            onChange={(event) => updateConfig("audioSpeed", event.target.value)}
                            onBlur={(event) => updateConfig("audioSpeed", normalizeAudioSpeedValue(event.target.value))}
                        />
                    </Form.Item>
                </div>
                <Form.Item label={t("config.preferences.regenerateBehavior")} className="mb-4">
                    <Radio.Group value={config.nodeRegenerateBehavior} onChange={(event) => updateConfig("nodeRegenerateBehavior", event.target.value)} className="flex flex-col gap-2">
                        <Radio value="overwrite">
                            <span className="block text-sm font-medium">{t("config.preferences.regenerateBehaviorOverwrite")}</span>
                            <span className="mt-0.5 block text-xs opacity-60">{t("config.preferences.regenerateBehaviorOverwriteDescription")}</span>
                        </Radio>
                        <Radio value="new-node">
                            <span className="block text-sm font-medium">{t("config.preferences.regenerateBehaviorNewNode")}</span>
                            <span className="mt-0.5 block text-xs opacity-60">{t("config.preferences.regenerateBehaviorNewNodeDescription")}</span>
                        </Radio>
                    </Radio.Group>
                </Form.Item>
                <Form.Item className="mb-4">
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-sm">{t("config.preferences.autoFocusOnSelect")}</span>
                        <Switch checked={config.autoFocusOnSelect} onChange={(checked) => updateConfig("autoFocusOnSelect", checked)} />
                    </div>
                </Form.Item>
                <Form.Item label={t("config.preferences.audioInstructions")} className="mb-4">
                    <Input.TextArea rows={2} value={config.audioInstructions} placeholder={t("config.preferences.audioInstructionsPlaceholder")} onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                </Form.Item>
                <Form.Item label={t("config.preferences.systemPrompt")} className="mb-0">
                    <Input.TextArea rows={4} value={config.systemPrompt} placeholder={t("config.preferences.systemPromptPlaceholder")} onChange={(event) => updateConfig("systemPrompt", event.target.value)} />
                </Form.Item>
            </Form>
            {saving ? <p className="mt-4 text-xs text-muted-foreground">正在保存偏好</p> : null}
            {dirty && !saving && !conflict ? <Button onClick={() => void useConfigStore.getState().save()}>重试保存偏好</Button> : null}
        </section>
    );
}

function normalizeImageCount(value: string) { return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 3)))); }
