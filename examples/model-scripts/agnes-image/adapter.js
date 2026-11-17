import { imageURLs } from "./lib/materials.js";


export async function submit(input) {
  const p = input.params, images = imageURLs([...(input.images || []), ...(input.videos || []), ...(input.audios || [])]);
  const extra_body = { response_format: p.response_format };
  if (images.length) extra_body.image = images;
  const body = { model: input.model, prompt: input.prompt, size: p.size, ratio: p.ratio, extra_body };
  if (!images.length && p.response_format === "b64_json") body.return_base64 = true;
  return {
    method: "POST",
    path: "images/generations",
    body,
    responseType: "image-json"
  };
}

export async function result({ response }) {
  return { status: "completed", responseFile: response.responseFile };
}
