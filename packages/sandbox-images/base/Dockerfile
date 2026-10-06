# tq-base: sandbox image for Terminal Quest player containers (plan.md §7.1).
# Debian 12 slim + the full tool set for Worlds 1-5. Player runs as `player`
# (uid 1000); checks and setup run as root via `docker exec` (T1.2).
FROM debian:12-slim

ENV LANG=C.UTF-8 \
    TERM=xterm-256color \
    HISTSIZE=10000

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash coreutils findutils grep sed gawk less nano vim \
    man-db manpages manpages-dev \
    procps psmisc iproute2 iputils-ping curl netcat-openbsd dnsutils openssh-client \
    tar gzip bzip2 xz-utils zip unzip \
    jq cron rsync tmux git sudo lsof strace shellcheck bats file tree \
    ncurses-term locales python3 python3-croniter \
  && rm -rf /var/lib/apt/lists/* \
  && useradd -m -u 1000 -s /bin/bash player \
  && passwd -l root \
  && passwd -l player \
  # No `su` for player in the base image (plan.md §7.1). The `admin`
  # profile re-enables what it needs via per-level setup (T2.2).
  && chmod 0750 /bin/su /usr/bin/su \
  && mkdir -p /run/tq /opt/tq/secret \
  && chmod 0755 /opt/tq \
  && chmod 0700 /opt/tq/secret

# /opt/tq helpers: root-owned, player can read and execute, never write.
COPY tq/ /opt/tq/
RUN chown -R root:root /opt/tq \
  && chmod 0755 /opt/tq \
  && chmod 0644 /opt/tq/bashrc \
  && chmod 0755 /opt/tq/bin/* \
  && chmod 0644 /opt/tq/cheats/* \
  && chown -R player:player /home/player

USER player
WORKDIR /home/player
CMD ["bash"]
