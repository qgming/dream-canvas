export async function submit(input, { encode, sign }) {
  const body = {model: input.model, prompt: input.prompt}, p = input.params || {};
  if ((input.images || []).some(r => r.parameterKey === "mask") && !(input.images || []).some(r => r.parameterKey !== "mask")) throw new Error("A mask requires an original image");
  for (const key of ["size", "quality", "background", "output_format", "response_format", "moderation", "input_fidelity", "output_compression", "n"]) if (p[key] != null && p[key] !== "") body[key] = p[key];
  if (!input.images?.length) return {method: "POST", path: "images/generations", body, responseType: "image-json"};
  const multipart = Object.entries(body).map(([name, value]) => ({name, value: String(value)}));
  for (const r of input.images) multipart.push({name: r.parameterKey === "mask" ? "mask" : "image[]", assetId: r.assetId});
  return {method: "POST", path: "images/edits", multipart, responseType: "image-json"};
}

export async function result(input, { encode, sign }) {
  return {status: "completed", responseFile: input.response.responseFile};
}
