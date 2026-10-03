---
title: 为 NexT 配置图片预览与背景动效
date: 2019-08-28
updated: 2026-10-03
tags: [Hexo, NexT, 前端]
domain: Hexo
---

技术图缩到正文宽度后，节点上的小字可能已经读不清。点击放大能直接改善阅读；页面背景的缓慢变化则只负责营造视觉氛围，不应该抢走注意力。这里分别用 NexT 的图片预览集成和一个 CSS 背景实现它们。

完成后的页面有三种表现：宽屏显示轻微移动的渐变，要求减少动态效果时保留静态渐变，窄屏直接省去装饰。图片预览独立工作，打开和关闭之后应能继续原来的阅读。

本文基线为 **Hexo 8.1.2、NexT 8.29.0、Node.js 24.19.0 LTS、npm 12.2.0**，主题方案采用 Gemini。先按[Hexo 与 NexT 入门](/hexo-writing/)建立站点。所有路径都相对于站点根目录；主题设置保存在 `_config.next.yml`。浏览器需要支持 CSS 媒体查询、渐变与 transform，这些能力不依赖额外背景动画库。

## 先让读者能看清正文里的图

### 准备一张适合放大查看的图片

先下载下面的[预览测试图](./images/preview-demo.svg)，保存为 Hexo 站点的 `source/images/preview-demo.svg`。它是本例自制的矢量示意图，包含较小的细节文字，便于比较正文缩放与打开原图后的阅读效果。

[![图片预览测试图，依次展示请求、处理、响应](./images/preview-demo.svg)](./images/preview-demo.svg)

在一篇测试文章中引用：

```md
![请求、处理与响应](/images/preview-demo.svg)
```

这里的 `/images/` 指生成后站点根路径；如果博客部署在子路径，应按 Hexo 的 root 与链接规则调整。正文中只有一个图片元素，接下来交给主题的图片预览集成处理。

### 启用主题自带的图片预览

NexT 支持 Fancybox 和 Medium Zoom。Fancybox 提供灯箱式浏览，Medium Zoom 更接近在正文中直接放大图片；选择一种即可，避免两个处理器同时响应同一次点击。[NexT 图片预览配置](https://theme-next.js.org/docs/third-party-services/external-libraries)

本例在 `_config.next.yml` 中保留已有 `scheme: Gemini`，添加：

```yaml
fancybox: true
mediumzoom: false
```

图片存在、主题开关正确和前端资源能加载，是三个独立条件。NexT 的第三方资源默认可由 CDN 提供；生成成功不能证明浏览器已取得预览脚本。如果图片显示但点击没有预期效果，先看资源请求与控制台，再核对配置。[NexT 第三方资源](https://theme-next.js.org/docs/third-party-services/)

## 给宽屏加入轻量背景

### 用自定义模板保存扩展

NexT 8 使用 Nunjucks 模板。下载本例的 [body-end.njk](./body-end.njk)，保存到 `source/_data/body-end.njk`，再把它接到 `_config.next.yml`：

```yaml
custom_file_path:
  bodyEnd: source/_data/body-end.njk
```

已有 custom_file_path 时，在同一个映射下补 bodyEnd，不要重复声明整个键。模板单独保存，升级或重新安装 `node_modules` 不会覆盖它。[NexT 自定义文件入口](https://theme-next.js.org/docs/advanced-settings/custom-files.html)

附件里的核心是一个背景伪元素：

```css
body {
  isolation: isolate;
}

@media (min-width: 64rem) {
  body::before {
    content: '';
    position: fixed;
    inset: -15vmax;
    z-index: -1;
    pointer-events: none;
    background:
      radial-gradient(ellipse at 20% 30%, rgb(117 154 230 / 20%), transparent 45%),
      radial-gradient(ellipse at 80% 70%, rgb(126 196 190 / 18%), transparent 45%);
  }
}
```

可以先把动画关掉，只检查静态效果：背景应在内容面板后方，链接仍能正常点击。`isolation` 建立堆叠上下文，负 z-index 将渐变放到内容后面；`pointer-events: none` 让装饰不参与指针命中。这样，背景的位置和交互责任在加动画之前就已经确定。

### 在适合的空间和动态偏好下启用动画

完整模板只在宽屏且用户没有要求减少动态效果时应用动画：

```css
@media (min-width: 64rem) and (prefers-reduced-motion: no-preference) {
  body::before {
    animation: allurx-ambient-pan 20s ease-in-out infinite alternate;
  }
}

@keyframes allurx-ambient-pan {
  from { transform: translate3d(-2%, -1%, 0); }
  to { transform: translate3d(2%, 1%, 0); }
}
```

窄屏时不创建背景伪元素；宽屏减少动态效果时保留静态渐变。媒体查询会在窗口尺寸或偏好改变时重新生效，不需要脚本维护加载、销毁或全局鼠标事件。20 秒和位移幅度只是本例的视觉参数，不是性能指标。

如果站点已有 body 伪元素或特殊堆叠布局，应先合并样式责任，不能直接覆盖已有主题扩展。背景色、透明度和面板遮挡也要结合实际深浅主题判断；装饰与阅读冲突时，应降低装饰或移除它。

## 打开图片，再回到正文检查效果

在站点根目录运行：

```sh
npx hexo clean
npx hexo generate --bail
npx hexo server
```

打开实际测试文章，完成图片打开、放大、关闭，检查返回正文的位置和键盘焦点。再连续缩窄与放宽窗口，切换减少动态效果与深浅主题，确认背景跟随条件变化、正文对比度和链接点击没有受影响。

若图片能显示却不能放大，重点看预览脚本的网络请求与控制台；若放大正常而背景遮住正文，重点看堆叠关系和主题面板样式。两项功能分别验证，才能准确定位问题。
