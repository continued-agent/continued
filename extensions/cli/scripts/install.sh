#!/usr/bin/env bash
set -euo pipefail

# Continue CLI Installer - Unix (macOS, Linux, WSL, Git Bash)
# curl -fsSL https://raw.githubusercontent.com/continued-agent/continued/main/extensions/cli/scripts/install.sh | bash

REQUIRED_NODE_VERSION="20.20.1"
PACKAGE_NAME="@continuedev/cli"
CLI_COMMAND="cn"
NETWORK_TIMEOUT=60
FNM_INSTALL_DIR="$HOME/.local/share/fnm"
FNM_VERSION="1.39.0"
# The release URL defaults to a mutable GitHub tag. The adjacent checksum
# protects against transfer corruption; use CONTINUE_CLI_RELEASE_URL pointing
# at an immutable asset when the release/tag trust boundary is not sufficient.
RELEASE_URL="${CONTINUE_CLI_RELEASE_URL:-https://github.com/continued-agent/continued/releases/download/cli-latest/continue-cli.tgz}"
CHECKSUM_URL="${RELEASE_URL}.sha256"

# Cleanup tracking
CLEANUP_FNM=false
INSTALL_TEMP_DIR=""

# Colors
if [ -t 1 ] && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
    RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m'
    BLUE='\033[0;34m' BOLD='\033[1m' NC='\033[0m'
else
    RED='' GREEN='' YELLOW='' BLUE='' BOLD='' NC=''
fi

info()    { printf "${BLUE}==>${NC} ${BOLD}%s${NC}\n" "$1"; }
success() { printf "${GREEN}==>${NC} ${BOLD}%s${NC}\n" "$1"; }
warn()    { printf "${YELLOW}==> Warning:${NC} %s\n" "$1"; }
error()   { printf "${RED}==> Error:${NC} %s\n" "$1" >&2; exit 1; }

cleanup() {
    local exit_code=$?
    if [ -n "$INSTALL_TEMP_DIR" ] && [ -d "$INSTALL_TEMP_DIR" ]; then
        rm -rf "$INSTALL_TEMP_DIR" 2>/dev/null || true
    fi
    if [ $exit_code -ne 0 ]; then
        warn "Installation failed. Cleaning up..."
        if [ "$CLEANUP_FNM" = true ] && [ -d "$FNM_INSTALL_DIR" ]; then
            rm -rf "$FNM_INSTALL_DIR" 2>/dev/null || true
        fi
    fi
    exit $exit_code
}
trap cleanup EXIT

PLATFORM=""
ARCH=""
SHELL_PROFILE=""
SHELL_TYPE=""

check_dependencies() {
    local missing_deps=()

    if ! command -v curl &>/dev/null && ! command -v wget &>/dev/null; then
        missing_deps+=("curl or wget")
    fi

    if ! command -v sha256sum &>/dev/null && ! command -v shasum &>/dev/null; then
        missing_deps+=("sha256sum or shasum")
    fi

    if [ ${#missing_deps[@]} -gt 0 ]; then
        error "Missing required dependencies: ${missing_deps[*]}. Please install them first."
    fi
}

download() {
    local url="$1"
    local output="${2:-}"

    if command -v curl &>/dev/null; then
        if [ -n "$output" ]; then
            curl -fsSL --connect-timeout "$NETWORK_TIMEOUT" --max-time $((NETWORK_TIMEOUT * 3)) -o "$output" "$url"
        else
            curl -fsSL --connect-timeout "$NETWORK_TIMEOUT" --max-time $((NETWORK_TIMEOUT * 3)) "$url"
        fi
    elif command -v wget &>/dev/null; then
        if [ -n "$output" ]; then
            wget -q --timeout="$NETWORK_TIMEOUT" -O "$output" "$url"
        else
            wget -q --timeout="$NETWORK_TIMEOUT" -O - "$url"
        fi
    else
        error "Neither curl nor wget found. Please install one of them."
    fi
}

detect_platform() {
    local os arch
    os="$(uname -s)"
    arch="$(uname -m)"

    case "$os" in
        Linux*)                          PLATFORM="linux" ;;
        Darwin*)                         PLATFORM="darwin" ;;
        MINGW*|MSYS*|CYGWIN*|Windows_NT) PLATFORM="windows" ;;
        *)                               error "Unsupported OS: $os. Use install.ps1 for Windows." ;;
    esac

    case "$arch" in
        x86_64|amd64)  ARCH="x64" ;;
        arm64|aarch64) ARCH="arm64" ;;
        armv7l)        ARCH="armv7l" ;;
        i386|i686)     error "32-bit systems are not supported" ;;
        *)             error "Unsupported architecture: $arch" ;;
    esac

    info "Detected platform: $PLATFORM-$ARCH"
}

