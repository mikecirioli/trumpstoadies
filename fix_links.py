import os
import re

src_dir = 'trumpstoadies/src'

for root, dirs, files in os.walk(src_dir):
    for file in files:
        if file.endswith('.astro'):
            filepath = os.path.join(root, file)
            with open(filepath, 'r') as f:
                content = f.read()
            
            # Replace href="/" with href="/toadies/"
            content = re.sub(r'href="/"', r'href="/toadies/"', content)
            
            # Replace href="/some-path" with href="/toadies/some-path"
            # Ensure it does NOT replace absolute http URLs or already prefixed ones
            content = re.sub(r'href="/(?!toadies/)([^"]+)"', r'href="/toadies/\1"', content)
            
            # Replace dynamic href={`/some-path`} with href={`/toadies/some-path`}
            content = re.sub(r'href=\{`/([^`]+)`\}', r'href={`/toadies/\1`}', content)
            
            with open(filepath, 'w') as f:
                f.write(content)
print("Links correctly prefixed.")
