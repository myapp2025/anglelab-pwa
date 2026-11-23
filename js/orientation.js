export function eulerToQuat(alphaDeg, betaDeg, gammaDeg) {
  const a = alphaDeg * Math.PI / 180;
  const b = betaDeg * Math.PI / 180;
  const g = gammaDeg * Math.PI / 180;
  const ca = Math.cos(a/2), sa = Math.sin(a/2);
  const cb = Math.cos(b/2), sb = Math.sin(b/2);
  const cg = Math.cos(g/2), sg = Math.sin(g/2);
  return {
    w: ca*cb*cg - sa*sb*sg,
    x: ca*sb*cg - sa*cb*sg,
    y: ca*cb*sg + sa*sb*cg,
    z: sa*cb*cg + ca*sb*sg
  };
}

export function quatMul(a, b) {
  return {
    w: a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z,
    x: a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
    y: a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
    z: a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w
  };
}
export const quatConj = q => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

export function quatToMatrix(q) {
  const { x, y, z, w } = q;
  const xx = x*x, yy = y*y, zz = z*z, xy = x*y, xz = x*z, yz = y*z;
  const wx = w*x, wy = w*y, wz = w*z;
  return [
    [1-2*(yy+zz), 2*(xy-wz),   2*(xz+wy)],
    [2*(xy+wz),   1-2*(xx+zz), 2*(yz-wx)],
    [2*(xz-wy),   2*(yz+wx),   1-2*(xx+yy)]
  ];
}

// Extract intrinsic Z-X'-Y'' (matches DeviceOrientation convention) from relative quaternion
export function quatToEulerZXY(q) {
  const m = quatToMatrix(q);
  const r12 = m[0][1], r22 = m[1][1];
  const r31 = m[2][0], r32 = m[2][1], r33 = m[2][2];
  const b = Math.asin(Math.max(-1, Math.min(1, r32)));
  const a = Math.atan2(-r12, r22);
  const g = Math.atan2(-r31, r33);
  return {
    alpha: a * 180/Math.PI,
    beta: b * 180/Math.PI,
    gamma: g * 180/Math.PI
  };
}

export class OrientationTracker {
  constructor(onUpdate) {
    this.onUpdate = onUpdate;
    this.enabled = false;
    this.reference = null;
    this.lastQuat = { x: 0, y: 0, z: 0, w: 1 };
    this.lastRaw = null;
    this.hasAbsolute = false;
    this.sensorSource = 'none';
    this._handler = e => this._onEvent(e);
  }
  static async requestPermission() {
    if (typeof DeviceOrientationEvent === 'undefined') return 'unavailable';
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try { return await DeviceOrientationEvent.requestPermission(); }
      catch { return 'denied'; }
    }
    return 'granted';
  }
  start() {
    if (this.enabled) return;
    window.addEventListener('deviceorientationabsolute', this._handler, true);
    window.addEventListener('deviceorientation', this._handler, true);
    this.enabled = true;
  }
  stop() {
    window.removeEventListener('deviceorientationabsolute', this._handler, true);
    window.removeEventListener('deviceorientation', this._handler, true);
    this.enabled = false;
  }
  _onEvent(e) {
    if (e.alpha == null && e.beta == null && e.gamma == null) return;
    const alpha = e.alpha || 0, beta = e.beta || 0, gamma = e.gamma || 0;
    this.hasAbsolute = e.absolute === true || e.type === 'deviceorientationabsolute';
    this.sensorSource = e.type;
    const q = eulerToQuat(alpha, beta, gamma);
    this.lastQuat = q;
    this.lastRaw = { alpha, beta, gamma, absolute: this.hasAbsolute, timestamp: e.timeStamp || performance.now() };
    let relative = null;
    if (this.reference) {
      const qRel = quatMul(q, quatConj(this.reference.quat));
      relative = quatToEulerZXY(qRel);
    }
    this.onUpdate({
      raw: this.lastRaw, quaternion: q, relative,
      hasAbsolute: this.hasAbsolute, sensorSource: this.sensorSource
    });
  }
  setReference() {
    this.reference = { quat: { ...this.lastQuat }, raw: this.lastRaw ? { ...this.lastRaw } : null, timestamp: Date.now() };
  }
  clearReference() { this.reference = null; }
}