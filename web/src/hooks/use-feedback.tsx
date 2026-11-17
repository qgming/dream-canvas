import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { useTranslation } from "react-i18next";

type Confirmation = { title: ReactNode; content?: ReactNode; confirmText?: ReactNode; cancelText?: ReactNode; destructive?: boolean; onConfirm?: () => void | Promise<unknown>; onCancel?: () => void };
type ConfirmationHandle = { destroy: () => void; update: (patch: Partial<Confirmation>) => void };
const FeedbackContext = createContext<((options: Confirmation) => ConfirmationHandle) | null>(null);
const notify = { ...toast, warning: toast.warning, loading: (content: ReactNode) => { const id = toast.loading(content); return () => toast.dismiss(id); } };

export function FeedbackProvider({ children }: { children: ReactNode }) {
    const [requests, setRequests] = useState<(Confirmation & { id: number })[]>([]);
    const sequence = useRef(0);
    const { t } = useTranslation();
    const confirm = useCallback((options: Confirmation) => { const id = ++sequence.current; setRequests((current) => [...current, { ...options, id }]); return { destroy: () => setRequests((current) => current.filter((entry) => entry.id !== id)), update: (patch: Partial<Confirmation>) => setRequests((current) => current.map((entry) => entry.id === id ? { ...entry, ...patch } : entry)) }; }, []);
    const request = requests[0];
    const dismiss = () => setRequests((current) => current.filter((entry) => entry.id !== request?.id));
    return <FeedbackContext.Provider value={confirm}>{children}{request ? <Dialog key={request.id} open title={request.title} confirmText={request.confirmText || t("ui.confirm")} cancelText={request.cancelText || t("common.cancel")} destructive={request.destructive} onClose={() => { request.onCancel?.(); dismiss(); }} onConfirm={async () => { await request.onConfirm?.(); dismiss(); }}><div className="text-sm leading-6 text-muted-foreground">{request.content}</div></Dialog> : null}</FeedbackContext.Provider>;
}

export function useFeedback() {
    const confirm = useContext(FeedbackContext);
    if (!confirm) throw new Error("FeedbackProvider is required");
    return { notify, confirm };
}
