export async function validate(input, { encode, sign }) {
  const p = input.params || {}, refs = [...(input.images || []), ...(input.videos || []), ...(input.audios || [])];
  const images = refs.filter(r => r.role === "image"), others = refs.filter(r => r.role !== "image");
  if (p.mode === "text" && refs.length || p.mode === "keyframe" && (!images.length || images.length > 2 || others.length)) return {valid: false, error: "文生模式不接受参考；首尾帧需一至两张图片 / Check reference inputs for the selected mode"};
  if (p.mode === "text" && p.ratio === "adaptive") return {valid: false, error: "此 Seedance 1.0 文生模板需选择具体比例 / Choose a concrete aspect ratio for this Seedance 1.0 text template"};
  for (const r of images) if (!r.width || !r.height || r.width / r.height < 0.4 || r.width / r.height > 2.5 || r.bytes >= 30000000) return {valid: false, error: "参考图宽高比须为 0.4–2.5，文件小于 30 MB / Reference aspect ratio must be 0.4–2.5 and size below 30 MB"};
  return {valid: true};
}

export async function submit(input, { encode, sign }) {
  const p = input.params || {}, content = [{type: "text", text: input.prompt}];
  for (const r of [...(input.images || []), ...(input.videos || []), ...(input.audios || [])]) {
      const type = `${r.role}_url`, role = r.role === "image" && p.mode === "keyframe" ? r.parameterKey : `reference_${r.role}`;
      content.push({type, [type]: {url: r.url}, role});
  }
  const body = {model: input.model, content};
  for (const key of ["resolution", "ratio", "duration", "frames", "seed", "camera_fixed", "watermark", "generate_audio"]) if (p[key] != null) body[key] = p[key];
  return {method: "POST", path: "contents/generations/tasks", body};
}

export async function query(input, { encode, sign }) {
  return {method: "GET", path: `contents/generations/tasks/${encode("url", input.upstreamId)}`};
}

export async function result(input, { encode, sign }) {
  const r = input.response, status = r.status || "queued", usage = {...r.usage};
  return {upstreamId: r.id || input.input.upstreamId, status: status === "succeeded" ? "completed" : status === "expired" ? "failed" : status, url: r.content?.video_url, usage, error: ["failed", "expired"].includes(status) ? "供应商视频生成失败 / Provider video task failed" : ""};
}
