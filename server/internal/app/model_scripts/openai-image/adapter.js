import sizes from "./sizes.json";

export async function validate({params}) {
  if (params.size !== "auto" && !Object.prototype.hasOwnProperty.call(sizes["1k"], params.size) && !/^[1-9]\d*x[1-9]\d*$/.test(params.size)) return {valid: false, error: "请选择常用比例、auto 或填写 WIDTHxHEIGHT 像素尺寸 / Choose a listed ratio, auto or WIDTHxHEIGHT pixels"};
  return {valid: true};
}

export async function submit({model, prompt, params: p, images}) {
  const body = {model, prompt, n: p.count, output_format: "png"};
  if (p.size !== "auto") body.size = sizes[p.resolution === "auto" ? "1k" : p.resolution][p.size] || p.size;
  if (p.quality !== "auto") body.quality = p.quality;
  if (p.background === "transparent") body.background = p.background;
  if (!/gpt-image/.test(model)) body.response_format = "b64_json";
  if (!images.length) return {method: "POST", path: "images/generations", body, responseType: "image-json"};
  const multipart = Object.entries(body).map(([name, value]) => ({name, value: String(value)}));
  for (const image of images) multipart.push({name: images.length > 1 ? "image[]" : "image", assetId: image.assetId});
  return {method: "POST", path: "images/edits", multipart, responseType: "image-json"};
}

export async function result({response}) {
  return {status: "completed", responseFile: response.responseFile};
}
