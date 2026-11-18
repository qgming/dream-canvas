import { Copy, FileText, Image, Video } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { Prompt } from "@/services/api/prompts";

const promptIcons = { text: FileText, image: Image, video: Video };

export function PromptCard({ item, onOpen, onCopy, extraAction, compact = false }: { item: Prompt; onOpen: () => void; onCopy: () => void; extraAction?: ReactNode; compact?: boolean }) {
    const { t } = useTranslation();
    const Icon = promptIcons[item.type];
    return <article className={cn("flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground transition-colors hover:border-foreground/25", !compact && "min-h-40")}>
        <button type="button" onClick={onOpen} className={cn("flex min-w-0 flex-1 flex-col p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", !compact && "pb-1")}>
            <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><Icon className="size-3.5" />{t(`prompts.types.${item.type}`)}</span>
                {item.category ? <span>{item.category}</span> : null}
                <span className="ml-auto">{t(item.builtIn ? "inspiration.builtin" : "inspiration.mine")}</span>
            </div>
            <h3 className="line-clamp-2 text-sm font-medium leading-5">{item.title}</h3>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.description || item.prompt}</p>
        </button>
        {!compact ? <div className="flex items-center justify-end gap-0.5 px-2 pb-2">{extraAction}<Button variant="ghost" size="icon" className="size-7" title={t("common.copyPrompt")} aria-label={t("common.copyPrompt")} onClick={onCopy}><Copy className="size-4" /></Button></div> : null}
    </article>;
}
