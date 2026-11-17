export function materials(references = []) {
  return {
    first: references.filter((r) => r.parameterKey === "first_frame"),
    last: references.filter((r) => r.parameterKey === "last_frame"),
    images: references.filter((r) => !r.parameterKey && r.role === "image"),
    audios: references.filter((r) => !r.parameterKey && r.role === "audio")
  };
}

export function publicURL(reference) {
  if (!reference.url) throw new Error("素材尚未获得可访问地址 / Reference URL is unavailable");
  return reference.url;
}
