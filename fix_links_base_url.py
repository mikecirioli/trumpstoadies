import os
import re

src_dir = 'trumpstoadies/src'

for root, dirs, files in os.walk(src_dir):
    for file in files:
        if file.endswith('.astro'):
            filepath = os.path.join(root, file)
            with open(filepath, 'r') as f:
                content = f.read()
            
            # 1. href="/"
            content = re.sub(r'href="/"', r'href={import.meta.env.BASE_URL}', content)
            
            # 2. href="/something" (excluding absolute http/s and already imported ones)
            # We want to replace href="/people" with href={import.meta.env.BASE_URL + "people"}
            content = re.sub(r'href="/([a-zA-Z0-9_-]+[a-zA-Z0-9_./-]*)"', r'href={import.meta.env.BASE_URL + "\1"}', content)
            
            # 3. Dynamic strings: href={`/events/${...}`}
            content = re.sub(r'href=\{`/([^`]+)`\}', r'href={`${import.meta.env.BASE_URL}\1`}', content)
            
            with open(filepath, 'w') as f:
                f.write(content)
print("Updated all Astro files to use BASE_URL")
