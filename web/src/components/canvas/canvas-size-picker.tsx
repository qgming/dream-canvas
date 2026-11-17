import { Choice } from "@/components/ui/choice";
import { useTranslation } from "react-i18next";

const sizes = ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"];
export function CanvasSizePicker({ value, className, onChange }: { value: string; className?: string; onChange: (value: string) => void }) {
    const { t } = useTranslation();
    const options = [...new Set([...sizes, value].filter(Boolean))].map((size) => ({ value: size, label: size === "auto" ? t("settingsPanels.common.auto") : size }));
    return <Choice searchable creatable compact value={value || undefined} options={options} placeholder={t("canvas.controls.ratio")} className={className} onChange={(next: string) => onChange(next.trim())} />;
}
