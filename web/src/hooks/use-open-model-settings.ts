import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import { useAuthStore } from "@/stores/use-auth-store";

export function useOpenModelSettings() {
    const navigate = useNavigate();
    const admin = useAuthStore((state) => state.user?.role === "admin");
    return useCallback(() => { void navigate(admin ? "/settings/channels" : "/settings/models"); }, [admin, navigate]);
}
