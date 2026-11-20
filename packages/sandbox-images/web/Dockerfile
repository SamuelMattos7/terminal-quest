FROM debian:12-slim
RUN apt-get update && apt-get install -y --no-install-recommends nginx curl \
  && rm -rf /var/lib/apt/lists/*
COPY nginx.conf /etc/nginx/nginx.conf
COPY index.html /srv/intranet/index.html
USER www-data
HEALTHCHECK --interval=1s --timeout=2s --retries=8 CMD curl -fsS http://127.0.0.1/status || exit 1
CMD ["nginx", "-g", "daemon off;"]
