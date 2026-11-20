import appI18n from "@/i18n";
import { CircleAlert, Clapperboard, Clock3, CloudAlert, CloudCheck, CloudOff, CloudUpload, Copy, Database, Download, FileText, HardDrive, Image as ImageIcon, LayoutGrid, LoaderCircle, Music2, PencilLine, Plus, Trash2, Upload, Ellipsis } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Tabs } from "@animate-ui/react/primitives/radix-ui";
import { Link } from "react-router-dom";
import { Notice as Alert, Spinner } from "@/components/ui/display";
import { useFeedback } from "@/hooks/use-feedback";
import { Button } from "@/components/ui/button";
import { Menu, Tooltip } from "@/components/ui/popover";
import { PageHeader } from "@/components/layout/page-header";
import { Sheet } from "@/components/ui/dialog";
import { EmptyState as Empty } from "@/components/ui/display";
import { EditorForm, Field, useEditorForm, useWatch, validateForm } from "@/components/ui/form";
import { z } from "zod";
import { MediaPreview } from "@/components/ui/media-preview";
import { Input, Textarea, SearchInput } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Pagination } from "@/components/ui/pagination";
import { Choice } from "@/components/ui/choice";
import { Badge as Tag } from "@/components/ui/display";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import { useCopyText } from "@/hooks/use-copy-text";
import { formatBytes, formatDuration, formatRatio } from "@/lib/image-utils";
import { getMediaBlob, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { getImageBlob, getImagePreviewRevision, subscribeImagePreviews, uploadImage } from "@/services/image-storage";
import { assetCoverUrl, useAssetStore, type Asset, type AssetKind, type ImageAsset } from "@/stores/use-asset-store";
import { retryAssetCleanup, retryAssetSync } from "@/services/api/assets";
import { captureSession } from "@/services/api/client";

type AssetFormValues = {
    kind: AssetKind;
    title: string;
    note?: string;
    content?: string;
};

type ImageDraft = ImageAsset["data"] | null;

const kindOptions = [
    { key: "all", icon: LayoutGrid },
    { key: "text", icon: FileText },
    { key: "image", icon: ImageIcon },
    { key: "video", icon: Clapperboard },
    { key: "audio", icon: Music2 },
] as const;

export default function AssetsPage() {
    const { notify } = useFeedback();
    const { t } = useTranslation();
    const copyText = useCopyText();
    const form = useEditorForm<AssetFormValues>();
    const imageInputRef = useRef<HTMLInputElement>(null);
    const assets = useAssetStore((state) => state.assets);
    const hydrated = useAssetStore((state) => state.hydrated);
    const assetError = useAssetStore((state) => state.error);
    const deleting = useAssetStore((state) => state.deleting);
    const addAsset = useAssetStore((state) => state.addAsset);
    const updateAsset = useAssetStore((state) => state.updateAsset);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
    const [isAssetOpen, setIsAssetOpen] = useState(false);
    const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
    const [deletingAsset, setDeletingAsset] = useState<Asset | null>(null);
    const [formKind, setFormKind] = useState<AssetKind>("text");
    const [imageDraft, setImageDraft] = useState<ImageDraft>(null);
    const [mediaDraft, setMediaDraft] = useState<UploadedFile | null>(null);
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const deleteRef = useRef(false);
    const editorRevision = useRef(0);
    const title = useWatch({ name: "title", control: form.control }) || "";
    const content = useWatch({ name: "content", control: form.control }) || "";
    const mediaPreview = mediaDraft || (editingAsset?.kind === "video" || editingAsset?.kind === "audio" ? editingAsset.data : null);

    const filteredAssets = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return assets.filter((asset) => {
            if (kindFilter !== "all" && asset.kind !== kindFilter) return false;
            if (!query) return true;
            return assetSearchText(asset).includes(query);
        });
    }, [assets, keyword, kindFilter]);

    const visibleAssets = useMemo(() => {
        const start = (page - 1) * pageSize;
        return filteredAssets.slice(start, start + pageSize);
    }, [filteredAssets, page, pageSize]);

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filteredAssets.length / pageSize));
        setPage((value) => Math.min(value, maxPage));
    }, [filteredAssets.length, pageSize]);

    const openCreate = () => {
        editorRevision.current++;
        setEditingAsset(null);
        setImageDraft(null);
        setMediaDraft(null);
        setFormKind("text");
        form.reset({ kind: "text", title: "", note: "", content: "" });
        setIsAssetOpen(true);
    };

    const openEdit = (asset: Asset) => {
        editorRevision.current++;
        setEditingAsset(asset);
        setFormKind(asset.kind);
        setImageDraft(asset.kind === "image" ? asset.data : null);
        setMediaDraft(null);
        form.reset({
            kind: asset.kind,
            title: asset.title,
            note: asset.note,
            content: asset.kind === "text" ? asset.data.content : "",
        });
        setIsAssetOpen(true);
    };

    const closeEditor = () => { editorRevision.current++; setIsAssetOpen(false); };
    const saveAsset = async () => { if (savingRef.current) return; savingRef.current = true; const assertSession = captureSession(); const revision = editorRevision.current; setSaving(true); try {
        const values = await validateForm(form);
        assertSession();
        if (revision !== editorRevision.current) return;
        const base = {
            title: values.title.trim(),
            coverUrl: editingAsset?.coverUrl || "",
            source: editingAsset ? editingAsset.source : t("assets.manual"),
            note: values.note?.trim(),
            metadata: editingAsset?.metadata || { source: "manual" },
        };

        if (values.kind === "text") {
            const asset = { ...base, kind: "text" as const, data: { content: (values.content || "").trim() } };
            await (editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset));
        } else if (editingAsset) {
            await updateAsset(editingAsset.id, base);
        } else if (values.kind === "image") {
            if (!imageDraft) {
                notify.error(t("assets.selectImage"));
                return;
            }
            const asset = { ...base, kind: "image" as const, data: imageDraft };
            await addAsset(asset);
        } else {
            if (!mediaDraft) { notify.error(appI18n.t("workspace.chooseOriginal")); return; }
            const data = { ...mediaDraft, width: mediaDraft.width || 0, height: mediaDraft.height || 0 };
            if (values.kind === "video") await addAsset({ ...base, kind: "video", data });
            else await addAsset({ ...base, kind: "audio", data });
        }
        assertSession();
        if (revision !== editorRevision.current) return;
        notify.success(editingAsset ? t("assets.updated") : t("assets.saved"));
        closeEditor();
        } finally { savingRef.current = false; setSaving(false); }
    };

    const readImageFile = async (file?: File) => {
        if (!file) return;
        const assertSession = captureSession();
        const revision = editorRevision.current;
        const kind = formKind;
        if (kind === "video" || kind === "audio") {
            const media = await uploadMediaFile(file, kind);
            assertSession();
            if (revision !== editorRevision.current || form.getValues("kind") !== kind) return;
            setMediaDraft(media);
            if (!form.getValues("title")) form.setValue("title", file.name, { shouldDirty: true });
            return;
        }
        if (!file.type.startsWith("image/")) return;
        const image = await uploadImage(file);
        assertSession();
        if (revision !== editorRevision.current || form.getValues("kind") !== kind) return;
        const draft = { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType };
        setImageDraft(draft);
        if (!form.getValues("title")) form.setValue("title", file.name, { shouldDirty: true });
    };

    const copyAssetText = async (asset: Asset) => {
        if (asset.kind !== "text") return;
        copyText(asset.data.content, t("assets.textCopied"));
    };

    const downloadImage = async (asset: Asset) => {
        if (asset.kind === "text") return;
        try {
            const blob = await readAssetMediaBlob(asset);
            if (!blob) {
                notify.error(t("assets.downloadFailed"));
                return;
            }
            const ext = asset.data.mimeType?.split("/")[1]?.split("+")[0] || (asset.kind === "audio" ? "mp3" : asset.kind === "video" ? "mp4" : "png");
            saveAs(blob, `${asset.title || "asset"}.${ext}`);
        } catch {
            notify.error(t("assets.downloadFailed"));
        }
    };

    const confirmDelete = async () => {
        if (!deletingAsset || deleteRef.current) return;
        deleteRef.current = true;
        try { const state = await removeAsset(deletingAsset.id); if (state === "deleted") notify.success(t("assets.deleted")); else notify.info(t("assets.deletionQueued")); setDeletingAsset(null); }
        finally { deleteRef.current = false; }
    };

    const assetContent = <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {visibleAssets.map((asset) => <AssetCard key={asset.id} asset={asset} onOpen={() => setPreviewAsset(asset)} onEdit={() => openEdit(asset)} onCopy={copyAssetText} onDownload={downloadImage} onDelete={() => setDeletingAsset(asset)} />)}
        </div>
        {!hydrated ? <div className="flex justify-center py-20"><Spinner /></div> : !visibleAssets.length && !assetError ? <Empty description={t("assets.empty")} className="py-20" /> : null}
    </div>;

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
            <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:py-8">
                <div className="mx-auto max-w-7xl">
                    {assetError ? <Alert type="error" className="mb-4" title={assetError} action={<Button onClick={() => void useAssetStore.getState().loadAssets()}>{appI18n.t("workspace.retryRead")}</Button>} /> : null}
                    {deleting.map((asset) => <Alert key={asset.id} type="warning" className="mb-3" title={t("workspace.assetDeletionPending", { title: asset.title })} description={asset.error || appI18n.t("workspace.originalCleanupPending")} action={<div className="flex shrink-0 flex-col gap-2 sm:flex-row">{asset.cleanupTaskId ? <Button asChild variant="outline"><Link to={`/settings/tasks?taskId=${encodeURIComponent(asset.cleanupTaskId)}`}>{t("workspace.viewBlockingTask")}</Link></Button> : null}<Button variant="outline" onClick={() => { void retryAssetCleanup(asset.id).then(() => useAssetStore.getState().loadAssets()).catch((error: unknown) => notify.error(error instanceof Error ? error.message : appI18n.t("workspace.cleanupFailed"))); }}>{appI18n.t("workspace.retryCleanup")}</Button></div>} />)}
                    <PageHeader className="mb-4" title={t("assets.title")} actions={<>
                        <SearchInput className="w-full sm:w-72" value={keyword} aria-label={t("assets.search")} placeholder={t("assets.search")} onChange={(event) => { setPage(1); setKeyword(event.target.value); }} />
                        <Button variant="default" icon={<Plus />} disabled={!hydrated} onClick={openCreate}>{t("assets.add")}</Button>
                    </>} />
                    <Tabs.Root value={kindFilter} onValueChange={(value) => { setPage(1); setKindFilter(value as AssetKind | "all"); }} className="min-w-0">
                        <div className="thin-scrollbar mb-4 overflow-x-auto overflow-y-hidden pb-2">
                            <Tabs.List aria-label={t("assets.browseByType")} className="inline-flex w-max items-center gap-1 rounded-xl border border-border bg-card p-1">
                                {kindOptions.map(({ key, icon: Icon }) => <Tabs.Trigger key={key} value={key} className="inline-flex h-8 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-accent data-[state=active]:text-card-foreground data-[state=active]:shadow-sm"><Icon className="size-4 text-foreground" />{t(key === "all" ? "common.all" : `assets.kinds.${key}`)}</Tabs.Trigger>)}
                            </Tabs.List>
                        </div>
                        {kindOptions.map(({ key }) => <AssetTabPanel key={key} value={key} active={key === kindFilter}>{key === kindFilter ? assetContent : null}</AssetTabPanel>)}
                    </Tabs.Root>
                    {hydrated && !assetError ? <Pagination className="mt-5" current={page} pageSize={pageSize} total={filteredAssets.length} onChange={setPage} onPageSizeChange={(size) => { setPage(1); setPageSize(size); }} /> : null}
                </div>
            </main>

            <Dialog title={editingAsset ? t("assets.edit") : t("assets.add")} open={isAssetOpen} width={980} onClose={closeEditor} onConfirm={saveAsset} busy={saving} confirmText={t("common.save")} cancelText={t("common.cancel")}>
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <EditorForm form={form}>
                        <Field name="kind" label={t("assets.type")}>
                            <Choice
                                disabled={Boolean(editingAsset)}
                                options={[
                                    { label: t("assets.kinds.text"), value: "text" },
                                    { label: t("assets.kinds.image"), value: "image" },
                                    { label: t("assets.kinds.video"), value: "video" },
                                    { label: t("assets.kinds.audio"), value: "audio" },
                                ]}
                                onChange={(value) => { editorRevision.current++; setFormKind(value); setImageDraft(null); setMediaDraft(null); }}
                            />
                        </Field>
                        <Field name="title" label={t("assets.fields.title")} schema={z.string().trim().min(1, t("assets.fields.titleRequired"))}>
                            <Input size="large" placeholder={t("assets.fields.titlePlaceholder")} />
                        </Field>
                        <Field name="note" label={t("assets.fields.note")}>
                            <Input placeholder={t("assets.fields.optional")} />
                        </Field>
                        {formKind === "text" ? (
                            <Field name="content" label={t("assets.fields.textContent")} schema={z.string().trim().min(1, t("assets.fields.textRequired"))}>
                                <Textarea rows={8} placeholder={t("assets.fields.textPlaceholder")} />
                            </Field>
                        ) : (
                            <Field label={t("workspace.originalFile", { kind: t(`assets.kinds.${formKind}`) })}>
                                <div className="rounded-lg border border-dashed border-border p-4 ">
                                    <Button disabled={Boolean(editingAsset)} icon={<Upload className="size-4" />} onClick={() => imageInputRef.current?.click()}>
                                        {formKind === "image" ? t("assets.selectImageFile") : t("workspace.chooseFile", { kind: t(`assets.kinds.${formKind}`) })}
                                    </Button>
                                    {editingAsset ? <p className="mt-2 text-xs text-muted-foreground">{appI18n.t("workspace.originalUnchanged")}</p> : null}
                                    {formKind === "image" && imageDraft ? (
                                        <span data-secondary className="ml-3 text-xs">
                                            {imageDraft.width}x{imageDraft.height} · {formatBytes(imageDraft.bytes)}
                                        </span>
                                    ) : mediaDraft ? <span data-secondary className="ml-3 text-xs">{formatBytes(mediaDraft.bytes)} · {mediaDraft.mimeType}</span> : !editingAsset ? (
                                        <span data-secondary className="ml-3 text-xs">
                                            {t("ui.noFileSelected")}
                                        </span>
                                    ) : null}
                                </div>
                            </Field>
                        )}
                    </EditorForm>
                    <div className="min-w-0 space-y-3 self-start">
                        <h3 className="text-sm font-medium">{t("assets.preview")}</h3>
                        <div className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground">
                            {formKind === "image" && imageDraft ? (
                                <img src={imageDraft.dataUrl} alt={title} className="max-h-[50dvh] w-full object-contain" />
                            ) : formKind === "video" && mediaPreview ? (
                                <video key={mediaPreview.url} src={mediaPreview.url} controls playsInline preload="metadata" aria-label={title || t("assets.kinds.video")} className="max-h-[50dvh] w-full bg-muted object-contain" />
                            ) : formKind === "audio" && mediaPreview ? (
                                <audio key={mediaPreview.url} src={mediaPreview.url} controls preload="metadata" aria-label={title || t("assets.kinds.audio")} className="w-full p-3" />
                            ) : (
                                <div className="thin-scrollbar max-h-[50dvh] min-h-32 overflow-y-auto whitespace-pre-wrap break-words p-4 text-sm leading-6 text-muted-foreground">{formKind === "text" ? content || t("assets.fields.textPlaceholder") : t("ui.noFileSelected")}</div>
                            )}
                            <div className="flex items-center justify-between gap-2 p-3">
                                <span className="truncate text-sm font-medium">
                                    {title || t("assets.untitled")}
                                </span>
                                <Tag className="shrink-0 text-xs">{t(`assets.kinds.${formKind}`)}</Tag>
                            </div>
                        </div>
                    </div>
                </div>
                <input
                    ref={imageInputRef}
                    type="file"
                    accept={formKind === "video" ? "video/*" : formKind === "audio" ? "audio/*" : "image/*"}
                    className="hidden"
                    onChange={(event) => {
                        void readImageFile(event.target.files?.[0]).catch((error: unknown) => notify.error(error instanceof Error ? error.message : appI18n.t("workspace.uploadFailed")));
                        event.target.value = "";
                    }}
                />
            </Dialog>

            <AssetDrawer asset={previewAsset ? assets.find((asset) => asset.id === previewAsset.id) || null : null} onClose={() => setPreviewAsset(null)} onCopy={copyAssetText} onDownload={downloadImage} />

            <AlertDialog title={t("assets.deleteTitle")} description={t("workspace.deleteAssetDescription", { title: deletingAsset?.title })} open={Boolean(deletingAsset)} onClose={() => setDeletingAsset(null)} onConfirm={confirmDelete} confirmText={t("common.delete")} destructive />
        </div>
    );
}

