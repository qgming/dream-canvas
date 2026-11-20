import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowUpRight, Clapperboard, Film, Image, Layers3, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/display";
import { Field } from "@/components/ui/form";
import { Input, PasswordInput } from "@/components/ui/input";
import { getAuthStatus } from "@/services/api/auth";
import { ApiError } from "@/services/api/client";
import { useAuthStore } from "@/stores/use-auth-store";

function StoryFrame() {
    return <svg viewBox="0 0 480 270" className="h-full w-full" aria-hidden="true">
        <rect width="480" height="270" fill="currentColor" opacity=".06" />
        <circle cx="352" cy="64" r="25" fill="currentColor" opacity=".12" />
        <path d="M0 185 72 160 110 181 185 117 252 161 302 140 383 185 435 151 480 163V270H0Z" fill="currentColor" opacity=".09" />
        <path d="M0 222 89 201 143 215 220 189 285 210 352 196 480 225V270H0Z" fill="currentColor" opacity=".13" />
        <path d="m226 202 9-37h10l8 37m-14-37v-11m-10 25 10-8 15 11m-21 19-6 27m18-27 9 27" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
        <path d="M0 242H480" stroke="currentColor" opacity=".18" />
        <path d="M22 40V22h24m388 0h24v18M22 230v18h24m388 0h24v-18" fill="none" stroke="currentColor" opacity=".28" />
    </svg>;
}

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
    const { t } = useTranslation();
    const location = useLocation();
    const user = useAuthStore((state) => state.user);
    const ready = useAuthStore((state) => state.ready);
    const siteClosed = useAuthStore((state) => state.siteClosed);
    const refresh = useAuthStore((state) => state.refresh);
    const [loginOpen, setLoginOpen] = useState(false);
    const [busy, setBusy] = useState(false);
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

    return <main className="h-dvh overflow-y-auto bg-background text-foreground">
        <header className="border-b border-border bg-card">
            <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-4 px-6 sm:px-10">
                <Link to="/" className="flex items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"><img src="/logo.svg" alt="" className="size-8 dark:invert" /><span className="text-lg font-semibold tracking-tight">{t("landing.name")}</span></Link>
                <nav aria-label={t("landing.navigation")} className="flex items-center gap-6">
                    <a href="#workflow" className="hidden rounded text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:block">{t("landing.workflow")}</a>
                    {user ? <Button asChild variant="default"><Link to={closed && user.role === "admin" ? "/settings/site" : target}>{t(closed && user.role === "admin" ? "site.title" : "landing.enter")}</Link></Button> : <Button variant="default" disabled={!ready || !status.data?.initialized} onClick={() => setLoginOpen(true)}>{t("workspace.login")}</Button>}
                </nav>
            </div>
        </header>
        <div className="mx-auto max-w-7xl px-6 sm:px-10">
            <div className="space-y-3 empty:hidden">
                {closed ? <Notice className="mt-6" type="warning" title={t("landing.closedTitle")} description={t("landing.closedDescription")} /> : null}
                {status.error ? <Notice className="mt-6" type="error" title={t("workspace.serviceUnavailable")} action={<Button onClick={() => void status.refetch()}>{t("workspace.retry")}</Button>} /> : null}
                {status.data?.initialized === false ? <Notice className="mt-6" type="info" title={t("workspace.initializeAdmin")} description={t("workspace.initializeInstructions")} /> : null}
            </div>
            <section className="grid items-center gap-12 py-16 lg:grid-cols-[.9fr_1.1fr] lg:gap-14 lg:py-24">
                <div>
                    <h1 className="text-3xl font-semibold leading-[1.22] tracking-tight sm:text-5xl xl:text-6xl"><span className="block">{t("landing.titleFirst")}</span><span className="block">{t("landing.titleSecond")}</span></h1>
                    <p className="mt-7 max-w-md text-base leading-8 text-muted-foreground">{t("landing.description")}</p>
                    <a href="#workflow" className="mt-8 inline-flex items-center gap-2 rounded text-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("landing.explore")}<ArrowUpRight className="size-4" /></a>
                </div>
                <figure className="min-w-0 overflow-hidden rounded-xl border border-border bg-card" aria-label={t("landing.previewLabel")}>
                    <figcaption className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-xs"><span className="flex items-center gap-2"><Clapperboard className="size-4" />{t("landing.previewProject")}</span><span className="text-muted-foreground">{t("landing.previewCaption")}</span></figcaption>
                    <div className="relative grid gap-5 overflow-hidden bg-background p-5 sm:grid-cols-[.7fr_1fr] sm:items-center sm:gap-7 sm:p-7" style={{ backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)", backgroundSize: "20px 20px" }}>
                        <div className="relative rounded-xl border border-border bg-card p-3">
                            <span className="mb-3 flex items-center gap-2 text-xs font-medium"><Type className="size-3.5" />{t("landing.previewPrompt")}</span>
                            <p className="text-xs leading-6 text-muted-foreground">{t("landing.prompt")}</p>
                            <span aria-hidden="true" className="absolute -right-1 top-1/2 hidden size-2 rounded-full border border-foreground/40 bg-card sm:block" />
                            <span aria-hidden="true" className="absolute -right-7 top-1/2 hidden w-6 border-t border-foreground/30 sm:block" />
                        </div>
                        <div className="overflow-hidden rounded-xl border border-foreground/25 bg-card">
                            <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium"><Image className="size-3.5" />{t("landing.previewShot")}</div>
                            <div className="aspect-video"><StoryFrame /></div>
                            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><Film className="size-3.5" /><span>{t("landing.previewSequence")}</span></div>
                        </div>
                    </div>
                </figure>
            </section>
            <section id="workflow" aria-labelledby="workflow-title" className="scroll-mt-8 border-t border-border py-12 sm:py-16">
                <h2 id="workflow-title" className="mb-8 text-2xl font-semibold tracking-tight">{t("landing.workflowTitle")}</h2>
                <div className="grid gap-8 md:grid-cols-3 md:gap-10">
                    {[{ key: "canvas", icon: Layers3 }, { key: "assets", icon: Image }, { key: "generation", icon: Clapperboard }].map(({ key, icon: Icon }) => <article key={key}><Icon className="mb-4 size-5" /><h3 className="text-base font-medium">{t(`landing.${key}Title`)}</h3><p className="mt-3 max-w-sm text-sm leading-7 text-muted-foreground">{t(`landing.${key}Description`)}</p></article>)}
                </div>
            </section>
            <footer className="flex flex-wrap justify-between gap-3 border-t border-border py-6 text-xs text-muted-foreground"><span>{t("landing.name")}</span><span>{t("landing.footer")}</span></footer>
        </div>
        <Dialog open={loginOpen} title={t("workspace.loginTitle")} onClose={() => setLoginOpen(false)} width={400} footer={null} busy={busy}>
            {loginOpen ? <LoginForm target={target} closed={closed} onSuccess={() => setLoginOpen(false)} onBusy={setBusy} /> : null}
        </Dialog>
    </main>;
}
