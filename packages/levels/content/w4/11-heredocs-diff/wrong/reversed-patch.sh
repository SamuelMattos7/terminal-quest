cat > next.conf <<'CONF'
port=9090
debug=false
mode=active
CONF
diff -u next.conf engine.conf >engine.patch
patch --batch --forward engine.conf <engine.patch
