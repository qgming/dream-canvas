import { useEffect, useState, type ReactNode } from "react";
import { Controller } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Choice } from "@/components/ui/choice";
import { Notice, Spinner } from "@/components/ui/display";
import { EditorForm, Field, useEditorForm, useFormContext, useWatch } from "@/components/ui/form";
import { Input, NumberInput } from "@/components/ui/input";
import { Switch } from "@/components/ui/controls";
import { Disclosure } from "@/components/ui/tabs";
import { useFeedback } from "@/hooks/use-feedback";
import { captureSession } from "@/services/api/client";
import { getRuntime, saveRuntime, type ExecutionPolicy } from "@/services/api/runtime";

const durationKeys = [
    "connectSeconds", "querySeconds", "firstResponseSeconds", "idleSeconds", "textSeconds", "imageSeconds", "audioSeconds",
    "transferSeconds", "pollSeconds", "maxWaitSeconds", "signedUrlSeconds", "scriptSeconds",
] as const;
const byteKeys = ["imageBytes", "audioBytes", "videoBytes", "jsonBytes"] as const;
const retryKeys = ["downloadRetrySeconds", "storageRetrySeconds"] as const;

type DurationKey = typeof durationKeys[number];
type ByteKey = typeof byteKeys[number];
type RetryKey = typeof retryKeys[number];
type DurationUnit = "seconds" | "minutes" | "hours";
type ByteUnit = "MiB" | "GiB";
type RuntimeForm = Omit<ExecutionPolicy, DurationKey | ByteKey | RetryKey> & Record<DurationKey, string> & Record<ByteKey, string> & Record<RetryKey, string[]>;
type DurationUnits = Record<DurationKey, DurationUnit>;
type ByteUnits = Record<ByteKey, ByteUnit>;

const groups: { name: "concurrency" | "timeouts" | "recovery"; keys: (keyof RuntimeForm)[] }[] = [
    { name: "concurrency", keys: ["assistantSlots", "generationSlots", "userSlots", "transferSlots", "previewSlots"] },
    { name: "timeouts", keys: ["connectSeconds", "querySeconds", "firstResponseSeconds", "idleSeconds", "textSeconds", "imageSeconds", "audioSeconds", "transferSeconds"] },
    { name: "recovery", keys: ["pollSeconds", "queryFailures", "maxWaitSeconds", "downloadRetrySeconds", "storageRetrySeconds", "signedUrlSeconds"] },
];
const limitKeys: (keyof RuntimeForm)[] = ["imageBytes", "audioBytes", "videoBytes", "jsonBytes", "scriptSeconds", "scriptMemoryMiB"];
const durationValues = new Set<string>(durationKeys);
const byteValues = new Set<string>(byteKeys);
const retryValues = new Set<string>(retryKeys);
const durationFactors: Record<DurationUnit, bigint> = { seconds: 1n, minutes: 60n, hours: 3600n };
const byteFactors: Record<ByteUnit, bigint> = { MiB: 1024n ** 2n, GiB: 1024n ** 3n };

