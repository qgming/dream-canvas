export function CanvasRefreshShell() {
    return (
        <main className="relative h-full min-h-0 overflow-hidden bg-background text-foreground">
            <div
                className="absolute inset-0 opacity-60"
                style={{
                    backgroundImage: "radial-gradient(circle, var(--border) 1px, transparent 1px)",
                    backgroundSize: "28px 28px",
                }}
            />

            <div className="pointer-events-none absolute inset-y-20 left-4 z-50 flex items-center" aria-hidden="true">
                <div className="flex max-h-full w-fit flex-col items-center gap-1 overflow-hidden rounded-xl border p-1 shadow-lg backdrop-blur [&>*]:shrink-0" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                    {Array.from({ length: 7 }).map((_, index) => (
                        <div key={index} className="size-8 rounded-md bg-current opacity-10" />
                    ))}
                </div>
            </div>

            <div className="absolute bottom-40 left-[88px] z-50 h-40 w-[240px] rounded-lg border shadow-2xl backdrop-blur-sm" style={{ background: "var(--card)", borderColor: "var(--border)" }} aria-hidden="true">
                <div className="absolute left-7 top-7 h-5 w-12 rounded-sm bg-current opacity-10" />
                <div className="absolute left-28 top-16 h-6 w-16 rounded-sm bg-current opacity-10" />
                <div className="absolute bottom-7 left-16 h-8 w-20 rounded-sm bg-current opacity-10" />
                <div className="absolute inset-5 rounded border border-current opacity-15" />
            </div>

            <div className="absolute bottom-5 left-4 z-50 flex items-center gap-1 rounded-xl border p-1 shadow-lg backdrop-blur" style={{ background: "var(--card)", borderColor: "var(--border)" }} aria-hidden="true">
                <div className="size-8 rounded-md bg-current opacity-10" />
                <div className="size-8 rounded-md bg-current opacity-10" />
                <div className="h-8 w-16 rounded-md bg-current opacity-10" />
            </div>
        </main>
    );
}
