set shell := ["zsh", "-cu"]
set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

# Homebrew의 keg-only Node/Rust도 자동으로 찾되 CI와 다른 환경에서는 기존 PATH를 쓴다.
tool_path := if os() == "macos" { "/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/rustup/bin:" + env_var("PATH") } else { env_var("PATH") }
export PATH := tool_path

format:
    pnpm exec prettier --write .
    cargo fmt --all

lint:
    pnpm exec prettier --check .
    pnpm lint
    cargo fmt --all --check
    cargo clippy --workspace --all-targets --all-features -- -D warnings
    python scripts/check_project.py

test:
    pnpm test
    cargo test --workspace --all-features

e2e:
    pnpm tauri build --no-bundle --features e2e --config src-tauri/tauri.e2e.conf.json
    pnpm e2e

e2e-native-visual:
    @node -e 'if (process.platform !== "darwin") { console.error("e2e-native-visual은 macOS에서만 실행할 수 있습니다."); process.exit(1); }'
    QT_MANAGER_NATIVE_VISUAL=1 just e2e

e2e-build:
    pnpm build
    cargo build --package qt-manager

bundle_args := if os() == "macos" { "--bundles app,dmg" } else if os() == "windows" { "--bundles nsis" } else { "" }

package:
    pnpm tauri build {{bundle_args}}

release-check: check e2e package

generate-fixture:
    cargo run --package qt-infrastructure --example generate_legacy_fixture -- tests/fixtures/legacy-2026-anonymous.xlsx

check: lint test
