// Pull plain text out of Word and PDF files, in the browser. Agents only ever
// see the words, so a .docx or .pdf costs the same as the equivalent .txt.
// Both libraries load on demand, only when someone uploads one of these files.

export async function docxToText(file) {
  const mod = await import("mammoth");
  const mammoth = mod.default || mod;
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return value.replace(/\n{3,}/g, "\n\n").trim();
}

export async function pdfToText(file) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await task.promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const { items } = await (await pdf.getPage(n)).getTextContent();
    pages.push(items.map(item => (item.str || "") + (item.hasEOL ? "\n" : "")).join(""));
  }
  await task.destroy(); // frees the PDF worker
  return pages.join("\n\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
