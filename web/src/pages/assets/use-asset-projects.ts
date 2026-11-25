import { useQuery } from "@tanstack/react-query";
import { listAssetProjects } from "@/services/api/assets";
import { useAuthStore } from "@/stores/use-auth-store";

export const assetProjectsKey = ["asset-projects"] as const;

export function useAssetProjects(enabled = true) {
    const userId = useAuthStore((state) => state.user?.id);
    return useQuery({ queryKey: [...assetProjectsKey, userId], queryFn: listAssetProjects, enabled: enabled && Boolean(userId) });
}
