import os
import re

src_dir = 'trumpstoadies/src'

for root, dirs, files in os.walk(src_dir):
    for file in files:
        if file.endswith('.astro'):
            filepath = os.path.join(root, file)
            with open(filepath, 'r') as f:
                content = f.read()
            
            # Astro v5 has a `base` config property, but it DOES NOT auto-prefix standard <a> tags.
            # The correct way to prefix static links in Astro when using `base` is either:
            # 1. Manually add the base path: href="/toadies/path"
            # 2. Use import.meta.env.BASE_URL
            
            # Let's cleanly apply import.meta.env.BASE_URL with a trailing slash to all root-relative links.
            
            # Replace href="/"
            content = re.sub(r'href="/"', r'href={`${import.meta.env.BASE_URL}/`}', content)
            
            # Replace href="/path"
            content = re.sub(r'href="/([a-zA-Z0-9_-]+[a-zA-Z0-9_./-]*)?"', r'href={`${import.meta.env.BASE_URL}/\1`}', content)
            
            # Replace dynamic href={`/some-path`}
            content = re.sub(r'href=\{`/([^`]+)`\}', r'href={`${import.meta.env.BASE_URL}/\1`}', content)
            
            with open(filepath, 'w') as f:
                f.write(content)
print("Updated all links to use BASE_URL safely")
