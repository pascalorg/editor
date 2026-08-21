import sys
with open(r'C:\Users\resul.ovur\.gemini\antigravity\brain\0c853378-1fc7-417f-af1a-42a5416e25b2\.system_generated\steps\952\content.md', 'r', encoding='utf-8') as f:
    content = f.read()

idx = content.find('+++ b/packages/plugin-articraft/package.json')
if idx != -1:
    print(content[idx:idx+1000])
else:
    print("Not found")
