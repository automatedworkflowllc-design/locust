"""Read the three prompt-weight runs: what each session loaded, and how big
the first request's prompt was. Prints counts and numbers only."""
import json
import os
import sys

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'weight')

for name in ('a-locust', 'b-no-connectors', 'c-strict-mcp', 'd-tool-search', 'g-deny-all-but-one'):
    path = os.path.join(HERE, name + '.jsonl')
    if not os.path.exists(path):
        print(name, 'missing')
        continue
    init = None
    first = None
    result = None
    for line in open(path, encoding='utf-8'):
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except ValueError:
            continue
        kind = record.get('type')
        if kind == 'system' and record.get('subtype') == 'init' and init is None:
            init = record
        elif kind == 'assistant' and first is None:
            first = (record.get('message') or {}).get('usage') or {}
        elif kind == 'result':
            result = record
    tools = (init or {}).get('tools') or []
    mcp_tools = [t for t in tools if t.startswith('mcp__')]
    servers = (init or {}).get('mcp_servers') or []
    connected = [s for s in servers if (s.get('status') if isinstance(s, dict) else '') == 'connected']
    prompt = None
    if first is not None:
        prompt = sum(first.get(k) or 0 for k in ('input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'))
    print(f"{name:16} tools {len(tools):3} (mcp {len(mcp_tools):3})  servers {len(servers):2} connected {len(connected):2}  "
          f"skills {len((init or {}).get('skills') or []):3}  agents {len((init or {}).get('agents') or []):2}  plugins {len((init or {}).get('plugins') or []):2}  "
          f"| first prompt {prompt}  (in {first.get('input_tokens') if first else None}, write {first.get('cache_creation_input_tokens') if first else None}, "
          f"read {first.get('cache_read_input_tokens') if first else None})  | cost {round((result or {}).get('total_cost_usd') or 0, 4)}  "
          f"said {((result or {}).get('result') or '')[:20]!r}")
