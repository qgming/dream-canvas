import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trans, useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowDown, Languages } from "lucide-react";
import { GlyphBackground } from "@/components/animate-ui/backgrounds/glyph";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/display";
import { Field } from "@/components/ui/form";
import { Input, PasswordInput } from "@/components/ui/input";
import { getAuthStatus } from "@/services/api/auth";
import { ApiError } from "@/services/api/client";
import { useAuthStore } from "@/stores/use-auth-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { changeAppLocale } from "@/i18n";
import { AsciiLogo } from "./ascii-logo";
import { LandingFeatures } from "./landing-features";
import "./landing.css";

function LoginForm({ target, closed, onSuccess, onBusy }: { target: string; closed: boolean; onSuccess: () => void; onBusy: (value: boolean) => void }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const signIn = useAuthStore((state) => state.signIn);
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const submitting = useRef(false);
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (submitting.current) return;
        submitting.current = true; setBusy(true); onBusy(true); setError("");
        try {
            await signIn(username.trim(), password);
            const user = useAuthStore.getState().user;
            if (!user) return;
            onSuccess(); navigate(closed && user.role === "admin" ? "/settings/site" : target, { replace: true });
        } catch (error) {
            setError(error instanceof ApiError ? t(`landing.errors.${error.code}`, { defaultValue: error.message }) : error instanceof Error ? error.message : t("workspace.loginFailed"));
        } finally { submitting.current = false; setBusy(false); onBusy(false); }
    };
    return <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy} className="space-y-5 py-2">
            <Field label={t("workspace.username")}><Input autoComplete="username" autoFocus required value={username} onChange={(event) => setUsername(event.target.value)} size="large" /></Field>
            <Field label={t("workspace.password")}><PasswordInput autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} size="large" /></Field>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <Button variant="default" type="submit" size="lg" className="w-full" loading={busy}>{t("workspace.login")}</Button>
        </fieldset>
    </form>;
}

export default function HomePage() {
    const { t, i18n } = useTranslation();
    const location = useLocation();
    const user = useAuthStore((state) => state.user);
    const ready = useAuthStore((state) => state.ready);
    const siteClosed = useAuthStore((state) => state.siteClosed);
    const refresh = useAuthStore((state) => state.refresh);
    const [loginOpen, setLoginOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const status = useQuery({ queryKey: ["auth-status"], queryFn: getAuthStatus, refetchOnWindowFocus: true });
    const from = (location.state as { from?: string } | null)?.from;
    const target = from?.startsWith("/") && !from.startsWith("//") && !from.startsWith("/login") && from !== "/" ? from : "/canvas";
    const closed = status.data?.open === false || siteClosed;
    useEffect(() => {
        void refresh();
        const expired = () => useAuthStore.getState().clear();
        const closed = () => useAuthStore.getState().closeSite();
        window.addEventListener("session-expired", expired);
        window.addEventListener("site-closed", closed);
        const focused = () => { if (useAuthStore.getState().user) void refresh(); };
        window.addEventListener("focus", focused);
        return () => { window.removeEventListener("session-expired", expired); window.removeEventListener("site-closed", closed); window.removeEventListener("focus", focused); };
    }, [refresh]);
    useEffect(() => { if (status.data?.open) useAuthStore.setState({ siteClosed: false }); }, [status.dataUpdatedAt, status.data?.open]);

    return <main className="landing-page bg-background text-foreground">
        <section className={`landing-first-screen${closed ? " landing-site-closed" : ""}`} aria-labelledby="landing-title">
            <header className="landing-header">
                <div className="landing-header-inner">
                    <Link to="/" className="landing-brand"><img src="/logo.svg" alt="" className="dark:invert" /><span>{t("landing.name")}</span></Link>
                    {closed ? <p className="landing-closed-notice rounded-full border border-foreground/30" role="status">{t("landing.closedNotice")}</p> : null}
                    <nav aria-label={t("landing.navigation")} className="landing-nav">
                        <Button asChild variant="ghost" size="icon" title={t("landing.github")}><a href="https://github.com/qgming/dream-canvas" target="_blank" rel="noreferrer" aria-label={t("landing.github")}><img src="/icons/github.svg" alt="" className="size-4 dark:invert" /></a></Button>
                        <Button variant="ghost" size="icon" title={t("landing.switchLanguage")} aria-label={t("landing.switchLanguage")} onClick={() => void changeAppLocale(i18n.resolvedLanguage === "zh-CN" ? "en-US" : "zh-CN")}><Languages /></Button>
                        <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} title={t("theme.toggle")} />
                        <span aria-hidden="true" className="landing-nav-divider" />
                        {user ? <Button asChild variant="default" className="landing-login"><Link to={closed && user.role === "admin" ? "/settings/site" : target}>{t(closed && user.role === "admin" ? "site.title" : "landing.enter")}</Link></Button> : <Button variant="default" className="landing-login" disabled={!ready || !status.data?.initialized} onClick={() => setLoginOpen(true)}>{t("workspace.login")}</Button>}
                    </nav>
                </div>
            </header>
            <div className="landing-notices space-y-3 empty:hidden">
                {status.error ? <Notice className="mt-6" type="error" title={t("workspace.serviceUnavailable")} action={<Button onClick={() => void status.refetch()}>{t("workspace.retry")}</Button>} /> : null}
                {status.data?.initialized === false ? <Notice className="mt-6" type="info" title={t("workspace.initializeAdmin")} description={t("workspace.initializeInstructions")} /> : null}
            </div>
            <GlyphBackground className="landing-glyph" glowColor={theme === "dark" ? "#ffffff" : "#000000"} shapeColor={theme === "dark" ? "#ffffff" : "#000000"}>
                <AsciiLogo />
                <div className="landing-hero-copy">
                    <h1 id="landing-title"><span>{t("landing.titleFirst")}</span><span>{t("landing.titleSecond")}</span></h1>
                </div>
                <a className="landing-scroll-cue" href="#features" aria-label={t("landing.exploreFeatures")}><ArrowDown aria-hidden="true" /></a>
            </GlyphBackground>
        </section>
        <LandingFeatures />
        <footer className="landing-footer"><Trans i18nKey="landing.footer" components={{ author: <a href="https://www.qgming.com/" target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:text-foreground hover:underline" /> }} /></footer>
        <Dialog open={loginOpen} title={t("workspace.loginTitle")} onClose={() => setLoginOpen(false)} width={400} footer={null} busy={busy}>
            {loginOpen ? <LoginForm target={target} closed={closed} onSuccess={() => setLoginOpen(false)} onBusy={setBusy} /> : null}
        </Dialog>
    </main>;
}
