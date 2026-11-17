/** TEXT QR content is literal text, never executable HTML supplied by its creator. */
export function renderPublicQrText(value: string): string {
  const escaped=value.replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!));
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>${escaped}</h1></body></html>`;
}
