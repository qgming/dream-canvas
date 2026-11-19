import appI18n from "@/i18n";
import { AudioLines, Clapperboard, Copy, Download, FileText, Image as ImageIcon, LayoutGrid, PencilLine, Trash2, Upload, Ellipsis } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Tabs } from "@animate-ui/react/primitives/radix-ui";
import { useQuery } from "@tanstack/react-query";
import { Notice as Alert, Spinner } from "@/components/ui/display";
import { useFeedback } from "@/hooks/use-feedback";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/popover";
import { PageHeader } from "@/components/layout/page-header";
import { Sheet } from "@/components/ui/dialog";
import { EmptyState as Empty } from "@/components/ui/display";
import { EditorForm, Field, useEditorForm, useWatch, validateForm } from "@/components/ui/form";
import { z } from "zod";
import { MediaPreview } from "@/components/ui/media-preview";
import { Input, Textarea, SearchInput } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Pagination } from "@/components/ui/pagination";
import { Choice } from "@/components/ui/choice";
import { Badge as Tag } from "@/components/ui/display";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import { useCopyText } from "@/hooks/use-copy-text";
import { useDiscardChanges } from "@/hooks/use-discard-changes";
import { formatBytes, formatDuration, formatRatio } from "@/lib/image-utils";
import { getMediaBlob, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { getImageBlob, getImagePreviewRevision, subscribeImagePreviews, uploadImage } from "@/services/image-storage";
import { assetCoverUrl, useAssetStore, type Asset, type AssetKind, type ImageAsset } from "@/stores/use-asset-store";
import { exportAssets, readAssetPackage } from "./asset-transfer";
import { retryAssetCleanup, retryAssetSync, listAssetVoices, saveAssetVoice } from "@/services/api/assets";
import { captureSession } from "@/services/api/client";
import { useConfigStore } from "@/stores/use-config-store";
import { AssetFilenameRepair } from "./asset-filename-repair";

type AssetFormValues = {
    kind: AssetKind;
    title: string;
    coverUrl: string;
    source?: string;
    note?: string;
    content?: string;
};

type ImageDraft = ImageAsset["data"] | null;

const kindOptions = [
    { key: "all", icon: LayoutGrid },
    { key: "text", icon: FileText },
    { key: "image", icon: ImageIcon },
    { key: "video", icon: Clapperboard },
    { key: "audio", icon: AudioLines },
] as const;

export default function AssetsPage() {
    const { notify } = useFeedback();
    const { t } = useTranslation();
    const copyText = useCopyText();
    const form = useEditorForm<AssetFormValues>();
    const coverInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const assetInputRef = useRef<HTMLInputElement>(null);
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
    const [pageSize, setPageSize] = useState(10);
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
    const coverUrl = useWatch({ name: "coverUrl", control: form.control }) || "";
    const title = useWatch({ name: "title", control: form.control }) || "";
    const content = useWatch({ name: "content", control: form.control }) || "";
    const validAssets = assets;

    const filteredAssets = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return validAssets.filter((asset) => {
            if (kindFilter !== "all" && asset.kind !== kindFilter) return false;
            if (!query) return true;
            return assetSearchText(asset).includes(query);
        });
    }, [validAssets, keyword, kindFilter]);

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
        form.reset({ kind: "text", title: "", coverUrl: "", source: t("assets.manual"), note: "", content: "" });
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
            coverUrl: asset.coverUrl,
            source: asset.source,
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
            coverUrl: values.coverUrl?.trim() || (values.kind === "image" && imageDraft ? imageDraft.dataUrl : ""),
            source: values.source?.trim(),
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

    const readCoverFile = async (file?: File) => {
        if (!file) return;
        const assertSession = captureSession();
        const revision = editorRevision.current;
        const image = await uploadImage(file);
        assertSession();
        if (revision !== editorRevision.current) return;
        form.setValue("coverUrl", image.url, { shouldDirty: true });
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
        if (!form.getValues("coverUrl")) form.setValue("coverUrl", draft.dataUrl, { shouldDirty: true });
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

    const exportAllAssets = async () => {
        if (!validAssets.length) {
            notify.warning(t("assets.noneToExport"));
            return;
        }
        try { await exportAssets(validAssets, t("assets.packageName")); }
        catch (error) { notify.error(error instanceof Error ? error.message : appI18n.t("workspace.exportAssetsFailed")); }
    };

    const importAssetZip = async (file?: File) => {
        if (!file) return;
        const assertSession = captureSession();
        try {
            const importedAssets = await readAssetPackage(file);
            for (const asset of importedAssets) {
                assertSession();
                const payload = { ...asset } as Record<string, unknown>;
                delete payload.id;
                delete payload.createdAt;
                delete payload.updatedAt;
                await addAsset(payload as Parameters<typeof addAsset>[0]);
            }
            notify.success(t("assets.imported", { count: importedAssets.length }));
        } catch {
            notify.error(t("assets.importFailed"));
        } finally {
            if (assetInputRef.current) assetInputRef.current.value = "";
        }
    };

    const confirmDelete = async () => {
        if (!deletingAsset || deleteRef.current) return;
        deleteRef.current = true;
        try { await removeAsset(deletingAsset.id); notify.success(t("assets.deleted")); setDeletingAsset(null); }
        finally { deleteRef.current = false; }
    };

    const assetContent = <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleAssets.map((asset) => <AssetCard key={asset.id} asset={asset} onOpen={() => setPreviewAsset(asset)} onEdit={() => openEdit(asset)} onCopy={copyAssetText} onDownload={downloadImage} onDelete={() => setDeletingAsset(asset)} />)}
        </div>
        {!hydrated ? <div className="flex justify-center py-20"><Spinner /></div> : !visibleAssets.length && !assetError ? <Empty description={t("assets.empty")} className="py-20" /> : null}
    </div>;

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
            <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:py-8">
                <div className="mx-auto max-w-7xl">
                    {assetError ? <Alert type="error" className="mb-4" title={assetError} action={<Button onClick={() => void useAssetStore.getState().loadAssets()}>{appI18n.t("workspace.retryRead")}</Button>} /> : null}
                    {deleting.map((asset) => <Alert key={asset.id} type="warning" className="mb-3" title={t("workspace.assetDeletionPending", { title: asset.title })} description={asset.error || appI18n.t("workspace.originalCleanupPending")} action={<Button onClick={() => { void retryAssetCleanup(asset.id).then(() => useAssetStore.getState().loadAssets()).catch((error: unknown) => notify.error(error instanceof Error ? error.message : appI18n.t("workspace.cleanupFailed"))); }}>{appI18n.t("workspace.retryCleanup")}</Button>} />)}
                    <PageHeader title={t("assets.title")} description={t("assets.description")} actions={<>
                        <Button variant="ghost" disabled={!hydrated} onClick={() => void exportAllAssets()}>{t("assets.export")}</Button>
                        <Button variant="ghost" onClick={() => assetInputRef.current?.click()}>{t("assets.import")}</Button>
                        <Button variant="default" disabled={!hydrated} onClick={openCreate}>{t("assets.add")}</Button>
                    </>} />
                    <AssetFilenameRepair />
                    <div className="mb-3 mt-6">
                        <SearchInput className="w-full sm:max-w-sm" value={keyword} aria-label={t("assets.search")} placeholder={t("assets.search")} onChange={(event) => { setPage(1); setKeyword(event.target.value); }} />
                    </div>
                    <Tabs.Root value={kindFilter} onValueChange={(value) => { setPage(1); setKindFilter(value as AssetKind | "all"); }} className="min-w-0">
                        <div className="thin-scrollbar mb-4 overflow-x-auto overflow-y-hidden pb-2">
                            <Tabs.List aria-label={t("assets.browseByType")} className="inline-flex w-max items-center gap-1 rounded-xl bg-muted p-1">
                                {kindOptions.map(({ key, icon: Icon }) => <Tabs.Trigger key={key} value={key} className="inline-flex h-8 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-card data-[state=active]:text-card-foreground data-[state=active]:shadow-sm"><Icon className="size-4" />{t(key === "all" ? "common.all" : `assets.kinds.${key}`)}</Tabs.Trigger>)}
                            </Tabs.List>
                        </div>
                        {kindOptions.map(({ key }) => <AssetTabPanel key={key} value={key} active={key === kindFilter}>{key === kindFilter ? assetContent : null}</AssetTabPanel>)}
                    </Tabs.Root>
                    {hydrated && !assetError ? <Pagination className="mt-5" current={page} pageSize={pageSize} total={filteredAssets.length} onChange={setPage} onPageSizeChange={(size) => { setPage(1); setPageSize(size); }} /> : null}
                </div>
            </main>

            <Dialog title={editingAsset ? t("assets.edit") : t("assets.add")} open={isAssetOpen} width={980} onClose={closeEditor} onConfirm={saveAsset} busy={saving} confirmText={t("common.save")} cancelText={t("common.cancel")}>
                <div className="grid gap-6 pt-1 lg:grid-cols-[minmax(0,1fr)_320px]">
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
                        <div className="flex items-end gap-2">
                            <Field name="coverUrl" label={t("assets.fields.coverUrl")} className="min-w-0 flex-1"><Input placeholder={t("assets.fields.coverPlaceholder")} /></Field>
                            <Button icon={<Upload className="size-4" />} onClick={() => coverInputRef.current?.click()}>{t("common.upload")}</Button>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Field name="source" label={t("assets.fields.source")}>
                                <Input placeholder={t("assets.fields.sourcePlaceholder")} />
                            </Field>
                            <Field name="note" label={t("assets.fields.note")}>
                                <Input placeholder={t("assets.fields.optional")} />
                            </Field>
                        </div>
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
                    <div className="rounded-xl border border-border bg-muted p-4  ">
                        <span className="font-medium">{t("assets.preview")}</span>
                        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-background ">
                            {coverUrl || imageDraft?.dataUrl ? (
                                <img src={coverUrl || imageDraft?.dataUrl} alt="" className="aspect-[4/3] w-full object-cover" />
                            ) : (
                                <div className="flex aspect-[4/3] items-center justify-center bg-muted p-5 text-center text-sm text-muted-foreground ">{content || t("assets.noCover")}</div>
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
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readCoverFile(event.target.files?.[0]).catch((error: unknown) => notify.error(error instanceof Error ? error.message : appI18n.t("workspace.uploadFailed")));
                        event.target.value = "";
                    }}
                />
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

            <input ref={assetInputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importAssetZip(event.target.files?.[0])} />

            <Dialog title={t("assets.deleteTitle")} open={Boolean(deletingAsset)} onClose={() => setDeletingAsset(null)} onConfirm={confirmDelete} confirmText={t("common.delete")} destructive cancelText={t("common.cancel")}>
                <p>{t("workspace.deleteAssetDescription", { title: deletingAsset?.title })}</p>
            </Dialog>
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
    const cover = assetCoverUrl(asset);
    const summary = assetSummary(asset);
    return (
        <article className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground transition-colors hover:border-foreground/25">
            <button type="button" className="block w-full shrink-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" aria-label={t("assets.previewNamed", { name: asset.title })} onClick={onOpen}>
                {cover ? (
                    <img src={cover} alt={asset.title} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                ) : (
                    <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted p-4 text-center text-sm leading-6 text-muted-foreground"><span className="line-clamp-5 break-words">{asset.kind === "text" ? asset.data.content : t("assets.noCover")}</span></div>
                )}
            </button>
            <div className="space-y-1 p-3">
                <div className="flex items-center justify-between gap-2">
                    <button type="button" className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onOpen}><h2 className="truncate text-sm font-medium">{asset.title}</h2></button>
                    <Tag className="shrink-0 text-xs">{t(`assets.kinds.${asset.kind}`)}</Tag>
                </div>
                <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate text-xs leading-5 text-muted-foreground">{summary}</span>
                    <Menu placement="topRight" items={[
                        { key: "use", label: t(asset.kind === "text" ? "common.copy" : "common.download"), icon: asset.kind === "text" ? <Copy /> : <Download />, onClick: () => asset.kind === "text" ? onCopy(asset) : onDownload(asset) },
                        { key: "edit", label: t("common.edit"), icon: <PencilLine />, onClick: onEdit },
                        { key: "delete", label: t("common.delete"), icon: <Trash2 />, danger: true, onClick: onDelete },
                    ]}><Button variant="ghost" size="icon" className="size-7" title={t("ui.moreActions")} aria-label={t("ui.moreActions")}><Ellipsis /></Button></Menu>
                </div>
            </div>
        </article>
    );
}

