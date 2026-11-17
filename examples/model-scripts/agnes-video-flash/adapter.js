import { materials, publicURL } from "./lib/materials.js";


export async function validate(input) {
  const refs = [...(input.images || []), ...(input.videos || []), ...(input.audios || [])] || [], { first, last, images, audios } = materials(refs), mode = input.params.mode;
  const invalid = (error) => ({ valid: false, error });
  if (first.length > 1 || last.length > 1 || first.concat(last).some((r) => r.role !== "image") || refs.length !== first.length + last.length + images.length + audios.length) return invalid("不支持的素材类型或用途 / Unsupported reference role");
  if (mode === "text" && refs.length) return invalid("文生模式不接受素材 / Text mode does not accept references");
  if (mode === "keyframe" && (!first.length && !last.length || images.length || audios.length)) return invalid("首尾帧模式至少选择一帧，不添加通用参考 / Keyframe mode needs a first or last frame without generic references");
  if (mode === "reference" && (first.length || last.length || !images.length && !audios.length)) return invalid("参考模式需要图片或音频，不使用首尾帧字段 / Reference mode needs images or audio without keyframes");
  if (images.length > 5 || audios.length > 3) return invalid("最多 5 张参考图、3 段参考音频 / At most 5 reference images and 3 audio clips");
  if (images.some((r) => r.bytes >= 15000000) || images.reduce((sum, r) => sum + r.bytes, 0) >= 50000000) return invalid("参考图单张小于 15 MB、合计小于 50 MB / Images must be below 15 MB each and 50 MB combined");
  const duration = audios.reduce((sum, r) => sum + r.durationMs, 0);
  if (audios.length && (audios.some((r) => !r.durationMs || r.bytes >= 15000000) || duration < 2000 || duration > 12000 || audios.reduce((sum, r) => sum + r.bytes, 0) >= 64000000)) return invalid("参考音频单段小于 15 MB、合计小于 64 MB，总时长 2–12 秒 / Audio must be below 15 MB each and 64 MB combined, with a combined duration of 2–12 seconds");
  return { valid: true };
}


export async function submit(input) {
  const p = input.params, { first, last, images, audios } = materials([...(input.images || []), ...(input.videos || []), ...(input.audios || [])]);
  const body = { model: input.model, prompt: input.prompt, mode: p.mode, seconds: String(p.seconds), size: p.size, aspect_ratio: p.aspect_ratio, n: 1 };
  if (p.seed != null && p.seed !== "") body.seed = p.seed;
  if (p.mode === "keyframe") {
    if (first.length) body.first_frame = publicURL(first[0]);
    if (last.length) body.last_frame = publicURL(last[0]);
  }
  if (p.mode === "reference") {
    if (images.length) body.images = images.map(publicURL);
    if (audios.length) body.audios = audios.map(publicURL);
  }
  return { method: "POST", path: "videos", body };
}

export async function query(input, { encode }) {
  return { method: "GET", path: `/agnesapi?video_id=${encode("url", input.upstreamId)}&model_name=${encode("url", input.model)}` };
}

export async function result({ response: r, input }) {
  const upstreamId = r.video_id || input.upstreamId;
  if (r.status === "failed") return { upstreamId, status: "failed", error: r.error?.message || "视频生成失败 / Video generation failed" };
  if (r.status === "completed") return r.url
    ? { upstreamId, status: "completed", url: r.url }
    : { upstreamId, status: "confirmation_required", error: "已完成但缺少成品地址 / Completed without an output URL" };
  if (upstreamId && ["queued", "in_progress"].includes(r.status)) return { upstreamId, status: r.status === "queued" ? "queued" : "running" };
  return { upstreamId, status: "confirmation_required", error: "缺少 video_id 或返回未知状态，请核对原响应 / Missing video_id or unknown status; inspect the saved response" };
}
