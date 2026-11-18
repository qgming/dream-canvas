export async function validate({params: p}) {
  if (p.size !== "auto" && !/^[1-9]\d*x[1-9]\d*$/.test(p.size) && !/^[1-9]\d*:[1-9]\d*$/.test(p.size)) return {valid: false, error: "尺寸需为比例、auto 或 WIDTHxHEIGHT / Use an aspect ratio, auto or WIDTHxHEIGHT"};
  if (!/^[1-9]\d*p$/.test(p.resolution)) return {valid: false, error: "分辨率需为正整数 p，例如 720p / Resolution must be a positive integer followed by p, such as 720p"};
  return {valid: true};
}

export async function submit(input) {
  const p = input.params || {}, images = input.images || [];
  const multipart = [{name: "model", value: input.model}, {name: "prompt", value: input.prompt}];
  const put = (name, value) => { if (value != null && value !== "") multipart.push({name, value: String(value)}); };
  if (p.size !== "auto") {
    const pixel = p.size.includes("x"), [w, h] = p.size.split(pixel ? "x" : ":").map(Number);
    const short = Number(p.resolution.slice(0, -1)), even = value => Math.max(2, Math.round(value / 2) * 2);
    const fraction = value => { const [a, b] = value.split(":").map(Number); return a / b; };
    const ratio = pixel ? ["1:1", "3:4", "4:3", "16:9", "9:16", "21:9"].reduce((best, next) => Math.abs(fraction(next) - w / h) < Math.abs(fraction(best) - w / h) ? next : best) : p.size;
    put("ratio", ratio);
    put("size", pixel ? p.size : `${even(w >= h ? short * w / h : short)}x${even(w >= h ? short : short * h / w)}`);
  }
  put("mode", p.mode);
  put("resolution_name", p.resolution);
  put("generate_audio", p.generateAudio);
  put("watermark", p.watermark);
  put("seconds", p.seconds);
  images.forEach((image, index) => multipart.push({name: p.mode === "frames" ? index === 0 ? "first_frame" : "last_frame" : "image[]", assetId: image.assetId}));
  for (const video of input.videos || []) multipart.push({name: "video[]", assetId: video.assetId});
  for (const audio of input.audios || []) multipart.push({name: "audio[]", assetId: audio.assetId});
  return {method: "POST", path: "videos", multipart};
}

export async function query(input) {
  return {method: "GET", path: `videos/${encodeURIComponent(input.upstreamId)}`};
}

export async function result({response, phase, input}) {
  if (phase === "followup") return {status: "completed", upstreamId: input.upstreamId, responseFile: response.responseFile, mimeType: response.mimeType, usage: input.previousResult?.usage || {}, usageState: input.previousResult?.usageState};
  if (response.code != null) {
    if (response.code !== 0 && response.code !== "0") return {status: "failed", upstreamId: input.upstreamId, error: "供应商返回视频接口错误，请核对渠道和参数 / Provider video API error; check the channel and parameters"};
    if (!response.data || typeof response.data !== "object") throw new Error("Missing video response data");
    response = response.data;
  }
  const upstreamId = response.id || input.upstreamId, usage = response.usage || {};
  const progress = typeof response.progress === "number" ? response.progress : undefined;
  const url = response.video_url || response.result_url || response.url || response.content?.video_url || response.content?.url;
  if (response.status === "failed" || response.status === "cancelled") return {status: response.status, upstreamId, url, usage, error: "供应商视频任务失败或已取消 / Provider video task failed or was cancelled"};
  if (response.status === "completed" || url) {
    if (url) return {status: "completed", upstreamId, url, usage, progress};
    if (!upstreamId) throw new Error("Missing video job ID");
    return {upstreamId, usage, progress, request: {method: "GET", path: `videos/${encodeURIComponent(upstreamId)}/content`, responseType: "binary"}};
  }
  if (phase === "submit" && upstreamId && !response.status) return {status: "queued", upstreamId, usage, progress};
  if (!upstreamId || !["queued", "in_progress", "running"].includes(response.status)) throw new Error("Missing video job ID or unknown status");
  return {status: response.status === "queued" ? "queued" : "running", upstreamId, usage, progress};
}
