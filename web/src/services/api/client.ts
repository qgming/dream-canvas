import i18n from "@/i18n";
let csrf = "";
let sessionRevision = 0;

export class ApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) {
        super(message);
        this.name = "ApiError";
    }
}

export function setCsrfToken(value: string) { if (csrf !== value) { csrf = value; sessionRevision++; } }

export function captureSession() {
    const revision = sessionRevision;
    return () => { if (revision !== sessionRevision) throw new ApiError(409, "session_changed", i18n.t("errors.sessionChanged")); };
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const revision = sessionRevision;
    const assertSession = captureSession();
    const headers = new Headers(init.headers);
    if (init.body && typeof init.body === "string") headers.set("Content-Type", "application/json");
    if (init.method && !["GET", "HEAD"].includes(init.method)) headers.set("X-CSRF-Token", csrf);
    const response = await fetch(`/api${path}`, { ...init, headers, credentials: "same-origin" });
    assertSession();
    if (!response.ok) {
        const error = await response.json().catch(() => ({})) as { code?: string; message?: string };
        assertSession();
        if (response.status === 401 && path !== "/auth/login" && revision === sessionRevision) window.dispatchEvent(new Event("session-expired"));
        throw new ApiError(response.status, error.code || "request_failed", error.message || i18n.t("errors.requestFailed", { status: response.status }));
    }
    const result = response.status === 204 ? undefined as T : await response.json() as T;
    assertSession();
    return result;
}

export function jsonRequest(method: string, body: unknown): RequestInit {
    return { method, body: JSON.stringify(body) };
}
