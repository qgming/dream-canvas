import { useEffect, type ReactNode } from "react";

export function ClientRootInit({ children }: { children: ReactNode }) {
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const fragment = new URLSearchParams(window.location.hash.slice(1));
        const keys = ["baseUrl", "baseurl", "apiKey", "apikey", "agentUrl", "agentToken"];
        if (!keys.some((key) => params.has(key) || fragment.has(key))) return;
        for (const key of keys) { params.delete(key); fragment.delete(key); }
        window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}${fragment.size ? `#${fragment}` : ""}`);
    }, []);
    return <>{children}</>;
}
