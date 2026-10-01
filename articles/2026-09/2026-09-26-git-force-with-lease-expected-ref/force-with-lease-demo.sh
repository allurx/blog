#!/usr/bin/env bash
set -euo pipefail

root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT

git init --bare -q "$root/remote.git"
git clone -q "$root/remote.git" "$root/seed"
git -C "$root/seed" config user.name Seed
git -C "$root/seed" config user.email seed@example.com
git -C "$root/seed" switch -q -c main
printf 'base\n' >"$root/seed/story.txt"
git -C "$root/seed" add story.txt
git -C "$root/seed" commit -qm base
git -C "$root/seed" push -q origin main:main main:default-demo main:explicit-demo
git -C "$root/remote.git" symbolic-ref HEAD refs/heads/main

git clone -q "$root/remote.git" "$root/alice"
git clone -q "$root/remote.git" "$root/bob"
for repo in alice bob; do
  git -C "$root/$repo" config user.name "$repo"
  git -C "$root/$repo" config user.email "$repo@example.com"
done

# Scenario 1: the implicit lease uses origin/default-demo.
git -C "$root/alice" switch -q -c default-demo origin/default-demo
printf 'alice rewrite\n' >"$root/alice/story.txt"
git -C "$root/alice" commit -qam 'alice rewritten history'
alice_default="$(git -C "$root/alice" rev-parse default-demo)"

git -C "$root/bob" switch -q -c default-demo origin/default-demo
printf 'bob work\n' >>"$root/bob/story.txt"
git -C "$root/bob" commit -qam 'bob work'
git -C "$root/bob" push -q origin default-demo
bob_default="$(git -C "$root/bob" rev-parse default-demo)"

if git -C "$root/alice" push -q --force-with-lease origin default-demo 2>/dev/null; then
  echo 'unexpected: stale implicit lease succeeded' >&2
  exit 1
fi
echo "implicit lease before fetch: rejected"

git -C "$root/alice" fetch -q origin
git -C "$root/alice" push -q --force-with-lease origin default-demo
remote_default="$(git --git-dir="$root/remote.git" rev-parse refs/heads/default-demo)"
test "$remote_default" = "$alice_default"
test "$remote_default" != "$bob_default"
echo "implicit lease after background-like fetch: succeeded and replaced Bob"

# Scenario 2: an explicit expected OID remains stable across fetches.
git -C "$root/alice" switch -q -c explicit-demo origin/explicit-demo
expected="$(git -C "$root/alice" rev-parse origin/explicit-demo)"
printf 'alice explicit rewrite\n' >"$root/alice/story.txt"
git -C "$root/alice" commit -qam 'alice explicit rewritten history'

git -C "$root/bob" switch -q -c explicit-demo origin/explicit-demo
printf 'bob explicit work\n' >>"$root/bob/story.txt"
git -C "$root/bob" commit -qam 'bob explicit work'
git -C "$root/bob" push -q origin explicit-demo
bob_explicit="$(git -C "$root/bob" rev-parse explicit-demo)"

git -C "$root/alice" fetch -q origin
if git -C "$root/alice" push -q \
    --force-with-lease="refs/heads/explicit-demo:$expected" \
    origin explicit-demo 2>/dev/null; then
  echo 'unexpected: explicit stale lease succeeded' >&2
  exit 1
fi
remote_explicit="$(git --git-dir="$root/remote.git" rev-parse refs/heads/explicit-demo)"
test "$remote_explicit" = "$bob_explicit"
echo "explicit expected OID after fetch: rejected; Bob preserved"
