import os, sys

def get_rel_files(root_dir, subpaths):
    files_map = {}
    excluded_dirs = {'node_modules', '.git', '.next', '.turbo', 'dist', '.vscode', '.agents', '.claude', '.cursor', '.codex', 'build'}
    for sub in subpaths:
        full_sub = os.path.join(root_dir, sub)
        if not os.path.exists(full_sub):
            continue
        for root, dirs, files in os.walk(full_sub):
            dirs[:] = [d for d in dirs if d not in excluded_dirs]
            for file in files:
                if file.endswith(('.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.html')):
                    full_path = os.path.join(root, file)
                    rel_to_sub = os.path.relpath(full_path, full_sub).replace('\\', '/')
                    # key by package/subpath/rel
                    key = f"{sub}/{rel_to_sub}"
                    files_map[key] = {
                        'full_path': full_path,
                        'size': os.path.getsize(full_path),
                        'lines': sum(1 for _ in open(full_path, 'r', encoding='utf-8', errors='ignore'))
                    }
    return files_map

def compare():
    v2_root = r'E:\Digital Twin V2'
    curr_root = r'E:\Digital Twin\editor'
    
    subpaths_v2 = [
        'packages/editor/src',
        'packages/ui/src',
        'packages/nodes/src',
        'packages/viewer/src',
        'packages/core/src',
        'packages/plugin-trees/src',
        'apps/editor/components',
        'apps/editor/app'
    ]
    
    subpaths_curr = [
        'packages/editor/src',
        'packages/ui/src',
        'packages/nodes/src',
        'packages/viewer/src',
        'packages/core/src',
        'packages/plugin-trees/src',
        'apps/editor/components',
        'apps/editor/app'
    ]
    
    v2_files = get_rel_files(v2_root, subpaths_v2)
    curr_files = get_rel_files(curr_root, subpaths_curr)
    
    v2_keys = set(v2_files.keys())
    curr_keys = set(curr_files.keys())
    
    missing_in_curr = sorted(list(v2_keys - curr_keys))
    new_in_curr = sorted(list(curr_keys - v2_keys))
    common = sorted(list(v2_keys & curr_keys))
    
    out_path = r'E:\Digital Twin\.agents\teamwork_preview_explorer_survey_frontend\raw_comparison.txt'
    with open(out_path, 'w', encoding='utf-8') as out:
        def p(s=""):
            print(s, flush=True)
            out.write(s + "\n")

        p("=== COMPARISON SUMMARY ===")
        p(f"V2 Total Frontend Files: {len(v2_keys)}")
        p(f"Current Total Frontend Files: {len(curr_keys)}")
        p(f"Files Missing in Current (in V2 only): {len(missing_in_curr)}")
        p(f"Files New in Current (in Current only): {len(new_in_curr)}")
        p(f"Common Files: {len(common)}")
        p()
        
        p("=== MISSING IN CURRENT (Legacy V2 Only) ===")
        for k in missing_in_curr:
            info = v2_files[k]
            p(f"[-] {k} ({info['lines']} lines, {info['size']} bytes)")
        p()
        
        p("=== NEW IN CURRENT (Current Only) ===")
        for k in new_in_curr:
            info = curr_files[k]
            p(f"[+] {k} ({info['lines']} lines, {info['size']} bytes)")
        p()
        
        p("=== MODIFIED / DIVERGENT FILES (Line Count Diff > 20) ===")
        for k in common:
            v2_lines = v2_files[k]['lines']
            curr_lines = curr_files[k]['lines']
            diff = curr_lines - v2_lines
            if abs(diff) > 20:
                p(f"[*] {k}: V2={v2_lines} lines vs Current={curr_lines} lines (diff: {diff:+d})")

if __name__ == '__main__':
    compare()


