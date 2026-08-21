import urllib.request
import json
import sys

try:
    req = urllib.request.Request('https://api.github.com/repos/ovurrsl/editor/actions/runs/32452710061/jobs')
    req.add_header('Accept', 'application/vnd.github.v3+json')
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read())
        
    for job in data.get('jobs', []):
        if job['conclusion'] != 'success':
            print(f"Job Name: {job['name']}")
            print(f"Status: {job['status']}")
            print(f"Conclusion: {job['conclusion']}")
            for step in job.get('steps', []):
                if step['conclusion'] != 'success':
                    print(f"  Failed Step: {step['name']}")
            print("-" * 20)
except Exception as e:
    print(f"Error: {e}")
