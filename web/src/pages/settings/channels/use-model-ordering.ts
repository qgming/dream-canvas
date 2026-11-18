import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getModelOrdering, saveModelOrdering, type ModelOrdering } from "@/services/api/channels";
import { ApiError, captureSession } from "@/services/api/client";
import { useDiscardChanges } from "@/hooks/use-discard-changes";
import { useEditGuard } from "@/hooks/use-edit-guard";

const message = (failure: unknown) => failure instanceof Error ? failure.message : String(failure);
const sameOrder = (left: string[], right: string[]) => left.length === right.length && left.every((id, index) => id === right[index]);

export function useModelOrdering() {
    const client = useQueryClient();
    const query = useQuery({ queryKey: ["model-ordering"], queryFn: getModelOrdering });
    const [ordering, setOrdering] = useState<ModelOrdering>({ version: 0, orders: {} });
    const [unsaved, setUnsaved] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [conflict, setConflict] = useState(false);
    const lastQuery = useRef<ModelOrdering | undefined>(undefined);
    const orderingRef = useRef(ordering);
    const persisted = useRef<Record<string, string[]>>({});
    const saving = useRef(false);
    const dirty = useRef(new Set<string>());
    const apply = useCallback((next: ModelOrdering) => {
        orderingRef.current = next;
        setOrdering(next);
    }, []);

    useEffect(() => {
        if (!query.data || query.data === lastQuery.current || dirty.current.size || saving.current || query.data.version < orderingRef.current.version) return;
        lastQuery.current = query.data;
        persisted.current = query.data.orders;
        apply(query.data);
        setError("");
        setConflict(false);
    }, [query.data, apply]);

    const persist = useCallback(async (version: number, orders: Record<string, string[]>, keys: string[]) => {
        if (saving.current) return false;
        saving.current = true;
        setBusy(true);
        setError("");
        setConflict(false);
        const assertSession = captureSession();
        try {
            const saved = await saveModelOrdering({ version, orders: Object.fromEntries(keys.map((key) => [key, orders[key] || []])) });
            assertSession();
            dirty.current.clear();
            persisted.current = saved.orders;
            setUnsaved(false);
            apply(saved);
            await Promise.all([
                client.invalidateQueries({ queryKey: ["model-catalog"] }),
                client.invalidateQueries({ queryKey: ["model-ordering"] }),
            ]);
            return true;
        } catch (failure) {
            setConflict(failure instanceof ApiError && (failure.code === "version_conflict" || failure.code === "model_ordering_stale"));
            setError(message(failure));
            return false;
        } finally {
            saving.current = false;
            setBusy(false);
        }
    }, [apply, client]);

    const preview = (key: string, ids: string[]) => {
        if (saving.current || query.isLoading) return;
        apply({ ...orderingRef.current, orders: { ...orderingRef.current.orders, [key]: ids } });
        dirty.current.add(key);
        setUnsaved(true);
    };

    const commit = useCallback((key: string) => {
        if (saving.current || query.isLoading) return;
        const ids = orderingRef.current.orders[key] || [];
        if (sameOrder(ids, persisted.current[key] || [])) {
            dirty.current.delete(key);
            if (!dirty.current.size) {
                setUnsaved(false);
                setError("");
                setConflict(false);
            }
            return;
        }
        dirty.current.add(key);
        setUnsaved(true);
        void persist(orderingRef.current.version, orderingRef.current.orders, [...dirty.current]);
    }, [persist, query.isLoading]);

    const reorder = (key: string, ids: string[]) => {
        if (saving.current || query.isLoading) return;
        apply({ ...orderingRef.current, orders: { ...orderingRef.current.orders, [key]: ids } });
        commit(key);
    };

    const retry = async () => {
        if (saving.current) return;
        if (!dirty.current.size) {
            const result = await query.refetch({ throwOnError: true }).catch(() => null);
            if (result?.data && !dirty.current.size && !saving.current && result.data.version >= orderingRef.current.version) {
                persisted.current = result.data.orders;
                apply(result.data);
                setError("");
                setConflict(false);
            }
            return;
        }
        const keys = [...dirty.current];
        if (!conflict) {
            await persist(orderingRef.current.version, orderingRef.current.orders, keys);
            return;
        }
        saving.current = true;
        setBusy(true);
        setError("");
        const assertSession = captureSession();
        try {
            const latest = await getModelOrdering();
            assertSession();
            persisted.current = latest.orders;
            const retained = keys.filter((key) => key in latest.orders);
            if (!retained.length) {
                dirty.current.clear();
                setUnsaved(false);
                apply(latest);
                setConflict(false);
                return;
            }
            const merged = { ...latest.orders };
            retained.forEach((key) => {
                const available = new Set(latest.orders[key] || []);
                merged[key] = (orderingRef.current.orders[key] || []).filter((id) => available.has(id));
            });
            apply({ ...latest, orders: merged });
            saving.current = false;
            await persist(latest.version, merged, retained);
        } catch (failure) {
            setError(message(failure));
        } finally {
            saving.current = false;
            setBusy(false);
        }
    };

    const refresh = async () => {
        if (saving.current || dirty.current.size) return;
        try {
            const latest = await query.refetch({ throwOnError: true });
            if (latest.data && !dirty.current.size && !saving.current && latest.data.version >= orderingRef.current.version) {
                persisted.current = latest.data.orders;
                apply(latest.data);
                setError("");
                setConflict(false);
            }
        } catch (failure) {
            setError(message(failure));
        }
    };

    const reload = async () => {
        if (saving.current) return;
        saving.current = true;
        setBusy(true);
        setError("");
        const assertSession = captureSession();
        try {
            const latest = await getModelOrdering();
            assertSession();
            dirty.current.clear();
            setConflict(false);
            persisted.current = latest.orders;
            setUnsaved(false);
            apply(latest);
        } catch (failure) {
            setError(message(failure));
        } finally {
            saving.current = false;
            setBusy(false);
        }
    };

    useEditGuard(unsaved, reload);
    const discardReload = useDiscardChanges(unsaved, reload);

    return {
        orders: ordering.orders,
        loading: query.isLoading,
        queryError: query.error ? message(query.error) : "",
        unsaved,
        busy,
        error,
        conflict,
        preview,
        commit,
        reorder,
        retry,
        refresh,
        reload: discardReload,
    };
}

export function sortByOrder<T>(items: T[], getID: (item: T) => string, order: string[] = []) {
    const positions = new Map(order.map((id, index) => [id, index]));
    return [...items].sort((left, right) => {
        const a = positions.get(getID(left));
        const b = positions.get(getID(right));
        if (a === undefined && b === undefined) return 0;
        if (a === undefined) return 1;
        if (b === undefined) return -1;
        return a - b;
    });
}

export function reorderVisible(all: string[], visible: string[], nextVisible: string[]) {
    const next = [...all];
    visible.forEach((id, index) => {
        const position = next.indexOf(id);
        if (position >= 0) next[position] = nextVisible[index] || id;
    });
    return next;
}

export function moveBy(ids: string[], index: number, nextIndex: number) {
    if (nextIndex < 0 || nextIndex >= ids.length || index < 0 || index >= ids.length) return ids;
    const next = [...ids];
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item);
    return next;
}
