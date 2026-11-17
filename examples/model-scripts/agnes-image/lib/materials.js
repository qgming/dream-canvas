export function imageURLs(references = []) {
  return references.map((reference) => {
    if (reference.role !== "image" || !reference.url) throw new Error("参考图尚未获得可访问地址 / Reference image URL is unavailable");
    return reference.url;
  });
}