export default function RuntimePage() {
    const { t } = useTranslation();
    const query = useQuery({ queryKey: ["runtime-settings"], queryFn: getRuntime });
    const form = useEditorForm<RuntimeForm>();
    const values = useWatch({ control: form.control }) as Partial<RuntimeForm>;
    const { notify, confirm } = useFeedback();
    const [version, setVersion] = useState(0);
    const [busy, setBusy] = useState(false);
    const [durationUnits, setDurationUnits] = useState<DurationUnits>(() => unitMap<DurationKey, DurationUnit>(durationKeys, "seconds"));
    const [byteUnits, setByteUnits] = useState<ByteUnits>(() => unitMap<ByteKey, ByteUnit>(byteKeys, "MiB"));
    const [advancedOpen, setAdvancedOpen] = useState(false);

    useEffect(() => {
        if (!query.data || form.formState.isDirty) return;
        const policy = query.data.record.policy || query.data.suggested;
        const initial = formValue(policy);
        form.reset(initial.values);
        setDurationUnits(initial.durationUnits);
        setByteUnits(initial.byteUnits);
        setVersion(query.data.record.version || 0);
    }, [query.data]);

    if (query.isLoading) return <Spinner />;

    const changeDurationUnit = (key: DurationKey, next: DurationUnit) => {
        const seconds = parseAmount(form.getValues(key), durationFactors[durationUnits[key]]);
        if (seconds == null || seconds % Number(durationFactors[next]) !== 0) return;
        setDurationUnits((current) => ({ ...current, [key]: next }));
        form.setValue(key, durationAmount(seconds, next), { shouldDirty: false });
    };
    const changeByteUnit = (key: ByteKey, next: ByteUnit) => {
        const bytes = parseAmount(form.getValues(key), byteFactors[byteUnits[key]]);
        if (bytes == null) return;
        setByteUnits((current) => ({ ...current, [key]: next }));
        form.setValue(key, byteAmount(bytes, next), { shouldDirty: false });
    };
    const setRetryIntervals = (key: RetryKey, next: string[]) => form.setValue(key, next, { shouldDirty: true, shouldValidate: true });
    const resetGroup = (keys: (keyof RuntimeForm)[]) => {
        if (!query.data) return;
        const suggested = query.data.suggested;
        const nextDurationUnits = { ...durationUnits };
        const nextByteUnits = { ...byteUnits };
        for (const key of keys) {
            const name = String(key);
            if (durationValues.has(name)) {
                const typed = key as DurationKey;
                const seconds = suggested[typed];
                const unit = preferredDurationUnit(seconds);
                nextDurationUnits[typed] = unit;
                form.setValue(key, durationAmount(seconds, unit), { shouldDirty: true, shouldValidate: true });
            } else if (byteValues.has(name)) {
                const typed = key as ByteKey;
                const bytes = suggested[typed];
                const unit = preferredByteUnit(bytes);
                nextByteUnits[typed] = unit;
                form.setValue(key, byteAmount(bytes, unit), { shouldDirty: true, shouldValidate: true });
            } else if (retryValues.has(name)) {
                const typed = key as RetryKey;
                form.setValue(key, suggested[typed].map(String), { shouldDirty: true, shouldValidate: true });
            } else {
                form.setValue(key, suggested[key as keyof ExecutionPolicy] as never, { shouldDirty: true, shouldValidate: true });
            }
        }
        setDurationUnits(nextDurationUnits);
        setByteUnits(nextByteUnits);
    };

    return <section className="space-y-6">
        <PageHeader
            stickyActions
            title={t("execution.title")}
            description={t("execution.description")}
            actions={<>
                <span role="status" className="text-xs text-muted-foreground">{busy ? t("settings.savingChanges") : !query.data ? t("settings.loading") : form.formState.isDirty || !query.data.record.policy ? t("workspace.unsaved") : t("workspace.allSaved")}</span>
                <Button type="submit" form="runtime-settings" disabled={!query.data || (Boolean(query.data.record.policy) && !form.formState.isDirty)} loading={busy}>{t("workspace.save")}</Button>
            </>}
        />
        <Notice type="info" title={t("execution.confirmPolicy")} description={t("execution.failurePolicy")} />
        {query.error ? <Notice type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>{t("workspace.retry")}</Button>} /> : null}
        {query.data ? <EditorForm id="runtime-settings" form={form} className="space-y-8" disabled={busy} onSubmit={async (formValues: RuntimeForm) => {
            const assertSession = captureSession();
            let policy: ExecutionPolicy;
            try {
                policy = toPolicy(formValues, durationUnits, byteUnits);
            } catch (error) {
                const retryError = error instanceof Error && error.message.startsWith("Invalid retry");
                throw new Error(retryError ? t("execution.invalidIntervals") : t("ui.invalidValue"));
            }
            const apply = async () => {
                setBusy(true);
                try {
                    assertSession();
                    const record = await saveRuntime(version, policy);
                    assertSession();
                    setVersion(record.version);
                    form.reset(formValues);
                    notify.success(t("execution.saved"));
                    await query.refetch();
                } finally {
                    setBusy(false);
                }
            };
            await new Promise<void>((resolve, reject) => confirm({
                title: t("execution.confirmSave"),
                content: t("execution.failurePolicy"),
                confirmText: t("workspace.save"),
                onConfirm: async () => {
                    try {
                        await apply();
                        resolve();
                    } catch (error) {
                        reject(error);
                        throw error;
                    }
                },
                onCancel: () => resolve(),
            }));
        }}>
            <Field layout="horizontal" name="enabled" label={t("execution.enabled")} description={t("execution.enabledHint")} checked><Switch /></Field>

            {groups.map((group) => <SettingsGroup key={group.name} title={t(`execution.groups.${group.name}`)} onReset={() => resetGroup(group.keys)}>
                {group.keys.map((key) => {
                    const name = String(key);
                    if (durationValues.has(name)) return <DurationField key={key} name={key as DurationKey} value={values[key] as string} unit={durationUnits[key as DurationKey]} onUnitChange={changeDurationUnit} />;
                    if (retryValues.has(name)) return <RetryField key={key} name={key as RetryKey} values={values[key] as string[]} onChange={setRetryIntervals} />;
                    return <Field key={key} layout="horizontal" name={key} label={t(`execution.fields.${name}`)} schema={z.number().int().positive()}><NumberInput step={1} /></Field>;
                })}
            </SettingsGroup>)}

            <Disclosure open={advancedOpen} onOpenChange={setAdvancedOpen} title={t("execution.groups.advanced")}>
                <div className="mb-2 flex justify-end"><Button type="button" size="sm" variant="ghost" onClick={() => resetGroup(limitKeys)}>{t("execution.resetSuggested")}</Button></div>
                {limitKeys.map((key) => {
                    const name = String(key);
                    if (durationValues.has(name)) return <DurationField key={key} name={key as DurationKey} value={values[key] as string} unit={durationUnits[key as DurationKey]} onUnitChange={changeDurationUnit} />;
                    if (byteValues.has(name)) return <ByteField key={key} name={key as ByteKey} value={values[key] as string} unit={byteUnits[key as ByteKey]} onUnitChange={changeByteUnit} />;
                    return <Field key={key} layout="horizontal" name={key} label={t(`execution.fields.${name}`)} schema={z.number().int().positive()}><NumberInput step={1} /></Field>;
                })}
            </Disclosure>

        </EditorForm> : null}
    </section>;
}

