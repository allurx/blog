#!/bin/bash

# 命令之间强依赖，必须前面成功
set -e

# 克隆next主题
git clone https://github.com/next-theme/hexo-theme-next.git ./themes/next

# 替换next主题配置文件
cat ./_next_theme_config.yml > ./themes/next/_config.yml 

# 安装搜索插件
npm install hexo-generator-searchdb --save 

# 安装所有依赖
npm install

# 手动退出命令行
read -p "Press Enter to exit..."