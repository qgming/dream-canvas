function reasoningParts(item) {
  const read = (parts, type) => Object.fromEntries((parts || []).flatMap((part, index) => part?.type === type && typeof part.text === "string" && part.text ? [[index, part.text]] : []));
  return {summary: read(item.summary, "summary_text"), content: read(item.content, "reasoning_text")};
}

function reasoningText(items) {
  return Object.values(items).flatMap(item => {
    const summary = Object.values(item.summary || {}).filter(Boolean);
    return summary.length ? summary : Object.values(item.content || {}).filter(Boolean);
  }).join("\n\n");
}

function outputReasoning(output) {
  return reasoningText(output.filter(item => item.type === "reasoning").map(reasoningParts));
}

export async function submit(input, { encode, sign }) {
  const p = input.params || {}, refs = new Map(([...(input.images || []), ...(input.videos || []), ...(input.audios || [])]).map(r => [r.assetId, r]));
  const messages = input.messages?.length ? input.messages : [{role: "user", content: input.prompt}];
  if (!input.messages?.length && refs.size) messages[0].content = [{type: "text", text: input.prompt}, ...[...refs.values()].map(r => ({type: "image_asset", assetId: r.assetId}))];
  const list = [];
  if (p.systemPrompt) list.push({role: "system", content: p.systemPrompt});
  for (const m of messages) {
      if (m.role === "tool") { list.push({type: "function_call_output", call_id: m.tool_call_id, output: m.content}); continue; }
      if (m.responseItems) list.push(...m.responseItems);
      else for (const call of m.tool_calls || []) list.push({type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments});
      if (m.content) list.push({role: m.role, content: Array.isArray(m.content) ? m.content.map(c => c.type === "image_asset" ? {type: "input_image", image_url: refs.get(c.assetId)?.url || refs.get(c.assetId)?.dataUrl} : c.type === "image_url" ? {type: "input_image", image_url: c.image_url.url} : {type: "input_text", text: c.text}) : m.content});
  }
  const body = {model: input.model, input: list, stream: p.stream !== false, store: false, include: ["reasoning.encrypted_content"]};
  for (const key of ["temperature", "top_p", "max_output_tokens"]) if (p[key] != null) body[key] = p[key];
  if (p.reasoning_effort || p.reasoning_summary) body.reasoning = {...(p.reasoning_effort ? {effort: p.reasoning_effort} : {}), ...(p.reasoning_summary ? {summary: p.reasoning_summary} : {})};
  if (input.tools?.length) { body.tools = input.tools.map(t => ({type: "function", ...t.function, strict: false})); body.parallel_tool_calls = false; }
  return {method: "POST", path: "responses", body, responseType: body.stream ? "sse" : "json"};
}

export async function stream(input, { encode, sign }) {
  const s = input.state, e = input.event;
  s.text ||= ""; s.toolCalls ||= []; s.responseItems ||= [];
  if (e.response?.id) s.upstreamId = e.response.id;
  if (e.response?.usage) s.usage = e.response.usage;
  if (e.error || ["response.failed", "error"].includes(e.type)) { s.complete = true; s.status = "failed"; s.error = "供应商文本响应失败 / Provider response failed"; }
  if (s.status === "failed") return s;
  if (e.type === "response.output_text.delta") s.text += e.delta || "";
  const reasoningEvent = /^response\.reasoning_(summary_)?text\.(delta|done)$/.exec(e.type || "");
  if (reasoningEvent && Number.isSafeInteger(e.output_index) && e.output_index >= 0) {
      const field = reasoningEvent[1] ? "summary" : "content";
      const index = reasoningEvent[1] ? e.summary_index : e.content_index;
      const chunk = reasoningEvent[2] === "done" ? e.text : e.delta;
      if (Number.isSafeInteger(index) && index >= 0 && typeof chunk === "string" && chunk) {
          const parts = (((s.reasoningParts ||= {})[e.output_index] ||= {})[field] ||= {});
          parts[index] = reasoningEvent[2] === "done" ? chunk : (parts[index] || "") + chunk;
          s.reasoning = reasoningText(s.reasoningParts);
      }
  }
  if (e.type === "response.output_item.done") {
      const item = e.item;
      if (item.type === "function_call") s.toolCalls.push({id: item.call_id, type: "function", function: {name: item.name, arguments: item.arguments}});
      if (["reasoning", "function_call"].includes(item.type)) s.responseItems.push(item);
      if (item.type === "reasoning" && Number.isSafeInteger(e.output_index) && e.output_index >= 0) {
          const current = (s.reasoningParts ||= {})[e.output_index] ||= {};
          const parts = reasoningParts(item);
          for (const field of ["summary", "content"]) current[field] = {...current[field], ...parts[field]};
          s.reasoning = reasoningText(s.reasoningParts);
      }
  }
  if (["response.completed", "response.incomplete"].includes(e.type)) {
      s.complete = true; s.upstreamId = e.response.id; s.usage = e.response.usage; s.status = e.type === "response.incomplete" ? "incomplete" : "completed";
      if (Array.isArray(e.response.output)) s.reasoning = outputReasoning(e.response.output) || s.reasoning;
  }
  return s;
}

export async function result(input, { encode, sign }) {
  const r = input.response;
  if (Array.isArray(r.output)) {
    if (!["completed", "incomplete", "failed", "cancelled"].includes(r.status)) throw new Error("Missing terminal response status");
    const responseItems = r.output.filter(item => ["reasoning", "function_call"].includes(item.type));
    const toolCalls = r.output.filter(item => item.type === "function_call").map(item => ({id: item.call_id, type: "function", function: {name: item.name, arguments: item.arguments}}));
    return {status: r.status, upstreamId: r.id, text: r.output.flatMap(item => item.content || []).filter(item => item.type === "output_text").map(item => item.text).join(""), reasoning: outputReasoning(r.output), responseItems, toolCalls, usage: r.usage || {}, error: r.status !== "completed" ? "供应商文本未完整结束，已收到内容保留 / Incomplete provider response retained" : ""};
  }
  if (r.error && r.complete !== true) return {status: "failed", upstreamId: r.id, usage: r.usage || {}, error: "供应商文本接口返回错误 / Provider text API error"};
  if (r.complete !== true) throw new Error("Missing completed Responses response");
  return {status: r.status || "completed", upstreamId: r.upstreamId, text: r.text || "", reasoning: r.reasoning, responseItems: r.responseItems, toolCalls: (r.toolCalls || []).filter(Boolean), usage: r.usage || {}, error: r.error || (r.status === "incomplete" ? "输出未完整结束，已收到内容保留 / Incomplete output retained" : "")};
}