function SettingsGroup({ title, onReset, children }: { title: string; onReset: () => void; children: ReactNode }) {
    const { t } = useTranslation();
    return <section>
        <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-base font-medium">{title}</h2>
            <Button type="button" size="sm" variant="ghost" onClick={onReset}>{t("execution.resetSuggested")}</Button>
        </div>
        <div>{children}</div>
    </section>;
}

function DurationField({ name, value, unit, onUnitChange }: { name: DurationKey; value: string; unit: DurationUnit; onUnitChange: (name: DurationKey, unit: DurationUnit) => void }) {
    const { t } = useTranslation();
    const form = useFormContext();
    const seconds = parseAmount(value, durationFactors[unit]);
    return <Controller name={name} control={form.control} rules={{ validate: (next) => parseAmount(next, durationFactors[unit]) != null || t("execution.invalidDuration") }} render={({ field, fieldState }) => <SettingRow label={t(`execution.fields.${name}`)} error={fieldState.error?.message}>
        <div className="flex w-full gap-2">
            <Input aria-label={t(`execution.fields.${name}`)} inputMode="decimal" value={field.value || ""} onChange={(event) => field.onChange(event.target.value)} onBlur={field.onBlur} />
            <Choice className="w-28 shrink-0" aria-label={t("execution.durationUnit")} value={unit} options={(["seconds", "minutes", "hours"] as const).map((entry) => ({ value: entry, label: t(`execution.units.${entry}`), disabled: seconds == null || seconds % Number(durationFactors[entry]) !== 0 }))} onChange={(next) => onUnitChange(name, next)} />
        </div>
    </SettingRow>} />;
}

function ByteField({ name, value, unit, onUnitChange }: { name: ByteKey; value: string; unit: ByteUnit; onUnitChange: (name: ByteKey, unit: ByteUnit) => void }) {
    const { t } = useTranslation();
    const form = useFormContext();
    return <Controller name={name} control={form.control} rules={{ validate: (next) => parseAmount(next, byteFactors[unit]) != null || t("execution.invalidByteSize") }} render={({ field, fieldState }) => <SettingRow label={t(`execution.fields.${name}`)} error={fieldState.error?.message}>
        <div className="flex w-full gap-2">
            <Input aria-label={t(`execution.fields.${name}`)} inputMode="decimal" value={field.value || ""} onChange={(event) => field.onChange(event.target.value)} onBlur={field.onBlur} />
            <Choice className="w-24 shrink-0" aria-label={t("execution.byteUnit")} value={unit} options={(["MiB", "GiB"] as const).map((entry) => ({ value: entry, label: entry }))} onChange={(next) => onUnitChange(name, next)} />
        </div>
    </SettingRow>} />;
}

function RetryField({ name, values = [], onChange }: { name: RetryKey; values?: string[]; onChange: (name: RetryKey, values: string[]) => void }) {
    const { t } = useTranslation();
    const label = t(`execution.fields.${name}`);
    return <SettingRow label={label} description={t("execution.retryHint")}>
        <div className="w-full space-y-2">
            {values.map((value, index) => <div key={index} className="flex items-center gap-2">
                <Input aria-label={`${label} ${index + 1}`} type="number" min={1} step={1} inputMode="numeric" value={value} onChange={(event) => onChange(name, values.map((entry, item) => item === index ? event.target.value : entry))} />
                <span className="shrink-0 text-xs text-muted-foreground">{t("execution.units.seconds")}</span>
                <Button type="button" variant="ghost" size="icon" aria-label={t("execution.removeInterval")} onClick={() => onChange(name, values.filter((_, item) => item !== index))}><Trash2 /></Button>
            </div>)}
            <Button type="button" variant="ghost" size="sm" icon={<Plus />} onClick={() => onChange(name, [...values, ""])}>{t("execution.addInterval")}</Button>
        </div>
    </SettingRow>;
}

