import urllib.request
import json
import sys

try:
    req = urllib.request.Request('https://api.github.com/repos/ovurrsl/editor/actions/runs/32452807790')
    req.add_header('Accept', 'application/vnd.github.v3+json')
    with urllib.request.urlopen(req) as response:
        run = json.loads(response.read())
        
    print(f"Run ID: {run['id']}")
    print(f"Status: {run['status']}")
    print(f"Conclusion: {run['conclusion']}")
    print(f"Head SHA: {run['head_sha']}")
    print(f"Head Branch: {run['head_branch']}")
    print(f"Updated At: {run['updated_at']}")
except Exception as e:
    print(f"Error: {e}")
