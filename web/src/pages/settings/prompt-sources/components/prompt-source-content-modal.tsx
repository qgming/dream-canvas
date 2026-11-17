import { useFeedback } from "@/hooks/use-feedback";
import { Button } from "@/components/ui/button";
import { EmptyState as Empty } from "@/components/ui/display";
import { Notice } from "@/components/ui/display";
import { Dialog } from "@/components/ui/dialog";
import { DataTable } from "@/components/ui/data-table";
import { Badge as Tag } from "@/components/ui/display";
import { Copy, FolderPlus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { PromptDetailDialog } from "@/pages/prompts/components/prompt-detail-dialog";
import { useCopyText } from "@/hooks/use-copy-text";
import { useAssetStore } from "@/stores/use-asset-store";
import { fetchSourcePrompts, refreshSource, type Prompt } from "@/services/api/prompts";
import type { PromptSource } from "@/services/api/prompt-source-presets";

export function PromptSourceContentModal({ source, onClose }: { source: PromptSource | null; onClose: () => void }) {
    const { notify } = useFeedback();
    const { t } = useTranslation();
    const [items, setItems] = useState<Prompt[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [detail, setDetail] = useState<Prompt | null>(null);
    const copyText = useCopyText();
    const addAsset = useAssetStore((state) => state.addAsset);

    const load = useCallback(
        async (force: boolean) => {
            if (!source) return;
            setLoading(true);
            try {
                setItems(force ? await refreshSourceItems(source.id) : await fetchSourcePrompts(source.id));
                setError("");
            } catch (error) {
                setError(error instanceof Error ? error.message : t("config.promptSources.content.loadFailed"));
            } finally {
                setLoading(false);
            }
        },
        [source, notify, t],
    );

    useEffect(() => {
        if (source) void load(false);
        else setItems([]);
    }, [source, load]);

    const saveAsset = async (item: Prompt) => {
        await addAsset({ kind: "text", title: item.title, coverUrl: item.coverUrl, tags: item.tags, source: item.category, data: { content: item.prompt }, metadata: { source: "prompt-library", promptId: item.id, githubUrl: item.githubUrl } });
        notify.success(t("common.addedToAssets"));
    };

    return (
        <>
            <Dialog
                open={Boolean(source)}
                onClose={onClose}
                width={980}
                footer={null}
                title={
                    <div className="flex flex-wrap items-center justify-between gap-2 pr-6">
                        <div>
                            <div className="text-base font-semibold">{t("config.promptSources.content.title", { name: source?.name || "" })}</div>
                            <div className="mt-0.5 text-xs font-normal text-muted-foreground">{t("config.promptSources.content.count", { count: items.length })}</div>
                        </div>
                        <Button size="sm" icon={<RefreshCw className="size-3.5" />} loading={loading} onClick={() => void load(true)}>
                            {t("config.promptSources.content.refresh")}
                        </Button>
                    </div>
                }
            >
                {error ? <Notice type="error" className="mb-4" title={error} action={<Button onClick={() => void load(false)}>{t("common.retry")}</Button>} /> : null}
                <DataTable<Prompt>
                    rowId="id"
                    compact
                    loading={loading}
                    failed={Boolean(error)}
                    rows={items}
                    pageSize={10}
                    className="max-h-[64dvh] overflow-y-auto"
                    empty={<Empty description={t("config.promptSources.content.empty")} /> }
                    columns={[
                        {
                            title: t("config.promptSources.content.cover"),
                            dataIndex: "coverUrl",
                            width: 72,
                            render: (coverUrl: string) => (coverUrl ? <img src={coverUrl} alt="" className="size-12 rounded object-cover" /> : <div className="size-12 rounded bg-muted " />),
                        },
                        {
                            title: t("config.promptSources.content.titleColumn"),
                            dataIndex: "title",
                            render: (title: string, item) => (
                                <div className="min-w-40">
                                    <div className="truncate font-medium">{title}</div>
                                    <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.prompt}</div>
                                </div>
                            ),
                        },
                        {
                            title: t("config.promptSources.content.tags"),
                            dataIndex: "tags",
                            width: 200,
                            render: (tags: string[]) => (
                                <div className="flex flex-wrap gap-1">
                                    {tags.slice(0, 4).map((tag) => (
                                        <Tag key={tag} className="m-0">
                                            {tag}
                                        </Tag>
                                    ))}
                                </div>
                            ),
                        },
                        {
                            title: t("config.promptSources.content.actions"),
                            width: 210,
                            align: "right",
                            render: (_, item) => (
                                <div className="flex flex-wrap items-center justify-end gap-2">
                                    <Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} onClick={() => copyText(item.prompt, t("common.promptCopied"))}>
                                        {t("common.copy")}
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => setDetail(item)}>
                                        {t("common.details")}
                                    </Button>
                                    <Button size="sm" variant="ghost" icon={<FolderPlus className="size-3.5" />} onClick={() => saveAsset(item)}>
                                        {t("common.addToAssets")}
                                    </Button>
                                </div>
                            ),
                        },
                    ]}
                />
            </Dialog>
            <PromptDetailDialog prompt={detail} onClose={() => setDetail(null)} onCopy={(prompt) => copyText(prompt, t("common.promptCopied"))} onSaveAsset={saveAsset} />
        </>
    );
}

async function refreshSourceItems(sourceId: string) {
    await refreshSource(sourceId);
    return fetchSourcePrompts(sourceId);
}
