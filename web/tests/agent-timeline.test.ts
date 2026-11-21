import { expect, test, vi } from "vitest";
import type { AgentChatItem } from "../src/stores/use-agent-store";
import { groupTimelineMessages } from "../src/components/agent/agent-event-formatters";

vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

const tool = (id: string, turnId = "turn", threadId = "thread"): AgentChatItem => ({ id, threadId, turnId, role: "tool", text: "", detail: { kind: "tool", status: "completed" } });
const reply = (id: string, text = "", reasoning = ""): AgentChatItem => ({ id, threadId: "thread", turnId: "turn", role: "assistant", text, detail: { reasoning } });
const order = (items: AgentChatItem[]) => groupTimelineMessages(items).map((entry) => entry.type === "tools" ? entry.items.map((item) => item.id) : entry.item.id);

test("only adjacent tool calls share a group; reasoning and replies keep isolated calls separate", () => {
    expect(order([
        tool("a"), tool("b"), reply("reasoning", "", "Compare results"), tool("c"),
        reply("reply", "Result found"), tool("d"), tool("e"),
    ])).toEqual([["a", "b"], "reasoning", ["c"], "reply", ["d", "e"]]);
});

test("empty stream placeholders do not split tools, but turn and thread boundaries do", () => {
    expect(order([tool("a"), reply("stream", " "), tool("b"), tool("c", "other"), tool("c", "other", "other-thread")]))
        .toEqual([["a", "b"], ["c"], ["c"]]);
});
