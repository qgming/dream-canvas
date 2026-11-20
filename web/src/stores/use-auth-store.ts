import { create } from "zustand";
import appI18n from "@/i18n";

import { getSession, login, logout, type Session, type User } from "@/services/api/auth";
import { ApiError, setCsrfToken } from "@/services/api/client";

type AuthState = {
    user: User | null;
    ready: boolean;
    error: string;
    siteClosed: boolean;
    refresh: () => Promise<void>;
    signIn: (username: string, password: string) => Promise<void>;
    signOut: () => Promise<void>;
    clear: () => void;
    closeSite: () => void;
};

function acceptSession(session: Session) {
    setCsrfToken(session.csrf);
    useAuthStore.setState({ user: session.user, ready: true, error: "", siteClosed: false });
}

let revision = 0;

export const useAuthStore = create<AuthState>((set) => ({
    user: null,
    ready: false,
    error: "",
    siteClosed: false,
    refresh: async () => {
        const request = ++revision;
        try { const session = await getSession(); if (request === revision) acceptSession(session); }
        catch (error) {
            if (error instanceof ApiError && error.code === "site_closed") { if (request === revision) useAuthStore.getState().closeSite(); return; }
            if (request === revision) { setCsrfToken(""); set({ user: null, ready: true, error: error instanceof ApiError && error.status === 401 ? "" : error instanceof Error ? error.message : appI18n.t("workspace.serviceUnavailable") }); }
        }
    },
    signIn: async (username, password) => { const request = ++revision; const session = await login(username, password); if (request === revision) acceptSession(session); },
    signOut: async () => { const request = ++revision; await logout(); if (request === revision) useAuthStore.getState().clear(); },
    clear: () => { revision++; setCsrfToken(""); set({ user: null, ready: true, error: "" }); },
    closeSite: () => { revision++; setCsrfToken(""); set({ user: null, ready: true, error: "", siteClosed: true }); },
}));