detect_shell_profile() {
    local current_shell
    current_shell="$(basename "${SHELL:-/bin/bash}")"
    SHELL_TYPE="$current_shell"

    case "$current_shell" in
        zsh)  SHELL_PROFILE="$HOME/.zshrc" ;;
        bash)
            if [ "$PLATFORM" = "darwin" ]; then
                SHELL_PROFILE="$HOME/.bash_profile"
            else
                SHELL_PROFILE="$HOME/.bashrc"
            fi
            ;;
        fish)
            SHELL_PROFILE="$HOME/.config/fish/config.fish"
            mkdir -p "$HOME/.config/fish"
            ;;
        *)
            for f in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
                [ -f "$f" ] && SHELL_PROFILE="$f" && break
            done
            [ -z "$SHELL_PROFILE" ] && SHELL_PROFILE="$HOME/.bashrc"
            ;;
    esac
    touch "$SHELL_PROFILE"
    info "Using shell profile: $SHELL_PROFILE"
}

version_gte() {
    local current="${1#v}"
    local required="${2#v}"

    # Use POSIX awk rather than sort -V, which is unavailable on macOS's
    # default userland. Node reports a normal three-component semver here.
    current="${current%%-*}"
    current="${current%%+*}"
    required="${required%%-*}"
    required="${required%%+*}"
    awk -F. -v current="$current" -v required="$required" '
      BEGIN {
        split(current, c); split(required, r);
        for (i = 1; i <= 3; i++) {
          if ((c[i] + 0) > (r[i] + 0)) exit 0;
          if ((c[i] + 0) < (r[i] + 0)) exit 1;
        }
        exit 0;
      }
    '
}

source_nvm() {
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    if [ -s "$NVM_DIR/nvm.sh" ]; then
        # shellcheck source=/dev/null
        . "$NVM_DIR/nvm.sh"
    fi
}

source_fnm() {
    for fnm_path in "$HOME/.local/share/fnm" "$HOME/.fnm" "${FNM_DIR:-}"; do
        if [ -n "$fnm_path" ] && [ -d "$fnm_path" ]; then
            export PATH="$fnm_path:$PATH"
            break
        fi
    done
    command -v fnm &>/dev/null && eval "$(fnm env --shell bash 2>/dev/null || true)"
}

check_node() {
    source_nvm
    source_fnm

    if command -v node &>/dev/null; then
        local current_version
        current_version=$(node -v 2>/dev/null | sed 's/^v//')

        if [ -n "$current_version" ]; then
            info "Found Node.js v$current_version"
            if version_gte "$current_version" "$REQUIRED_NODE_VERSION"; then
                success "Node.js meets requirements (>= v$REQUIRED_NODE_VERSION)"
                return 0
            fi
            warn "Node.js v$current_version is below required v$REQUIRED_NODE_VERSION"
            return 1
        fi
    fi

    warn "Node.js is not installed"
    return 1
}

