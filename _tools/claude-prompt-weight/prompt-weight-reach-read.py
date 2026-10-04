"""For the two reach runs: which tools were called, whether a connector call
happened and succeeded, every request's prompt size, and the answer."""
import json
import os

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'weight')

for name in ('e-search-reach', 'f-plain-reach'):
    path = os.path.join(HERE, name + '.jsonl')
    calls = []
    results = []
    prompts = []
    seen_messages = set()
    answer = None
    cost = None
    denials = None
    for line in open(path, encoding='utf-8'):
        line = line.strip()
        if not line:
            continue
        record = json.loads(line)
        kind = record.get('type')
        if kind == 'assistant':
            message = record.get('message') or {}
            usage = message.get('usage') or {}
            if message.get('id') not in seen_messages:
                seen_messages.add(message.get('id'))
                prompts.append(sum(usage.get(k) or 0 for k in ('input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens')))
            for block in message.get('content') or []:
                if block.get('type') == 'tool_use':
                    calls.append(block.get('name'))
        elif kind == 'user':
            for block in (record.get('message') or {}).get('content') or []:
                if isinstance(block, dict) and block.get('type') == 'tool_result':
                    text = block.get('content')
                    if isinstance(text, list):
                        text = ' '.join(str(part.get('text', part.get('type'))) for part in text if isinstance(part, dict))
                    results.append(('ERROR ' if block.get('is_error') else '') + str(text)[:90])
        elif kind == 'result':
            answer = (record.get('result') or '')[:80]
            cost = round(record.get('total_cost_usd') or 0, 4)
            denials = [d.get('tool_name') for d in record.get('permission_denials') or []]
    print(name)
    print('  calls   :', calls)
    print('  results :', results)
    print('  prompts :', prompts)
    print('  answer  :', repr(answer), ' cost', cost, ' denied', denials)
