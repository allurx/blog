---
title: "--force-with-lease 为什么不是绝对保险"
date: 2026-09-26
updated: 2026-10-01
domain: "Git"
tags: ["Git","ForceWithLease","Concurrency"]
---

Alice 重写了本地分支，Bob 刚把新提交推到同一个远端分支。默认 `--force-with-lease` 本应因远端变化而拒绝更新，但一次后台 fetch 可能先把 `origin/feature` 推进到 Bob 的提交，随后租约检查又通过了。Alice 未整合 Bob 的工作，保护条件却已经变化。

原因是默认租约借用了会被 fetch 更新的 remote-tracking ref。确需改写历史时，应保存自己已经审阅的远端 OID，并用 `--force-with-lease=<ref>:<expect>` 明确比较该值。它提供条件更新，仍不能替代分支保护或对历史重写的协作约定。

## 租约检查比较的究竟是哪一个值

普通推送要求新提交包含远端旧提交，即更新必须是 fast-forward。重写历史后这一条件不成立，需要强制更新。

`--force-with-lease=<ref>:<expect>` 把规则改为：仅当远端 `<ref>` 当前仍指向 `<expect>` 时才更新，否则拒绝。这类似比较并交换：

```text
if remoteRef == expectedOid:
    remoteRef = newOid
else:
    reject
```

Git 官方文档说明，`--force-with-lease` 不带参数时，会用对应的 remote-tracking branch 作为预期值；只有显式指定 `<ref>:<expect>` 的形式固定了要比较的值。[git-push 2.55.0 文档](https://git-scm.com/docs/git-push#Documentation/git-push.txt---force-with-leaseltrefnamegtltexpectgt)

## 后台 fetch 如何改变默认预期

假设 Alice 最后确认过的远端提交是 `A`，Bob 随后把远端推进到 `B`：

- Alice 尚未 fetch：本地 `origin/feature=A`，默认租约要求远端仍为 `A`；实际为 `B`，推送被拒绝。
- 后台 fetch 后：本地 `origin/feature=B`，默认租约改为要求远端为 `B`；条件成立，即使 Alice 的新历史不包含 `B`，强制更新也可能成功。
- 显式租约：`--force-with-lease=refs/heads/feature:A` 始终要求远端仍为 Alice 真正确认过的 `A`；后台 fetch 不会改写这个参数，因此远端为 `B` 时仍会拒绝。

官方文档明确警告：不指定预期值的形式会与后台 `git fetch` 产生不良交互，并建议保存基准点或使用独立的推送 remote。[git-push 安全说明](https://git-scm.com/docs/git-push#Documentation/git-push.txt---force-with-leaseltrefnamegtltexpectgt)

## 保存审阅过的 OID，而不是推送前重算

先在确认远端状态时记录 OID：

```bash
git fetch origin
expected=$(git rev-parse origin/feature)

# 完成本地 rebase 后，仅在远端仍为 expected 时更新
git push \
  --force-with-lease="refs/heads/feature:$expected" \
  origin HEAD:feature
```

`expected` 必须来自你实际审阅并愿意替换的远端状态，不应在推送前无条件重新计算。

文末脚本在临时目录创建本地裸仓库及两个克隆，演示远端引用发生变化时的三种结果，预期输出为：

```text
implicit lease before fetch: rejected
implicit lease after background-like fetch: succeeded and replaced Bob
explicit expected OID after fetch: rejected; Bob preserved
```

可复现实验：[force-with-lease-demo.sh](./force-with-lease-demo.sh)

## 让客户端条件更新与服务端约束配合

- 个人分支重写前先 `fetch`、检查远端差异并保存已确认的 OID，再用显式 `<ref>:<expect>`。
- 推送前执行 `git log --graph --oneline --decorate --all` 或 `git range-diff`，确认被替换的提交范围。
- 团队主分支启用服务器端分支保护，禁止强制推送；客户端选项不能替代服务端策略。
- 若只能使用默认租约，留意 IDE、GUI、定时任务是否自动 fetch。`--force-if-includes` 可额外检查更新后的 remote-tracking tip 是否已进入本地 reflog 所代表的重写历史，但它不是显式 OID 的同义替代。[git-push `--force-if-includes`](https://git-scm.com/docs/git-push#Documentation/git-push.txt---force-if-includes)