install_node() {
    # Only mark for cleanup if fnm directory doesn't already exist
    if [ ! -d "$FNM_INSTALL_DIR" ]; then
        CLEANUP_FNM=true
    fi
    info "Installing fnm (Fast Node Manager) v$FNM_VERSION..."

    if ! command -v unzip &>/dev/null; then
        error "Missing required dependency: unzip. Please install it before installing Node.js."
    fi

    local fnm_asset fnm_sha256 fnm_binary
    case "$PLATFORM:$ARCH" in
        linux:x64)
            fnm_asset="fnm-linux.zip"
            fnm_sha256="7807664f39d39fc518da1c35ba0181e4b3267603c4b1dedeb4b5fc6ae440a224"
            fnm_binary="fnm"
            ;;
        linux:arm64)
            fnm_asset="fnm-arm64.zip"
            fnm_sha256="4eaff58b2c5bf30d0934027572dd0b5bbb60d2a1af309230b53662d4b1d45599"
            fnm_binary="fnm"
            ;;
        linux:armv7l)
            fnm_asset="fnm-arm32.zip"
            fnm_sha256="3d11d96a49d49cb3f11051a1aabf968fce30db665e79ee7d81851059731fa4ac"
            fnm_binary="fnm"
            ;;
        darwin:x64|darwin:arm64)
            fnm_asset="fnm-macos.zip"
            fnm_sha256="f046483e85c53b3278efe49a3620c8680f22efa58a8dabfd03eafc6b59b31a25"
            fnm_binary="fnm"
            ;;
        windows:x64|windows:arm64)
            fnm_asset="fnm-windows.zip"
            fnm_sha256="8183bed4348cb78fdfd8abb3d1247fbeab7b2082f941363929c61e747c001e10"
            fnm_binary="fnm.exe"
            ;;
        *)
            error "No pinned fnm binary is available for $PLATFORM-$ARCH. Install Node.js $REQUIRED_NODE_VERSION manually."
            ;;
    esac

    mkdir -p "$FNM_INSTALL_DIR"
    local fnm_temp_dir fnm_archive fnm_checksum_file archive_entries
    fnm_temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/continue-fnm.XXXXXX")"
    INSTALL_TEMP_DIR="$fnm_temp_dir"
    fnm_archive="$fnm_temp_dir/$fnm_asset"
    fnm_checksum_file="$fnm_temp_dir/$fnm_asset.sha256"

    if ! download "https://github.com/Schniz/fnm/releases/download/v$FNM_VERSION/$fnm_asset" "$fnm_archive"; then
        error "Failed to download pinned fnm v$FNM_VERSION. Check your network connection and try again."
    fi

    printf '%s  %s\n' "$fnm_sha256" "$fnm_asset" > "$fnm_checksum_file"
    verify_checksum "$fnm_archive" "$fnm_checksum_file"

    archive_entries="$(unzip -Z1 "$fnm_archive" | tr -d '\r')"
    if [ "$archive_entries" != "$fnm_binary" ]; then
        error "The pinned fnm archive contains unexpected files."
    fi

    if ! unzip -q -o "$fnm_archive" -d "$FNM_INSTALL_DIR"; then
        error "Failed to extract pinned fnm archive."
    fi

    chmod +x "$FNM_INSTALL_DIR/$fnm_binary"
    rm -rf "$fnm_temp_dir"
    INSTALL_TEMP_DIR=""

    if [ ! -x "$FNM_INSTALL_DIR/$fnm_binary" ]; then
        error "fnm installation failed - binary not found at $FNM_INSTALL_DIR/$fnm_binary"
    fi

    export PATH="$FNM_INSTALL_DIR:$PATH"

    # Initialize fnm for current session
    if ! eval "$(fnm env --shell bash 2>/dev/null)"; then
        error "Failed to initialize fnm environment"
    fi

    info "Installing Node.js v$REQUIRED_NODE_VERSION..."
    if ! fnm install "$REQUIRED_NODE_VERSION"; then
        error "Failed to install Node.js v$REQUIRED_NODE_VERSION"
    fi

    fnm use "$REQUIRED_NODE_VERSION"
    fnm default "$REQUIRED_NODE_VERSION"

    # Verify node is working
    if ! command -v node &>/dev/null; then
        error "Node.js installation succeeded but 'node' command not found in PATH"
    fi

    # Add to shell profile with shell-specific syntax
    add_fnm_to_profile

    CLEANUP_FNM=false
    success "Node.js v$REQUIRED_NODE_VERSION installed"
}

add_fnm_to_profile() {
    case "$SHELL_TYPE" in
        fish)
            add_to_profile "set -gx PATH \"$FNM_INSTALL_DIR\" \$PATH" "$FNM_INSTALL_DIR"
            add_to_profile 'fnm env --use-on-cd --shell fish | source' 'fnm env'
            ;;
        zsh|bash|*)
            add_to_profile "export PATH=\"$FNM_INSTALL_DIR:\$PATH\"" "$FNM_INSTALL_DIR"
            add_to_profile "eval \"\$(fnm env --use-on-cd --shell $SHELL_TYPE)\"" 'fnm env'
            ;;
    esac
}

add_to_profile() {
    local line="$1" check="$2"
    grep -q "$check" "$SHELL_PROFILE" 2>/dev/null || echo "$line" >> "$SHELL_PROFILE"
}

