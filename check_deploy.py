import urllib.request
import json
import sys

try:
    req = urllib.request.Request('https://api.github.com/repos/ovurrsl/editor/actions/workflows/deploy-bundle.yml/runs?branch=integration&per_page=1')
    req.add_header('Accept', 'application/vnd.github.v3+json')
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read())
        
    if not data.get('workflow_runs'):
        print("No runs found")
        sys.exit(0)
        
    run = data['workflow_runs'][0]
    print(f"Workflow: {run['name']}")
    print(f"Run ID: {run['id']}")
    print(f"Status: {run['status']}")
    print(f"Conclusion: {run['conclusion']}")
    print(f"Head SHA: {run['head_sha']}")
    print(f"Head Branch: {run['head_branch']}")
    print(f"Updated At: {run['updated_at']}")
except Exception as e:
    print(f"Error: {e}")
