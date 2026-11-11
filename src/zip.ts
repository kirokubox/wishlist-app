// 写真つきバックアップ用の最小ZIP読み書き。画像はすでにJPEG圧縮済みなので、書き出しは無圧縮にする。
export type ZipInputFile = { path: string; blob: Blob };
export type ZipEntry = { path: string; blob: Blob };

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const UTF8 = 0x0800;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export async function createZipBlob(files: ZipInputFile[], modifiedAt: Date): Promise<Blob> {
  const encoder = new TextEncoder();
  const stamp = dosDateTime(modifiedAt);
  const parts: BlobPart[] = [];
  const planned: { name: Uint8Array; crc: number; size: number; offset: number }[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.path);
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    const crc = crc32(bytes);
    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, LOCAL, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, UTF8, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, stamp.time, true);
    view.setUint16(12, stamp.date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, bytes.length, true);
    view.setUint32(22, bytes.length, true);
    view.setUint16(26, name.length, true);
    header.set(name, 30);
    parts.push(header, file.blob);
    planned.push({ name, crc, size: bytes.length, offset });
    offset += header.length + bytes.length;
  }
  const centralStart = offset;
  let centralSize = 0;
  for (const item of planned) {
    const record = new Uint8Array(46 + item.name.length);
    const view = new DataView(record.buffer);
    view.setUint32(0, CENTRAL, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, UTF8, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, stamp.time, true);
    view.setUint16(14, stamp.date, true);
    view.setUint32(16, item.crc, true);
    view.setUint32(20, item.size, true);
    view.setUint32(24, item.size, true);
    view.setUint16(28, item.name.length, true);
    view.setUint32(42, item.offset, true);
    record.set(item.name, 46);
    parts.push(record);
    centralSize += record.length;
  }
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, END, true);
  view.setUint16(8, planned.length, true);
  view.setUint16(10, planned.length, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralStart, true);
  parts.push(end);
  return new Blob(parts, { type: "application/zip" });
}

async function inflateRaw(blob: Blob): Promise<Blob> {
  if (typeof DecompressionStream !== "function") throw new Error("このブラウザでは圧縮されたZIPを読み込めません");
  return new Response(blob.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
}

async function findEnd(blob: Blob): Promise<DataView> {
  const length = Math.min(blob.size, 66000);
  const tail = new Uint8Array(await blob.slice(blob.size - length).arrayBuffer());
  const view = new DataView(tail.buffer);
  for (let index = tail.length - 22; index >= 0; index -= 1) if (view.getUint32(index, true) === END) return new DataView(tail.buffer, index);
  throw new Error("ZIPファイルとして読み込めませんでした");
}

export async function readZipEntries(blob: Blob): Promise<ZipEntry[]> {
  const end = await findEnd(blob);
  const centralSize = end.getUint32(12, true);
  const centralStart = end.getUint32(16, true);
  const total = end.getUint16(10, true);
  const bytes = new Uint8Array(await blob.slice(centralStart, centralStart + centralSize).arrayBuffer());
  const view = new DataView(bytes.buffer);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let cursor = 0;
  for (let index = 0; index < total; index += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== CENTRAL) throw new Error("ZIPの構造を読み取れませんでした");
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const path = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)).replace(/\\/g, "/");
    cursor += 46 + nameLength + extraLength + commentLength;
    if (path.endsWith("/")) continue;
    const local = new DataView(await blob.slice(localOffset, localOffset + 30).arrayBuffer());
    if (local.byteLength < 30 || local.getUint32(0, true) !== LOCAL) throw new Error("ZIPの構造を読み取れませんでした");
    const start = localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
    const raw = blob.slice(start, start + compressedSize);
    if (method === 0) entries.push({ path, blob: raw });
    else if (method === 8) entries.push({ path, blob: await inflateRaw(raw) });
    else throw new Error(`ZIP内の「${path}」は対応していない圧縮形式です`);
  }
  return entries;
}
