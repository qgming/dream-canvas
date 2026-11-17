import { useSyncExternalStore } from "react";

export function useMediaQuery(query: string) {
    return useSyncExternalStore((change) => { const media = matchMedia(query); media.addEventListener("change", change); return () => media.removeEventListener("change", change); }, () => matchMedia(query).matches, () => false);
}