function AssetTabPanel({ value, active, children }: { value: AssetKind | "all"; active: boolean; children: ReactNode }) {
    const [content, setContent] = useState(children);
    // Keep the outgoing assets visible until the tab's exit animation finishes.
    if (active && content !== children) setContent(children);
    return <Tabs.Content value={value} className="outline-none focus-visible:ring-2 focus-visible:ring-ring">{active ? children : content}</Tabs.Content>;
}

function AssetCard({ asset, onOpen, onEdit, onCopy, onDownload, onDelete }: { asset: Asset; onOpen: () => void; onEdit: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void; onDelete: () => void }) {
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const cover = asset.kind === "audio" ? "" : assetCoverUrl(asset);
    return (
        <article className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground transition-colors hover:border-foreground/25">
            <button type="button" className="block w-full shrink-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" aria-label={t("assets.previewNamed", { name: asset.title })} onClick={onOpen}>
                {cover ? (
                    <img src={cover} alt={asset.title} loading="lazy" className={`aspect-[4/3] w-full ${asset.kind === "image" && asset.data.mimeType === "image/svg+xml" ? "object-contain" : "object-cover"}`} />
                ) : (
                    <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-card p-4 text-center text-sm leading-6 text-muted-foreground">{asset.kind === "audio" ? <Music2 aria-hidden="true" className="size-10 text-foreground" /> : <span className="line-clamp-5 break-words">{asset.kind === "text" ? asset.data.content : t("assets.noCover")}</span>}</div>
                )}
            </button>
            <AssetInfo asset={asset} onOpen={onOpen} action={<Menu placement="topRight" items={[
                { key: "use", label: t(asset.kind === "text" ? "common.copy" : "common.download"), icon: asset.kind === "text" ? <Copy /> : <Download />, onClick: () => asset.kind === "text" ? onCopy(asset) : onDownload(asset) },
                { key: "edit", label: t("common.edit"), icon: <PencilLine />, onClick: onEdit },
                { key: "delete", label: t("common.delete"), icon: <Trash2 />, danger: true, onClick: onDelete },
            ]}><Button variant="ghost" size="icon" className="size-7" title={t("ui.moreActions")} aria-label={t("ui.moreActions")}><Ellipsis /></Button></Menu>} />
        </article>
    );
}

