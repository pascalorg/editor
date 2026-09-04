"""Axis conversion between Pascal (three.js, Y-up RH) and Blender (Z-up RH).

Convention (same permutation the bundled glTF importer uses; baked into data,
no compensating root rotation):

    location  (x, y, z)_pascal  ->  (x, -z, y)_blender
    plan pair [x, z]_pascal     ->  (x, -z) on the Blender XY plane
    scale     (x, y, z)         ->  (x, z, y)
    euler XYZ (rx, ry, rz)      ->  (rx, -rz, ry)   (rotation about permuted axes)
    scalar Y-rotation r         ->  rotation_euler.z = -r

All inverses are exact (sign flips and permutations only).
"""
from __future__ import annotations

from typing import Sequence, Tuple

Vec3 = Tuple[float, float, float]


def loc_to_blender(v: Sequence[float]) -> Vec3:
    return (float(v[0]), -float(v[2]), float(v[1]))


def loc_to_pascal(v: Sequence[float]) -> Vec3:
    return (float(v[0]), float(v[2]), -float(v[1]))


def plan_to_blender(p: Sequence[float]) -> Tuple[float, float]:
    """Pascal plan [x, z] -> Blender (x, y) on the ground plane."""
    return (float(p[0]), -float(p[1]))


def plan_to_pascal(p: Sequence[float]) -> Tuple[float, float]:
    return (float(p[0]), -float(p[1]))


def scale_to_blender(v: Sequence[float]) -> Vec3:
    return (float(v[0]), float(v[2]), float(v[1]))


def scale_to_pascal(v: Sequence[float]) -> Vec3:
    return (float(v[0]), float(v[2]), float(v[1]))


def euler_to_blender(v: Sequence[float]) -> Vec3:
    """Pascal XYZ Euler triple -> Blender XYZ Euler triple.

    Rotation about Pascal X stays about Blender X; about Pascal Y (up) becomes
    about Blender Z (up); about Pascal Z becomes about Blender -Y.
    """
    return (float(v[0]), -float(v[2]), float(v[1]))


def euler_to_pascal(v: Sequence[float]) -> Vec3:
    return (float(v[0]), float(v[2]), -float(v[1]))


def yrot_to_blender(r: float) -> float:
    """Pascal scalar rotation about +Y -> Blender rotation about +Z.

    The axis map (x, y, z) -> (x, -z, y) is a PROPER rotation (rotX(+90°),
    det +1), so rotations about Pascal +Y conjugate to rotations about
    Blender +Z with the SAME sign (verified numerically: a guide plane's
    local (1,0,0) at ry=π/2 lands at Pascal world (0,0,-1) = Blender
    (0,1,0) = rotZ(+π/2)·(1,0,0)). Consistent with euler_to_blender's
    middle-axis handling and with wall_angle_blender.
    """
    return float(r)


def yrot_to_pascal(r: float) -> float:
    return float(r)


def wall_angle_blender(start: Sequence[float], end: Sequence[float]) -> float:
    """Blender Z rotation for a wall from Pascal plan start/end.

    The wall mesh runs along local +X. In Pascal the direction is
    (dx, dz); in Blender ground plane that vector is (dx, -dz).
    """
    import math

    dx = float(end[0]) - float(start[0])
    dz = float(end[1]) - float(start[1])
    return math.atan2(-dz, dx)


def wall_local_to_blender(v: Sequence[float]) -> Vec3:
    """Pascal wall-local (x along wall, y up, z out the front face)
    -> Blender wall-local (x along wall, y = -front, z up)."""
    return (float(v[0]), -float(v[2]), float(v[1]))


def wall_local_to_pascal(v: Sequence[float]) -> Vec3:
    return (float(v[0]), float(v[2]), -float(v[1]))
