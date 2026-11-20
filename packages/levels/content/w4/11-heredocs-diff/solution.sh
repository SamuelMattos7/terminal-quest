cat > next.conf <<'CONF'
port=9090
debug=false
mode=active
CONF
diff -u engine.conf next.conf >engine.patch
patch engine.conf <engine.patch