function AssetInfo({ asset, onOpen, action }: { asset: Asset; onOpen: () => void; action: ReactNode }) {
    const { t } = useTranslation();
    return <div className="p-3">
        <div className="flex min-w-0 items-center justify-between gap-2">
            <button type="button" className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onOpen}><h2 className="truncate text-sm font-medium">{asset.title}</h2></button>
            <Tag className="shrink-0 text-xs">{t(`assets.kinds.${asset.kind}`)}</Tag>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="truncate text-xs leading-5 text-muted-foreground">{assetSummary(asset)}</span>
            {action}
        </div>
    </div>;
}

function AssetDrawer({ asset, onClose, onCopy, onDownload }: { asset: Asset | null; onClose: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void }) {
    const { t } = useTranslation();
    return (
        <Sheet title={t("assets.details")} open={Boolean(asset)} width={640} onClose={onClose}>
            {asset ? (
                <div className="w-full min-w-0 space-y-3">
                    {asset.kind === "image" ? (
                        <MediaPreview src={asset.data.dataUrl} alt={asset.title} className="max-h-[60dvh] w-full rounded-xl object-contain" />
                    ) : asset.kind === "video" ? (
                        <video key={asset.id} src={asset.data.url} controls playsInline preload="metadata" aria-label={asset.title} className="block max-h-[60dvh] w-full rounded-xl bg-muted object-contain" />
                    ) : asset.kind === "audio" ? (
                        <audio key={asset.id} src={asset.data.url} controls preload="metadata" aria-label={asset.title} className="block w-full min-w-0 max-w-full [&::-webkit-media-controls-enclosure]:w-full [&::-webkit-media-controls-enclosure]:max-w-none" />
                    ) : <div className="thin-scrollbar max-h-[60dvh] overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-muted p-4 text-sm leading-6">{asset.data.content}</div>}
                    <div className="space-y-1">
                        <div className="flex min-w-0 items-start justify-between gap-3">
                            <h3 className="min-w-0 flex-1 break-words text-lg font-medium leading-6">{asset.title}</h3>
                            <Tag className="mt-0.5 shrink-0 text-xs">{t(`assets.kinds.${asset.kind}`)}</Tag>
                        </div>
                        <p className="text-xs leading-5 text-muted-foreground">{assetSummary(asset)}</p>
                        <div className="flex items-center justify-between gap-3">
                            <AssetStorageStatus key={asset.id} asset={asset} />
                            <Button variant="ghost" size="icon" title={t(asset.kind === "text" ? "common.copy" : "assets.storageStatus.download")} aria-label={t(asset.kind === "text" ? "common.copy" : "assets.storageStatus.download")} onClick={() => asset.kind === "text" ? onCopy(asset) : onDownload(asset)}>{asset.kind === "text" ? <Copy /> : <Download />}</Button>
                        </div>
                    </div>
                    {asset.error ? <p role="alert" className="break-words text-xs leading-5 text-destructive">{asset.error}</p> : null}
                    {asset.note ? <p className="whitespace-pre-wrap break-words text-xs leading-5"><span className="text-muted-foreground">{t("assets.fields.note")}：</span>{asset.note}</p> : null}
                </div>
            ) : null}
        </Sheet>
    );
}

