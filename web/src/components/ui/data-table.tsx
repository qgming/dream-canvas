import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Spinner, EmptyState } from "./display";
import { Button } from "./button";

export type Column<T> = { title: ReactNode; dataIndex?: keyof T; key?: string; width?: number; align?: "left" | "center" | "right"; render?: (value: any, record: T, index: number) => ReactNode };
export function DataTable<T extends object>({ columns, rows = [], rowId, loading, failed, compact, pageSize, empty, className }: { columns: Column<T>[]; rows?: T[]; rowId: keyof T | ((record: T) => string); loading?: boolean; failed?: boolean; compact?: boolean; pageSize?: number; empty?: ReactNode; className?: string }) {
    const [page, setPage] = useState(1);
    const current = Math.min(page, Math.max(1, Math.ceil(rows.length / (pageSize || rows.length || 1))));
    const records = pageSize ? rows.slice((current - 1) * pageSize, current * pageSize) : rows;
    return <div aria-busy={loading || undefined} className={cn("overflow-hidden rounded-xl border border-border", className)}><div className="overflow-x-auto"><table className="w-full border-collapse text-left text-sm"><thead className="bg-muted/50 text-muted-foreground"><tr>{columns.map((column, index) => <th scope="col" key={column.key ?? index} style={{ width: column.width, textAlign: column.align }} className="whitespace-nowrap px-4 py-3 text-xs font-medium">{column.title}</th>)}</tr></thead><tbody>{records.map((record, index) => <tr key={String(typeof rowId === "function" ? rowId(record) : record[rowId])} className="border-t border-border transition-colors hover:bg-accent/50">{columns.map((column, cell) => <td key={column.key ?? cell} style={{ textAlign: column.align }} className={cn("px-4 py-3 align-middle", compact && "py-2")}>{column.render ? column.render(column.dataIndex ? record[column.dataIndex] : undefined, record, index) : column.dataIndex ? record[column.dataIndex] as ReactNode : null}</td>)}</tr>)}</tbody></table></div>{loading ? <div className="flex min-h-24 items-center justify-center"><Spinner /></div> : !rows.length && !failed ? empty ?? <EmptyState /> : null}{pageSize && rows.length > pageSize ? <div className="border-t border-border p-3"><Pagination current={current} pageSize={pageSize} total={rows.length} onChange={setPage} /></div> : null}</div>;
}

export function Pagination({ current = 1, pageSize = 10, total, onChange, onPageSizeChange, className }: { current?: number; pageSize?: number; total: number; onChange?: (page: number, size: number) => void; onPageSizeChange?: (size: number) => void; className?: string }) {
    const { t } = useTranslation();
    const pages = Math.max(1, Math.ceil(total / pageSize));
    return <div className={cn("flex flex-wrap items-center justify-end gap-3 text-xs text-muted-foreground", className)}><span>{t("ui.pagination", { current, pages, total })}</span>{onPageSizeChange ? <select aria-label={t("ui.pageSize")} value={pageSize} onChange={(event) => { const size = Number(event.target.value); onPageSizeChange(size); onChange?.(1, size); }} className="h-7 rounded-md border border-input bg-background px-2">{Array.from(new Set([pageSize, 10, 20, 50])).sort((a, b) => a - b).map((size) => <option key={size}>{size}</option>)}</select> : null}<Button size="icon" variant="ghost" disabled={current <= 1} onClick={() => onChange?.(current - 1, pageSize)} aria-label={t("ui.previous")}><ChevronLeft /></Button><Button size="icon" variant="ghost" disabled={current >= pages} onClick={() => onChange?.(current + 1, pageSize)} aria-label={t("ui.next")}><ChevronRight /></Button></div>;
}

export function Details({ items }: { items: { key: string; label: ReactNode; children: ReactNode }[] }) { return <dl className="divide-y divide-border">{items.map((item) => <div key={item.key} className="grid grid-cols-[120px_minmax(0,1fr)] gap-4 py-3 text-sm"><dt className="text-muted-foreground">{item.label}</dt><dd className="min-w-0 break-words">{item.children}</dd></div>)}</dl>; }
