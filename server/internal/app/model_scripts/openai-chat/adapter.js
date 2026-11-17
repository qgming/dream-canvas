export async function submit(input, { encode, sign }) {
  const p = input.params || {};
  const refs = new Map(([...(input.images || []), ...(input.videos || []), ...(input.audios || [])]).map(r => [r.assetId, r]));
  const referenceUrl = id => { const r = refs.get(id); return r?.transport === "data" ? r.dataUrl : r?.url; };
  const messages = (input.messages?.length ? input.messages : [{role: "user", content: input.prompt}]).map(({responseItems, ...m}) => ({...m, content: Array.isArray(m.content) ? m.content.map(c => c.type === "image_asset" ? {type: "image_url", image_url: {url: referenceUrl(c.assetId)}} : c) : m.content}));
  if (!input.messages?.length && refs.size) messages[0].content = [{type: "text", text: input.prompt}, ...[...refs.values()].map(r => ({type: "image_url", image_url: {url: referenceUrl(r.assetId)}}))];
  if (p.systemPrompt) messages.unshift({role: "system", content: p.systemPrompt});
  const body = {model: input.model, messages, stream: true, stream_options: {include_usage: true}};
  for (const key of ["temperature", "top_p", "max_tokens", "max_completion_tokens", "seed", "reasoning_effort"]) if (p[key] != null && p[key] !== "") body[key] = p[key];
  if (input.tools?.length) { body.tools = input.tools; body.parallel_tool_calls = false; }
  return {method: "POST", path: "chat/completions", body, responseType: "sse"};
}

export async function stream(input, { encode, sign }) {
  const s = input.state, e = input.event;
  s.text ||= ""; s.reasoning ||= ""; s.toolCalls ||= [];
  if (e.id) s.upstreamId = e.id;
  if (e.usage) s.usage = e.usage;
  for (const choice of e.choices || []) {
      const d = choice.delta || {};
      s.text += d.content || "";
      s.reasoning += d.reasoning_content || "";
      for (const call of d.tool_calls || []) {
          const current = s.toolCalls[call.index] ||= {id: "", type: "function", function: {name: "", arguments: ""}};
          if (call.id) current.id = call.id;
          current.function.name += call.function?.name || "";
          current.function.arguments += call.function?.arguments || "";
      }
      if (choice.finish_reason) { s.complete = true; s.status = ["length", "content_filter"].includes(choice.finish_reason) ? "incomplete" : "completed"; }
  }
  return s;
}

export async function result(input, { encode, sign }) {
  const r = input.response;
  return {status: r.status || "completed", upstreamId: r.upstreamId, text: r.text || "", reasoning: r.reasoning, responseItems: r.responseItems, toolCalls: (r.toolCalls || []).filter(Boolean), usage: r.usage || {}, error: r.error || (r.status === "incomplete" ? "输出未完整结束，已收到内容保留 / Incomplete output retained" : "")};
}