setup_npm_path() {
    local npm_bin
    npm_bin="$(npm config get prefix 2>/dev/null)/bin"
    [ -d "$npm_bin" ] && export PATH="$npm_bin:$PATH"
}

check_npm_permissions() {
    local npm_prefix
    npm_prefix="$(npm config get prefix 2>/dev/null)"

    # Check if we can write to npm global directory
    if [ -d "$npm_prefix/lib" ] && [ ! -w "$npm_prefix/lib" ]; then
        warn "Cannot write to npm global directory: $npm_prefix/lib"
        info "Attempting to fix npm permissions..."

        # Try to use npm prefix in user directory
        local user_npm_dir="$HOME/.npm-global"
        mkdir -p "$user_npm_dir"
        npm config set prefix "$user_npm_dir"
        export PATH="$user_npm_dir/bin:$PATH"

        add_to_profile "export PATH=\"$user_npm_dir/bin:\$PATH\"" ".npm-global/bin"
        info "Configured npm to use $user_npm_dir"
    fi
}

install_cli() {
    info "Installing $PACKAGE_NAME from the continued-agent/continued release..."

    if ! command -v npm &>/dev/null; then
        error "npm was not found after Node.js setup. Please restart your shell and try again."
    fi

    check_npm_permissions

    INSTALL_TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/continue-cli.XXXXXX")"
    local archive="$INSTALL_TEMP_DIR/continue-cli.tgz"
    local checksum="$INSTALL_TEMP_DIR/continue-cli.tgz.sha256"

    info "Downloading the prebuilt CLI..."
    if ! download "$RELEASE_URL" "$archive"; then
        error "Could not download the fork release. The cli-latest release may not have been published yet: $RELEASE_URL"
    fi

    info "Downloading the release checksum..."
    if ! download "$CHECKSUM_URL" "$checksum"; then
        error "Could not download the release checksum: $CHECKSUM_URL"
    fi

    verify_checksum "$archive" "$checksum"

    local npm_output
    local npm_exit_code=0

    npm_output=$(npm install -g "$archive" --ignore-scripts --omit=dev 2>&1) || npm_exit_code=$?

    if [ $npm_exit_code -ne 0 ]; then
        echo "$npm_output" >&2
        error "Failed to install $PACKAGE_NAME (exit code: $npm_exit_code)"
    fi

    # Verify installation
    setup_npm_path
    if ! command -v "$CLI_COMMAND" &>/dev/null; then
        warn "$CLI_COMMAND not found in PATH after installation"
        warn "You may need to restart your shell or source your profile"
    fi

    success "$PACKAGE_NAME installed!"
}

verify_checksum() {
    local archive="$1"
    local checksum_file="$2"
    local expected actual

    expected="$(awk 'NF { print $1; exit }' "$checksum_file")"
    if [[ ! "$expected" =~ ^[[:xdigit:]]{64}$ ]]; then
        error "The release checksum has an invalid format."
    fi

    if command -v sha256sum &>/dev/null; then
        actual="$(sha256sum "$archive" | awk '{print $1}')"
    else
        actual="$(shasum -a 256 "$archive" | awk '{print $1}')"
    fi

    expected="$(printf '%s' "$expected" | tr '[:upper:]' '[:lower:]')"
    actual="$(printf '%s' "$actual" | tr '[:upper:]' '[:lower:]')"
    if [ "$expected" != "$actual" ]; then
        error "The downloaded CLI checksum does not match the release checksum."
    fi

    success "Verified the CLI release checksum"
}

finalize() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    success "Continue CLI installation complete!"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    if command -v "$CLI_COMMAND" &>/dev/null; then
        success "Ready! Run: $CLI_COMMAND --help"
    else
        printf "Run ${BOLD}source %s${NC} or open a new terminal\n" "$SHELL_PROFILE"
        printf "Then: ${BOLD}%s --help${NC}\n" "$CLI_COMMAND"
    fi
    echo ""
}

main() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    printf "%s           Continue CLI Installer%s\n" "$BOLD" "$NC"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    check_dependencies
    detect_platform
    detect_shell_profile
    check_node || install_node
    setup_npm_path
    install_cli
    finalize
}

# Allow sourcing without running
if [[ "${BASH_SOURCE[0]:-}" == "${0}" ]] || [ -z "${BASH_SOURCE[0]:-}" ]; then
    main "$@"
fi
