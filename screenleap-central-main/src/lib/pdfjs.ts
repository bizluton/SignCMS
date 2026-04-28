import * as pdfjsLib from "pdfjs-dist";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

if (typeof window !== "undefined" && !(pdfjsLib as any).GlobalWorkerOptions.workerSrc) {
  (pdfjsLib as any).GlobalWorkerOptions.workerSrc = PdfWorker;
}

export const pdfjs = pdfjsLib;

export const pdfDocumentOptions = {
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
};