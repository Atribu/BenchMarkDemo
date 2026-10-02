export async function readBoundedJson(
  input: Request | Response,
  maxBytes: number,
): Promise<unknown> {
  const length = Number(input.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) {
    await input.body?.cancel();
    throw new Error("Yanıt veya istek boyutu sınırı aşıldı.");
  }
  const reader = input.body?.getReader();
  if (!reader) throw new Error("Boş JSON yanıtı.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("Yanıt veya istek boyutu sınırı aşıldı.");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
