FROM debian:12-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server python3 \
  && rm -rf /var/lib/apt/lists/* /etc/ssh/ssh_host_* \
  && useradd -m -s /bin/bash deploy && passwd -d deploy \
  && install -d -m 0700 -o deploy -g deploy /home/deploy/.ssh
COPY sshd_config /etc/ssh/sshd_config
COPY start.sh /usr/local/bin/tq-sshd
HEALTHCHECK --interval=1s --timeout=2s --retries=8 CMD ssh-keyscan -t ed25519 -T 1 127.0.0.1 2>/dev/null | grep -q ssh-ed25519
ENTRYPOINT ["sh", "/usr/local/bin/tq-sshd"]
