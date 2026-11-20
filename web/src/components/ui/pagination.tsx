import { Fragment } from "react";
import * as PaginationPrimitive from "@animate-ui/react/primitives/pagination";
import { ChevronLeft, ChevronRight, Ellipsis } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

export function Pagination({ current, pageSize, total, onChange, onPageSizeChange, className }: { current: number; pageSize: number; total: number; onChange: (page: number) => void; onPageSizeChange?: (size: number) => void; className?: string }) {
    const { t } = useTranslation();
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const start = Math.min(Math.max(current - 1, 2), pages - 3);
    const numbers = pages <= 7 ? Array.from({ length: pages }, (_, index) => index + 1) : [1, start, start + 1, start + 2, pages];
    const linkClass = "size-7 p-0 text-xs tabular-nums sm:size-8 sm:text-sm data-[active=true]:bg-card data-[active=true]:text-card-foreground";
    return <div className={cn("flex justify-center", className)}>
        <PaginationPrimitive.Root data-slot="pagination" aria-label={t("ui.paginationNavigation")} className="flex max-w-full justify-center">
            <ul data-slot="pagination-content" className="flex items-center gap-0.5 sm:gap-1">
                <li><Button data-slot="pagination-link" variant="ghost" size="icon" className={linkClass} disabled={current <= 1} onClick={() => onChange(current - 1)} aria-label={t("ui.previous")} title={t("ui.previous")}><ChevronLeft /></Button></li>
                {numbers.map((number, index) => <Fragment key={number}>
                    {index > 0 && number - numbers[index - 1] > 1 ? <li className="hidden sm:list-item"><span data-slot="pagination-ellipsis" aria-hidden="true" className="flex size-8 items-center justify-center text-muted-foreground"><Ellipsis className="size-4" /></span></li> : null}
                    <li className={number === current ? undefined : "hidden sm:list-item"}><Button data-slot="pagination-link" variant={number === current ? "outline" : "ghost"} aria-current={number === current ? "page" : undefined} data-active={number === current || undefined} className={linkClass} onClick={() => onChange(number)} aria-label={t("ui.pageNumber", { page: number })}>{number}</Button></li>
                </Fragment>)}
                {onPageSizeChange ? <li className="mx-1">
                    <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
                        <SelectTrigger className="h-8 w-auto gap-1.5 border-transparent px-2 text-xs" aria-label={t("ui.pageSize")}><SelectValue /></SelectTrigger>
                        <SelectContent>{[20, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{t("ui.itemsPerPage", { count: size })}</SelectItem>)}</SelectContent>
                    </Select>
                </li> : null}
                <li><Button data-slot="pagination-link" variant="ghost" size="icon" className={linkClass} disabled={current >= pages} onClick={() => onChange(current + 1)} aria-label={t("ui.next")} title={t("ui.next")}><ChevronRight /></Button></li>
            </ul>
        </PaginationPrimitive.Root>
    </div>;
}
