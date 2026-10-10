// pdf.js ships no typings for its worker module; the reader only hands the
// module to pdf.js itself, which knows its shape (pdfReader.ts).
declare module 'pdfjs-dist/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown
}
