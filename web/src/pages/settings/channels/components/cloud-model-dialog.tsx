import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { Badge, EmptyState, Notice, Spinner } from "@/components/ui/display";
import { Field } from "@/components/ui/form";
import { SearchInput } from "@/components/ui/input";
import { captureSession } from "@/services/api/client";
import { discoverModels } from "@/services/api/channels";

export function CloudModelDialog({ open, channelId, existing, pending, onClose, onSelect }: { open: boolean; channelId: string; existing: Set<string>; pending: Set<string>; onClose: () => void; onSelect: (models: string[]) => void }) {
    const { t } = useTranslation();
    const [search, setSearch] = useState("");
    const [selected, setSelected] = useState<string[]>([]);
    const query = useQuery({
        queryKey: ["channel-remote-models", channelId],
        enabled: open,
        staleTime: 0,
        queryFn: async () => {
            const assertSession = captureSession();
            const models = await discoverModels(channelId);
            assertSession();
            return [...new Set(models.map((id) => id.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
        },
    });
    useEffect(() => { if (open) { setSearch(""); setSelected([]); } }, [open]);
    const ids = query.data || [];
    const visible = ids.filter((id) => id.toLowerCase().includes(search.trim().toLowerCase()));
    const available = visible.filter((id) => !existing.has(id) && !pending.has(id));
    const selectedIDs = new Set(selected);
    const chosen = ids.filter((id) => selectedIDs.has(id) && !existing.has(id) && !pending.has(id));
    const confirm = () => {
        onSelect(chosen);
        setSelected([]);
        onClose();
    };
    return <Dialog open={open} title={t("modelScripts.remoteModels")} onClose={onClose} width={720} dirty={chosen.length > 0} secondaryAction={null} confirmText={t("ui.confirm")} confirmDisabled={!chosen.length || query.isFetching || Boolean(query.error)} onConfirm={confirm} footerStart={<span className="text-sm" aria-live="polite">{t("ui.selectedCount", { count: chosen.length })}</span>}>
        <div className="space-y-4">
            <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("workspace.searchModels")} aria-label={t("workspace.searchModels")} />
            {query.isFetching ? <div className="flex justify-center py-8"><Spinner label={t("settings.loading")} /></div> : null}
            {query.error ? <Notice type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>{t("workspace.retry")}</Button>} /> : null}
            {!query.isFetching && !query.error ? <Field label={t("modelScripts.remoteResults", { count: ids.length })} help={t("modelScripts.remoteHint")}>
                <div className="space-y-3">
                    {available.length ? <div className="flex justify-end"><Button onClick={() => setSelected((current) => [...new Set([...current, ...available])])}>{t("ui.selectFiltered")}</Button></div> : null}
                    {visible.length ? <div role="group" aria-label={t("modelScripts.remoteModels")} className="thin-scrollbar grid max-h-[50dvh] gap-2 overflow-y-auto p-0.5 sm:grid-cols-2">
                        {visible.map((id) => {
                            const added = existing.has(id), staged = pending.has(id), checked = added || staged || selectedIDs.has(id);
                            return <Checkbox key={id} checked={checked} disabled={added || staged} onChange={({ target }) => setSelected((current) => target.checked ? [...current, id] : current.filter((value) => value !== id))} className={`min-w-0 rounded-lg border px-3 py-3 hover:bg-accent ${checked ? "border-foreground/30 bg-accent" : "border-border bg-card"}`}>
                                <span className="min-w-0 flex-1 break-all text-sm">{id}</span>
                                {added || staged ? <Badge className="shrink-0">{t(added ? "modelScripts.alreadyAdded" : "modelScripts.pendingSelection")}</Badge> : null}
                            </Checkbox>;
                        })}
                    </div> : <EmptyState description={t(ids.length ? "workspace.noMatchingModels" : "modelScripts.remoteEmpty")} />}
                </div>
            </Field> : null}
        </div>
    </Dialog>;
}
