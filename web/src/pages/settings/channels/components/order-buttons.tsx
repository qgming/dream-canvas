import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";

export function OrderButtons({ label, index, count, disabled, onMove }: { label: string; index: number; count: number; disabled: boolean; onMove: (index: number) => void }) {
    return <div className="flex shrink-0 items-center">
        <Button type="button" size="icon" variant="ghost" className="size-7" disabled={disabled || index === 0} aria-label={`${label} ↑`} title={`${label} ↑`} onClick={() => onMove(index - 1)}><ArrowUp className="size-3.5" /></Button>
        <Button type="button" size="icon" variant="ghost" className="size-7" disabled={disabled || index === count - 1} aria-label={`${label} ↓`} title={`${label} ↓`} onClick={() => onMove(index + 1)}><ArrowDown className="size-3.5" /></Button>
    </div>;
}
