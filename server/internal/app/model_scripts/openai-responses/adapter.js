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
  const body = {model: input.model, input: list, stream: true, store: false, include: ["reasoning.encrypted_content"]};
  for (const key of ["temperature", "top_p", "max_output_tokens"]) if (p[key] != null) body[key] = p[key];
  if (p.reasoning_effort) body.reasoning = {effort: p.reasoning_effort};
  if (input.tools?.length) { body.tools = input.tools.map(t => ({type: "function", ...t.function, strict: false})); body.parallel_tool_calls = false; }
  return {method: "POST", path: "responses", body, responseType: "sse"};
}

export async function stream(input, { encode, sign }) {
  const s = input.state, e = input.event;
  s.text ||= ""; s.toolCalls ||= []; s.responseItems ||= [];
  if (e.type === "response.output_text.delta") s.text += e.delta || "";
  if (e.type === "response.output_item.done") {
      const item = e.item;
      if (item.type === "function_call") s.toolCalls.push({id: item.call_id, type: "function", function: {name: item.name, arguments: item.arguments}});
      if (["reasoning", "function_call"].includes(item.type)) s.responseItems.push(item);
  }
  if (["response.completed", "response.incomplete"].includes(e.type)) { s.complete = true; s.upstreamId = e.response.id; s.usage = e.response.usage; s.status = e.type === "response.incomplete" ? "incomplete" : "completed"; }
  if (["response.failed", "error"].includes(e.type)) { s.complete = true; s.status = "failed"; s.error = "供应商文本响应失败 / Provider response failed"; }
  return s;
}

export async function result(input, { encode, sign }) {
  const r = input.response;
  return {status: r.status || "completed", upstreamId: r.upstreamId, text: r.text || "", reasoning: r.reasoning, responseItems: r.responseItems, toolCalls: (r.toolCalls || []).filter(Boolean), usage: r.usage || {}, error: r.error || (r.status === "incomplete" ? "输出未完整结束，已收到内容保留 / Incomplete output retained" : "")};
}
