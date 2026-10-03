---
title: "--force-with-lease 为什么不是绝对保险"
date: 2026-09-26
updated: 2026-10-03
domain: "Git"
tags: ["Git","ForceWithLease","Concurrency"]
---

Alice 重写了本地分支，Bob 刚把新提交推到同一个远端分支。默认 `--force-with-lease` 本应因远端变化而拒绝更新，但一次后台 fetch 可能先把 `origin/feature` 推进到 Bob 的提交，随后租约检查又通过了。Alice 未整合 Bob 的工作，保护条件却已经变化。

关键在于“我以为远端是什么状态”存在哪里。默认租约借用本地的 `origin/feature`，这个引用会随 fetch 前进；显式租约则把已经确认的 OID 写进推送条件。下面沿 Alice 和 Bob 的操作比较两种做法，看看保护何时成立、又为什么会被后台更新改变。

本文以 Git 2.56 的命令语义为基线，适合已经理解提交、分支和远端跟踪引用的读者。实验使用 Windows、Git for Windows 2.56.0.windows.1 和 Bash 5.2.37；脚本仅在新建临时目录内操作本地仓库，不访问真实远端。

## 租约保护的是一个预期引用值

### 显式预期值如何决定推送能否发生

普通推送要求新提交包含远端旧提交，即更新必须是 fast-forward。重写历史后这一条件不成立，需要强制更新。

`--force-with-lease=<ref>:<expect>` 把规则改为：仅当远端 `<ref>` 当前仍指向 `<expect>` 时才更新，否则拒绝。这类似比较并交换：

```text
if remoteRef == expectedOid:
    remoteRef = newOid
else:
    reject
```

Git 官方文档说明，`--force-with-lease` 不带参数时，会用对应的 remote-tracking branch 作为预期值；只有显式指定 `<ref>:<expect>` 的形式固定了要比较的值。[git-push 文档](https://git-scm.com/docs/git-push#Documentation/git-push.txt---force-with-leaserefnameexpect)

### 默认预期值为何会被后台 fetch 改变

假设 Alice 最后确认过的远端提交是 `A`，Bob 随后把远端推进到 `B`：

- Alice 尚未 fetch：本地 `origin/feature=A`，默认租约要求远端仍为 `A`；实际为 `B`，推送被拒绝。
- 后台 fetch 后：本地 `origin/feature=B`，默认租约改为要求远端为 `B`；条件成立，即使 Alice 的新历史不包含 `B`，强制更新也可能成功。
- 显式租约：`--force-with-lease=refs/heads/feature:A` 始终要求远端仍为 Alice 真正确认过的 `A`；后台 fetch 不会改写这个参数，因此远端为 `B` 时仍会拒绝。

官方文档明确警告：不指定预期值的形式会与后台 `git fetch` 产生不良交互，并建议保存基准点或使用独立的推送 remote。[git-push 安全说明](https://git-scm.com/docs/git-push#Documentation/git-push.txt---force-with-leaserefnameexpect)

## 从审阅远端状态到执行条件推送

### 在开始重写前固定预期值

先在确认远端状态时记录 OID：

```bash
git fetch origin
expected=$(git rev-parse origin/feature)

# 完成本地 rebase 后，仅在远端仍为 expected 时更新
git push \
  --force-with-lease="refs/heads/feature:$expected" \
  origin HEAD:feature
```

这里的变量像一张保留到推送时再核对的收据：Alice 确认的是 A，就一直要求远端仍为 A。若推送前重新执行 `rev-parse origin/feature`，变量可能变成刚 fetch 下来的 B，显式参数虽然还在，原先的保护条件却已经换掉。

因此，在保存 expected 之前应检查将要替换的远端提交，确认重写范围。租约只比较 OID，不会判断 Alice 是否真正读过 Bob 的改动，也不会替团队决定谁有权重写这条分支。

### 用两个克隆观察保护条件怎样变化

下载 [force-with-lease-demo.sh](./force-with-lease-demo.sh)，在 Bash 中执行 `bash force-with-lease-demo.sh`。脚本在临时目录创建一个裸仓库及两个克隆，分别扮演远端、Alice 和 Bob，并在退出时清理这些实验数据。Windows 可使用 Git Bash，PowerShell 本身不解释脚本中的 Bash 语法。

在上述环境实际运行，三种结果如下；初始化空仓库时 Git 还可能输出提示，不影响判断：

```text
implicit lease before fetch: rejected
implicit lease after background-like fetch: succeeded and replaced Bob
explicit expected OID after fetch: rejected; Bob preserved
```

## 共享分支还需要哪些约束

- 个人分支重写前先 `fetch`、检查远端差异并保存已确认的 OID，再用显式 `<ref>:<expect>`。
- 推送前执行 `git log --graph --oneline --decorate --all` 或 `git range-diff`，确认被替换的提交范围。
- 团队主分支启用服务器端分支保护，禁止强制推送；客户端选项不能替代服务端策略。
- 若只能使用默认租约，留意 IDE、GUI、定时任务是否自动 fetch。`--force-if-includes` 可额外检查更新后的 remote-tracking tip 是否已进入本地 reflog 所代表的重写历史，但它不是显式 OID 的同义替代。[git-push `--force-if-includes`](https://git-scm.com/docs/git-push#Documentation/git-push.txt---force-if-includes)
