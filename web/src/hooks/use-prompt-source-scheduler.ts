import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { refreshDueSources } from "@/services/api/prompts";
import { usePromptSourceStore } from "@/stores/use-prompt-source-store";
import { useAuthStore } from "@/stores/use-auth-store";

const CHECK_INTERVAL_MS = 60_000;

/** Periodically update only the sources whose last successful refresh is due. */
export function usePromptSourceScheduler() {
    const queryClient = useQueryClient();
    const intervalMinutes = usePromptSourceStore((state) => state.schedule.intervalMinutes);
    const hydrated = usePromptSourceStore((state) => state.hydrated);
    const owner = useAuthStore((state) => state.user?.id);

    useEffect(() => {
        if (!intervalMinutes || !hydrated || !owner) return;
        let running = false;
        const tick = async () => {
            if (running) return;
            const { updateSchedule } = usePromptSourceStore.getState();
            running = true;
            try {
                const result = await refreshDueSources(intervalMinutes * 60_000);
                if (!result.results.length || useAuthStore.getState().user?.id !== owner) return;
                const dirty = usePromptSourceStore.getState().dirty;
                updateSchedule("lastFetchedAt", new Date().toISOString());
                if (!dirty) await usePromptSourceStore.getState().save();
                await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ["prompts"] }),
                    queryClient.invalidateQueries({ queryKey: ["side-panel-prompts"] }),
                    queryClient.invalidateQueries({ queryKey: ["prompt-source-statuses"] }),
                ]);
            } catch {
                // Per-source errors are stored in source state and retried during the next check cycle.
            } finally {
                running = false;
            }
        };
        void tick();
        const timer = window.setInterval(() => void tick(), CHECK_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [intervalMinutes, queryClient, hydrated, owner]);
}
