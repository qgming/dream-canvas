import { useCallback, useState, type ReactNode } from "react";
import { EditGuardContext, type EditRegistration } from "@/hooks/use-edit-guard";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";

export function EditGuard({ children }: { children: ReactNode }) {
    const [edits, setEdits] = useState(new Map<string, EditRegistration>());
    const register = useCallback((id: string, edit: EditRegistration | null) => setEdits((current) => {
        const next = new Map(current);
        if (edit) next.set(id, edit); else next.delete(id);
        return next;
    }), []);
    const dirty = [...edits.values()].some((edit) => edit.dirty);
    useUnsavedChanges(dirty, () => edits.forEach((edit) => { if (edit.dirty) edit.reset(); }));
    return <EditGuardContext.Provider value={{ register, dirty }}>{children}</EditGuardContext.Provider>;
}
