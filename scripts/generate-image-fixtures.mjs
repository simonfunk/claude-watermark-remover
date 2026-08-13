#!/usr/bin/env node
// Regenerates the representative binary fixtures under tests/fixtures/images/.
// Run manually with: node scripts/generate-image-fixtures.mjs
// These fixtures are intentionally minimal, structurally plausible PNG/JPEG files
// (not real photos) used to exercise the provenance chunk/segment walker in src/c2pa.ts.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures", "images");

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u32be(value) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(value >>> 0, 0);
  return buf;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  return Buffer.concat([u32be(data.length), body, u32be(crc32(body))]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function buildPng({ includeC2pa, includeXmp }) {
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0); // width
  ihdrData.writeUInt32BE(1, 4); // height
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: truecolor
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = pngChunk("IHDR", ihdrData);

  const chunks = [ihdr];

  if (includeC2pa) {
    // Approximates a C2PA JUMBF box embedded in the PNG-private "caBX" ancillary chunk.
    // Real JUMBF/CBOR manifest structure is far larger; this is a representative stand-in
    // that carries the recognizable "jumb"/"jumd"/"c2pa" box markers our inspector looks for.
    const jumd = Buffer.concat([Buffer.from("jumd", "ascii"), Buffer.from("c2pa", "ascii"), Buffer.alloc(8)]);
    const jumb = Buffer.concat([Buffer.from("jumb", "ascii"), jumd]);
    chunks.push(pngChunk("caBX", jumb));
  }

  if (includeXmp) {
    const xmpPacket = Buffer.from(
      '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"></rdf:RDF></x:xmpmeta><?xpacket end="w"?>',
      "utf8",
    );
    const keyword = Buffer.from("XML:com.adobe.xmp\0", "ascii");
    const flags = Buffer.from([0, 0]); // compression flag = 0, method = 0
    const langAndTranslated = Buffer.from("\0\0", "ascii"); // empty language tag + translated keyword
    chunks.push(pngChunk("iTXt", Buffer.concat([keyword, flags, langAndTranslated, xmpPacket])));
  }

  const raw = Buffer.from([0, 255, 0, 0]); // filter byte 0 + one RGB pixel
  chunks.push(pngChunk("IDAT", deflateSync(raw)));
  chunks.push(pngChunk("IEND", Buffer.alloc(0)));

  return Buffer.concat([PNG_SIGNATURE, ...chunks]);
}

function marker(code, payload) {
  if (payload === undefined) return Buffer.from([0xff, code]);
  const length = payload.length + 2;
  const lengthBuf = Buffer.alloc(2);
  lengthBuf.writeUInt16BE(length, 0);
  return Buffer.concat([Buffer.from([0xff, code]), lengthBuf, payload]);
}

function buildJpeg({ includeC2pa, includeXmp, includeExif }) {
  const segments = [Buffer.from([0xff, 0xd8])]; // SOI

  const jfif = Buffer.concat([
    Buffer.from("JFIF\0", "ascii"),
    Buffer.from([1, 1, 0]), // version 1.1, units 0
    Buffer.from([0, 1, 0, 1]), // Xdensity=1, Ydensity=1
    Buffer.from([0, 0]), // no thumbnail
  ]);
  segments.push(marker(0xe0, jfif));

  if (includeExif) {
    const tiffHeader = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]);
    segments.push(marker(0xe1, Buffer.concat([Buffer.from("Exif\0\0", "ascii"), tiffHeader])));
  }

  if (includeXmp) {
    const xmpPacket = Buffer.from(
      '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta><?xpacket end="w"?>',
      "utf8",
    );
    segments.push(marker(0xe1, Buffer.concat([Buffer.from("http://ns.adobe.com/xap/1.0/\0", "ascii"), xmpPacket])));
  }

  if (includeC2pa) {
    // Approximates a JPEG XT/ISO 19566-5 APP11 JUMBF box carrying a C2PA manifest store.
    const commonIdentifier = Buffer.from("JP", "ascii");
    const boxInstanceNumber = Buffer.from([0x00, 0x01]);
    const packetSequenceNumber = Buffer.from([0x00, 0x00, 0x00, 0x01]);
    const jumd = Buffer.concat([Buffer.from("jumd", "ascii"), Buffer.from("c2pa", "ascii"), Buffer.alloc(8)]);
    const jumb = Buffer.concat([Buffer.from("jumb", "ascii"), jumd]);
    segments.push(
      marker(0xeb, Buffer.concat([commonIdentifier, boxInstanceNumber, packetSequenceNumber, jumb])),
    );
  }

  segments.push(marker(0xda, Buffer.from([0x00, 0x01, 0x01, 0x00]))); // minimal SOS header
  segments.push(Buffer.from([0x00])); // dummy entropy-coded byte
  segments.push(Buffer.from([0xff, 0xd9])); // EOI

  return Buffer.concat(segments);
}

function buildSvg({ includeC2pa, includeXmp }) {
  const c2paNamespace = includeC2pa ? ' xmlns:c2pa="http://c2pa.org/manifest"' : "";
  const c2paElement = includeC2pa
    ? '<c2pa:manifest c2pa:manifest_uri="data:application/c2pa;base64,AAAA=="/>'
    : "";
  const xmpMetadata = includeXmp
    ? '<metadata><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"></rdf:RDF></x:xmpmeta></metadata>'
    : "";

  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"${c2paNamespace} width="10" height="10" viewBox="0 0 10 10">\n${xmpMetadata}${c2paElement}<rect width="10" height="10" fill="#fff"/>\n</svg>\n`,
    "utf8",
  );
}

const fixtures = {
  "clean.png": buildPng({ includeC2pa: false, includeXmp: false }),
  "c2pa.png": buildPng({ includeC2pa: true, includeXmp: true }),
  "clean.jpg": buildJpeg({ includeC2pa: false, includeXmp: false, includeExif: false }),
  "c2pa.jpg": buildJpeg({ includeC2pa: true, includeXmp: true, includeExif: true }),
  "exif-only.jpg": buildJpeg({ includeC2pa: false, includeXmp: false, includeExif: true }),
  "clean.svg": buildSvg({ includeC2pa: false, includeXmp: false }),
  "c2pa.svg": buildSvg({ includeC2pa: true, includeXmp: true }),
};

for (const [name, buffer] of Object.entries(fixtures)) {
  writeFileSync(path.join(outDir, name), buffer);
  console.log(`wrote ${name} (${buffer.length} bytes)`);
}
