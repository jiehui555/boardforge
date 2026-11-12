/**
 * Minimal, dependency-free binary STL writer.
 *
 * STL is unitless, so the exported coordinates stay in millimetres. The format
 * stores an 80-byte header, a little-endian uint32 triangle count, then 50 bytes
 * per triangle: normal (3 × float32), three vertices (9 × float32), attribute.
 */

const HEADER_BYTES = 80;
const TRIANGLE_BYTES = 50;

function writeAsciiHeader(bytes, text) {
  const encoded = new TextEncoder().encode(text);
  const length = Math.min(encoded.length, HEADER_BYTES - 1);
  bytes.fill(0x20, 0, HEADER_BYTES);
  bytes.set(encoded.subarray(0, length), 0);
}

function normalize(x, y, z) {
  const length = Math.hypot(x, y, z);
  if (length < 1e-12) return [0, 0, 0];
  return [x / length, y / length, z / length];
}

export function binaryStlTriangleCount(geometry) {
  const position = geometry.getAttribute('position');
  if (!position) return 0;
  return geometry.index ? Math.floor(geometry.index.count / 3) : Math.floor(position.count / 3);
}

/**
 * @param {import('three').BufferGeometry} geometry
 * @param {{name?: string}} [options]
 * @returns {ArrayBuffer}
 */
export function createBinaryStl(geometry, options = {}) {
  const position = geometry.getAttribute('position');
  if (!position) {
    throw new Error('模型没有顶点数据，无法导出 STL。');
  }

  const index = geometry.index;
  const triangleCount = binaryStlTriangleCount(geometry);
  if (triangleCount <= 0) {
    throw new Error('模型没有可导出的三角面。');
  }
  if (triangleCount > 0xffffffff) {
    throw new Error('模型面数超过 STL 格式上限。');
  }

  const buffer = new ArrayBuffer(HEADER_BYTES + 4 + triangleCount * TRIANGLE_BYTES);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const headerName = String(options.name || 'BoardForge board').replace(/[\r\n]/g, ' ').trim();
  writeAsciiHeader(
    bytes,
    `BoardForge binary STL | millimetres | ${headerName}`.slice(0, HEADER_BYTES),
  );
  view.setUint32(HEADER_BYTES, triangleCount, true);

  let offset = HEADER_BYTES + 4;

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const source = triangle * 3;
    const a = index ? index.getX(source) : source;
    const b = index ? index.getX(source + 1) : source + 1;
    const c = index ? index.getX(source + 2) : source + 2;

    const ax = position.getX(a);
    const ay = position.getY(a);
    const az = position.getZ(a);
    const bx = position.getX(b);
    const by = position.getY(b);
    const bz = position.getZ(b);
    const cx = position.getX(c);
    const cy = position.getY(c);
    const cz = position.getZ(c);

    if (
      !Number.isFinite(ax) ||
      !Number.isFinite(ay) ||
      !Number.isFinite(az) ||
      !Number.isFinite(bx) ||
      !Number.isFinite(by) ||
      !Number.isFinite(bz) ||
      !Number.isFinite(cx) ||
      !Number.isFinite(cy) ||
      !Number.isFinite(cz)
    ) {
      throw new Error('模型包含无效顶点坐标，已取消 STL 导出。');
    }

    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const [nx, ny, nz] = normalize(
      aby * acz - abz * acy,
      abz * acx - abx * acz,
      abx * acy - aby * acx,
    );

    view.setFloat32(offset, nx, true);
    view.setFloat32(offset + 4, ny, true);
    view.setFloat32(offset + 8, nz, true);
    view.setFloat32(offset + 12, ax, true);
    view.setFloat32(offset + 16, ay, true);
    view.setFloat32(offset + 20, az, true);
    view.setFloat32(offset + 24, bx, true);
    view.setFloat32(offset + 28, by, true);
    view.setFloat32(offset + 32, bz, true);
    view.setFloat32(offset + 36, cx, true);
    view.setFloat32(offset + 40, cy, true);
    view.setFloat32(offset + 44, cz, true);
    view.setUint16(offset + 48, 0, true);
    offset += TRIANGLE_BYTES;
  }

  return buffer;
}

export function stlByteLength(triangleCount) {
  return HEADER_BYTES + 4 + triangleCount * TRIANGLE_BYTES;
}
