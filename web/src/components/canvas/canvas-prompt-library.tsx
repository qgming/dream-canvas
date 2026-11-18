import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/popover";
import { BookOpen } from "lucide-react";
import { useTranslation } from "react-i18next";

import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { PromptType } from "@/services/api/prompts";

export function CanvasPromptLibrary({ onSelect, type }: { onSelect: (prompt: string) => void; type: PromptType | "all" }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <>
            <Tooltip title={t("inspiration.choosePrompt")}>
                <Button
                    variant="ghost"
                    className="!h-8 !w-8 !min-w-8 shrink-0 !rounded-md !bg-transparent !p-0"
                    style={{ color: theme.node.text }}
                    icon={<BookOpen className="size-3.5" />}
                    onClick={() => setOpen(true)}
                    aria-label={t("inspiration.choosePrompt")}
                />
            </Tooltip>
            <PromptSelectDialog open={open} onOpenChange={setOpen} onSelect={onSelect} initialType={type} />
        </>
    );
}