function SettingRow({ label, description, error, children }: { label: ReactNode; description?: ReactNode; error?: string; children: ReactNode }) {
    return <div className="grid gap-2 py-3 @md/settings:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] @md/settings:items-center @md/settings:gap-x-8">
        <div className="min-w-0 space-y-1"><div className="text-sm font-medium leading-5">{label}</div>{description ? <div className="text-xs leading-5 text-muted-foreground">{description}</div> : null}</div>
        <div className="min-w-0 space-y-2"><div className="flex min-w-0 items-center justify-end">{children}</div>{error ? <p role="alert" className="text-xs leading-5 text-destructive">{error}</p> : null}</div>
    </div>;
}

function formValue(policy: ExecutionPolicy) {
    const durationUnits: DurationUnits = unitMap(durationKeys, "seconds");
    const byteUnits: ByteUnits = unitMap(byteKeys, "MiB");
    const values = { ...policy } as unknown as RuntimeForm;
    for (const key of durationKeys) {
        const unit = preferredDurationUnit(policy[key]);
        durationUnits[key] = unit;
        values[key] = durationAmount(policy[key], unit);
    }
    for (const key of byteKeys) {
        const unit = preferredByteUnit(policy[key]);
        byteUnits[key] = unit;
        values[key] = byteAmount(policy[key], unit);
    }
    for (const key of retryKeys) values[key] = policy[key].map(String);
    return { values, durationUnits, byteUnits };
}

function toPolicy(values: RuntimeForm, durationUnits: DurationUnits, byteUnits: ByteUnits) {
    const policy = { ...values } as unknown as ExecutionPolicy;
    for (const key of durationKeys) {
        const seconds = parseAmount(values[key], durationFactors[durationUnits[key]]);
        if (seconds == null) throw new Error(`Invalid duration: ${key}`);
        policy[key] = seconds;
    }
    for (const key of byteKeys) {
        const bytes = parseAmount(values[key], byteFactors[byteUnits[key]]);
        if (bytes == null) throw new Error(`Invalid byte size: ${key}`);
        policy[key] = bytes;
    }
    for (const key of retryKeys) {
        policy[key] = values[key].map((value) => Number(value));
        if ((key === "storageRetrySeconds" && !policy[key].length) || policy[key].some((value) => !Number.isSafeInteger(value) || value <= 0)) throw new Error(`Invalid retry intervals: ${key}`);
    }
    return policy;
}

function preferredDurationUnit(seconds: number): DurationUnit {
    if (seconds >= 3600 && seconds % 3600 === 0) return "hours";
    if (seconds >= 60 && seconds % 60 === 0) return "minutes";
    return "seconds";
}

function durationAmount(seconds: number, unit: DurationUnit) {
    return String(Number(seconds) / Number(durationFactors[unit]));
}

function preferredByteUnit(bytes: number): ByteUnit {
    return bytes >= Number(byteFactors.GiB) ? "GiB" : "MiB";
}

function byteAmount(bytes: number, unit: ByteUnit) {
    return ratioDecimal(BigInt(bytes), unit === "MiB" ? 20 : 30);
}

function ratioDecimal(value: bigint, powerOfTwo: number) {
    if (!powerOfTwo) return value.toString();
    const scaled = value * 5n ** BigInt(powerOfTwo);
    const digits = scaled.toString().padStart(powerOfTwo + 1, "0");
    const whole = digits.slice(0, -powerOfTwo);
    const fraction = digits.slice(-powerOfTwo).replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole;
}

function parseAmount(value: string | undefined, factor: bigint) {
    if (value == null || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
    const [whole, fraction = ""] = value.trim().split(".");
    const denominator = 10n ** BigInt(fraction.length);
    const numerator = BigInt(whole + fraction);
    const product = numerator * factor;
    if (product % denominator !== 0n) return null;
    const amount = product / denominator;
    if (amount <= 0n) return null;
    const number = Number(amount);
    return Number.isSafeInteger(number) ? number : null;
}

function unitMap<K extends string, U extends string>(keys: readonly K[], value: U): Record<K, U> {
    return Object.fromEntries(keys.map((key) => [key, value])) as Record<K, U>;
}
