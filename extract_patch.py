import re
with open(r'C:\Users\resul.ovur\.gemini\antigravity\brain\0c853378-1fc7-417f-af1a-42a5416e25b2\.system_generated\steps\952\content.md', 'r', encoding='utf-8') as f:
    data = f.read()

match = re.search(r'\+\+\+ b/packages/plugin-articraft/package\.json(.*?)\n(?:---|\Z)', data, re.DOTALL)
if match:
    print(match.group(1)[:1000])
else:
    print("Not found")
