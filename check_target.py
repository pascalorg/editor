import urllib.request
import json

try:
    req = urllib.request.Request('https://api.github.com/repos/ovurrsl/digitaltwin/commits')
    req.add_header('Accept', 'application/vnd.github.v3+json')
    with urllib.request.urlopen(req) as response:
        commits = json.loads(response.read())
        
    print(f"Latest commit on digitaltwin:")
    print(f"Message: {commits[0]['commit']['message']}")
    print(f"Date: {commits[0]['commit']['author']['date']}")
except Exception as e:
    print(f"Error: {e}")
