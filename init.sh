#!/bin/bash

# 命令之间强依赖，必须前面成功
set -e

# 克隆next主题
git clone https://github.com/next-theme/hexo-theme-next.git ./themes/next

# 安装所有依赖
npm install

# 手动退出命令行
read -p "Press Enter to exit..."