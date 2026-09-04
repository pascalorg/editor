from articraft_worker.generation import _joints, _parts, _public_manifest, _title
from articraft_worker.models import Artifact, CatalogItem


def test_normalizes_viewer_metadata() -> None:
    parts = _parts([{"name": "lid", "usd_name": "lid_1"}])
    joints = _joints(
        [
            {
                "name": "hinge",
                "type": "revolute",
                "parent": "body",
                "child": "lid",
                "axis": [0, 1, 0],
                "origin": {"xyz": [1, 2, 3], "rpy": [0, 0, 0]},
                "motion_limits": {"lower": -1.2, "upper": 0.4},
            }
        ]
    )

    assert parts[0].objectName == "lid_1"
    assert joints[0].limits is not None
    assert joints[0].limits.lower == -1.2
    assert joints[0].axis == (0.0, 1.0, 0.0)


def test_title_is_bounded() -> None:
    assert _title("  a   folding desk lamp with a blue shade  ") == (
        "A folding desk lamp with a blue shade"
    )


def test_public_manifest_omits_generation_prompt() -> None:
    item = CatalogItem(
        id="generated:abc123",
        title="Folding lamp",
        artifact=Artifact(url="https://assets.invalid/model.usdz", sha256="abc123"),
        dimensions=(1.0, 1.0, 1.0),
        parts=[],
        joints=[],
        defaultJointValues={},
        prompt="private reconstruction details",
    )

    manifest = _public_manifest(item)

    assert "prompt" not in manifest
    assert manifest["id"] == "generated:abc123"
