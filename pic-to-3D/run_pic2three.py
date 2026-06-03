import copy
import json
import mimetypes
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


COMFYUI_BASE_URL = "http://192.168.100.250:8188"
WORKFLOW_FILE = "pic2threeAPI.json"
INPUT_IMAGE = "test.jpg"
OUTPUT_FALLBACK_NAME = "pic2three_output.glb"
LOAD_IMAGE_NODE_ID = "56"


def http_json(method, path, payload=None, timeout=30):
    url = f"{COMFYUI_BASE_URL}{path}"
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = Request(url, data=data, headers=headers, method=method)
    with urlopen(request, timeout=timeout) as response:
        body = response.read()
    return json.loads(body.decode("utf-8")) if body else {}


def upload_image(image_path):
    boundary = f"----ComfyUIBoundary{uuid.uuid4().hex}"
    content_type = mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"
    file_bytes = image_path.read_bytes()

    parts = [
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="image"; filename="{image_path.name}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode("utf-8"),
        file_bytes,
        (
            f"\r\n--{boundary}\r\n"
            'Content-Disposition: form-data; name="overwrite"\r\n\r\n'
            "true\r\n"
        ).encode("utf-8"),
        (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="type"\r\n\r\n'
            "input\r\n"
            f"--{boundary}--\r\n"
        ).encode("utf-8"),
    ]
    body = b"".join(parts)

    request = Request(
        f"{COMFYUI_BASE_URL}/upload/image",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def queue_prompt(prompt):
    client_id = str(uuid.uuid4())
    response = http_json("POST", "/prompt", {"prompt": prompt, "client_id": client_id}, timeout=30)
    return response["prompt_id"]


def wait_for_history(prompt_id, poll_interval=2, timeout=1800):
    deadline = time.time() + timeout
    while time.time() < deadline:
        history = http_json("GET", f"/history/{prompt_id}", timeout=30)
        if prompt_id in history:
            record = history[prompt_id]
            status = record.get("status", {})
            if status.get("status_str") == "error":
                messages = status.get("messages", [])
                raise RuntimeError(f"ComfyUI prompt failed: {messages}")
            return record
        time.sleep(poll_interval)
    raise TimeoutError(f"Timed out waiting for prompt {prompt_id}")


def collect_glb_outputs(value):
    found = []
    if isinstance(value, dict):
        filename = value.get("filename")
        if isinstance(filename, str) and filename.lower().endswith(".glb"):
            found.append(
                {
                    "filename": filename,
                    "subfolder": value.get("subfolder", ""),
                    "type": value.get("type", "output"),
                }
            )
        for child in value.values():
            found.extend(collect_glb_outputs(child))
    elif isinstance(value, list):
        for child in value:
            found.extend(collect_glb_outputs(child))
    return found


def download_output(output_info, destination):
    params = urlencode(
        {
            "filename": output_info["filename"],
            "subfolder": output_info.get("subfolder", ""),
            "type": output_info.get("type", "output"),
        }
    )
    with urlopen(f"{COMFYUI_BASE_URL}/view?{params}", timeout=120) as response:
        destination.write_bytes(response.read())


def main():
    script_dir = Path(__file__).resolve().parent
    workflow_path = script_dir / WORKFLOW_FILE
    image_path = script_dir / INPUT_IMAGE

    if not workflow_path.exists():
        raise FileNotFoundError(f"Workflow not found: {workflow_path}")
    if not image_path.exists():
        raise FileNotFoundError(f"Input image not found: {image_path}")

    workflow = json.loads(workflow_path.read_text(encoding="utf-8"))

    uploaded = upload_image(image_path)
    image_name = uploaded["name"]
    if uploaded.get("subfolder"):
        image_name = f"{uploaded['subfolder']}/{image_name}"

    prompt = copy.deepcopy(workflow)
    prompt[LOAD_IMAGE_NODE_ID]["inputs"]["image"] = image_name

    print(f"Uploaded image: {image_name}")
    prompt_id = queue_prompt(prompt)
    print(f"Queued prompt: {prompt_id}")

    history = wait_for_history(prompt_id)
    glb_outputs = collect_glb_outputs(history.get("outputs", {}))
    if not glb_outputs:
        raise RuntimeError("Prompt completed, but no .glb output was found in ComfyUI history.")

    output_info = glb_outputs[-1]
    destination = script_dir / (Path(output_info["filename"]).name or OUTPUT_FALLBACK_NAME)
    if destination.suffix.lower() != ".glb":
        destination = script_dir / OUTPUT_FALLBACK_NAME

    download_output(output_info, destination)
    print(f"Saved GLB: {destination}")


if __name__ == "__main__":
    try:
        main()
    except (HTTPError, URLError, TimeoutError, RuntimeError, FileNotFoundError, KeyError) as exc:
        raise SystemExit(f"Error: {exc}")
