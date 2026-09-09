#!/usr/bin/env bash

set -euo pipefail

public_key_file="${CONTINUE_SSH_PUBLIC_KEY_FILE:-${HOME}/.ssh/id_ed25519.pub}"
if [[ ! -r "$public_key_file" ]]; then
  echo "No readable public key at $public_key_file." >&2
  echo "Set CONTINUE_SSH_PUBLIC_KEY_FILE to the key you want to authorize." >&2
  exit 1
fi

authorized_keys_file="$(mktemp)"
trap 'rm -f "$authorized_keys_file" authorized_keys Dockerfile' EXIT
cp "$public_key_file" "$authorized_keys_file"

cat > Dockerfile <<'EOF'
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssh-server \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/bash continue \
    && mkdir -p /run/sshd /home/continue/.ssh \
    && chown -R continue:continue /home/continue/.ssh \
    && chmod 700 /home/continue/.ssh

COPY --chown=continue:continue authorized_keys /home/continue/.ssh/authorized_keys
RUN chmod 600 /home/continue/.ssh/authorized_keys \
    && printf '%s\n' \
      'PermitRootLogin no' \
      'PasswordAuthentication no' \
      'KbdInteractiveAuthentication no' \
      'AllowUsers continue' \
      >> /etc/ssh/sshd_config

EXPOSE 22
CMD ["/usr/sbin/sshd", "-D", "-e"]
EOF

cp "$authorized_keys_file" authorized_keys
docker build -t continue-ubuntu-ssh .

container_name="continue-ssh-container"
docker run -d -p 127.0.0.1:2222:22 --name "$container_name" continue-ubuntu-ssh

echo "Container ${container_name} is listening only on localhost:2222."
echo "Connect with: ssh continue@localhost -p 2222"
