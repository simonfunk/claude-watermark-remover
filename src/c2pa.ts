export type ProvenanceFileType = "png" | "jpeg" | "svg" | "unknown";

export type ProvenanceSignalKind = "c2pa-jumbf" | "xmp" | "exif" | "photoshop-iptc";

export interface ProvenanceSignal {
  kind: ProvenanceSignalKind;
  location: string;
  description: string;
}

export interface ProvenanceInspection {
  filename: string | null;
  fileType: ProvenanceFileType;
  hasC2paCandidate: boolean;
  signals: ProvenanceSignal[];
  verification: {
    status: "not-performed";
    explanation: string;
  };
}

const VERIFICATION_EXPLANATION =
  "This tool only looks for the byte-level presence of C2PA/JUMBF, XMP, and EXIF markers. " +
  "It does not parse or cryptographically verify a C2PA manifest's claim signature or certificate " +
  "chain, which requires a conformant C2PA library or tool (for example c2patool). Presence of a " +
  "marker is not proof of a valid or trustworthy manifest, and its absence is not proof a file has " +
  "no provenance history — verification status is honestly reported as not performed rather than " +
  "guessed.";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function matchesSignature(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

function readAsciiSlice(bytes: Uint8Array, start: number, end: number): string {
  return Array.from(bytes.slice(start, end))
    .map((byte) => String.fromCharCode(byte))
    .join("");
}

function hasJumbfManifestBox(bytes: Uint8Array, start: number, end: number): boolean {
  if (start < 0 || end > bytes.length || end - start < 20) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const outerLength = view.getUint32(start, false);
  if (outerLength < 20 || start + outerLength > end) return false;
  if (readAsciiSlice(bytes, start + 4, start + 8) !== "jumb") return false;

  const childStart = start + 8;
  const childLength = view.getUint32(childStart, false);
  if (childLength < 12 || childStart + childLength > start + outerLength) return false;
  if (readAsciiSlice(bytes, childStart + 4, childStart + 8) !== "jumd") return false;
  return readAsciiSlice(bytes, childStart + 8, childStart + childLength).includes("c2pa");
}

function detectFileType(bytes: Uint8Array): ProvenanceFileType {
  if (matchesSignature(bytes, PNG_SIGNATURE)) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";

  const head = readAsciiSlice(bytes, 0, Math.min(bytes.length, 512)).trimStart();
  if (head.startsWith("<?xml") || head.startsWith("<svg")) {
    if (head.includes("<svg")) return "svg";
  }
  return "unknown";
}

function inspectPng(bytes: Uint8Array): ProvenanceSignal[] {
  const signals: ProvenanceSignal[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = readAsciiSlice(bytes, offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.length) break;

    const hasJumbfManifest = hasJumbfManifestBox(bytes, dataStart, dataEnd);

    if (type === "caBX" && hasJumbfManifest) {
      signals.push({
        kind: "c2pa-jumbf",
        location: "PNG chunk caBX",
        description: "PNG-private ancillary chunk used by C2PA to carry a JUMBF-wrapped manifest store.",
      });
    } else if (type === "eXIf") {
      signals.push({
        kind: "exif",
        location: "PNG chunk eXIf",
        description: "Standard PNG EXIF metadata chunk.",
      });
    } else if (type === "iTXt" || type === "tEXt" || type === "zTXt") {
      const keyword = readAsciiSlice(bytes, dataStart, Math.min(dataEnd, dataStart + 79)).split("\0")[0] ?? "";
      if (/xmp/i.test(keyword)) {
        signals.push({
          kind: "xmp",
          location: `PNG chunk ${type} (keyword "${keyword}")`,
          description: "Textual chunk carrying an embedded XMP metadata packet.",
        });
      }
    }

    offset = dataEnd + 4; // skip CRC
  }

  return signals;
}

const APP_MARKERS_WITH_LENGTH_START = 0xe0;
const APP_MARKERS_WITH_LENGTH_END = 0xef;
const SOS_MARKER = 0xda;
const MARKERS_WITHOUT_PAYLOAD = new Set([0xd8, 0xd9, 0x01]);

function inspectJpeg(bytes: Uint8Array): ProvenanceSignal[] {
  const signals: ProvenanceSignal[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2; // skip SOI

  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === undefined) break;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (MARKERS_WITHOUT_PAYLOAD.has(marker) || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === SOS_MARKER || marker === 0xd9) break;
    if (offset + 4 > bytes.length) break;

    const segmentLength = view.getUint16(offset + 2, false);
    const payloadStart = offset + 4;
    const payloadEnd = offset + 2 + segmentLength;
    if (payloadEnd > bytes.length) break;

    if (marker >= APP_MARKERS_WITH_LENGTH_START && marker <= APP_MARKERS_WITH_LENGTH_END) {
      const appNumber = marker - 0xe0;
      const prefix = readAsciiSlice(bytes, payloadStart, Math.min(payloadEnd, payloadStart + 32));

      const isJpegXtJumbf =
        appNumber === 11 &&
        prefix.startsWith("JP") &&
        payloadEnd - payloadStart >= 8 &&
        hasJumbfManifestBox(bytes, payloadStart + 8, payloadEnd);

      if (isJpegXtJumbf) {
        signals.push({
          kind: "c2pa-jumbf",
          location: "JPEG APP11 segment",
          description:
            "APP11 marker segment consistent with a JPEG XT/ISO 19566-5 JUMBF box, the container C2PA uses for JPEG manifests.",
        });
      } else if (appNumber === 1 && prefix.startsWith("Exif\0\0")) {
        signals.push({
          kind: "exif",
          location: "JPEG APP1 segment (Exif)",
          description: "Standard JPEG EXIF metadata segment.",
        });
      } else if (appNumber === 1 && prefix.startsWith("http://ns.adobe.com/xap/1.0/")) {
        signals.push({
          kind: "xmp",
          location: "JPEG APP1 segment (XMP)",
          description: "Embedded XMP metadata packet.",
        });
      } else if (appNumber === 13 && prefix.startsWith("Photoshop 3.0")) {
        signals.push({
          kind: "photoshop-iptc",
          location: "JPEG APP13 segment",
          description: "Photoshop IPTC/IIM metadata segment.",
        });
      }
    }

    offset = payloadEnd;
  }

  return signals;
}

function inspectSvg(bytes: Uint8Array): ProvenanceSignal[] {
  const signals: ProvenanceSignal[] = [];
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

  if (/<c2pa:manifest\b/i.test(text)) {
    signals.push({
      kind: "c2pa-jumbf",
      location: "SVG c2pa namespace/element",
      description: "SVG document declares a c2pa: namespace or <c2pa:manifest> element referencing a manifest.",
    });
  }

  if (/<x:xmpmeta\b|xmlns:xmp\s*=/i.test(text)) {
    signals.push({
      kind: "xmp",
      location: "SVG XMP metadata block",
      description: "SVG document embeds an XMP metadata packet.",
    });
  }

  return signals;
}

export function inspectProvenance(bytes: Uint8Array, filename?: string): ProvenanceInspection {
  const fileType = detectFileType(bytes);
  let signals: ProvenanceSignal[] = [];

  if (fileType === "png") signals = inspectPng(bytes);
  else if (fileType === "jpeg") signals = inspectJpeg(bytes);
  else if (fileType === "svg") signals = inspectSvg(bytes);

  return {
    filename: filename ?? null,
    fileType,
    hasC2paCandidate: signals.some((signal) => signal.kind === "c2pa-jumbf"),
    signals,
    verification: {
      status: "not-performed",
      explanation: VERIFICATION_EXPLANATION,
    },
  };
}
