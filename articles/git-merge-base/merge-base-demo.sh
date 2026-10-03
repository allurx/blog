#!/usr/bin/env bash
set -euo pipefail

root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT

# 只在临时仓库构造历史，不读取或修改调用者的工作仓库。
git init -q -b main "$root"
git -C "$root" config user.name Example
git -C "$root" config user.email example@example.invalid
printf 'timeout = 10\n' >"$root/config.txt"
git -C "$root" add config.txt
git -C "$root" commit -qm base
base="$(git -C "$root" rev-parse HEAD)"
git -C "$root" branch feature

# main 修改后又恢复；feature 保留同一项修改。
printf 'timeout = 30\n' >"$root/config.txt"
git -C "$root" commit -qam 'temporary change'
printf 'timeout = 10\n' >"$root/config.txt"
git -C "$root" commit -qam 'restore original content'
git -C "$root" switch -q feature
printf 'timeout = 30\n' >"$root/config.txt"
git -C "$root" commit -qam 'feature change'
git -C "$root" switch -q main

test "$(git -C "$root" merge-base main feature)" = "$base"
echo 'merge-base: matched original baseline'
git -C "$root" merge -q --no-edit feature
test "$(cat "$root/config.txt")" = 'timeout = 30'
echo 'reverted change: merge restored timeout=30'

# 待合并分支包含当前分支时，快进直接移到已有提交。
git -C "$root" switch -q -c ahead
printf 'added\n' >"$root/extra.txt"
git -C "$root" add extra.txt
git -C "$root" commit -qm advance
ahead="$(git -C "$root" rev-parse HEAD)"
git -C "$root" switch -q main
git -C "$root" merge-base --is-ancestor main ahead
git -C "$root" merge -q --ff-only ahead
test "$(git -C "$root" rev-parse HEAD)" = "$ahead"
echo 'fast-forward: main moved to existing commit'
