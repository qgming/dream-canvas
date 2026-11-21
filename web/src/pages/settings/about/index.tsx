import { ArrowUpRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/layout/page-header";

export default function AboutPage() {
    const { t } = useTranslation();
    const details = [
        { label: t("about.version"), value: __APP_VERSION__ },
        { label: t("about.author"), value: "qgming", href: "https://www.qgming.com/" },
        { label: t("about.github"), value: "github.com/qgming/dream-canvas", href: "https://github.com/qgming/dream-canvas" },
        { label: t("about.license"), value: "MIT License", href: "https://github.com/qgming/dream-canvas/blob/main/LICENSE" },
    ];

    return <section className="space-y-6">
        <PageHeader title={t("settings.about")} />
        <div className="flex items-center gap-4 py-2">
            <img src="/logo.svg" alt="" className="size-14 shrink-0 dark:invert" />
            <div className="min-w-0 space-y-1">
                <h2 className="text-xl font-semibold tracking-tight">{t("landing.name")}</h2>
                <p className="text-sm leading-[22px] text-muted-foreground">{t("about.description")}</p>
            </div>
        </div>
        <dl className="text-sm">
            {details.map(({ label, value, href }) => <div key={label} className="grid gap-1 py-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-start sm:gap-x-8">
                <dt className="font-medium">{label}</dt>
                <dd className="min-w-0">{href ? <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 rounded-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"><span className="min-w-0 break-all">{value}</span><ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" /></a> : value}</dd>
            </div>)}
        </dl>
    </section>;
}