function AssetDrawer({ asset, onClose, onCopy, onDownload }: { asset: Asset | null; onClose: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void }) {
    const { t } = useTranslation();
    const { notify } = useFeedback();
    const [syncing, setSyncing] = useState(false);
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const cover = asset ? asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "") : "";
    return (
        <Sheet title={t("assets.details")} open={Boolean(asset)} width={640} onClose={onClose}>
            {asset ? (
                <div className="space-y-5">
                    {cover ? (
                        <MediaPreview src={assetCoverUrl(asset)} previewSrc={cover} alt={asset.title} className="rounded-lg" />
                    ) : (
                        <div className="rounded-lg border border-border bg-muted p-5 text-sm leading-6 text-muted-foreground   ">{asset.kind === "text" ? asset.data.content : t("assets.noCover")}</div>
                    )}
                    <div>
                        <h3 className="!mb-2">
                            {asset.title}
                        </h3>
                        <div className="flex flex-wrap items-center gap-2">
                            <Tag>{t(`assets.kinds.${asset.kind}`)}</Tag>
                        </div>
                    </div>
                    <p className="text-sm text-muted-foreground">{t("workspace.fileSave")}：{asset.saveState === "saved" ? appI18n.t("workspace.saved") : asset.saveState === "saving" ? appI18n.t("workspace.savingFile") : appI18n.t("workspace.saveFileFailed")} · {t("workspace.cloudSync")}：{asset.syncState === "synced" ? appI18n.t("workspace.synced") : asset.syncState === "syncing" ? appI18n.t("workspace.syncing") : asset.syncState === "failed" ? appI18n.t("workspace.syncFailed") : appI18n.t("workspace.local")}{asset.error ? ` · ${asset.error}` : ""}</p>
                    {asset.kind !== "text" && asset.saveState === "saved" && asset.syncState !== "synced" ? <Button variant="ghost" loading={syncing} onClick={async () => { setSyncing(true); try { await retryAssetSync(asset.id); await useAssetStore.getState().loadAssets(); notify.success(t("storage.syncQueued")); } catch (error) { notify.error(error instanceof Error ? error.message : t("workspace.operationFailed")); } finally { setSyncing(false); } }}>{t("storage.retrySync")}</Button> : null}
                    {asset.kind === "audio" ? <AssetVoiceForm key={asset.id} assetId={asset.id} /> : null}
                    <div className="rounded-lg border border-border p-4 ">
                        <span data-secondary className="block text-xs">
                            {asset.kind === "text" ? t("assets.fields.textContent") : t(`assets.kinds.${asset.kind}`)}
                        </span>
                        {asset.kind === "text" ? (
                            <p className="mt-2 whitespace-pre-wrap">{asset.data.content}</p>
                        ) : asset.kind === "audio" ? (
                            <audio src={asset.data.url} controls preload="none" className="mt-2 w-full" />
                        ) : asset.kind === "video" ? (
                            <video src={asset.data.url} controls preload="none" className="mt-2 aspect-video w-full rounded-lg bg-black" />
                        ) : (
                            <span className="mt-2 block">
                                {asset.data.width}x{asset.data.height} · {formatBytes(asset.data.bytes)} · {asset.data.mimeType}
                            </span>
                        )}
                    </div>
                    {asset.note ? (
                        <div>
                            <span data-secondary>{t("assets.fields.note")}</span>
                            <p className="mt-1">{asset.note}</p>
                        </div>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2">
                        {asset.kind === "text" ? (
                            <Button variant="default" icon={<Copy className="size-4" />} onClick={() => onCopy(asset)}>
                                {t("assets.copyText")}
                            </Button>
                        ) : null}
                        {asset.kind !== "text" ? (
                            <Button variant="default" icon={<Download className="size-4" />} onClick={() => onDownload(asset)}>
                                {asset.kind === "audio" ? appI18n.t("workspace.downloadAudio") : asset.kind === "video" ? t("assets.downloadVideo") : t("assets.downloadImage")}
                            </Button>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </Sheet>
    );
}

function AssetVoiceForm({ assetId }: { assetId: string }) {
    const { t } = useTranslation();
    const channels = useConfigStore((state) => state.config.channels);
    const query = useQuery({ queryKey: ["asset-voices", assetId], queryFn: () => listAssetVoices(assetId) });
    const [channelId, setChannelId] = useState("");
    const form = useEditorForm();
    const changeChannel = useDiscardChanges(form.formState.isDirty, (id: string) => { setChannelId(id); const row = query.data?.find((voice) => voice.channelId === id); form.reset({ voiceId: row?.voiceId || "" }); });
    const row = query.data?.find((voice) => voice.channelId === channelId);
    return <section className="space-y-3">
        <h3 className="text-sm font-medium">{t("execution.voiceAssociation")}</h3>
        <p className="text-xs text-muted-foreground">{t("execution.voiceAssociationHint")}</p>
        {query.error ? <Alert type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>{t("workspace.retry")}</Button>} /> : null}
        <Choice aria-label={t("workspace.channelModel")} disabled={form.formState.isSubmitting} value={channelId || undefined} options={channels.filter((channel) => channel.models.some((model) => model.capability === "audio")).map((channel) => ({ value: channel.id, label: channel.name }))} onChange={changeChannel} />
        {channelId && query.data ? <EditorForm form={form} onSubmit={async (values) => { const assertSession = captureSession(); await saveAssetVoice(assetId, channelId, values.voiceId, row?.version || 0); assertSession(); form.reset(values); await query.refetch(); }}>
            <Field name="voiceId" label={t("execution.voiceId")} schema={z.string().trim().min(1)}><Input /></Field>
            <Button type="submit">{t("workspace.save")}</Button>
        </EditorForm> : null}
    </section>;
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
