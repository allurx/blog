#!/bin/bash

# 命令之间强依赖，必须前面成功
set -e

# 替换next主题配置文件
cat ./_next_theme_config.yml > ./themes/next/_config.yml

# 删除之前生成的文件
hexo clean 

# 在public文件夹下生成web静态文件
hexo g