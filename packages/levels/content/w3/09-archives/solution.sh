tar -czf site.tar.gz site
mkdir -p /tmp/restore
tar -xzf site.tar.gz -C /tmp/restore
tar -xOzf site.tar.gz site/config.ini >config.ini
