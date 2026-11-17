import { createContext, useCallback, useContext, useEffect, useId, useRef } from "react";

export type EditRegistration = { dirty: boolean; reset: () => void };
export const EditGuardContext = createContext<{ register: (id: string, edit: EditRegistration | null) => void; dirty: boolean } | null>(null);
export const DialogEditContext = createContext<{ active: boolean; register: (id: string, edit: EditRegistration | null) => void } | null>(null);

export function useEditGuard(dirty: boolean, reset: () => void) {
    const id = useId();
    const global = useContext(EditGuardContext);
    const dialog = useContext(DialogEditContext);
    const resetRef = useRef(reset);
    resetRef.current = reset;
    const discard = useCallback(() => resetRef.current(), []);
    const active = dialog?.active ?? true;
    useEffect(() => {
        const edit = { dirty: dirty && active, reset: discard };
        global?.register(id, edit);
        dialog?.register(id, edit);
        return () => { global?.register(id, null); dialog?.register(id, null); };
    }, [id, global?.register, dialog?.register, active, dirty, discard]);
    useEffect(() => {
        if (global || !active || !dirty) return;
        const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", beforeUnload);
        return () => window.removeEventListener("beforeunload", beforeUnload);
    }, [Boolean(global), active, dirty]);
}
