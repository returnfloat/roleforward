// Reads one file out of a zip archive with Node's own zlib, so no unzip command is needed (Windows has none).
// Only the archive's directory and the matching entry are read; nothing is written to disk.
// Handles stored and deflated entries, which is what LinkedIn's data export and every common zip tool produce.

import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const read = (fd, pos, len) => { const b = Buffer.alloc(len); readSync(fd, b, 0, len, pos); return b; };

// The text of the first entry whose path matches the test, or null when none does.
export function readZipEntry(file, test) {
  const fd = openSync(file, 'r');
  try {
    // The directory's location is in the end record, in the last 22 bytes plus an optional comment of up to 64 KB.
    const size = fstatSync(fd).size, tailLen = Math.min(size, 22 + 0xffff), tail = read(fd, size - tailLen, tailLen);
    const end = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (end < 0) throw new Error(`${file} isn't a zip archive.`);
    const count = tail.readUInt16LE(end + 10), dirSize = tail.readUInt32LE(end + 12), dirAt = tail.readUInt32LE(end + 16);
    if (dirAt === 0xffffffff || count === 0xffff) throw new Error(`${file} is a zip64 archive, which isn't supported. Unzip it and import the CSV inside instead.`);
    const dir = read(fd, dirAt, dirSize);
    for (let p = 0, i = 0; i < count; i++) {
      if (dir.readUInt32LE(p) !== 0x02014b50) throw new Error(`${file}: damaged zip directory.`);
      const method = dir.readUInt16LE(p + 10), packed = dir.readUInt32LE(p + 20), nameLen = dir.readUInt16LE(p + 28);
      const skip = nameLen + dir.readUInt16LE(p + 30) + dir.readUInt16LE(p + 32), at = dir.readUInt32LE(p + 42);
      const name = dir.toString('utf8', p + 46, p + 46 + nameLen);
      p += 46 + skip;
      if (!test(name)) continue;
      // The entry's own header repeats the name and may carry a different extra field, so its length is read there.
      const head = read(fd, at, 30);
      const data = read(fd, at + 30 + head.readUInt16LE(26) + head.readUInt16LE(28), packed);
      if (method === 0) return data.toString('utf8');
      if (method === 8) return inflateRawSync(data).toString('utf8');
      throw new Error(`${name} in ${file} uses an unsupported compression method (${method}). Unzip it and import the CSV instead.`);
    }
    return null;
  } finally { closeSync(fd); }
}
