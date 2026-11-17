export async function validate(input, { encode, sign }) {
  const p = input.params || {}, refs = [...(input.images || []), ...(input.videos || []), ...(input.audios || [])];
  const images = refs.filter(r => r.role === "image"), videos = refs.filter(r => r.role === "video"), audios = refs.filter(r => r.role === "audio");
  if (!Number.isInteger(p.duration) || p.duration < (input.model === "MiniMax-H3-Max" ? 5 : 4) || p.duration > 15) return {valid: false, error: "时长需为 4–15 秒整数（H3 Max 为 5–15 秒） / Check integer duration"};
  if (p.mode === "text" && refs.length || p.mode === "keyframe" && (!images.length || images.length > 2 || videos.length || audios.length) || p.mode === "reference" && (!refs.length || images.length > 9 || videos.length > 3 || audios.length > 3)) return {valid: false, error: "参考素材与生成模式不匹配 / References do not match the generation mode"};
  if (p.mode === "text" && p.ratio === "adaptive" || p.mode === "keyframe" && p.ratio !== "adaptive") return {valid: false, error: "首尾帧请选择 adaptive，文生请选择具体比例 / Check aspect ratio for the selected mode"};
  if (input.model === "MiniMax-H3-Lite" && p.mode === "reference" && p.ratio === "adaptive") return {valid: false, error: "H3 Lite 参考模式请选择具体比例 / H3 Lite requires a concrete reference aspect ratio"};
  for (const r of refs.filter(r => r.role === "image" || r.role === "video")) if (!r.width || !r.height || r.width / r.height < 0.4 || r.width / r.height > 2.5) return {valid: false, error: "参考宽高比需为 0.4–2.5，且需核实尺寸 / Reference aspect ratio must be verified and within 0.4–2.5"};
  for (const r of videos) {
      const [numerator, denominator = 1] = String(r.fps).split("/").map(Number), fps = numerator / denominator;
      if (!["h264", "hevc"].includes(r.videoCodec) || r.audioCodec && !["aac", "mp3"].includes(r.audioCodec) || !Number.isFinite(fps) || fps < 23.976 || fps > 60) return {valid: false, error: "参考视频需 H.264/H.265、AAC/MP3 音轨及 23.976–60 fps / Reference codec or frame rate is unsupported or unverified"};
  }
  for (const role of ["video", "audio"]) if (refs.filter(r => r.role === role).reduce((sum, r) => sum + r.durationMs, 0) > 15000) return {valid: false, error: "参考视频或音频总时长最多 15 秒 / Reference duration exceeds 15 seconds"};
  return {valid: true};
}

export async function submit(input, { encode, sign }) {
  const p = input.params || {}, content = [{type: "text", text: input.prompt}];
  for (const r of [...(input.images || []), ...(input.videos || []), ...(input.audios || [])]) {
      const type = `${r.role}_url`, role = r.role === "image" && p.mode === "keyframe" ? r.parameterKey : `reference_${r.role}`;
      content.push({type, [type]: {url: r.url}, role});
  }
  const body = {model: input.model, content, response_format: "task"};
  for (const key of ["resolution", "ratio", "duration", "aigc_watermark"]) if (p[key] != null) body[key] = p[key];
  if (p.prompt_expansion_mode) body.extra = {prompt_expansion_mode: p.prompt_expansion_mode};
  return {method: "POST", path: "/v2/video_generation", body};
}

export async function query(input, { encode, sign }) {
  return {method: "GET", path: `/v2/query/video_generation/${encode("url", input.upstreamId)}`};
}

export async function result(input, { encode, sign }) {
  const r = input.response.task || input.response, status = r.status || "queued", usage = r.usage || {};
  if (usage.output_seconds != null) usage.seconds = usage.output_seconds;
  return {upstreamId: r.id || r.task_id || input.input.upstreamId, status: status === "succeeded" ? "completed" : status === "expired" ? "failed" : status, url: r.content?.url, usage, error: ["failed", "expired"].includes(status) ? "供应商视频生成失败 / Provider video task failed" : ""};
}
