import { useId, useRef } from "react";
import { Check, Circle, CircleAlert, CircleDot, CircleHelp, ListTodo, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AssistantInteraction, AssistantTodo } from "@/services/api/assistant";
import { AgentStep } from "./agent-chat-steps";
import type { AssistantQuestionReply } from "./assistant-session";

const cardClass = "min-w-0 rounded-xl border border-border bg-card px-3 py-2.5 text-card-foreground";
const todoIcon = { pending: Circle, in_progress: CircleDot, completed: Check };

export function AssistantInteractionRow({ detail, reply, disabled }: { detail: AssistantInteraction; reply?: AssistantQuestionReply; disabled?: boolean }) {
    const { t } = useTranslation();
    if (detail.kind === "question") return <AssistantQuestion detail={detail} reply={reply} disabled={disabled} />;
    if (detail.kind === "todo") return <AssistantTodos todos={detail.todos} />;
    const Icon = detail.status === "running" ? LoaderCircle : detail.status === "completed" ? Check : CircleAlert;
    return <AgentStep icon={<Icon aria-hidden className={cn(detail.status === "running" && "animate-spin motion-reduce:animate-none", detail.status === "failed" && "text-warning")} />} label={t(`agent.interaction.context.${detail.status}`)} />;
}

function AssistantQuestion({ detail, reply, disabled }: { detail: Extract<AssistantInteraction, { kind: "question" }>; reply?: AssistantQuestionReply; disabled?: boolean }) {
    const { t } = useTranslation();
    const labelId = useId();
    const composing = useRef(false);
    const options = [...new Set(detail.options)];
    const status = reply?.status === "sent" ? "sent" : detail.status;
    const locked = disabled || reply?.status === "sending" || reply?.status === "changed";
    if (!reply && status === "waiting") return null;
    return <section aria-labelledby={labelId} className={cardClass}>
        <div className="flex items-start gap-2">
            <CircleHelp aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
                <p role="status" className="text-xs text-muted-foreground">{t(`agent.interaction.question.${status}`)}</p>
                <h3 id={labelId} className="mt-0.5 whitespace-pre-wrap break-words text-sm font-medium leading-5">{detail.question || t("agent.interaction.question.title")}</h3>
            </div>
        </div>
        {detail.status === "answered" && detail.answer ? <p className="mt-2 whitespace-pre-wrap break-words border-l border-border pl-2 text-sm leading-5">{detail.answer}</p> : null}
        {reply && status === "waiting" ? <form className="mt-2 space-y-2" data-base-ui-swipe-ignore onSubmit={(event) => { event.preventDefault(); if (!locked && !composing.current) reply.send(); }}>
            {options.length ? <div role="group" aria-label={t("agent.interaction.question.options")} className="flex flex-wrap gap-1.5">
                {options.map((option) => <Button key={option} size="sm" aria-pressed={reply.value === option} disabled={locked} className="h-auto min-h-7 max-w-full whitespace-normal py-1 text-left aria-pressed:border-foreground/50 aria-pressed:bg-accent" onClick={() => reply.change(option)}><span className="min-w-0 whitespace-pre-wrap break-words">{option}</span></Button>)}
            </div> : null}
            <div className="flex items-center gap-2">
                <Input value={reply.value} disabled={disabled} readOnly={locked} placeholder={t(options.length ? "agent.interaction.question.custom" : "agent.interaction.question.reply")} aria-label={t("agent.interaction.question.reply")} aria-describedby={labelId} onChange={(event) => reply.change(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={(event) => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} />
                <Button type="submit" variant="default" className="text-xs" disabled={locked || !reply.value.trim()} loading={reply.status === "sending"}>{t("agent.interaction.question.send")}</Button>
            </div>
            {reply.status === "failed" ? <p role="alert" className="text-xs text-destructive">{t("agent.interaction.question.failed")}</p> : null}
            {reply.status === "changed" ? <div className="flex flex-wrap items-center gap-2">
                <p role="alert" className="text-xs text-destructive">{t("agent.interaction.question.changed")}</p>
                <Button size="sm" onClick={reply.refresh} disabled={disabled}>{t("agent.interaction.question.refresh")}</Button>
            </div> : null}
        </form> : null}
    </section>;
}

function AssistantTodos({ todos }: { todos: AssistantTodo[] }) {
    const { t } = useTranslation();
    const labelId = useId();
    const completed = todos.filter((todo) => todo.status === "completed").length;
    return <section aria-labelledby={labelId} className={cardClass}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <ListTodo aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <h3 id={labelId} className="min-w-0 flex-1 font-medium">{t("agent.interaction.todos.title")}</h3>
            <span className="shrink-0 text-muted-foreground">{t("agent.interaction.todos.progress", { completed, total: todos.length })}</span>
        </div>
        <ul className="mt-1.5 space-y-1">
            {todos.map((todo) => {
                const Icon = todoIcon[todo.status];
                return <li key={todo.id} className={cn("flex items-start gap-2 text-[13px] leading-5", todo.status === "completed" && "text-muted-foreground", todo.status === "in_progress" && "font-medium")}>
                    <Icon aria-hidden className="mt-1 size-3 shrink-0" />
                    <span className="min-w-0 whitespace-pre-wrap break-words"><span className="sr-only">{t(`agent.interaction.todos.${todo.status}`)}: </span>{todo.text}</span>
                </li>;
            })}
        </ul>
    </section>;
}
