Check the JavaScript syntax of index.html.

Run:
```bash
python3 -c "
import re
html = open('index.html').read()
blocks = re.findall(r'<script[^>]*>(.*?)</script>', html, re.DOTALL)
open('/tmp/check.js', 'w').write(max(blocks, key=len))
" && node --check /tmp/check.js && echo 'SYNTAX OK'
```

Report: print "SYNTAX OK" if clean, or show the error with its line number.
