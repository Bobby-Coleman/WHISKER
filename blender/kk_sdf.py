# Vectorised signed-distance helpers (numpy), mirroring src/chars/sdf.ts so Blender sculpts match the game's shapes.
import numpy as np


def smin(a, b, k):
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def smax(a, b, k):
    return -smin(-a, -b, k)


def ellipsoid(c, r):
    cx, cy, cz = c
    rx, ry, rz = r

    def f(x, y, z):
        px, py, pz = (x - cx) / rx, (y - cy) / ry, (z - cz) / rz
        k0 = np.sqrt(px * px + py * py + pz * pz)
        qx, qy, qz = (x - cx) / (rx * rx), (y - cy) / (ry * ry), (z - cz) / (rz * rz)
        k1 = np.sqrt(qx * qx + qy * qy + qz * qz) + 1e-9
        return k0 * (k0 - 1.0) / k1
    return f


def sphere(c, r):
    cx, cy, cz = c
    return lambda x, y, z: np.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2) - r


def capsule(a, b, ra, rb=None):
    rb = ra if rb is None else rb
    a = np.asarray(a, float); b = np.asarray(b, float)
    ba = b - a
    bb = float(ba @ ba)

    def f(x, y, z):
        px, py, pz = x - a[0], y - a[1], z - a[2]
        h = np.clip((px * ba[0] + py * ba[1] + pz * ba[2]) / bb, 0.0, 1.0)
        return np.sqrt((px - ba[0] * h) ** 2 + (py - ba[1] * h) ** 2 + (pz - ba[2] * h) ** 2) - (ra + (rb - ra) * h)
    return f


def torus(c, axis, R, r):
    # Ring of major radius R around `axis` through `c`, tube radius r.
    c = np.asarray(c, float); ax = np.asarray(axis, float); ax = ax / np.linalg.norm(ax)

    def f(x, y, z):
        px, py, pz = x - c[0], y - c[1], z - c[2]
        h = px * ax[0] + py * ax[1] + pz * ax[2]
        qx, qy, qz = px - ax[0] * h, py - ax[1] * h, pz - ax[2] * h
        q = np.sqrt(qx * qx + qy * qy + qz * qz)
        return np.sqrt((q - R) ** 2 + h * h) - r
    return f


def union(k, *fs):
    def f(x, y, z):
        d = fs[0](x, y, z)
        for g in fs[1:]:
            d = smin(d, g(x, y, z), k)
        return d
    return f


def gradient(sdf, p, eps=1e-4):
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    g = np.stack([
        sdf(x + eps, y, z) - sdf(x - eps, y, z),
        sdf(x, y + eps, z) - sdf(x, y - eps, z),
        sdf(x, y, z + eps) - sdf(x, y, z - eps),
    ], axis=1)
    return g / (np.linalg.norm(g, axis=1, keepdims=True) + 1e-12)


def polygonize(sdf, lo, hi, step):
    # Marching cubes on a regular grid; returns (verts, faces) in the SDF's space.
    from skimage.measure import marching_cubes
    lo = np.asarray(lo, float); hi = np.asarray(hi, float)
    n = np.ceil((hi - lo) / step).astype(int) + 1
    xs = lo[0] + np.arange(n[0]) * step
    ys = lo[1] + np.arange(n[1]) * step
    zs = lo[2] + np.arange(n[2]) * step
    X, Y, Z = np.meshgrid(xs, ys, zs, indexing='ij')
    field = sdf(X, Y, Z).astype(np.float32)
    verts, faces, _, _ = marching_cubes(field, level=0.0, spacing=(step, step, step))
    verts += lo
    # marching_cubes winds faces for increasing values outward; flip so normals point out of the solid (sdf > 0).
    return verts, faces[:, ::-1].copy()
