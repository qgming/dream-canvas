import { useTranslation } from "react-i18next";
import { useThemeStore } from "@/stores/use-theme-store";

const primaryFeatures = ["canvas", "image", "video"] as const;
const supportingFeatures = ["assets", "assistant", "inspiration"] as const;

export function LandingFeatures() {
    const { t, i18n } = useTranslation();
    const theme = useThemeStore((state) => state.theme);
    const locale = i18n.resolvedLanguage?.startsWith("en") ? "en" : "zh";

    return <div id="features" className="landing-features">
        {primaryFeatures.map((key) => <section key={key} className="landing-feature" aria-labelledby={`feature-${key}`}>
            <div className="landing-feature-copy">
                <h2 id={`feature-${key}`}>{t(`landing.features.${key}.title`).split("\n").map((line) => <span key={line}>{line}</span>)}</h2>
                <p>{t(`landing.features.${key}.description`)}</p>
            </div>
            <figure className="landing-preview">
                <img src={`/images/landing/${key}-${locale}-${theme}.webp`} alt={t(`landing.features.${key}.preview`)} width={1600} height={960} loading="lazy" decoding="async" />
            </figure>
        </section>)}
        <section className="landing-supporting-features" aria-label={t("landing.features.more")}>
            {supportingFeatures.map((key) => <article key={key}><h2>{t(`landing.features.${key}.title`)}</h2><p>{t(`landing.features.${key}.description`)}</p></article>)}
        </section>
    </div>;
}
