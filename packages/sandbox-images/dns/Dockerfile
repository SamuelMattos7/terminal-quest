FROM debian:12-slim
RUN apt-get update && apt-get install -y --no-install-recommends dnsmasq-base bind9-dnsutils \
  && rm -rf /var/lib/apt/lists/*
COPY start.sh /usr/local/bin/tq-dns
HEALTHCHECK --interval=1s --timeout=2s --retries=8 CMD dig +short +time=1 +tries=1 @127.0.0.1 db.penguin.corp | grep -q '^192\.0\.2\.'
ENTRYPOINT ["sh", "/usr/local/bin/tq-dns"]
