import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Badge as Tag, EmptyState as Empty, FilterChip, Notice, Spinner } from "@/components/ui/display";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Pagination } from "@/components/ui/pagination";
import { ArrowLeft, Folder, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { useAssetProjects } from "@/pages/assets/use-asset-projects";
import type { AssetProject } from "@/services/api/assets";
import { getImagePreviewRevision, subscribeImagePreviews } from "@/services/image-storage";
import { assetCoverUrl, useAssetStore, type Asset, type AssetKind } from "@/stores/use-asset-store";

type MediaPayload = { url: string; title: string; storageKey?: string; width?: number; height?: number };
export type InsertAssetPayload = { kind: "text"; content: string; title: string } | { kind: "image"; dataUrl: string; title: string; storageKey?: string } | ({ kind: "video" } & MediaPayload) | ({ kind: "audio" } & MediaPayload);

type Props = {
    open: boolean;
    title?: string;
    kinds?: readonly AssetKind[];
    onInsert: (payload: InsertAssetPayload) => void;
    onClose: () => void;
};

export function AssetPickerModal({ open, title, kinds, onInsert, onClose }: Props) {
    const { t } = useTranslation();
    const projects = useAssetProjects(open);
    const [assetProjectId, setAssetProjectId] = useState<string | null>(null);
    const [keyword, setKeyword] = useState("");
    const sectionHeading = useRef<HTMLHeadingElement>(null);
    const previousProjectId = useRef(assetProjectId);
    useEffect(() => {
        if (open) void useAssetStore.getState().loadAssets();
        else {
            setAssetProjectId(null);
            setKeyword("");
        }
    }, [open]);
    useEffect(() => {
        if (open && previousProjectId.current !== assetProjectId) sectionHeading.current?.focus();
        previousProjectId.current = assetProjectId;
    }, [open, assetProjectId]);

    const projectTitle = (project: AssetProject) => project.isDefault ? t("assetProjects.defaultTitle") : project.title;
    const project = projects.data?.find((entry) => entry.id === assetProjectId);
    const search = keyword.trim().toLocaleLowerCase();
    const visibleProjects = projects.data?.filter((entry) => projectTitle(entry).toLocaleLowerCase().includes(search)) ?? [];

    return (
        <Dialog title={title || t("canvas.assetPicker.title")} open={open} onClose={onClose} footer={null} width={860} className="min-h-[min(532px,calc(100dvh-32px))]">
            <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                        {assetProjectId ? <Button size="icon" title={t("canvas.assetPicker.backToProjects")} aria-label={t("canvas.assetPicker.backToProjects")} onClick={() => setAssetProjectId(null)}><ArrowLeft /></Button> : null}
                        <h2 ref={sectionHeading} tabIndex={-1} className="min-w-0 break-words text-sm font-medium outline-none">
                            {project ? projectTitle(project) : t(assetProjectId ? "canvas.assetPicker.title" : "canvas.assetPicker.chooseProject")}
                        </h2>
                    </div>
                    {!assetProjectId ? <SearchInput className="w-full sm:w-72" placeholder={t("assetProjects.search")} value={keyword} onChange={(event) => setKeyword(event.target.value)} /> : null}
                </div>
                {projects.error ? <Notice type="error" title={projects.error.message} action={<Button loading={projects.isFetching} onClick={() => void projects.refetch()}>{t("common.retry")}</Button>} /> : projects.isPending ? (
                    <div className="flex justify-center py-12"><Spinner /></div>
                ) : assetProjectId ? (
                    project ? <ProjectAssets key={project.id} assetProjectId={project.id} kinds={kinds} onInsert={onInsert} /> : <Empty description={t("assetProjects.notFound")} />
                ) : visibleProjects.length ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                        {visibleProjects.map((entry) => {
                            const Icon = entry.isDefault ? FolderOpen : Folder;
                            return <button key={entry.id} type="button" className="flex min-h-24 min-w-0 cursor-pointer flex-col items-start gap-1 rounded-xl border border-border bg-card p-3 text-left text-card-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none" onClick={() => setAssetProjectId(entry.id)}>
                                <span className="flex w-full min-w-0 items-center gap-2 text-sm font-medium"><Icon aria-hidden className="size-4 shrink-0" /><span className="truncate">{projectTitle(entry)}</span></span>
                                {entry.isDefault ? <span className="text-xs leading-5 text-muted-foreground">{t("assetProjects.defaultDescription")}</span> : null}
                            </button>;
                        })}
                    </div>
                ) : <Empty description={t("ui.noMatches")} />}
            </div>
        </Dialog>
    );
}

