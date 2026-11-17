export async function submit(input, { encode, sign }) {
  const p = input.params || {}, body = {model: input.model, prompt: input.prompt};
  for (const image of input.images || []) {
    if (image.parameterKey === "first_frame") body.first_frame_image = image.url;
    if (image.parameterKey === "last_frame") body.last_frame_image = image.url;
  }
  for (const key of ["duration", "resolution", "prompt_optimizer"]) if (p[key] != null) body[key] = p[key];
  return {method: "POST", path: "video_generation", body};
}

export async function query(input, { encode, sign }) {
  return {method: "GET", path: `query/video_generation?task_id=${encode("url", input.upstreamId)}`};
}

export async function result(input, { encode, sign }) {
  const r = input.response;
  if (input.phase === "followup") return {status: "completed", upstreamId: input.input.upstreamId, url: r.file?.download_url};
  if (r.base_resp?.status_code) return {status: "failed", error: "供应商返回业务错误 / Provider returned a business error"};
  if (r.status === "Success") return {upstreamId: r.task_id || input.input.upstreamId, request: {method: "GET", path: `files/retrieve?file_id=${encode("url", r.file_id)}`}};
  return {upstreamId: r.task_id || input.input.upstreamId, status: r.status === "Fail" ? "failed" : "running", usage: r.usage || {}};
}
