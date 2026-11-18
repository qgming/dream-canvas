import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useTranslation } from "react-i18next";

import { formatPromptDate, type Prompt } from "@/services/api/prompts";

export function PromptDetailDialog({ prompt, onClose, onCopy }: { prompt: Prompt | null; onClose: () => void; onCopy: (prompt: string) => void }) {
    const { i18n, t } = useTranslation();

    return (
        <Dialog title={prompt?.title} open={Boolean(prompt)} onClose={onClose} footer={null} width={720} bodyClassName="h-[calc(85dvh-80px)] overflow-hidden">
            {prompt ? (
                <div className="flex h-full min-h-0 flex-col">
                    <div className="shrink-0 pb-4 text-xs text-muted-foreground">{t(`prompts.types.${prompt.type}`)} · {t(prompt.builtIn ? "prompts.builtin" : "prompts.mine")}{prompt.category ? ` · ${prompt.category}` : ""}</div>
                    {prompt.builtIn ? <p className="pb-4 text-xs leading-5 text-muted-foreground">{t("prompts.templateHint")}</p> : null}
                    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto border-y border-border py-4 pr-2 ">
                        {prompt.description ? <p className="mt-4 text-sm leading-6 text-muted-foreground ">{prompt.description}</p> : null}
                        <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-muted-foreground ">{prompt.prompt}</p>
                        {!prompt.builtIn ? <div className="mt-4 text-xs text-muted-foreground">{t("common.updated", { date: formatPromptDate(prompt.updatedAt, i18n.resolvedLanguage) })}</div> : null}
                    </div>
                    <div className="shrink-0 pt-4">
                        <div className="flex flex-wrap items-center gap-2">
                            <Button variant="default" icon={<Copy className="size-4" />} onClick={() => onCopy(prompt.prompt)}>
                                {t("common.copyPrompt")}
                            </Button>
                        </div>
                    </div>
                </div>
            ) : null}
        </Dialog>
    );
}