const PAGE_SIZE = 8;

const kindOptions = ["all", "text", "image", "video", "audio"] as const;

function PickerCard({ title, kind, cover, onClick }: { title: string; kind: string; cover: string; onClick: () => void }) {
    const { t } = useTranslation();
    return (
        <button
            type="button"
            className="group relative cursor-pointer overflow-hidden rounded-lg border border-border bg-card text-left outline-none transition-colors hover:border-ring focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onClick}
        >
            {cover ? (
                <img src={cover} alt={title} className="aspect-[4/3] w-full object-cover" />
            ) : (
                <div className="flex aspect-[4/3] items-center justify-center bg-card p-3 text-center text-xs leading-5 text-muted-foreground">{title}</div>
            )}
            <div className="p-2.5">
                <div className="flex items-center justify-between gap-2">
                    <span className="line-clamp-1 text-sm font-medium text-foreground">{title}</span>
                    <Tag className="m-0 shrink-0 text-xs">{t(`assets.kinds.${kind}`)}</Tag>
                </div>
            </div>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-foreground/70 text-sm font-medium text-background opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">{t("canvas.assetPicker.insert")}</div>
        </button>
    );
}

function ProjectAssets({ assetProjectId, kinds, onInsert }: Pick<Props, "kinds" | "onInsert"> & { assetProjectId: string }) {
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const assets = useAssetStore((state) => state.assets);
    const error = useAssetStore((state) => state.error);
    const hydrated = useAssetStore((state) => state.hydrated);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
    const [page, setPage] = useState(1);
    const options = kindOptions.filter((kind) => kind === "all" || !kinds || kinds.includes(kind));
    const activeKind = options.find((kind) => kind === kindFilter) ?? "all";

    const filtered = useMemo(() => {
        const query = keyword.trim().toLocaleLowerCase();
        return assets.filter((asset) => asset.assetProjectId === assetProjectId && (!kinds || kinds.includes(asset.kind)) && (activeKind === "all" || asset.kind === activeKind) && (!query || asset.title.toLocaleLowerCase().includes(query)));
    }, [activeKind, assets, keyword, kinds, assetProjectId]);

    const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const currentPage = Math.min(page, maxPage);
    const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    useEffect(() => { setPage((value) => Math.min(value, maxPage)); }, [maxPage]);

    const handleInsert = (asset: Asset) => {
        if (asset.kind === "text") {
            onInsert({ kind: "text", content: asset.data.content, title: asset.title });
        } else {
            onInsert(asset.kind === "video" || asset.kind === "audio" ? { kind: asset.kind, url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height } : { kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title });
        }
    };

    if (error) return <Notice type="error" title={error} action={<Button onClick={() => void useAssetStore.getState().loadAssets()}>{t("workspace.retryRead")}</Button>} />;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
                <SearchInput
                    className="w-full sm:w-56"
                    size="small"
                    placeholder={t("canvas.assetPicker.search")}
                    value={keyword}
                    onChange={(event) => {
                        setPage(1);
                        setKeyword(event.target.value);
                    }}
                />
                <div className="flex flex-wrap gap-1.5">
                    {options.map((option) => (
                        <FilterChip
                            key={option}
                            checked={activeKind === option}
                            className={cn("prompt-filter-tag", activeKind === option && "is-active")}
                            onChange={() => {
                                setPage(1);
                                setKindFilter(option);
                            }}
                        >
                            {option === "all" ? t("canvas.assetPicker.allTypes") : t(`assets.kinds.${option}`)}
                        </FilterChip>
                    ))}
                </div>
            </div>

            {visible.length ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {visible.map((asset) => (
                        <PickerCard key={asset.id} title={asset.title} kind={asset.kind} cover={assetCoverUrl(asset)} onClick={() => handleInsert(asset)} />
                    ))}
                </div>
            ) : !hydrated ? <div className="flex justify-center py-12"><Spinner /></div> : (
                <Empty description={t("canvas.assetPicker.empty")} className="py-12" />
            )}

            {filtered.length > PAGE_SIZE && (
                <Pagination current={currentPage} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} />
            )}
        </div>
    );
}
