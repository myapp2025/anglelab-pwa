const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function dosDateTime(d) {
  return {
    time: ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() >> 1) & 0x1F),
    date: (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0xF) << 5) | (d.getDate() & 0x1F)
  };
}

export async function createZip(files) {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(new Date());
  const parts = [], central = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
    const crc = crc32(data);
    const lh = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true);
    dv.setUint16(6, 0x0800, true); dv.setUint16(8, 0, true);
    dv.setUint16(10, time, true); dv.setUint16(12, date, true);
    dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true);
    dv.setUint16(26, nameBytes.length, true); dv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);
    parts.push(lh, data);

    const ch = new Uint8Array(46 + nameBytes.length);
    const dv2 = new DataView(ch.buffer);
    dv2.setUint32(0, 0x02014b50, true); dv2.setUint16(4, 20, true);
    dv2.setUint16(6, 20, true); dv2.setUint16(8, 0x0800, true);
    dv2.setUint16(10, 0, true); dv2.setUint16(12, time, true); dv2.setUint16(14, date, true);
    dv2.setUint32(16, crc, true); dv2.setUint32(20, data.length, true); dv2.setUint32(24, data.length, true);
    dv2.setUint16(28, nameBytes.length, true); dv2.setUint16(30, 0, true);
    dv2.setUint16(32, 0, true); dv2.setUint16(34, 0, true); dv2.setUint16(36, 0, true);
    dv2.setUint32(38, 0, true); dv2.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    central.push(ch);

    offset += lh.length + data.length;
  }

  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const dv3 = new DataView(eocd.buffer);
  dv3.setUint32(0, 0x06054b50, true); dv3.setUint16(4, 0, true); dv3.setUint16(6, 0, true);
  dv3.setUint16(8, files.length, true); dv3.setUint16(10, files.length, true);
  dv3.setUint32(12, centralSize, true); dv3.setUint32(16, offset, true); dv3.setUint16(20, 0, true);

  return new Blob([...parts, ...central, eocd], { type: 'application/zip' });
}