export async function validate(input, { encode, sign }) {
  const p = input.params || {}, length = s => [...(s || "")].length;
  if (!input.prompt?.trim() || length(input.prompt) > 4096 || length(p.instructions) > 4096) return {valid: false, error: "TTS 文本与指令分别最多 4096 字符 / Text and instructions: up to 4096 characters each"};
  if (!p.voice) return {valid: false, error: "请填写渠道可用的音色编号 / Voice is required"};
  if ([...(input.images || []), ...(input.videos || []), ...(input.audios || [])]?.length && ![...(input.images || []), ...(input.videos || []), ...(input.audios || [])][0].voiceId) return {valid: false, error: "参考音频尚未关联此渠道的已注册音色编号，请在资产详情配置 / Register the channel voice ID on this audio asset"};
  if (["tts-1", "tts-1-hd"].includes(input.model) && p.instructions) return {valid: false, error: "此模型不支持 instructions / This model does not support instructions"};
  if (p.speed != null && (p.speed < 0.25 || p.speed > 4)) return {valid: false, error: "语速须在 0.25–4 之间 / Speed must be 0.25–4"};
  return {valid: true};
}

export async function submit(input, { encode, sign }) {
  const p = input.params || {};
  const voice = [...(input.images || []), ...(input.videos || []), ...(input.audios || [])]?.[0]?.voiceId || p.voice;
  const body = {model: input.model, input: input.prompt, voice: voice?.startsWith("voice_") ? {id: voice} : voice};
  for (const key of ["instructions", "speed", "response_format"]) if (p[key] != null && p[key] !== "") body[key] = p[key];
  return {method: "POST", path: "audio/speech", body, responseType: "binary"};
}

export async function result(input, { encode, sign }) {
  return {status: "completed", responseFile: input.response.responseFile, mimeType: input.input.params.response_format === "pcm" ? "audio/pcm" : input.response.mimeType, usage: {characters: [...input.input.prompt].length}, usageState: "estimated"};
}
