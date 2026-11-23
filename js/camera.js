export class CameraManager {
  constructor(videoEl) {
    this.video = videoEl;
    this.stream = null;
    this.devices = [];
    this.currentFacing = 'environment';
    this.currentDeviceId = null;
  }
  async listCameras() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    this.devices = devices.filter(d => d.kind === 'videoinput');
    return this.devices;
  }
  async start(facing = 'environment', deviceId = null) {
    this.stop();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia not supported');
    const constraints = {
      audio: false,
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        : { facingMode: facing === 'user' ? 'user' : { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.stream = stream;
    this.video.srcObject = stream;
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    await this.video.play().catch(() => {});
    this.currentFacing = facing;
    this.currentDeviceId = deviceId;
    await this.listCameras();
    return stream;
  }
  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  }
  async capture() {
    if (!this.stream) throw new Error('Camera not started');
    const v = this.video;
    const w = v.videoWidth || 1280;
    const h = v.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(v, 0, 0, w, h);
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve({ blob, width: w, height: h }) : reject(new Error('Blob failed')), 'image/jpeg', 0.92);
    });
  }
}

export async function annotateImage(blob, meta) {
  const img = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = img.width; canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const barH = Math.max(140, Math.round(img.height * 0.12));
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, img.height - barH, img.width, barH);
  const fontSize = Math.round(barH * 0.13);
  const pad = Math.round(fontSize * 0.7);
  ctx.fillStyle = '#00e5ff';
  ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  const fmt = v => (v == null || isNaN(v)) ? '—' : Number(v).toFixed(1);
  const lines = [
    `Yaw ${fmt(meta.yaw)}°   Pitch ${fmt(meta.pitch)}°   Roll ${fmt(meta.roll)}°`,
    `Rel ${fmt(meta.relativeYaw)}° / ${fmt(meta.relativePitch)}° / ${fmt(meta.relativeRoll)}°`,
    `${meta.timestamp}   ${meta.sessionId}`
  ];
  let y = img.height - barH + pad;
  for (const line of lines) { ctx.fillText(line, pad, y); y += fontSize * 1.35; }
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('annotate failed')), 'image/jpeg', 0.92);
  });
}

/**
 * Save photo to the device gallery.
 * - iOS Safari 15.4+: opens Web Share Sheet → user taps "Save Image"
 * - Android Chrome & others: triggers download → appears in Gallery/Downloads
 * Both are initiated by user gesture (button click) so browsers allow them.
 */
export async function savePhotoToDevice(blob, fileName) {
  try {
    if (navigator.canShare) {
      const file = new File([blob], fileName, { type: blob.type || 'image/jpeg' });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'AngleLab', text: 'Research photo' });
          return { method: 'share', ok: true };
        } catch (e) {
          if (e.name === 'AbortError') return { method: 'share', ok: false, cancelled: true };
          // NotAllowedError etc → fall through
        }
      }
    }
  } catch {}
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return { method: 'download', ok: true };
  } catch (e) {
    return { method: 'none', ok: false, error: e.message };
  }
}