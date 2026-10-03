---
title: 用 Git Hook 触发 Hexo 构建与发布
date: 2018-10-05
updated: 2026-10-03
tags: [Hexo, Git, Git-Hook, 自动部署]
domain: Hexo
---

Git 推送可以触发博客构建，但“代码已经保存”和“页面已经发布”是两个不同的结果。可靠的发布流程需要明确构建哪个提交，并在构建成功后才替换线上入口，避免访问者看到生成到一半的目录。

下面面向 **Ubuntu 26.04 LTS** 这类使用 GNU 工具链的 Linux 服务器。目标软件组合为 **Git 2.56.0、Bash 5.x、Node.js 24.19.0 LTS、npm 12.2.0、nginx 1.30.5 stable**；`mv -T`、`mktemp` 来自 GNU coreutils，`flock` 来自 util-linux，使用发行版仍受维护的包。Hexo 8.1.2 与 NexT 8.29.0 的依赖准备见[入门文章](/hexo-writing/)。这些是部署目标条件，本文没有把 Windows 上的脚本解析或静态构建等同于完整 Linux 部署实测。[Ubuntu 支持周期](https://ubuntu.com/about/release-cycle)、[nginx 发行分支](https://nginx.org/en/download.html)

部署账号通过 SSH 接收推送，具有专用目录的写权限；仓库中的构建代码由可信维护者提交。部署前分别运行 `bash --version`、`git --version`、`node --version`、`npm --version`、`mv --version`、`flock --version` 和 `nginx -v`，确认实际安装包与目标能力。macOS 的 BSD 工具和 Windows Git Bash 不能直接当作这套服务端环境。

## 保存完整项目，监听准确的分支

版本库应保存完整 Hexo 项目，包括文章、站点配置、`_config.next.yml`、自定义资源和 `package-lock.json`。只保存 `source/` 会让主题、插件和构建条件游离在文章版本之外。项目准备可参考[Hexo 与 NexT 入门](/hexo-writing/)。

在服务器上，以部署账号创建专用目录和裸仓库。以下路径是本文完整示例的约定，实际使用时统一替换为该账号有权管理的目录：

```sh
mkdir -p /srv/blog/releases
git init --bare --initial-branch=main /srv/blog/repo.git
```

在本地项目中配置 SSH 远端；将 `deploy` 和 `server.example` 替换为实际账号与主机：

```sh
git remote add deploy deploy@server.example:/srv/blog/repo.git
git push deploy main
```

服务器使用 `post-receive`，它从标准输入接收 `旧提交 新提交 引用名`。只处理 `refs/heads/main`，忽略其他分支和删除引用。不能无条件构建裸仓库的 `HEAD`，因为它不一定指向刚被更新的分支。[Git 接收钩子](https://git-scm.com/docs/githooks#post-receive)

## 在独立目录构建，再切换入口

将以下内容保存为 `/srv/blog/repo.git/hooks/post-receive`。脚本按阶段处理：筛选主分支更新、串行化部署、导出确切提交、安装并构建，最后替换静态入口。

```bash
#!/usr/bin/env bash
set -euo pipefail
umask 022

repository=/srv/blog/repo.git
release_root=/srv/blog/releases
site_link=/srv/blog/current

requested=
while read -r previous revision reference; do
  if [[ "$reference" == refs/heads/main && ! "$revision" =~ ^0+$ ]]; then
    requested=$revision
  fi
done
[[ -n "$requested" ]] || exit 0

# 同一站点串行发布；等待锁后以主分支当前提交为准。
exec 9>/srv/blog/deploy.lock
flock 9
revision=$(git --git-dir="$repository" rev-parse refs/heads/main)
release=$(mktemp -d "$release_root/$revision.XXXXXX")
git --git-dir="$repository" archive "$revision" | tar -x -C "$release"

# 接收钩子的 Git 环境不能泄漏到构建工具调用的其他仓库。
while read -r variable; do
  unset "$variable"
done < <(git rev-parse --local-env-vars)

# PATH 必须包含部署账号安装的 node/npm；不要依赖交互式 shell 的版本管理初始化。
cd "$release"
npm ci
./node_modules/.bin/hexo generate --bail
test -s public/index.html
chmod 755 "$release"

# 构建期间若主分支已推进，把发布交给该次推送的钩子。
latest=$(git --git-dir="$repository" rev-parse refs/heads/main)
if [[ "$revision" != "$latest" ]]; then
  printf 'Built %s; main advanced to %s, skip activation.\n' "$revision" "$latest"
  exit 0
fi

# 临时链接与正式链接位于同一文件系统；current 必须不存在或为符号链接。
if [[ -e "$site_link" && ! -L "$site_link" ]]; then
  printf 'Refusing to replace non-symlink: %s\n' "$site_link" >&2
  exit 1
fi
next_link="/srv/blog/.current-$(basename "$release")"
ln -s "$release/public" "$next_link"
mv -Tf "$next_link" "$site_link"
printf 'Published %s\n' "$revision"
```

赋予执行权限：

```sh
chmod +x /srv/blog/repo.git/hooks/post-receive
```

`git archive` 根据指定提交导出项目，子模块内容不会自动展开，因此这个示例使用 npm 管理 NexT，而不把主题藏在未导出的子模块中。[Git archive](https://git-scm.com/docs/git-archive)

`flock` 让两个推送触发的构建顺序执行。取得锁后重新读取主分支，可以避免等待中的旧钩子最终把较旧版本覆盖到线上。构建后再次检查分支，能跳过已知过期产物；它不是 Git 引用与文件系统之间的原子事务，极短的竞争窗口中仍可能先激活一个完整版本，再由下一次钩子发布新版本。[flock 使用方式](https://man7.org/linux/man-pages/man1/flock.1.html)

构建失败时，`current` 仍指向上一次成功产物；失败目录留在 `releases/`，便于排查。符号链接切换避免新请求命中半成品，但不能使已经打开页面的后续资源请求固定到同一个版本。需要严格保持跨请求版本一致时，应使用带版本的资源 URL，并保留相应版本资源。

## 让 Web 服务器只暴露生成文件

nginx 的站点配置可以使用以下最小结构，将 `server_name` 替换为真实域名。TLS、访问权限和站点配置加载按服务器现有管理方式完成：

```nginx
server {
    listen 80;
    server_name blog.example;
    root /srv/blog/current;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

Web 根目录指向生成后的 `public/`，不能指向 Git 仓库或项目根目录，后两者包含源码与构建资料。脚本使用 `umask 022`，并在构建成功后为 `mktemp` 创建的发布目录设置 `755`；否则该目录默认只有部署账号能进入，独立运行的 nginx 进程会无法访问。还需确保 `/srv/blog`、`releases` 等父目录允许 nginx 遍历，生成文件允许它读取；部署账号负责构建和切换链接。[nginx 静态文件服务](https://nginx.org/en/docs/beginners_guide.html#static)

## 分别确认保存、构建和页面

安装 hook 后再次推送一次真实内容变更，查看远端输出中的提交号，再核对 `/srv/blog/current` 指向的目录和公开文章的关键正文。首次配置没有新的提交时，可以在服务器上向 hook 输入一条该分支的更新记录来重新部署，不必制造一篇新文章：

```sh
revision=$(git --git-dir=/srv/blog/repo.git rev-parse refs/heads/main)
printf '%s %s %s\n' "$revision" "$revision" refs/heads/main |
  (cd /srv/blog/repo.git && hooks/post-receive)
```

`post-receive` 在引用更新之后执行，失败不会撤销已经保存的 Git 提交。因此推送成功不能代替构建与页面核验，构建失败也不需要重新提交同一篇正文。

发布目录的清理应另外安排，只删除确认不再被入口或资源引用的版本。这份脚本不自动删除版本，也不把可恢复的构建失败扩大为线上内容丢失。
