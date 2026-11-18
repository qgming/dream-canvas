import { Search } from "lucide-react";
import { type UIEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState, Notice, Spinner } from "@/components/ui/display";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Choice } from "@/components/ui/choice";
import { ALL_PROMPTS_OPTION, type PromptScope, type PromptType } from "@/services/api/prompts";
import { PromptCard } from "./prompt-card";
import { usePromptList } from "./use-prompt-list";

export function PromptSelectDialog({ open, onOpenChange, onSelect, initialType = "all" }: { open: boolean; onOpenChange: (open: boolean) => void; onSelect: (prompt: string) => void; initialType?: PromptType | "all" }) {
    const { t, i18n } = useTranslation();
    const [keyword, setKeyword] = useState("");
    const [category, setCategory] = useState(ALL_PROMPTS_OPTION);
    const [scope, setScope] = useState<PromptScope>("all");
    const [type, setType] = useState<PromptType | "all">(initialType);
    const { query, items, categories } = usePromptList({ keyword, category, scope, type, enabled: open });
    useEffect(() => { setCategory(ALL_PROMPTS_OPTION); }, [i18n.resolvedLanguage]);
    useEffect(() => { if (open) { setType(initialType); setCategory(ALL_PROMPTS_OPTION); } }, [open, initialType]);
    const select = (prompt: string) => { onSelect(prompt); onOpenChange(false); };
    const handleScroll = (event: UIEvent<HTMLDivElement>) => {
        const target = event.currentTarget;
        if (query.hasNextPage && !query.isFetchingNextPage && target.scrollTop + target.clientHeight >= target.scrollHeight - 160) void query.fetchNextPage();
    };

    return <Dialog title={t("inspiration.choosePrompt")} open={open} onClose={() => onOpenChange(false)} footer={null} width={880}>
        <div className="flex h-[62dvh] min-h-0 flex-col gap-4">
            <Input prefix={<Search className="size-4" />} aria-label={t("prompts.search")} value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={t("prompts.search")} />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Choice<PromptScope> aria-label={t("inspiration.scope")} value={scope} onChange={(value) => { setScope(value); setCategory(ALL_PROMPTS_OPTION); }} options={(["all", "builtin", "user"] as const).map((value) => ({ value, label: t(`inspiration.scopes.${value}`) }))} />
                <Choice<PromptType | "all"> aria-label={t("prompts.type")} value={type} onChange={(value) => { setType(value); setCategory(ALL_PROMPTS_OPTION); }} options={[{ value: "all", label: t("prompts.allTypes") }, ...(["text", "image", "video"] as const).map((value) => ({ value, label: t(`prompts.types.${value}`) }))]} />
                <Choice aria-label={t("prompts.category")} value={category} onChange={setCategory} options={categories.map((value) => ({ value, label: value === ALL_PROMPTS_OPTION ? t("inspiration.allCategories") : value }))} />
            </div>
            <p className="text-xs leading-5 text-muted-foreground">{t("prompts.templateHint")}</p>
            {query.error ? <Notice type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>{t("common.retry")}</Button>} /> : null}
            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto pr-1" onScroll={handleScroll}>
                {query.isLoading ? <div className="flex h-40 items-center justify-center"><Spinner /></div> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map((item) => <PromptCard key={item.id} item={item} onOpen={() => select(item.prompt)} onCopy={() => select(item.prompt)} compact />)}</div>}
                {!query.isLoading && !query.error && !items.length ? <EmptyState description={t("prompts.empty")} /> : null}
                {query.hasNextPage ? <div className="py-4 text-center"><Button variant="ghost" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{t("prompts.more")}</Button></div> : null}
            </div>
        </div>
    </Dialog>;
}
