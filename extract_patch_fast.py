def extract():
    with open(r'C:\Users\resul.ovur\.gemini\antigravity\brain\0c853378-1fc7-417f-af1a-42a5416e25b2\.system_generated\steps\952\content.md', 'r', encoding='utf-8') as f:
        in_file = False
        content = []
        for line in f:
            if line.startswith('+++ b/packages/plugin-articraft/package.json'):
                in_file = True
                continue
            if in_file and line.startswith('diff --git'):
                break
            if in_file:
                content.append(line)
        return "".join(content)

with open(r'e:\Digital Twin\editor\articraft_pkg.json', 'w', encoding='utf-8') as out:
    out.write(extract())
