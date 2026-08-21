import urllib.request
import json
import zipfile
import io

# Get jobs for the run
req = urllib.request.Request('https://api.github.com/repos/ovurrsl/editor/actions/runs/32347784303/jobs')
req.add_header('Accept', 'application/vnd.github.v3+json')
with urllib.request.urlopen(req) as response:
    jobs_data = json.loads(response.read())

job_id = jobs_data['jobs'][0]['id']

# Download the log for the job
log_req = urllib.request.Request(f'https://api.github.com/repos/ovurrsl/editor/actions/jobs/{job_id}/logs')
try:
    with urllib.request.urlopen(log_req) as response:
        log_content = response.read().decode('utf-8')
        print(log_content[-2000:])
except Exception as e:
    print(f"Error downloading log: {e}")
