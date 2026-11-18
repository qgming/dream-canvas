export async function validate({prompt}) {
  if (!prompt?.trim()) return {valid: false, error: "请输入待朗读文本 / Enter text to speak"};
  return {valid: true};
}

export async function submit({model, prompt, params: p}) {
  const body = {model, input: prompt, voice: p.voice, response_format: p.format, speed: p.speed};
  if (p.instructions) body.instructions = p.instructions;
  return {method: "POST", path: "audio/speech", body, responseType: "binary"};
}

export async function result({response, input}) {
  return {status: "completed", responseFile: response.responseFile, mimeType: input.params.format === "pcm" ? "audio/pcm" : response.mimeType, usage: {characters: [...input.prompt].length}, usageState: "estimated"};
}
