import { Ellipsis, ImageIcon, Plus, Trash2, Video } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/display";
import { Menu, Tooltip } from "@/components/ui/popover";
import { previewUrlFor } from "@/services/image-storage";
import { cn } from "@/lib/utils";

type HistoryRecord = {
    id: string;
    title: string;
    status: string;
    images?: { storageKey?: string; dataUrl: string }[];
    video?: { storageKey: string };
};

export function WorkbenchHistory<T extends HistoryRecord>({ kind, logs, unavailable, activeLogId, onCreateSession, onDeleteLog, onPreviewLog }: {
    kind: "image" | "video";
    logs: T[];
    unavailable?: boolean;
    activeLogId?: string;
    onCreateSession: () => void;
    onDeleteLog: (log: T) => void;
    onPreviewLog: (log: T) => void;
}) {
    const { t } = useTranslation();
    return <>
        <div className="sticky top-0 z-10 mb-3 flex items-center justify-between gap-2 bg-sidebar pb-2">
            <div className="flex min-w-0 items-center gap-2">
                <h2 className="truncate text-base font-semibold">{t("workbench.logs")}</h2>
                <Badge className="shrink-0">{logs.length}</Badge>
            </div>
            <Tooltip title={t("workbench.new")}>
                <Button variant="outline" size="icon" className="size-7" icon={<Plus />} aria-label={t("workbench.new")} onClick={onCreateSession} />
            </Tooltip>
        </div>
        <div className="space-y-3">
            {logs.map((log) => <HistoryCard key={log.id} kind={kind} log={log} active={activeLogId === log.id} onPreview={() => onPreviewLog(log)} onDelete={() => onDeleteLog(log)} />)}
            {!logs.length && !unavailable ? <div className="flex min-h-40 items-center justify-center text-center text-sm text-muted-foreground">{t("workbench.noLogs")}</div> : null}
        </div>
    </>;
}

function HistoryCard({ kind, log, active, onPreview, onDelete }: { kind: "image" | "video"; log: HistoryRecord; active: boolean; onPreview: () => void; onDelete: () => void }) {
    const { t } = useTranslation();
    const image = log.images?.find((item) => item.storageKey || item.dataUrl);
    const preview = kind === "video" ? previewUrlFor(log.video?.storageKey) : previewUrlFor(image?.storageKey) || image?.dataUrl;
    const [coverErrors, setCoverErrors] = useState(0);
    const cover = coverErrors === 1 && kind === "image" ? image?.dataUrl : preview;
    useEffect(() => setCoverErrors(0), [preview]);
    const status = log.status === "confirmation_required" ? "workspace.confirmationRequired" : log.status === "disconnected" ? "workspace.progressDisconnected" : log.status === "pending" ? "workbench.generating" : log.status === "failed" ? "workbench.failed" : "workspace.assetUnavailable";
    const Icon = kind === "video" ? Video : ImageIcon;

    return <div className={cn("group relative rounded-lg border border-border bg-card", active && "ring-2 ring-ring ring-offset-2 ring-offset-sidebar")}>
        <Tooltip title={log.title}><button type="button" className="relative block aspect-[4/3] w-full overflow-hidden rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" onClick={onPreview} aria-label={log.title} aria-pressed={active}>
            {cover && coverErrors < (kind === "image" ? 2 : 1) ? <img src={cover} alt={log.title} loading="lazy" className="absolute inset-0 size-full object-cover" onError={() => setCoverErrors((value) => value + 1)} /> : <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-xs text-muted-foreground"><Icon className="size-6 text-foreground" /><span>{t(status)}</span></div>}
        </button></Tooltip>
        <div className="absolute bottom-2 right-2">
            <Menu placement="bottomRight" items={[{ key: "delete", label: t("common.delete"), icon: <Trash2 />, danger: true, onClick: onDelete }]}>
                <Button variant="ghost" size="icon" className="pointer-events-none size-7 bg-popover text-popover-foreground opacity-0 hover:bg-accent group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100" icon={<Ellipsis />} aria-label={t("ui.moreActions")} />
            </Menu>
        </div>
    </div>;
}
