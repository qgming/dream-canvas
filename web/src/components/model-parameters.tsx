import { Input, InputNumber, Select, Switch } from "antd";

import { decodeChannelModel, type AiConfig } from "@/stores/use-config-store";
import { useAssetStore } from "@/stores/use-asset-store";

export function ModelParameters({ config, model, value = {}, onChange, disabled = false }: { config: AiConfig; model: string; value?: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void; disabled?: boolean }) {
    const selected = decodeChannelModel(model);
    const controls = config.channels.find((channel) => channel.id === selected?.channelId)?.models.find((entry) => entry.name === selected?.model)?.parameters || [];
    const assets = useAssetStore((state) => state.assets);
    if (!controls.length) return null;
    return <div className="grid gap-3" onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
        {controls.map((control) => {
            const current = Object.prototype.hasOwnProperty.call(value, control.key) ? value[control.key] : control.default;
            const change = (next: unknown) => onChange({ ...value, [control.key]: next });
            return <label key={control.key} className="flex min-w-0 flex-col gap-1.5 text-xs">
                <span>{control.label}{control.required ? " *" : ""}</span>
                {control.type === "switch" ? <div className="flex items-center gap-2"><Switch size="small" className="!w-fit" aria-label={control.label} disabled={disabled} checked={current === true} onChange={change} />{current == null && control.required ? <button type="button" className="text-muted-foreground hover:text-foreground" disabled={disabled} onClick={() => change(false)}>选择关闭</button> : null}</div>
                    : control.type === "number" ? <InputNumber className="!w-full" aria-label={control.label} disabled={disabled} value={typeof current === "number" ? current : null} onChange={change} />
                    : control.type === "asset" ? <Select aria-label={control.label} disabled={disabled} allowClear value={typeof current === "string" ? current : undefined} placeholder="选择已保存的资产" options={assets.filter((asset) => asset.kind === control.role && asset.saveState === "saved").map((asset) => ({ label: asset.title, value: `asset:${asset.id}` }))} onChange={(next) => change(next ?? null)} />
                    : control.type === "select" ? <Select aria-label={control.label} disabled={disabled} allowClear value={current == null ? undefined : JSON.stringify(current)} options={control.options?.map((option) => ({ label: option.label, value: JSON.stringify(option.value) }))} onChange={(next) => change(next === undefined ? null : JSON.parse(next))} />
                    : control.type === "textarea" ? <Input.TextArea aria-label={control.label} disabled={disabled} value={typeof current === "string" ? current : ""} autoSize onChange={(event) => change(event.target.value)} />
                    : <Input aria-label={control.label} disabled={disabled} value={typeof current === "string" ? current : ""} onChange={(event) => change(event.target.value)} />}
            </label>;
        })}
    </div>;
}
