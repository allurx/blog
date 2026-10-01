---
title: 自定义Hexo
date: 2019-08-28
id: 2019-08-28-hexo-theme-customization
tags:
  - Hexo
domain: Hexo
---

## 核心结论

图片预览和背景动画由主题插件与对应配置共同启用，修改配置后需要重新生成静态文件才能查看结果。本文保留这两项旧版主题扩展的示例；插件目录、配置键和兼容版本应以各插件维护文档为准。

## 问题与适用范围

本文回答：旧版 NexT 主题如何启用图片预览和 canvas-nest 背景效果？

本文记录 2019 年的 Hexo/NexT 扩展方式，原文没有固定具体主题版本。它用于理解历史集成场景，不代表当前博客提供这些插件或使用同样的目录结构。

## 概述

给Hexo添加图片预览和背景动画，用于理解主题扩展的配置方式。

<!-- more -->

## 图片预览

1. 进入到博客根目录

   ```bash
   $ cd blog
   ```

2. 克隆图片预览插件到next主题（对应博客主题）的`source/lib`目录下

   ```bash
   $ git clone https://github.com/theme-next/theme-next-fancybox3 ./themes/next/source/lib/fancybox
   ```

3. 修改主题的`_config.yml`文件，启用fancybox

   ```yaml
   fancybox: true
   ```

4. 重新启动hexo即可预览博客内容中的图片

   ```bash
   $ hexo clean && hexo g
   ```

## 背景动画canvas-nest

1. 进入到博客根目录

   ```bash
   $ cd blog
   ```

2. 克隆canvas-nest插件到next主题（对应博客主题）的`source/lib`目录下

   ```bash
   $ git clone https://github.com/theme-next/theme-next-canvas-nest ./themes/next/source/lib/canvas-nest
   ```

3. 修改主题的`_config.yml`文件，启用canvas-nest

   ```yaml
   # Canvas-nest
   # Dependencies: https://github.com/theme-next/theme-next-canvas-nest
   # For more information: https://github.com/hustcc/canvas-nest.js
   canvas_nest:
     enable: true
     onmobile: true # Display on mobile or not
     color: "0,0,255" # RGB values, use `,` to separate
     opacity: 0.5 # The opacity of line: 0~1
     zIndex: -1 # z-index property of the background
     count: 99 # The number of lines
   ```

4. 重新启动hexo即可看到背景动画

   ```bash
   $ hexo clean && hexo g
   ```

## 资料来源

- [NexT FancyBox 配置](https://theme-next.js.org/docs/third-party-services/external-libraries)
- [canvas-nest 插件维护源](https://github.com/theme-next/theme-next-canvas-nest)