function AssetStorageStatus({ asset }: { asset: Asset }) {
    const { t } = useTranslation();
    const { notify } = useFeedback();
    const [submitting, setSubmitting] = useState(false);
    const submittingRef = useRef(false);
    const saved = asset.saveState === "saved";
    const saving = asset.saveState === "saving";
    const SaveIcon = saved ? asset.kind === "text" ? Database : HardDrive : saving ? LoaderCircle : CircleAlert;
    const saveLabel = t(`assets.storageStatus.${saved ? asset.kind === "text" ? "textSaved" : "serverSaved" : saving ? "serverSaving" : asset.saveState === "failed" ? "serverSaveFailed" : "serverSaveUnknown"}`);
    const cloudState = asset.kind === "text" ? "notApplicable" : !saved ? "needsSave" : submitting ? "submitting" : asset.syncState || "local";
    const cloudStatuses = {
        notApplicable: { Icon: CloudOff, label: "cloudNotApplicable", className: "text-muted-foreground" },
        needsSave: { Icon: CloudOff, label: "cloudNeedsSave", className: "text-muted-foreground" },
        local: { Icon: CloudUpload, label: "cloudLocal", className: "text-muted-foreground" },
        submitting: { Icon: LoaderCircle, label: "cloudSubmitting", className: "text-info hover:text-info [&_svg]:animate-spin motion-reduce:[&_svg]:animate-none" },
        pending: { Icon: Clock3, label: "cloudPending", className: "text-info hover:text-info" },
        syncing: { Icon: LoaderCircle, label: "cloudSyncing", className: "text-info hover:text-info [&_svg]:animate-spin motion-reduce:[&_svg]:animate-none" },
        synced: { Icon: CloudCheck, label: "cloudSynced", className: "text-success hover:text-success" },
        failed: { Icon: CloudAlert, label: "cloudFailed", className: "text-destructive hover:text-destructive" },
    };
    const cloudStatus = cloudStatuses[cloudState as keyof typeof cloudStatuses] || { Icon: CloudOff, label: "cloudUnknown", className: "text-muted-foreground" };
    const cloudLabel = t(`assets.storageStatus.${cloudStatus.label}`);
    const canSync = cloudState === "local" || cloudState === "failed";
    const sync = async () => {
        if (!canSync || submittingRef.current) return;
        const assertSession = captureSession();
        submittingRef.current = true; setSubmitting(true);
        try {
            await retryAssetSync(asset.id); assertSession();
            await useAssetStore.getState().loadAssets(); assertSession();
            const state = useAssetStore.getState();
            if (state.error) throw new Error(state.error);
            const current = state.assets.find((item) => item.id === asset.id);
            if (current?.syncState === "local") notify.warning(t("assets.storageStatus.cloudUnavailable"));
            else if (current?.syncState === "synced") notify.success(t("assets.storageStatus.cloudSynced"));
            else if (current?.syncState === "failed") notify.error(t("assets.storageStatus.cloudFailed"));
        } catch (error) { notify.error(error instanceof Error ? error.message : t("workspace.operationFailed")); }
        finally { submittingRef.current = false; setSubmitting(false); }
    };
    return <div className="flex items-center gap-1">
        <Tooltip title={saveLabel} clickable><Button variant="ghost" size="icon" aria-label={saveLabel} aria-busy={saving || undefined} className={saved ? "text-success hover:text-success" : saving ? "text-info hover:text-info [&_svg]:animate-spin motion-reduce:[&_svg]:animate-none" : "text-destructive hover:text-destructive"}><SaveIcon /></Button></Tooltip>
        <Button variant="ghost" size="icon" title={cloudLabel} aria-label={cloudLabel} aria-disabled={!canSync || undefined} aria-busy={submitting || cloudState === "syncing" || undefined} className={cloudStatus.className} onClick={() => void sync()}><cloudStatus.Icon /></Button>
    </div>;
}

async function readAssetMediaBlob(asset: Exclude<Asset, { kind: "text" }>) {
    const storageKey = asset.data.storageKey;
    if (storageKey) {
        const stored = asset.kind === "image" ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
        if (stored) return stored;
    }
    const url = asset.kind === "image" ? asset.data.dataUrl || asset.coverUrl : asset.data.url;
    if (!url) return null;
    const response = await fetch(url);
    return response.ok ? response.blob() : null;
}

function assetSummary(asset: Asset) {
    if (asset.kind === "text") return appI18n.t("assets.characterCount", { count: asset.data.content.length });
    return [
        asset.kind !== "audio" && asset.data.width > 0 && asset.data.height > 0 ? formatRatio(asset.data.width, asset.data.height) : "",
        formatBytes(asset.data.bytes),
        asset.kind !== "image" && asset.data.durationMs && asset.data.durationMs > 0 ? formatDuration(asset.data.durationMs) : "",
    ].filter(Boolean).join(" · ") || "—";
}

function assetSearchText(asset: Asset) {
    return [asset.title, asset.source || "", asset.note || "", asset.kind === "text" ? asset.data.content : asset.data.mimeType].join(" ").toLowerCase();
}
