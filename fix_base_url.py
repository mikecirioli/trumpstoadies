import os
import re

src_dir = 'trumpstoadies/src'

for root, dirs, files in os.walk(src_dir):
    for file in files:
        if file.endswith('.astro'):
            filepath = os.path.join(root, file)
            with open(filepath, 'r') as f:
                content = f.read()
            
            # Since Astro's base URL (e.g. '/toadies') does NOT include a trailing slash,
            # but we need one when concatenating paths, we'll replace the old logic to ensure a slash is added
            
            # Replace href={`${import.meta.env.BASE_URL}/events...`} with trailing slashes
            content = re.sub(r'href=\{`\$\{import\.meta\.env\.BASE_URL\}/([^`]+)`\}', r'href={`${import.meta.env.BASE_URL}/\1/`}', content)
            
            # Remove double trailing slashes that might have been created above (e.g. /`)
            content = re.sub(r'//`\}', r'/`}', content)
            
            # Replace import.meta.env.BASE_URL + "/people" with import.meta.env.BASE_URL + "/people/"
            content = re.sub(r'href=\{import\.meta\.env\.BASE_URL \+ "/([a-zA-Z0-9_.-]+)"\}', r'href={import.meta.env.BASE_URL + "/\1/"}', content)
            
            # Ensure the query parameter links on issues page don't get a trailing slash before the ?
            content = re.sub(r'/\/\?topic', r'/?topic', content)

            with open(filepath, 'w') as f:
                f.write(content)
print("Updated trailing slashes for all links")
