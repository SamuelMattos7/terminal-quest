cat > hello.sh <<'TQ_SCRIPT'
#!/bin/bash
printf 'Hello, %s\n' "$(whoami)"
TQ_SCRIPT
chmod +x hello.sh
