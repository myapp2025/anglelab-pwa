import { DB } from './db.js';
import { createZip } from './zip.js';

async function photoToRecord(p) {
  return {
    session_id: p.sessionId,
    photo_id: p.id,
    timestamp: p.timestamp,
    sensor_timestamp: p.sensorTimestamp || null,
    yaw: p.yaw ?? null, pitch: p.pitch ?? null, roll: p.roll ?? null,
    relative_yaw: p.relativeYaw ?? null,
    relative_pitch: p.relativePitch ?? null,
    relative_roll: p.relativeRoll ?? null,
    quaternion: p.quaternion || null,
    reference_set: !!p.referenceSet,
    sensor_source: p.sensorSource || 'unknown',
    sensor_accuracy: p.sensorAccuracy || 'unknown',
    sensor_available: p.sensorAvailable !== false,
    image: {
      mime: p.mimeType, width: p.width, height: p.height,
      size_bytes: p.sizeBytes || (p.blob ? p.blob.size : null),
      file: `photos/${p.id}.jpg`,
      annotated_file: p.annotatedBlob ? `photos/${p.id}_annotated.jpg` : null
    }
  };
}

export async function exportSessionJSON(sessionId) {
  const session = await DB.getSession(sessionId);
  const photos = await DB.listPhotos(sessionId);
  const records = await Promise.all(photos.map(photoToRecord));
  const data = {
    schema: 'anglelab-pwa/v1',
    exported_at: new Date().toISOString(),
    session: { id: session.id, name: session.name, notes: session.notes || '', created_at: session.createdAt, updated_at: session.updatedAt },
    photos: records
  };
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const numOr = v => (v == null || isNaN(v)) ? '' : String(v);

export async function exportSessionCSV(sessionId) {
  const photos = await DB.listPhotos(sessionId);
  const headers = [
    'photo_id','session_id','timestamp','sensor_timestamp',
    'yaw','pitch','roll','relative_yaw','relative_pitch','relative_roll',
    'quat_x','quat_y','quat_z','quat_w','reference_set',
    'sensor_source','sensor_accuracy','sensor_available',
    'width','height','size_bytes','file'
  ];
  const rows = [headers.join(',')];
  for (const p of photos) {
    const q = p.quaternion || {};
    rows.push([
      p.id, p.sessionId, p.timestamp, p.sensorTimestamp || '',
      numOr(p.yaw), numOr(p.pitch), numOr(p.roll),
      numOr(p.relativeYaw), numOr(p.relativePitch), numOr(p.relativeRoll),
      numOr(q.x), numOr(q.y), numOr(q.z), numOr(q.w),
      p.referenceSet ? 'true' : 'false',
      p.sensorSource || '', p.sensorAccuracy || '',
      p.sensorAvailable === false ? 'false' : 'true',
      p.width || '', p.height || '',
      p.sizeBytes || (p.blob ? p.blob.size : ''),
      `photos/${p.id}.jpg`
    ].map(csvCell).join(','));
  }
  return new Blob([rows.join('\n')], { type: 'text/csv' });
}

export async function exportSessionZIP(sessionId) {
  const session = await DB.getSession(sessionId);
  const photos = await DB.listPhotos(sessionId);
  const files = [];
  const records = [];
  for (const p of photos) {
    records.push(await photoToRecord(p));
    if (p.blob) files.push({ name: `photos/${p.id}.jpg`, data: new Uint8Array(await p.blob.arrayBuffer()) });
    if (p.annotatedBlob) files.push({ name: `photos/${p.id}_annotated.jpg`, data: new Uint8Array(await p.annotatedBlob.arrayBuffer()) });
  }
  const metadata = {
    schema: 'anglelab-pwa/v1',
    exported_at: new Date().toISOString(),
    session: { id: session.id, name: session.name, notes: session.notes || '', created_at: session.createdAt, updated_at: session.updatedAt },
    photos: records
  };
  files.push({ name: 'metadata.json', data: new TextEncoder().encode(JSON.stringify(metadata, null, 2)) });
  const csvBlob = await exportSessionCSV(sessionId);
  files.push({ name: 'metadata.csv', data: new Uint8Array(await csvBlob.arrayBuffer()) });
  files.push({
    name: 'README.txt',
    data: new TextEncoder().encode(
      `AngleLab PWA Export\nSession: ${session.name}\nExported: ${metadata.exported_at}\n\n` +
      `- metadata.json / metadata.csv : full metadata\n- photos/ : original + annotated JPEGs\n\n` +
      `Sensor values come from the browser DeviceOrientation API. Accuracy varies by device.\n`
    )
  });
  return createZip(files);
}